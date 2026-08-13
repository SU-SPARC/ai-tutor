#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
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
const defaultOutputPath = path.join(
  repoRoot,
  "data/private/generated/review-queue.json",
)
const args = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(repoRoot, args.input ?? defaultInputPath)
const outputPath = path.resolve(repoRoot, args.output ?? defaultOutputPath)

async function main() {
  if (!assertPrivateOrTempOutput(outputPath)) {
    process.exitCode = 1
    return
  }

  const generatedPayload = JSON.parse(await readFile(inputPath, "utf8"))
  const queueItems = buildReviewQueue(generatedPayload.questions ?? [])
  const payload = {
    schemaVersion: 1,
    visibility: "private",
    source: {
      type: "generated_original_questions",
      inputPath: relativeToRepo(inputPath),
    },
    reviewQueue: queueItems,
  }
  const errors = validateReviewQueuePayload(payload)

  if (errors.length > 0) {
    console.error("Generated review queue failed validation:")
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(
    `Prepared ${queueItems.length} private review queue item(s) at ${relativeToRepo(
      outputPath,
    )}.`,
  )
}

function buildReviewQueue(questions) {
  return questions.map((question) => ({
    id: `review-${question.id}`,
    question: question.questionText,
    answer: question.finalAnswer,
    solutionSteps: question.solutionSteps,
    hints: question.hints,
    misconceptions: question.misconceptions,
    patternId: question.patternId,
    originalityNote: question.originalityNote,
    reviewStatus: question.reviewStatus,
    topic: question.topic,
    topicId: question.topicId,
    difficulty: question.difficulty,
  }))
}

function validateReviewQueuePayload(payload) {
  const errors = []

  if (payload.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.")
  }

  if (payload.visibility !== "private") {
    errors.push("review queue visibility must be private.")
  }

  if (!Array.isArray(payload.reviewQueue) || payload.reviewQueue.length === 0) {
    errors.push("reviewQueue must be a non-empty array.")
    return errors
  }

  const seenIds = new Set()

  for (const [index, item] of payload.reviewQueue.entries()) {
    const label = `reviewQueue[${index}]`

    for (const field of [
      "id",
      "question",
      "answer",
      "patternId",
      "originalityNote",
      "reviewStatus",
      "topic",
      "topicId",
      "difficulty",
    ]) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        errors.push(`${label}.${field} must be a non-empty string.`)
      }
    }

    if (seenIds.has(item.id)) {
      errors.push(`${label}.id is duplicated: ${item.id}.`)
    }
    seenIds.add(item.id)

    if (item.reviewStatus !== "needs_review") {
      errors.push(`${label}.reviewStatus must be needs_review.`)
    }

    requireStringArray(item.solutionSteps, `${label}.solutionSteps`, errors)
    requireStringArray(item.hints, `${label}.hints`, errors)
    validateMisconceptions(
      item.misconceptions,
      `${label}.misconceptions`,
      errors,
    )
  }

  return errors
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

function assertPrivateOrTempOutput(targetPath) {
  if (
    isInside(targetPath, "/tmp") ||
    isInside(targetPath, "/private/tmp") ||
    isInside(targetPath, tmpdir())
  ) {
    return true
  }

  if (!isInside(targetPath, path.join(repoRoot, "data/private"))) {
    console.warn(
      `WARNING: review queue output must stay under data/private by default: ${relativeToRepo(
        targetPath,
      )}`,
    )
    return false
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
      `WARNING: review queue output is not ignored by Git: ${relativePath}`,
      "Refusing to continue because generated review queues must stay private.",
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
