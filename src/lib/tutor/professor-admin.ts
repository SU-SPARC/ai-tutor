import "server-only"

import {
  REVIEW_PRIORITIES,
  REVIEW_STATUSES,
  SOURCE_TYPES,
  TRUST_LEVELS,
  type Difficulty,
  type GeneratedQuestionReviewOutcomes,
  type InstructorAnalyticsDashboard,
  type ProfessorAnalyticsDashboard,
  type ProfessorPracticeAnalytics,
  type ProfessorReviewAnalytics,
  type ReviewCandidate,
  type ReviewPriority,
  type ReviewStatus,
  type SourceType,
  type Topic,
  type TrustLevel,
  type UsageDashboard,
} from "@/lib/types"

export type GeneratedReviewUploadResult =
  | {
      candidates: ReviewCandidate[]
      errors: []
    }
  | {
      candidates: []
      errors: string[]
    }

const allowedDifficulties = new Set<Difficulty>([
  "foundational",
  "intermediate",
  "challenge",
])

const generatedSourceTypes = new Set<SourceType>([
  "generated_original",
  "pattern_derived_original",
])

const forbiddenUploadKeys = new Set([
  "chunk",
  "chunks",
  "embedding",
  "embeddings",
  "extractedText",
  "locator",
  "page",
  "pageNumber",
  "privatePhraseHashes",
  "rawText",
  "sourceItemIds",
  "sourceNumberSets",
  "sourcePage",
  "sourceStoryFamilies",
])

const copiedSourceSignal =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number/i

const MAX_UPLOAD_CANDIDATES = 100

export function buildProfessorAnalyticsDashboard(input: {
  mode: "database" | "demo"
  practice: ProfessorPracticeAnalytics
  reviewQueue: ReviewCandidate[]
  usage: UsageDashboard
}): ProfessorAnalyticsDashboard {
  return {
    instructor: buildInstructorAnalyticsDashboard(input),
    mode: input.mode,
    practice: input.practice,
    review: buildReviewAnalytics(input.reviewQueue),
    usage: input.usage,
  }
}

export function buildInstructorAnalyticsDashboard(input: {
  mode: "database" | "demo"
  practice: ProfessorPracticeAnalytics
  reviewQueue: ReviewCandidate[]
  usage: UsageDashboard
}): InstructorAnalyticsDashboard {
  const usageTotals = input.usage.daily.reduce(
    (totals, day) => ({
      cacheHits: totals.cacheHits + day.cacheHits,
      llmCalls: totals.llmCalls + day.llmCalls,
    }),
    { cacheHits: 0, llmCalls: 0 },
  )
  const generated = normalizeGeneratedOutcomes(
    input.practice.generatedQuestionOutcomes,
  )
  const mostMissedQuestions = input.practice.questions
    .map((question) => {
      const missedAttempts = Math.max(
        0,
        question.attempts - question.correctAttempts,
      )

      return {
        attempts: question.attempts,
        correctAttempts: question.correctAttempts,
        missedAttempts,
        missRate: question.attempts > 0 ? missedAttempts / question.attempts : 0,
        questionId: question.questionId,
        questionTitle: question.questionTitle,
        topicId: question.topicId,
        topicTitle: question.topicTitle,
      }
    })
    .filter((question) => question.missedAttempts > 0)
    .sort(
      (left, right) =>
        right.missedAttempts - left.missedAttempts ||
        right.missRate - left.missRate ||
        left.questionTitle.localeCompare(right.questionTitle),
    )
    .slice(0, 8)
  const mostPracticedTopics = [...input.practice.topics]
    .sort(
      (left, right) =>
        right.attempts - left.attempts ||
        left.topicTitle.localeCompare(right.topicTitle),
    )
    .slice(0, 8)
  const commonMisconceptions = [...input.practice.commonMisconceptions]
    .sort(
      (left, right) =>
        right.missedAttempts - left.missedAttempts ||
        left.feedback.localeCompare(right.feedback),
    )
    .slice(0, 8)
  const mode =
    input.practice.mode === "database" && input.usage.mode === "database"
      ? "database"
      : "demo"

  return {
    commonMisconceptions,
    generatedQuestions: {
      approved: generated.approved,
      needsEdit: generated.needs_edit,
      needsRegeneration: generated.needs_regeneration,
      needsReview: generated.needs_review,
      rejected: generated.rejected,
    },
    mode,
    mostMissedQuestions,
    mostPracticedTopics,
    notes:
      mode === "database"
        ? []
        : [
            "Demo analytics are shown because database-backed analytics are unavailable or incomplete.",
          ],
    totals: {
      averageHintsUsed:
        input.practice.summary.totalTutorSessions > 0
          ? input.practice.summary.totalHintsUsed /
            input.practice.summary.totalTutorSessions
          : 0,
      cacheHits: usageTotals.cacheHits,
      generatedQuestionsApproved: generated.approved,
      generatedQuestionsRejected: generated.rejected,
      llmCallsUsed:
        usageTotals.llmCalls ||
        input.practice.questions.reduce(
          (total, question) => total + question.llmAttempts,
          0,
        ),
      totalAttempts: input.practice.summary.totalAttempts,
      totalTutorSessions: input.practice.summary.totalTutorSessions,
    },
  }
}

