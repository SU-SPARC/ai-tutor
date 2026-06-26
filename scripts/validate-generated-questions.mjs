#!/usr/bin/env node

import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const defaultInputPath = path.join(
  repoRoot,
  "data/private/generated/generated-questions.json",
)
const defaultPrivatePatternsPath = path.join(
  repoRoot,
  "data/private/generated/question-patterns.json",
)
const defaultPrivateTextDir = path.join(repoRoot, "data/private/extracted")
const args = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(repoRoot, args.input ?? defaultInputPath)
const privatePatternsPath = path.resolve(
  repoRoot,
  args.privatePatterns ?? defaultPrivatePatternsPath,
)
const privateTextDir = path.resolve(
  repoRoot,
  args.privateTextDir ?? defaultPrivateTextDir,
)

async function main() {
  const payload = JSON.parse(await readFile(inputPath, "utf8"))
  const errors = validateGeneratedQuestionPayload(payload)
  const warnings = await collectSimilarityWarnings(payload, {
    privatePatternsPath,
    privateTextDir,
  })

  for (const warning of warnings) {
    console.warn(`WARNING: ${warning}`)
  }

  if (errors.length > 0) {
    console.error(
      `Invalid generated questions in ${relativeToRepo(inputPath)}:`,
    )
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(
    `Validated ${payload.questions.length} generated question draft(s) with ${warnings.length} warning(s).`,
  )
}

export function validateGeneratedQuestionPayload(payload) {
  const errors = []

  if (payload.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.")
  }

  if (payload.visibility !== "private") {
    errors.push("visibility must be private.")
  }

  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    errors.push("questions must be a non-empty array.")
    return errors
  }

  const seenIds = new Set()

  for (const [index, question] of payload.questions.entries()) {
    validateQuestion(question, index, seenIds, errors)
  }

  return errors
}

async function collectSimilarityWarnings(
  payload,
  { privatePatternsPath, privateTextDir },
) {
  const questions = Array.isArray(payload.questions) ? payload.questions : []
  const warnings = []
  const privatePatterns = await readJsonIfExists(privatePatternsPath)
  const privatePatternTexts = extractPrivatePatternTexts(privatePatterns)
  const privateSourceText = await readPrivateSourceText(privateTextDir)

  for (const question of questions) {
    const label = typeof question.id === "string" ? question.id : "unknown draft"
    const generatedText = questionTextForSimilarity(question)

    if (
      privatePatterns?.patterns?.some(
        (pattern) => pattern.id && pattern.id === question.patternId,
      )
    ) {
      warnings.push(
        `${label} references a private pattern identifier; public seed pattern IDs should be used for generated drafts.`,
      )
    }

    if (hasNgramOverlap(generatedText, privatePatternTexts, 8)) {
      warnings.push(
        `${label} has long phrase overlap with private pattern metadata.`,
      )
    }

    if (hasNgramOverlap(generatedText, privateSourceText, 10)) {
      warnings.push(`${label} has long phrase overlap with private source text.`)
    }
  }

  return warnings
}

function validateQuestion(question, index, seenIds, errors) {
  const label = `questions[${index}]`
  const requiredStringFields = [
    "id",
    "patternId",
    "topic",
    "difficulty",
    "questionText",
    "finalAnswer",
    "sourceType",
    "trustLevel",
    "reviewStatus",
    "originalityNote",
  ]

  for (const field of requiredStringFields) {
    if (typeof question[field] !== "string" || question[field].trim() === "") {
      errors.push(`${label}.${field} must be a non-empty string.`)
    }
  }

  if (seenIds.has(question.id)) {
    errors.push(`${label}.id is duplicated: ${question.id}.`)
  }
  seenIds.add(question.id)

  if (question.sourceType !== "generated_original") {
    errors.push(`${label}.sourceType must be generated_original.`)
  }

  if (question.trustLevel !== "generated_unverified") {
    errors.push(`${label}.trustLevel must be generated_unverified.`)
  }

  if (question.reviewStatus !== "needs_review") {
    errors.push(`${label}.reviewStatus must be needs_review.`)
  }

  requireStringArray(question.solutionSteps, `${label}.solutionSteps`, errors)
  requireStringArray(question.hints, `${label}.hints`, errors)
  validateMisconceptions(question.misconceptions, `${label}.misconceptions`, errors)
}

function validateMisconceptions(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty array.`)
    return
  }

  value.forEach((misconception, index) => {
    for (const field of ["id", "hook", "feedback"]) {
      if (
        typeof misconception[field] !== "string" ||
        misconception[field].trim() === ""
      ) {
        errors.push(`${label}[${index}].${field} must be a non-empty string.`)
      }
    }
  })
}

function requireStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty string array.`)
    return
  }

  if (value.some((item) => typeof item !== "string" || item.trim() === "")) {
    errors.push(`${label} must contain only non-empty strings.`)
  }
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

async function readPrivateSourceText(directoryPath) {
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

function extractPrivatePatternTexts(payload) {
  if (!payload || !Array.isArray(payload.patterns)) {
    return ""
  }

  return payload.patterns
    .flatMap((pattern) => [
      pattern.title,
      pattern.abstractTemplate,
      ...(pattern.reasoningPlan ?? []),
      ...(pattern.misconceptionTargets ?? []),
      ...(pattern.formulaRefs ?? []),
    ])
    .filter(Boolean)
    .join(" ")
}

function questionTextForSimilarity(question) {
  return [
    question.questionText,
    question.finalAnswer,
    ...(question.solutionSteps ?? []),
    ...(question.hints ?? []),
    ...(question.misconceptions ?? []).flatMap((misconception) => [
      misconception.hook,
      misconception.feedback,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
}

function hasNgramOverlap(leftText, rightText, size) {
  if (!leftText || !rightText) {
    return false
  }

  const rightNgrams = ngrams(rightText, size)

  for (const ngram of ngrams(leftText, size)) {
    if (rightNgrams.has(ngram)) {
      return true
    }
  }

  return false
}

function ngrams(text, size) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9.%]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
  const phrases = new Set()

  for (let index = 0; index <= words.length - size; index += 1) {
    phrases.add(words.slice(index, index + size).join(" "))
  }

  return phrases
}

function parseArgs(rawArgs) {
  const parsed = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]

    if (arg === "--input") {
      parsed.input = rawArgs[index + 1]
      index += 1
    } else if (arg === "--private-patterns") {
      parsed.privatePatterns = rawArgs[index + 1]
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

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
