#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const inputDir = path.join(repoRoot, "data/private/extracted")
const publicOutputPath = path.join(repoRoot, "data/processed/course-outline.json")
const privateGeneratedDir = path.join(repoRoot, "data/private/generated")
const privateUncertainPath = path.join(
  privateGeneratedDir,
  "course-outline-uncertain.json",
)

const topicCatalog = [
  {
    id: "basic-probability",
    name: "Basic probability",
    terms: ["probability", "sample space", "event", "outcome", "complement"],
    learningObjectives: [
      "Identify sample spaces, events, and complements.",
      "Compute probabilities as favorable outcomes divided by total outcomes.",
    ],
    misconceptions: [
      "Using the wrong denominator for the sample space.",
      "Confusing an event with its complement.",
    ],
  },
  {
    id: "counting",
    name: "Counting",
    terms: ["counting", "permutation", "combination", "factorial", "choose"],
    learningObjectives: [
      "Choose between permutations, combinations, and the multiplication rule.",
      "Count outcomes without listing every case.",
    ],
    misconceptions: [
      "Counting ordered arrangements when order does not matter.",
      "Forgetting restrictions such as no replacement or no repeated digits.",
    ],
  },
  {
    id: "conditional-probability",
    name: "Conditional probability",
    terms: ["conditional", "given", "independent", "bayes", "p(a|b)"],
    learningObjectives: [
      "Restrict the sample space after a condition is given.",
      "Apply conditional probability and Bayes-type reasoning.",
    ],
    misconceptions: [
      "Using the original sample space after conditioning.",
      "Confusing P(A | B) with P(B | A).",
    ],
  },
  {
    id: "random-variables",
    name: "Random variables",
    terms: ["random variable", "distribution", "pmf", "cdf", "variance"],
    learningObjectives: [
      "Describe a random variable by its possible values and probabilities.",
      "Check that a probability distribution sums to one.",
    ],
    misconceptions: [
      "Listing outcomes instead of values of the random variable.",
      "Forgetting to include all possible values in a distribution.",
    ],
  },
  {
    id: "expected-value",
    name: "Expected value",
    terms: ["expected value", "expectation", "mean", "e(x)", "weighted average"],
    learningObjectives: [
      "Compute expected value as a probability-weighted average.",
      "Interpret expected value as a long-run average, not a guaranteed outcome.",
    ],
    misconceptions: [
      "Treating expected value as the most likely outcome.",
      "Adding outcomes without weighting by their probabilities.",
    ],
  },
]