export function buildReviewAnalytics(
  reviewQueue: ReviewCandidate[],
): ProfessorReviewAnalytics {
  const byDifficulty = {
    challenge: 0,
    foundational: 0,
    intermediate: 0,
  } satisfies Record<Difficulty, number>
  const byPriority = {
    normal: 0,
    priority: 0,
  } satisfies Record<ReviewPriority, number>
  const byStatus = REVIEW_STATUSES.reduce(
    (counts, status) => ({ ...counts, [status]: 0 }),
    {} as Record<ReviewStatus, number>,
  )
  const byTopic: Record<string, number> = {}

  for (const candidate of reviewQueue) {
    byDifficulty[candidate.difficulty] += 1
    byPriority[candidate.review.reviewPriority ?? "normal"] += 1
    byStatus[candidate.review.status] += 1
    byTopic[candidate.topicId] = (byTopic[candidate.topicId] ?? 0) + 1
  }

  return {
    byDifficulty,
    byPriority,
    byStatus,
    byTopic,
    totalBacklog: reviewQueue.length,
  }
}

export function emptyGeneratedQuestionReviewOutcomes(): GeneratedQuestionReviewOutcomes {
  return REVIEW_STATUSES.reduce(
    (counts, status) => ({ ...counts, [status]: 0 }),
    {} as GeneratedQuestionReviewOutcomes,
  )
}

function normalizeGeneratedOutcomes(
  outcomes: GeneratedQuestionReviewOutcomes,
): GeneratedQuestionReviewOutcomes {
  return {
    ...emptyGeneratedQuestionReviewOutcomes(),
    ...outcomes,
  }
}

export function validateGeneratedReviewUpload(
  payload: unknown,
): GeneratedReviewUploadResult {
  const safetyErrors = findForbiddenUploadSignals(payload)

  if (safetyErrors.length > 0) {
    return { candidates: [], errors: safetyErrors }
  }

  const items = extractUploadItems(payload)
  const errors: string[] = []

  if (!items) {
    return {
      candidates: [],
      errors: [
        "Upload must contain a generated review array, candidates, reviewQueue, or questions.",
      ],
    }
  }

  if (items.length === 0) {
    return { candidates: [], errors: ["Upload must include at least one item."] }
  }

  if (items.length > MAX_UPLOAD_CANDIDATES) {
    return {
      candidates: [],
      errors: [`Upload is limited to ${MAX_UPLOAD_CANDIDATES} candidates.`],
    }
  }

  const candidates = items.flatMap((item, index) => {
    const result = candidateFromUploadItem(item, index)
    if ("error" in result) {
      errors.push(result.error)
      return []
    }

    return [result.candidate]
  })

  if (errors.length > 0) {
    return { candidates: [], errors }
  }

  const duplicateIds = findDuplicateIds(candidates)
  if (duplicateIds.length > 0) {
    return {
      candidates: [],
      errors: [`Duplicate candidate id(s): ${duplicateIds.join(", ")}.`],
    }
  }

  return { candidates, errors: [] }
}

export function isValidReviewPriority(
  value: string | undefined,
): value is ReviewPriority {
  return value ? (REVIEW_PRIORITIES as readonly string[]).includes(value) : false
}

export function isValidReviewStatus(
  value: string | undefined,
): value is ReviewStatus {
  return value ? (REVIEW_STATUSES as readonly string[]).includes(value) : false
}

export function isValidReviewDifficulty(
  value: string | undefined,
): value is Difficulty {
  return value ? allowedDifficulties.has(value as Difficulty) : false
}

export function safeTopics(topics: Topic[]) {
  return topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
  }))
}

function extractUploadItems(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!isRecord(payload)) {
    return undefined
  }

  for (const key of ["candidates", "reviewQueue", "questions"]) {
    const value = payload[key]
    if (Array.isArray(value)) {
      return value
    }
  }

  return undefined
}

