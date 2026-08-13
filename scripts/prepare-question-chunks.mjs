#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  QUESTION_CHUNK_MAX_BODY_CHARACTERS,
  chunkQuestion,
  validateQuestionChunks,
} from "../src/lib/ai/chunk-question.ts"
import {
  compareTopics,
  loadCanonicalSyllabusTopics,
} from "./lib/canonical-syllabus-topics.mjs"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

const defaults = {
  approvedGenerated: path.join(
    repoRoot,
    "data/processed/approved-generated-questions.json",
  ),
  demoQuestions: path.join(repoRoot, "data/demo/questions.json"),
  privateOutput: path.join(
    repoRoot,
    "data/private/generated/question-chunks.json",
  ),
  publicOutput: path.join(repoRoot, "data/processed/demo-question-chunks.json"),
  reviewCandidates: path.join(
    repoRoot,
    "data/demo/generated-review-candidates.json",
  ),
  reviewQueue: path.join(repoRoot, "data/private/generated/review-queue.json"),
}

const args = parseArgs(process.argv.slice(2))
const paths = {
  approvedGenerated: resolveArgPath(
    args.approvedGenerated,
    defaults.approvedGenerated,
  ),
  demoQuestions: resolveArgPath(args.demoQuestions, defaults.demoQuestions),
  privateOutput: resolveArgPath(args.privateOutput, defaults.privateOutput),
  publicOutput: resolveArgPath(args.publicOutput, defaults.publicOutput),
  reviewCandidates: resolveArgPath(
    args.reviewCandidates,
    defaults.reviewCandidates,
  ),
  reviewQueue: resolveArgPath(args.reviewQueue, defaults.reviewQueue),
}