async function main() {
  const extractedFiles = await listExtractedTextFiles()
  const extractedTexts = []
  const uncertainItems = []

  for (const filePath of extractedFiles) {
    const text = await readFile(filePath, "utf8")
    extractedTexts.push(text)
    collectUncertainLines(filePath, text, uncertainItems)
  }

  const combinedText = extractedTexts.join("\n")
  const detectedTopics = detectTopics(combinedText)
  const sectionHeadings = extractSectionHeadings(combinedText, uncertainItems)
  const formulas = extractFormulas(combinedText, uncertainItems)
  const outline = buildOutline({
    detectedTopics,
    fileCount: extractedFiles.length,
    formulas,
    sectionHeadings,
  })

  await mkdir(path.dirname(publicOutputPath), { recursive: true })
  await writeFile(publicOutputPath, `${JSON.stringify(outline, null, 2)}\n`)

  if (uncertainItems.length > 0) {
    if (!assertIgnored("private uncertain extraction output", privateUncertainPath)) {
      process.exitCode = 1
      return
    }

    await mkdir(privateGeneratedDir, { recursive: true })
    await writeFile(
      privateUncertainPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          visibility: "private",
          purpose:
            "Private review queue for lines that were not safe for public metadata.",
          items: uncertainItems,
        },
        null,
        2,
      )}\n`,
    )
  }

  console.log(
    `Prepared ${relativeToRepo(publicOutputPath)} from ${extractedFiles.length} extracted file(s).`,
  )

  if (extractedFiles.length === 0) {
    console.log(
      `No extracted text files found in ${relativeToRepo(inputDir)}; wrote an empty safe outline.`,
    )
  }

  if (uncertainItems.length > 0) {
    console.log(
      `Kept ${uncertainItems.length} uncertain line(s) in ${relativeToRepo(
        privateUncertainPath,
      )}.`,
    )
  }
}

async function listExtractedTextFiles() {
  let entries

  try {
    entries = await readdir(inputDir, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return []
      }
    }

    throw error
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort()
}

function collectUncertainLines(filePath, text, uncertainItems) {
  const lines = text.split(/\r?\n/)

  lines.forEach((line, index) => {
    const cleaned = normalizeWhitespace(line)
    if (!cleaned) {
      return
    }

    const reason = unsafeReason(cleaned)
    if (!reason) {
      return
    }

    uncertainItems.push({
      lineNumber: index + 1,
      reason,
      sourcePath: relativeToRepo(filePath),
      text: cleaned,
    })
  })
}

function detectTopics(text) {
  const normalized = text.toLowerCase()

  return topicCatalog.filter((topic) =>
    topic.terms.some((term) => normalized.includes(term)),
  )
}

function extractSectionHeadings(text, uncertainItems) {
  return uniqueStrings(
    text
      .split(/\r?\n/)
      .map(normalizeWhitespace)
      .filter(isSafeSectionHeading)
      .filter((heading) => !uncertainItems.some((item) => item.text === heading))
      .map(stripHeadingNumbering),
  ).slice(0, 80)
}

function extractFormulas(text, uncertainItems) {
  const formulas = []

  for (const line of text.split(/\r?\n/).map(normalizeWhitespace)) {
    if (!isSafeFormulaLine(line)) {
      continue
    }

    if (uncertainItems.some((item) => item.text === line)) {
      continue
    }

    const symbolicFormula = sanitizeFormula(line)
    if (!symbolicFormula) {
      continue
    }

    formulas.push({
      name: formulaName(symbolicFormula),
      symbolicFormula,
    })
  }

  return uniqueByFormula(formulas).slice(0, 80)
}

function buildOutline({ detectedTopics, fileCount, formulas, sectionHeadings }) {
  return {
    schemaVersion: 1,
    visibility: "public",
    source: {
      type: "private_extracted_metadata_only",
      inputDirectory: "data/private/extracted",
      inputFileCount: fileCount,
    },
    safety: {
      excludesCopiedParagraphs: true,
      excludesCopiedQuestions: true,
      excludesCopiedSolutions: true,
      excludesCopiedExamples: true,
      excludesAnswerKeys: true,
    },
    topics: detectedTopics.map((topic) => topic.name),
    sectionHeadings,
    formulas,
    learningObjectives: uniqueStrings(
      detectedTopics.flatMap((topic) => topic.learningObjectives),
    ),
    misconceptionCandidates: uniqueStrings(
      detectedTopics.flatMap((topic) => topic.misconceptions),
    ),
  }
}

function isSafeSectionHeading(line) {
  if (!line || line.length > 90 || wordCount(line) > 12) {
    return false
  }

  if (unsafeReason(line) || containsFormulaSignal(line)) {
    return false
  }

  return (
    /^(chapter|section|unit|module)\s+\d+/i.test(line) ||
    /^[A-Z][A-Za-z0-9 ,:()/-]{2,}$/.test(line)
  )
}

function isSafeFormulaLine(line) {
  if (!line || line.length > 140 || wordCount(line) > 18) {
    return false
  }

  const formula = sanitizeFormula(line)
  return containsFormulaSignal(formula) && isMostlySymbolicFormula(formula)
}

function unsafeReason(line) {
  if (line.includes("?")) {
    return "possible copied question"
  }

  if (
    /\b(example|exercise|problem|question|solution|answer|answer key|answers|worked example|homework|quiz|exam)\b/i.test(
      line,
    )
  ) {
    return "possible copied example, exercise, solution, or answer key"
  }

  if (line.length > 220 || wordCount(line) > 28) {
    return "long prose kept private for review"
  }

  return undefined
}

function containsFormulaSignal(line) {
  return /[=∑Σμσ√]|\bP\s*\(|\bE\s*\(|\bVar\s*\(|\bC\s*\(|\bn!\b/.test(line)
}

function sanitizeFormula(line) {
  const stripped = line
    .replace(/^formula\s*[:.-]\s*/i, "")
    .replace(/^([A-Za-z ]{2,35})\s*[:]\s*(?=.*[=∑Σμσ√])/, "")
    .trim()
  const formulaStart = stripped.search(
    /\b(?:P|E|Var|C)\s*\(|[∑Σμσ√]|[A-Za-z][A-Za-z0-9_]*\s*=/,
  )
  const formula = formulaStart > 0 ? stripped.slice(formulaStart) : stripped

  return formula
    .replace(/\s+(where|because|when|for)\s+.*$/i, "")
    .replace(/[.;:]+$/, "")
    .trim()
}

function isMostlySymbolicFormula(formula) {
  const compact = formula.replace(/\s+/g, "")
  if (!compact) {
    return false
  }

  const symbolicCharacters = compact.match(/[=+\-*/^_()|,∑Σμσ√0-9]/g) ?? []
  return symbolicCharacters.length / compact.length >= 0.25 && wordCount(formula) <= 10
}

function formulaName(formula) {
  if (/\bP\s*\([^)]*\|[^)]*\)/.test(formula)) {
    return "Conditional probability"
  }

  if (/\bE\s*\(/.test(formula)) {
    return "Expected value"
  }

  if (/\bVar\s*\(/.test(formula)) {
    return "Variance"
  }

  if (/\bC\s*\(|n!/.test(formula)) {
    return "Counting formula"
  }

  if (/[μσ]/.test(formula)) {
    return "Distribution formula"
  }

  return "Formula"
}

function stripHeadingNumbering(line) {
  return line.replace(/^(chapter|section|unit|module)\s+\d+\.?\s*/i, "").trim()
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim()
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

function uniqueByFormula(formulas) {
  const seen = new Set()
  const unique = []

  for (const formula of formulas) {
    const key = `${formula.name}:${formula.symbolicFormula}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(formula)
  }

  return unique
}

function wordCount(value) {
  return value.split(/\s+/).filter(Boolean).length
}

function assertIgnored(label, targetPath) {
  const relativePath = relativeToRepo(targetPath)
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", relativePath], {
    cwd: repoRoot,
  })

  if (result.status === 0) {
    return true
  }

  console.warn(
    [
      `WARNING: ${label} is not ignored by Git: ${relativePath}`,
      "Refusing to write uncertain extraction outside ignored private storage.",
    ].join("\n"),
  )
  return false
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
