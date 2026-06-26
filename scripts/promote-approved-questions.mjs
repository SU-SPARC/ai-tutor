#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const defaultInputPath = path.join(
  repoRoot,
  "data/private/generated/review-queue.json",
)
const defaultOutputPath = path.join(
  repoRoot,
  "data/processed/approved-generated-questions.json",
)
const args = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(repoRoot, args.input ?? defaultInputPath)
const outputPath = path.resolve(repoRoot, args.output ?? defaultOutputPath)

async function main() {
  if (!assertPublicProcessedOutput(outputPath)) {
    process.exitCode = 1
    return
  }

  const queuePayload = JSON.parse(await readFile(inputPath, "utf8"))
  const promotion = promoteApprovedQuestions(queuePayload.reviewQueue ?? [])

  if (promotion.errors.length > 0) {
    console.error("Approved question promotion failed:")
    for (const error of promotion.errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  const outputPayload = {
    schemaVersion: 1,
    visibility: "public",
    source: {
      type: "approved_generated_questions",
      inputPath: "data/private/generated/review-queue.json",
    },
    safety: {
      excludesNeedsReview: true,
      excludesRejected: true,
      excludesNeedsEdit: true,
      excludesCopiedSourceText: true,
      requiresProfessorApproval: true,
    },
    questions: promotion.questions,
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(outputPayload, null, 2)}\n`)
  console.log(
    `Promoted ${promotion.questions.length} approved generated question(s) to ${relativeToRepo(
      outputPath,
    )}.`,
  )
}

function promoteApprovedQuestions(queueItems) {
  const questions = []
  const errors = []
  const seenIds = new Set()

  for (const [index, item] of queueItems.entries()) {
    if (item.reviewStatus !== "approved") {
      continue
    }

    const label = `reviewQueue[${index}]`
    const itemErrors = validatePromotableItem(item, label)

    if (itemErrors.length > 0) {
      errors.push(...itemErrors)
      continue
    }

    const id = item.id.replace(/^review-/, "approved-")

    if (seenIds.has(id)) {
      errors.push(`${label}.id produces duplicate public id ${id}.`)
      continue
    }
    seenIds.add(id)

    questions.push({
      id,
      topic: item.topic,
      difficulty: item.difficulty,
      questionText: item.question,
      finalAnswer: item.answer,
      solutionSteps: item.solutionSteps,
      hints: item.hints,
      misconceptions: item.misconceptions,
      patternId: item.patternId,
      originalityNote: item.originalityNote,
      sourceMetadata: {
        sourceType: "generated_original",
        visibility: "public",
        originalityNote: item.originalityNote,
      },
      reviewStatus: "approved",
      trustLevel: "professor_approved",
    })
  }

  return { errors, questions }
}

function validatePromotableItem(item, label) {
  const errors = []

  for (const field of [
    "id",
    "question",
    "answer",
    "patternId",
    "originalityNote",
    "topic",
    "difficulty",
  ]) {
    if (typeof item[field] !== "string" || item[field].trim() === "") {
      errors.push(`${label}.${field} must be a non-empty string.`)
    }
  }

  requireStringArray(item.solutionSteps, `${label}.solutionSteps`, errors)
  requireStringArray(item.hints, `${label}.hints`, errors)

  if (!Array.isArray(item.misconceptions) || item.misconceptions.length === 0) {
    errors.push(`${label}.misconceptions must be a non-empty array.`)
  }

  if (containsCopiedSourceSignal(item)) {
    errors.push(
      `${label} appears to contain copied source or textbook wording and cannot be promoted.`,
    )
  }

  return errors
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

function containsCopiedSourceSignal(item) {
  return /copied from|textbook|source page|worked example|answer key|verbatim/i.test(
    JSON.stringify(item),
  )
}

function assertPublicProcessedOutput(targetPath) {
  if (
    isInside(targetPath, "/tmp") ||
    isInside(targetPath, "/private/tmp") ||
    isInside(targetPath, tmpdir())
  ) {
    return true
  }

  if (!isInside(targetPath, path.join(repoRoot, "data/processed"))) {
    console.warn(
      `WARNING: approved generated questions must be written under data/processed: ${relativeToRepo(
        targetPath,
      )}`,
    )
    return false
  }

  if (isInside(targetPath, path.join(repoRoot, "data/processed/private"))) {
    console.warn(
      "WARNING: approved generated questions are public-safe output and should not be written under data/processed/private.",
    )
    return false
  }

  return true
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