async function main() {
  if (!assertPublicProcessedOutput(paths.publicOutput)) {
    process.exitCode = 1
    return
  }

  if (!assertPrivateOrTempOutput(paths.privateOutput)) {
    process.exitCode = 1
    return
  }

  const canonicalTopics = await loadCanonicalSyllabusTopics(repoRoot)
  const demoQuestions = await readJson(paths.demoQuestions)
  const approvedGenerated = await readJsonOptional(paths.approvedGenerated)
  const reviewQueue = await readJsonOptional(paths.reviewQueue)
  const reviewCandidates = await readJsonOptional(paths.reviewCandidates)

  const publicQuestionInputs = [
    ...arrayItems(demoQuestions).map(demoQuestionToInput),
    ...arrayItems(approvedGenerated?.questions).map(approvedGeneratedToInput),
  ]
    .filter((question) => question.reviewStatus === "approved")
    .sort((left, right) => compareTopics(left, right, canonicalTopics))

  const privateQuestionInputs = [
    ...arrayItems(reviewQueue?.reviewQueue).map(reviewQueueItemToInput),
    ...arrayItems(reviewCandidates).map(reviewCandidateToInput),
  ]
    .filter(
      (question) =>
        question.reviewStatus === "needs_review" &&
        question.trustLevel === "generated_unverified",
    )
    .sort((left, right) => compareTopics(left, right, canonicalTopics))

  const publicChunks = publicQuestionInputs.flatMap(chunkQuestion)
  const privateChunks = privateQuestionInputs.flatMap(chunkQuestion)
  const errors = [
    ...validateQuestionChunks(publicChunks, { visibility: "public" }),
    ...validateQuestionChunks(privateChunks, {
      allowGeneratedUnverified: true,
      visibility: "private",
    }),
  ]

  if (errors.length > 0) {
    console.error("Question chunk preparation failed validation:")
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  const publicPayload = {
    schemaVersion: 1,
    visibility: "public",
    audience: "student",
    source: {
      type: "question_retrieval_chunks",
      inputs: [
        relativeToRepo(paths.demoQuestions),
        relativeToRepo(paths.approvedGenerated),
      ],
    },
    safety: {
      includesApprovedDemoQuestions: true,
      includesApprovedGeneratedQuestions: true,
      excludesNeedsReviewGeneratedQuestions: true,
      excludesCopiedTextbookQuestions: true,
      callsOpenAI: false,
    },
    chunkSize: {
      maxBodyCharacters: QUESTION_CHUNK_MAX_BODY_CHARACTERS,
    },
    chunks: publicChunks,
  }
  const privatePayload = {
    schemaVersion: 1,
    visibility: "private",
    audience: "admin_dev",
    source: {
      type: "question_retrieval_chunks",
      inputs: [
        relativeToRepo(paths.reviewQueue),
        relativeToRepo(paths.reviewCandidates),
      ],
    },
    safety: {
      includesNeedsReviewGeneratedQuestions: true,
      studentFacing: false,
      excludesCopiedTextbookQuestions: true,
      callsOpenAI: false,
    },
    chunkSize: {
      maxBodyCharacters: QUESTION_CHUNK_MAX_BODY_CHARACTERS,
    },
    chunks: privateChunks,
  }

  await mkdir(path.dirname(paths.publicOutput), { recursive: true })
  await mkdir(path.dirname(paths.privateOutput), { recursive: true })
  await writeFile(
    paths.publicOutput,
    `${JSON.stringify(publicPayload, null, 2)}\n`,
  )
  await writeFile(
    paths.privateOutput,
    `${JSON.stringify(privatePayload, null, 2)}\n`,
  )

  console.log(
    `Prepared ${publicChunks.length} public question chunk(s) at ${relativeToRepo(
      paths.publicOutput,
    )}.`,
  )
  console.log(
    `Prepared ${privateChunks.length} private admin/dev question chunk(s) at ${relativeToRepo(
      paths.privateOutput,
    )}.`,
  )
}

function demoQuestionToInput(question) {
  return {
    id: stringValue(question.id),
    topic: stringValue(question.topic),
    topicId: stringValue(question.topicId),
    title: titleCase(stringValue(question.topic)),
    difficulty: difficultyValue(question.difficulty),
    questionText: stringValue(question.questionText),
    finalAnswer: stringValue(question.finalAnswer),
    answerExplanation: stringValue(question.finalAnswer),
    solutionSteps: stringArray(question.solutionSteps),
    hints: stringArray(question.hints),
    misconceptions: misconceptionArray(question.misconceptions),
    sourceType: sourceTypeValue(
      question.sourceMetadata?.sourceType,
      "original_demo",
    ),
    trustLevel: trustLevelValue(question.trustLevel, "public_original"),
    reviewStatus: reviewStatusValue(question.reviewStatus, "approved"),
    visibility: "public",
    priorityTier: "safe_demo",
  }
}

function approvedGeneratedToInput(question) {
  return {
    id: stringValue(question.id),
    topic: stringValue(question.topic),
    topicId: stringValue(question.topicId),
    title: titleCase(stringValue(question.topic)),
    difficulty: difficultyValue(question.difficulty),
    questionText: stringValue(question.questionText),
    finalAnswer: stringValue(question.finalAnswer),
    answerExplanation: stringValue(question.finalAnswer),
    solutionSteps: stringArray(question.solutionSteps),
    hints: stringArray(question.hints),
    misconceptions: misconceptionArray(question.misconceptions),
    sourceType: sourceTypeValue(
      question.sourceMetadata?.sourceType,
      "generated_original",
    ),
    trustLevel: trustLevelValue(question.trustLevel, "professor_approved"),
    reviewStatus: reviewStatusValue(question.reviewStatus, "approved"),
    visibility: "public",
    priorityTier: "approved_generated",
  }
}

function reviewQueueItemToInput(item) {
  return {
    id: stringValue(item.id),
    topic: stringValue(item.topic),
    topicId: stringValue(item.topicId),
    title: titleCase(stringValue(item.topic)),
    difficulty: difficultyValue(item.difficulty),
    questionText: stringValue(item.question),
    finalAnswer: stringValue(item.answer),
    answerExplanation: stringValue(item.answer),
    solutionSteps: stringArray(item.solutionSteps),
    hints: stringArray(item.hints),
    misconceptions: misconceptionArray(item.misconceptions),
    sourceType: "generated_original",
    trustLevel: "generated_unverified",
    reviewStatus: reviewStatusValue(item.reviewStatus, "needs_review"),
    visibility: "private",
    priorityTier: "admin_dev_draft",
  }
}

function reviewCandidateToInput(candidate) {
  return {
    id: stringValue(candidate.id),
    topic: stringValue(candidate.topic ?? candidate.topicId),
    topicId: stringValue(candidate.topicId),
    title:
      stringValue(candidate.title) || titleCase(stringValue(candidate.topic)),
    difficulty: difficultyValue(candidate.difficulty),
    questionText: stringValue(candidate.prompt),
    finalAnswer: stringValue(candidate.answer?.acceptedAnswers?.[0]),
    answerExplanation: stringValue(candidate.answer?.explanation),
    solutionSteps: stringArray(candidate.solutionSteps),
    hints: stringArray(candidate.hints),
    misconceptions: misconceptionArray(candidate.misconceptions),
    sourceType: sourceTypeValue(
      candidate.source?.sourceType,
      "pattern_derived_original",
    ),
    trustLevel: trustLevelValue(
      candidate.source?.trustLevel,
      "generated_unverified",
    ),
    reviewStatus: reviewStatusValue(candidate.review?.status, "needs_review"),
    visibility: "private",
    priorityTier: "admin_dev_draft",
  }
}

async function readJson(inputPath) {
  return JSON.parse(await readFile(inputPath, "utf8"))
}

async function readJsonOptional(inputPath) {
  try {
    return await readJson(inputPath)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return undefined
      }
    }

    throw error
  }
}

