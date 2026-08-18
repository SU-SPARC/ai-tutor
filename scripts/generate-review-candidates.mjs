#!/usr/bin/env node

import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  canonicalTopicMap,
  compareTopics,
  loadCanonicalSyllabusTopics,
} from "./lib/canonical-syllabus-topics.mjs"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const defaultInputPath = path.join(
  repoRoot,
  "data/private/generated/question-patterns.json",
)
const defaultOutputPath = path.join(
  repoRoot,
  "data/demo/generated-review-candidates.json",
)
const defaultAuditPath = path.join(
  repoRoot,
  "data/private/generated/generation-audit.json",
)
const defaultPrivateTextDir = path.join(repoRoot, "data/private/extracted")

const args = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(repoRoot, args.input ?? defaultInputPath)
const outputPath = path.resolve(repoRoot, args.output ?? defaultOutputPath)
const auditPath = path.resolve(repoRoot, args.audit ?? defaultAuditPath)
const privateTextDir = path.resolve(
  repoRoot,
  args.privateTextDir ?? defaultPrivateTextDir,
)
const canonicalTopicList = await loadCanonicalSyllabusTopics(repoRoot)
const canonicalTopics = canonicalTopicMap(canonicalTopicList)

async function main() {
  if (!assertSafePublicOutput(outputPath)) {
    process.exitCode = 1
    return
  }

  if (!assertPrivateAuditPath(auditPath)) {
    process.exitCode = 1
    return
  }

  const audit = {
    schemaVersion: 1,
    visibility: "private",
    inputPath: relativeToRepo(inputPath),
    outputPath: relativeToRepo(outputPath),
    generated: [],
    rejected: [],
    skipped: [],
  }
  const patternFile = await readJsonIfExists(inputPath)

  if (!patternFile) {
    audit.skipped.push({
      reason: "Private question pattern file was not found.",
    })
    await mkdir(path.dirname(auditPath), { recursive: true })
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`)
    console.log(
      `No private question patterns found at ${relativeToRepo(
        inputPath,
      )}; public candidates were not changed.`,
    )
    console.log(
      `Wrote private generation audit to ${relativeToRepo(auditPath)}.`,
    )
    return
  }

  const patterns = patternFile.patterns ?? []
  for (const pattern of patterns) {
    if (
      pattern.mappingStatus !== "needs_topic_mapping" &&
      !canonicalTopics.has(pattern.topicId)
    ) {
      throw new Error(
        `Pattern ${pattern.id} references stale topic ${pattern.topicId}.`,
      )
    }
  }
  const privateText = await readPrivateTextIfAvailable(privateTextDir)
  const candidates = []
  const familyCounts = new Map()

  for (const pattern of patterns) {
    const familyKey = generatorFamilyKey(pattern)
    const sequence = (familyCounts.get(familyKey) ?? 0) + 1
    familyCounts.set(familyKey, sequence)
    const result = generateCandidate(pattern, sequence)

    if (!result.ok) {
      audit.skipped.push({
        patternId: pattern.id,
        reason: result.reason,
      })
      continue
    }

    const safety = checkOriginality(
      result.candidate,
      result.variables,
      pattern,
      {
        privateText,
      },
    )

    if (!safety.ok) {
      audit.rejected.push({
        patternId: pattern.id,
        reason: safety.reason,
      })
      continue
    }

    candidates.push(result.candidate)
    audit.generated.push({
      candidateId: result.candidate.id,
      patternId: pattern.id,
      variableTuple: result.variables,
    })
  }

  candidates.sort((left, right) =>
    compareTopics(left, right, canonicalTopicList),
  )
  await mkdir(path.dirname(outputPath), { recursive: true })
  await mkdir(path.dirname(auditPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(candidates, null, 2)}\n`)
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`)

  console.log(
    `Generated ${candidates.length} review candidate(s) at ${relativeToRepo(
      outputPath,
    )}.`,
  )
  console.log(`Wrote private generation audit to ${relativeToRepo(auditPath)}.`)
}

function generateCandidate(pattern, sequence) {
  if (pattern.mappingStatus === "needs_topic_mapping") {
    return { ok: false, reason: "Pattern needs canonical topic mapping." }
  }

  if (hasTag(pattern, ["binomial", "exact count"])) {
    return {
      ok: true,
      candidate: buildBinomialCandidate(sequence, pattern.topicId),
      variables: { n: 8, k: 3, p: 0.6 },
    }
  }

  if (hasTag(pattern, ["bayes", "false positive"])) {
    return {
      ok: true,
      candidate: buildBayesCandidate(sequence, pattern.topicId),
      variables: { baseRate: 8, targetFlagRate: 92, otherFlagRate: 6 },
    }
  }

  if (hasTag(pattern, ["z-score", "standardization"])) {
    return {
      ok: true,
      candidate: buildZScoreCandidate(sequence, pattern.topicId),
      variables: { mean: 74, standardDeviation: 6, observation: 83 },
    }
  }

  return { ok: false, reason: "No deterministic generator for this pattern." }
}

function generatorFamilyKey(pattern) {
  if (hasTag(pattern, ["binomial", "exact count"])) {
    return "binomial-exact-count"
  }

  if (hasTag(pattern, ["bayes", "false positive"])) {
    return "bayes-false-positive"
  }

  if (hasTag(pattern, ["z-score", "standardization"])) {
    return "normal-z-score"
  }

  return "unsupported"
}

function buildBayesCandidate(sequence, topicId) {
  return {
    id: `generated-bayes-campus-badges-${sequence}`,
    topicId,
    title: "Campus badge flag draft",
    prompt:
      "A campus event scanner flags 6% of regular badges and 92% of priority badges. If 8% of badges are priority badges, what is the probability that a flagged badge is priority?",
    patternSource: "Bayes false-positive pattern",
    difficulty: "intermediate",
    answer: {
      acceptedAnswers: ["0.5714", "0.571", "57.14%", "57.1%"],
      numericValue: 0.5714285714285714,
      tolerance: 0.001,
      explanation:
        "Use Bayes theorem with priority badge as the event of interest and flagged badge as the condition.",
    },
    hints: [
      "Compute the probability that a badge is both priority and flagged.",
      "Compute the total probability that a badge is flagged.",
      "Divide the priority-and-flagged probability by the total flagged probability.",
    ],
    solutionSteps: [
      "P(flagged and priority) = 0.92 * 0.08 = 0.0736.",
      "P(flagged and regular) = 0.06 * 0.92 = 0.0552, so P(flagged) = 0.1288.",
      "P(priority | flagged) = 0.0736 / 0.1288, which is about 0.5714.",
    ],
    misconceptions: [
      {
        id: "uses-flag-rate-only",
        matchTerms: ["0.92", "92%"],
        feedback:
          "The flag rate among priority badges is not the same as the probability that a flagged badge is priority. Include the base rate of priority badges.",
      },
    ],
    source: generatedSource("Bayes false-positive"),
    review: { status: "needs_review" },
  }
}

function buildBinomialCandidate(sequence, topicId) {
  return {
    id: `generated-binomial-study-app-${sequence}`,
    topicId,
    title: "Study app exact count draft",
    prompt:
      "A study app shows 8 independent review cards. Each card has a 60% chance of being answered correctly. What is the probability of exactly 3 correct answers?",
    patternSource: "Binomial exact-count pattern",
    difficulty: "intermediate",
    answer: {
      acceptedAnswers: ["0.12386304", "0.1239", "12.386304%", "12.39%"],
      numericValue: 0.12386304,
      tolerance: 0.001,
      explanation:
        "Use the binomial exact-count formula with n = 8, k = 3, and p = 0.6.",
    },
    hints: [
      "Identify the number of trials, the success probability, and the desired number of successes.",
      "Use C(n,k)p^k(1-p)^(n-k).",
      "The incorrect-answer probability is 0.4.",
    ],
    solutionSteps: [
      "Here n = 8, k = 3, and p = 0.6.",
      "Compute C(8,3)(0.6)^3(0.4)^5.",
      "The result is 0.12386304, or about 12.39%.",
    ],
    misconceptions: [
      {
        id: "missing-combination",
        matchTerms: ["0.00221184", "0.6^3"],
        feedback:
          "That counts only one order. Include C(8,3) for all positions of the three correct answers.",
      },
    ],
    source: generatedSource("binomial exact-count"),
    review: { status: "needs_review" },
  }
}

function buildZScoreCandidate(sequence, topicId) {
  return {
    id: `generated-z-score-transit-${sequence}`,
    topicId,
    title: "Transit time z-score draft",
    prompt:
      "Shuttle wait times are normally distributed with mean 74 seconds and standard deviation 6 seconds. What is the z-score for a wait time of 83 seconds?",
    patternSource: "Normal standardization pattern",
    difficulty: "foundational",
    answer: {
      acceptedAnswers: ["1.5", "3/2"],
      numericValue: 1.5,
      tolerance: 0.001,
      explanation:
        "A wait time of 83 seconds is 9 seconds above the mean, which is 9/6 = 1.5 standard deviations.",
    },
    hints: [
      "Use z = (x - mean) / standard deviation.",
      "Find how far 83 is above 74 before dividing.",
      "The standard deviation is 6 seconds.",
    ],
    solutionSteps: [
      "Subtract the mean: 83 - 74 = 9.",
      "Divide by the standard deviation: 9 / 6 = 1.5.",
      "The z-score is 1.5.",
    ],
    misconceptions: [
      {
        id: "reversed-subtraction",
        matchTerms: ["-1.5", "-3/2"],
        feedback:
          "The sign is reversed. Since 83 is above the mean, the z-score should be positive.",
      },
    ],
    source: generatedSource("normal standardization"),
    review: { status: "needs_review" },
  }
}

function generatedSource(patternLabel) {
  return {
    // Ad-hoc template output. Use pattern_derived_original only when a
    // catalogued pattern ID is linked, which the publication quality gate
    // requires (invalid_source_classification).
    sourceType: "generated_original",
    trustLevel: "generated_unverified",
    visibility: "public",
    originalityNote: `Original practice item generated from an abstract ${patternLabel} pattern; no private source text or private audit identifiers included.`,
  }
}

function checkOriginality(candidate, variables, pattern, { privateText }) {
  const generatedText = [
    candidate.prompt,
    candidate.answer.explanation,
    ...candidate.solutionSteps,
  ].join(" ")
  const forbidden = pattern.forbiddenSimilarity ?? {}
  const storyFamilies = forbidden.sourceStoryFamilies ?? []

  if (
    storyFamilies.some((storyFamily) =>
      generatedText.toLowerCase().includes(String(storyFamily).toLowerCase()),
    )
  ) {
    return {
      ok: false,
      reason: "Generated text reused a banned story family.",
    }
  }

  const numberTuple = Object.values(variables).map(String)
  const sourceNumberSets = forbidden.sourceNumberSets ?? []

  if (
    sourceNumberSets.some((set) => arraysEqual(set.map(String), numberTuple))
  ) {
    return { ok: false, reason: "Generated variables matched source numbers." }
  }

  const generatedHashes = phraseHashes(generatedText)
  const privatePhraseHashes = forbidden.privatePhraseHashes ?? []

  if (privatePhraseHashes.some((hash) => generatedHashes.has(hash))) {
    return {
      ok: false,
      reason: "Generated text matched a private phrase hash.",
    }
  }

  if (privateText && hasLongNgramOverlap(generatedText, privateText)) {
    return { ok: false, reason: "Generated text overlapped private text." }
  }

  return { ok: true }
}

async function readPrivateTextIfAvailable(directoryPath) {
  let entries

  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return ""
      }
    }

    throw error
  }

  const texts = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".txt")) {
      continue
    }

    texts.push(await readFile(path.join(directoryPath, entry.name), "utf8"))
  }

  return texts.join("\n")
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return undefined
      }
    }

    throw error
  }
}

function hasTag(pattern, tags) {
  const values = [
    pattern.title,
    pattern.abstractTemplate,
    ...(pattern.conceptTags ?? []),
    ...(pattern.formulaRefs ?? []),
  ]
    .join(" ")
    .toLowerCase()

  return tags.every((tag) => values.includes(tag))
}

function hasLongNgramOverlap(generatedText, privateText) {
  const privateNgrams = ngrams(privateText, 8)
  return ngrams(generatedText, 8).some((ngram) => privateNgrams.has(ngram))
}

function phraseHashes(text) {
  return new Set(
    [...ngrams(text, 5)].map((phrase) =>
      createHash("sha256").update(phrase).digest("hex"),
    ),
  )
}

function ngrams(text, size) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9.%]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  const phrases = []

  for (let index = 0; index <= words.length - size; index += 1) {
    phrases.push(words.slice(index, index + size).join(" "))
  }

  return new Set(phrases)
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function assertSafePublicOutput(targetPath) {
  if (
    !isInside(targetPath, path.join(repoRoot, "data/demo")) &&
    !isInside(targetPath, "/tmp") &&
    !isInside(targetPath, "/private/tmp") &&
    !isInside(targetPath, tmpdir())
  ) {
    console.warn(
      `WARNING: public candidate output must stay under data/demo: ${relativeToRepo(
        targetPath,
      )}`,
    )
    return false
  }

  return true
}

function assertPrivateAuditPath(targetPath) {
  if (!isInside(targetPath, path.join(repoRoot, "data/private"))) {
    return true
  }

  const relativePath = relativeToRepo(targetPath)
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--", relativePath],
    {
      cwd: repoRoot,
    },
  )

  if (result.status === 0) {
    return true
  }

  console.warn(
    [
      `WARNING: private generation audit is not ignored by Git: ${relativePath}`,
      "Refusing to continue because private audit data must stay out of Git.",
    ].join("\n"),
  )
  return false
}

function isInside(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath)
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  )
}

function parseArgs(rawArgs) {
  const parsed = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]

    if (arg === "--input") {
      parsed.input = rawArgs[index + 1]
      index += 1
    } else if (arg === "--output") {
      parsed.output = rawArgs[index + 1]
      index += 1
    } else if (arg === "--audit") {
      parsed.audit = rawArgs[index + 1]
      index += 1
    } else if (arg === "--private-text-dir") {
      parsed.privateTextDir = rawArgs[index + 1]
      index += 1
    }
  }

  return parsed
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
