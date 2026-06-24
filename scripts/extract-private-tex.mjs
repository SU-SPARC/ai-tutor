#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const inputDir = path.join(repoRoot, "data/private/course-materials")
const privateGeneratedDir = path.join(repoRoot, "data/private/generated")
const privateDetailsPath = path.join(
  privateGeneratedDir,
  "latex-ingestion-details.json",
)
const publicOutputPath = path.join(repoRoot, "data/processed/latex-outline.json")

const topicCatalog = [
  {
    label: "basic probability",
    terms: ["probability", "sample space", "event", "outcome", "complement"],
  },
  {
    label: "counting",
    terms: ["counting", "permutation", "combination", "factorial", "choose"],
  },
  {
    label: "conditional probability",
    terms: ["conditional", "given", "independent", "bayes", "p(a|b)"],
  },
  {
    label: "random variables",
    terms: ["random variable", "distribution", "pmf", "cdf", "variance"],
  },
  {
    label: "expected value",
    terms: ["expected value", "expectation", "mean", "e(x)", "weighted"],
  },
]

async function main() {
  const texFiles = await listTexFiles()
  const parsedFiles = []

  for (const filePath of texFiles) {
    if (!assertIgnored("private LaTeX input", filePath)) {
      process.exitCode = 1
      return
    }

    const source = await readFile(filePath, "utf8")
    parsedFiles.push(parseTexFile(filePath, source))
  }

  if (!assertIgnored("private LaTeX parse details", privateDetailsPath)) {
    process.exitCode = 1
    return
  }

  const publicOutline = buildPublicOutline(parsedFiles)
  const privateDetails = buildPrivateDetails(parsedFiles)

  await mkdir(privateGeneratedDir, { recursive: true })
  await mkdir(path.dirname(publicOutputPath), { recursive: true })
  await writeFile(
    privateDetailsPath,
    `${JSON.stringify(privateDetails, null, 2)}\n`,
  )
  await writeFile(
    publicOutputPath,
    `${JSON.stringify(publicOutline, null, 2)}\n`,
  )

  console.log(
    `Parsed ${texFiles.length} LaTeX file(s) from ${relativeToRepo(inputDir)}.`,
  )
  console.log(`Wrote private details to ${relativeToRepo(privateDetailsPath)}.`)
  console.log(`Wrote safe outline to ${relativeToRepo(publicOutputPath)}.`)

  if (texFiles.length === 0) {
    console.log("No private .tex files found; wrote empty metadata outputs.")
  }
}

async function listTexFiles() {
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
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".tex"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort()
}

function parseTexFile(filePath, source) {
  const stripped = stripTexComments(source)
  const sections = extractSectionTitles(stripped)
  const formulas = extractFormulas(stripped)
  const learningObjectives = extractLearningObjectives(stripped)
  const uncertainLines = collectUncertainLines(stripped)

  return {
    sourcePath: relativeToRepo(filePath),
    sectionTitles: sections,
    formulas,
    topicLabels: detectTopicLabels([
      ...sections,
      ...learningObjectives,
      ...formulas.map((formula) => formula.symbolicFormula),
    ]),
    learningObjectives,
    uncertainLines,
  }
}

function buildPrivateDetails(parsedFiles) {
  return {
    schemaVersion: 1,
    visibility: "private",
    inputDirectory: "data/private/course-materials",
    parsedFileCount: parsedFiles.length,
    purpose:
      "Private parse details from LaTeX course materials. Do not commit this file.",
    files: parsedFiles,
  }
}

function buildPublicOutline(parsedFiles) {
  return {
    schemaVersion: 1,
    visibility: "public",
    source: {
      type: "private_latex_metadata_only",
      inputDirectory: "data/private/course-materials",
      inputFileCount: parsedFiles.length,
    },
    safety: {
      excludesCopiedLectureNotes: true,
      excludesCopiedExamples: true,
      excludesCopiedProblems: true,
      excludesCopiedSolutions: true,
      excludesAnswerKeys: true,
    },
    sectionTitles: uniqueStrings(
      parsedFiles.flatMap((file) => file.sectionTitles).filter(isPublicSafeTitle),
    ),
    formulas: uniqueByFormula(
      parsedFiles
        .flatMap((file) => file.formulas)
        .filter((formula) => isPublicSafeFormula(formula.symbolicFormula)),
    ),
    topicLabels: uniqueStrings(parsedFiles.flatMap((file) => file.topicLabels)),
    learningObjectives: uniqueStrings(
      parsedFiles
        .flatMap((file) => file.learningObjectives)
        .filter(isPublicSafeObjective),
    ),
  }
}

function stripTexComments(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/(?<!\\)%.*/, ""))
    .join("\n")
}