function arrayItems(value) {
  return Array.isArray(value) ? value : []
}

function misconceptionArray(value) {
  return arrayItems(value).map((misconception) => ({
    id: stringValue(misconception.id),
    hook: stringValue(misconception.hook),
    feedback: stringValue(misconception.feedback),
    matchTerms: stringArray(misconception.matchTerms),
  }))
}

function stringArray(value) {
  return arrayItems(value)
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function difficultyValue(value) {
  return ["foundational", "intermediate", "challenge"].includes(value)
    ? value
    : "foundational"
}

function sourceTypeValue(value, fallback) {
  return [
    "original_demo",
    "professor_provided",
    "generated_original",
    "pattern_derived_original",
    "private_reference_pattern",
  ].includes(value)
    ? value
    : fallback
}

function trustLevelValue(value, fallback) {
  if (value === "original_demo") {
    return "public_original"
  }

  return [
    "public_original",
    "professor_approved",
    "course_approved",
    "generated_unverified",
    "private_reference",
  ].includes(value)
    ? value
    : fallback
}

function reviewStatusValue(value, fallback) {
  return [
    "approved",
    "needs_review",
    "rejected",
    "needs_edit",
    "needs_regeneration",
  ].includes(value)
    ? value
    : fallback
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : ""
}

function titleCase(value) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
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
      `WARNING: public question chunks must be written under data/processed: ${relativeToRepo(
        targetPath,
      )}`,
    )
    return false
  }

  if (isInside(targetPath, path.join(repoRoot, "data/processed/private"))) {
    console.warn(
      "WARNING: public question chunks must not be written under data/processed/private.",
    )
    return false
  }

  return true
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
      `WARNING: private question chunks must stay under data/private: ${relativeToRepo(
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
      `WARNING: private question chunk output is not ignored by Git: ${relativePath}`,
      "Refusing to continue because private admin/dev chunks must stay local.",
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

function resolveArgPath(value, fallback) {
  return path.resolve(repoRoot, value ?? fallback)
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath) || "."
}

function parseArgs(rawArgs) {
  const parsed = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    const value = rawArgs[index + 1]

    if (arg === "--demo-questions") {
      parsed.demoQuestions = value
      index += 1
    } else if (arg === "--approved-generated") {
      parsed.approvedGenerated = value
      index += 1
    } else if (arg === "--review-queue") {
      parsed.reviewQueue = value
      index += 1
    } else if (arg === "--review-candidates") {
      parsed.reviewCandidates = value
      index += 1
    } else if (arg === "--public-output") {
      parsed.publicOutput = value
      index += 1
    } else if (arg === "--private-output") {
      parsed.privateOutput = value
      index += 1
    }
  }

  return parsed
}

await main()