function candidateFromUploadItem(
  item: unknown,
  index: number,
): { candidate: ReviewCandidate } | { error: string } {
  if (!isRecord(item)) {
    return { error: `Item ${index + 1} must be an object.` }
  }

  const review = recordValue(item.review)
  const source = recordValue(item.source) ?? recordValue(item.sourceMetadata)
  const answer = recordValue(item.answer)
  const prompt = firstString(item.prompt, item.question, item.questionText)
  const finalAnswer = firstString(
    item.finalAnswer,
    item.answerText,
    item.answer,
    answer?.acceptedAnswers,
  )
  const topicId = firstString(item.topicId) ?? slugify(firstString(item.topic))
  const sourceType = stringEnum<SourceType>(
    firstString(source?.sourceType, item.sourceType),
    SOURCE_TYPES,
  )
  const trustLevel = stringEnum<TrustLevel>(
    firstString(source?.trustLevel, item.trustLevel),
    TRUST_LEVELS,
  )
  const reviewStatus = stringEnum<ReviewStatus>(
    firstString(review?.status, item.reviewStatus),
    REVIEW_STATUSES,
  )
  const difficulty = firstString(item.difficulty)
  const acceptedAnswers = stringArray(answer?.acceptedAnswers)
  const answerChoices =
    acceptedAnswers.length > 0
      ? acceptedAnswers
      : finalAnswer
        ? [finalAnswer]
        : []
  const hints = stringArray(item.hints)
  const solutionSteps = stringArray(item.solutionSteps)
  const misconceptions = misconceptionArray(item.misconceptions)
  const originalityNote = firstString(
    source?.originalityNote,
    item.originalityNote,
  )
  const patternId = firstString(item.patternId)

  if (!prompt) {
    return { error: `Item ${index + 1} is missing a prompt/question.` }
  }

  if (!topicId) {
    return { error: `Item ${index + 1} is missing topicId or topic.` }
  }

  if (!difficulty || !allowedDifficulties.has(difficulty as Difficulty)) {
    return { error: `Item ${index + 1} has an invalid difficulty.` }
  }

  if (!sourceType || !generatedSourceTypes.has(sourceType)) {
    return {
      error:
        `Item ${index + 1} must be generated_original or pattern_derived_original.`,
    }
  }

  if (trustLevel !== "generated_unverified") {
    return {
      error: `Item ${index + 1} must have generated_unverified trustLevel.`,
    }
  }

  if (reviewStatus !== "needs_review") {
    return { error: `Item ${index + 1} must have needs_review status.` }
  }

  if (answerChoices.length === 0) {
    return { error: `Item ${index + 1} is missing a final answer.` }
  }

  if (hints.length === 0 || solutionSteps.length === 0) {
    return {
      error: `Item ${index + 1} must include hints and solution steps.`,
    }
  }

  if (misconceptions.length === 0) {
    return { error: `Item ${index + 1} must include misconceptions.` }
  }

  if (!originalityNote) {
    return { error: `Item ${index + 1} is missing an originality note.` }
  }

  return {
    candidate: {
      answer: {
        acceptedAnswers: answerChoices,
        explanation:
          firstString(answer?.explanation, item.answerExplanation) ??
          "Generated answer pending professor review.",
        numericValue: numberValue(answer?.numericValue),
        tolerance: numberValue(answer?.tolerance),
      },
      difficulty: difficulty as Difficulty,
      hints,
      id:
        firstString(item.id) ??
        `uploaded-generated-${(slugify(prompt) ?? "draft").slice(0, 48)}-${
          index + 1
        }`,
      misconceptions,
      patternSource:
        firstString(item.patternSource, item.patternId) ?? sourceType,
      prompt,
      review: {
        notes: firstString(review?.notes, item.reviewNotes),
        reviewPriority: stringEnum<ReviewPriority>(
          firstString(review?.reviewPriority, item.reviewPriority),
          REVIEW_PRIORITIES,
        ) ?? "normal",
        status: "needs_review",
      },
      solutionSteps,
      source: {
        originalityNote,
        patternIds: patternId ? [patternId] : undefined,
        sourceType,
        trustLevel: "generated_unverified",
        visibility: "public",
      },
      title:
        firstString(item.title) ??
        `Generated review candidate ${index + 1}`,
      topic: firstString(item.topic),
      topicId,
    },
  }
}

function misconceptionArray(value: unknown): ReviewCandidate["misconceptions"] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item, index) => {
    if (!isRecord(item)) {
      return []
    }

    const id = firstString(item.id) ?? `misconception-${index + 1}`
    const feedback = firstString(item.feedback)

    if (!feedback) {
      return []
    }

    return [
      {
        feedback,
        id,
        matchTerms: stringArray(item.matchTerms).concat(
          firstString(item.hook) ? [String(item.hook)] : [],
        ),
      },
    ]
  })
}

function findForbiddenUploadSignals(value: unknown) {
  const errors = new Set<string>()

  walkUnknown(value, (key, item) => {
    if (key && forbiddenUploadKeys.has(key)) {
      errors.add(`Upload contains private-only field: ${key}.`)
    }

    if (typeof item === "string" && copiedSourceSignal.test(item)) {
      errors.add("Upload contains copied-source or private-source wording.")
    }
  })

  return [...errors]
}

function walkUnknown(
  value: unknown,
  visit: (key: string | undefined, value: unknown) => void,
  key?: string,
) {
  visit(key, value)

  if (Array.isArray(value)) {
    value.forEach((item) => walkUnknown(item, visit))
    return
  }

  if (!isRecord(value)) {
    return
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    walkUnknown(childValue, visit, childKey)
  }
}

function findDuplicateIds(candidates: ReviewCandidate[]) {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      duplicates.add(candidate.id)
    }
    seen.add(candidate.id)
  }

  return [...duplicates]
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const first: string | undefined = firstString(...value)
      if (first) {
        return first
      }
      continue
    }

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((item): item is string => typeof item === "string")
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function stringEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function slugify(value: string | undefined) {
  return value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