function extractSectionTitles(source) {
  const titles = []
  const sectionPattern =
    /\\(?:chapter|section|subsection|subsubsection|paragraph)\*?\{([^{}]{1,120})\}/g

  for (const match of source.matchAll(sectionPattern)) {
    const title = cleanLatexText(match[1])
    if (title && !unsafeReason(title)) {
      titles.push(title)
    }
  }

  return uniqueStrings(titles).slice(0, 120)
}

function extractFormulas(source) {
  const formulas = []
  const patterns = [
    /\\\[((?:.|\n)*?)\\\]/g,
    /\$\$((?:.|\n)*?)\$\$/g,
    /\\begin\{(?:equation|align|gather|multline)\*?\}((?:.|\n)*?)\\end\{(?:equation|align|gather|multline)\*?\}/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const symbolicFormula = cleanFormula(match[1])
      if (!symbolicFormula || !isPublicSafeFormula(symbolicFormula)) {
        continue
      }

      formulas.push({
        name: formulaName(symbolicFormula),
        symbolicFormula,
      })
    }
  }

  return uniqueByFormula(formulas).slice(0, 120)
}

function extractLearningObjectives(source) {
  const objectives = []
  const lines = source.split(/\r?\n/).map((line) => cleanLatexText(line))

  for (const line of lines) {
    const objective = normalizeObjectiveLine(line)
    if (!objective || !isPublicSafeObjective(objective)) {
      continue
    }

    objectives.push(objective)
  }

  return uniqueStrings(objectives).slice(0, 120)
}

function collectUncertainLines(source) {
  const uncertain = []
  const lines = source.split(/\r?\n/)

  lines.forEach((line, index) => {
    const cleaned = cleanLatexText(line)
    if (!cleaned) {
      return
    }

    const reason = unsafeReason(cleaned)
    if (!reason) {
      return
    }

    uncertain.push({
      lineNumber: index + 1,
      reason,
      text: cleaned,
    })
  })

  return uncertain.slice(0, 500)
}

function normalizeObjectiveLine(line) {
  const withoutItem = line.replace(/^\\?item\s*/i, "").trim()
  const objectiveMatch = withoutItem.match(
    /^(?:objective|learning objective|learning goal|students will|student will|outcome)\s*:?\s*(.+)$/i,
  )

  return objectiveMatch ? objectiveMatch[1].trim() : undefined
}

function detectTopicLabels(values) {
  const text = values.join(" ").toLowerCase()
  return topicCatalog
    .filter((topic) => topic.terms.some((term) => text.includes(term)))
    .map((topic) => topic.label)
}

function isPublicSafeTitle(title) {
  return title.length <= 90 && wordCount(title) <= 12 && !unsafeReason(title)
}

function isPublicSafeObjective(objective) {
  return (
    objective.length <= 140 &&
    wordCount(objective) <= 18 &&
    !unsafeReason(objective)
  )
}

function isPublicSafeFormula(formula) {
  return (
    formula.length <= 160 &&
    wordCount(formula) <= 14 &&
    containsFormulaSignal(formula) &&
    !unsafeReason(formula)
  )
}

function unsafeReason(value) {
  if (value.includes("?")) {
    return "possible copied question"
  }

  if (
    /\b(example|exercise|problem|question|solution|answer|answer key|answers|worked example|homework|quiz|exam)\b/i.test(
      value,
    )
  ) {
    return "possible copied example, problem, solution, or answer key"
  }

  if (value.length > 220 || wordCount(value) > 28) {
    return "long prose kept private for review"
  }

  return undefined
}

function cleanLatexText(value) {
  return value
    .replace(/\\(?:begin|end)\{[^{}]+\}/g, " ")
    .replace(/\\(?:textbf|textit|emph|underline)\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanFormula(value) {
  return value
    .replace(/\\label\{[^{}]*\}/g, "")
    .replace(/\\tag\{[^{}]*\}/g, "")
    .replace(/\\notag/g, "")
    .replace(/\\\\/g, "; ")
    .replace(/\s+/g, " ")
    .trim()
}

function containsFormulaSignal(value) {
  return /[=∑Σμσ√]|\bP\s*\(|\bE\s*\(|\\(?:sum|frac|sqrt|binom)\b/.test(value)
}

function formulaName(formula) {
  if (/\bP\s*\([^)]*\|[^)]*\)|\\mid/.test(formula)) {
    return "Conditional probability"
  }

  if (/\bE\s*\(|\\mathbb\{E\}/.test(formula)) {
    return "Expected value"
  }

  if (/\\binom|\\choose|!/.test(formula)) {
    return "Counting formula"
  }

  if (/\\sum|∑|Σ/.test(formula)) {
    return "Summation formula"
  }

  return "Formula"
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
      "Refusing to continue because private course material must stay out of Git.",
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
