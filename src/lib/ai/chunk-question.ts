import type {
  Difficulty,
  RetrievalChunk,
  RetrievalChunkType,
  RetrievalPriorityTier,
  ReviewStatus,
  SourceMetadata,
  SourceType,
  TrustLevel,
  Visibility,
} from "../types"

export const QUESTION_CHUNK_MAX_BODY_CHARACTERS = 900

export type QuestionChunkMisconception = {
  feedback: string
  hook?: string
  id: string
  matchTerms?: string[]
}

export type QuestionChunkInput = {
  answerExplanation?: string
  difficulty: Difficulty
  finalAnswer?: string
  hints: string[]
  id: string
  misconceptions: QuestionChunkMisconception[]
  priorityTier?: RetrievalPriorityTier
  questionText: string
  reviewStatus: ReviewStatus
  solutionSteps: string[]
  sourceType: SourceType
  title?: string
  topic: string
  topicId: string
  trustLevel: TrustLevel
  visibility: Visibility
}

export type QuestionRetrievalChunk = RetrievalChunk & {
  chunkIndex?: number
  reviewStatus: ReviewStatus
  sourceType: SourceType
  topic: string
  trustLevel: TrustLevel
  visibility: Visibility
}

export type ChunkValidationOptions = {
  allowGeneratedUnverified?: boolean
  visibility?: Visibility
}

const copiedSourceSignal =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|textbook page/i

const keywordStopWords = new Set([
  "and",
  "are",
  "for",
  "from",
  "has",
  "into",
  "that",
  "the",
  "then",
  "this",
  "with",
])

export function chunkQuestion(
  question: QuestionChunkInput,
): QuestionRetrievalChunk[] {
  const base = baseMetadataForQuestion(question)
  const chunks: QuestionRetrievalChunk[] = []

  pushChunk(chunks, base, {
    body: `Question: ${question.questionText}`,
    chunkType: "question",
    idSuffix: "question",
    title: `${base.title} question`,
  })

  const solutionSummary = buildSolutionSummary(question)

  if (solutionSummary) {
    pushChunk(chunks, base, {
      body: solutionSummary,
      chunkType: "solution_summary",
      idSuffix: "solution-summary",
      title: `${base.title} solution summary`,
    })
  }

  question.solutionSteps.forEach((step, index) => {
    pushChunk(chunks, base, {
      body: `Solution step ${index + 1}: ${step}`,
      chunkIndex: index + 1,
      chunkType: "solution_step",
      idSuffix: `solution-step-${index + 1}`,
      title: `${base.title} solution step ${index + 1}`,
    })
  })

  question.hints.forEach((hint, index) => {
    pushChunk(chunks, base, {
      body: `Hint ${index + 1}: ${hint}`,
      chunkIndex: index + 1,
      chunkType: "hint",
      idSuffix: `hint-${index + 1}`,
      title: `${base.title} hint ${index + 1}`,
    })
  })

  question.misconceptions.forEach((misconception) => {
    const trigger = misconception.hook
      ? ` Trigger: ${misconception.hook}`
      : misconception.matchTerms?.length
        ? ` Watch for: ${misconception.matchTerms.join(", ")}.`
        : ""

    pushChunk(chunks, base, {
      body: `Misconception ${misconception.id}:${trigger} Feedback: ${misconception.feedback}`,
      chunkType: "misconception",
      idSuffix: `misconception-${slug(misconception.id)}`,
      title: `${base.title} misconception ${misconception.id}`,
    })
  })

  return chunks
}

export function validateQuestionChunks(
  chunks: QuestionRetrievalChunk[],
  options: ChunkValidationOptions = {},
) {
  const errors: string[] = []
  const seenIds = new Set<string>()

  for (const [index, chunk] of chunks.entries()) {
    const label = `chunks[${index}]`

    if (!chunk.id.trim()) {
      errors.push(`${label}.id must be a non-empty string.`)
    } else if (seenIds.has(chunk.id)) {
      errors.push(`${label}.id is duplicated: ${chunk.id}.`)
    }
    seenIds.add(chunk.id)

    for (const field of [
      "body",
      "questionId",
      "topic",
      "topicId",
      "sourceType",
      "trustLevel",
      "reviewStatus",
      "chunkType",
    ] as const) {
      if (typeof chunk[field] !== "string" || !chunk[field].trim()) {
        errors.push(`${label}.${field} must be a non-empty string.`)
      }
    }

    if (options.visibility && chunk.visibility !== options.visibility) {
      errors.push(`${label}.visibility must be ${options.visibility}.`)
    }

    if (chunk.body.length > QUESTION_CHUNK_MAX_BODY_CHARACTERS) {
      errors.push(
        `${label}.body exceeds ${QUESTION_CHUNK_MAX_BODY_CHARACTERS} characters.`,
      )
    }

    if (copiedSourceSignal.test(chunk.body)) {
      errors.push(`${label}.body contains copied-source or private-data text.`)
    }

    if (!options.allowGeneratedUnverified) {
      if (chunk.reviewStatus !== "approved") {
        errors.push(`${label}.reviewStatus must be approved.`)
      }

      if (chunk.trustLevel === "generated_unverified") {
        errors.push(`${label}.trustLevel must not be generated_unverified.`)
      }
    }
  }

  return errors
}

export function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || "untitled"
}

function baseMetadataForQuestion(question: QuestionChunkInput) {
  const topicId = question.topicId.trim()
  const title = question.title?.trim() || titleCase(question.topic)
  const priorityTier =
    question.priorityTier ?? priorityTierForQuestion(question)
  const source: SourceMetadata = {
    sourceType: question.sourceType,
    trustLevel: question.trustLevel,
    visibility: question.visibility,
  }

  return {
    conceptTags: [
      question.topic,
      question.difficulty,
      ...question.misconceptions.map((misconception) => misconception.id),
    ],
    difficulty: question.difficulty,
    keywords: buildKeywords([
      question.topic,
      title,
      question.questionText,
      question.answerExplanation ?? "",
      ...question.hints,
      ...question.solutionSteps,
      ...question.misconceptions.flatMap((misconception) => [
        misconception.id,
        misconception.hook ?? "",
        misconception.feedback,
        ...(misconception.matchTerms ?? []),
      ]),
    ]),
    priorityTier,
    questionId: question.id,
    review: {
      status: question.reviewStatus,
    },
    reviewStatus: question.reviewStatus,
    source,
    sourceType: question.sourceType,
    title,
    topic: question.topic,
    topicId,
    trustLevel: question.trustLevel,
    visibility: question.visibility,
  }
}

function pushChunk(
  chunks: QuestionRetrievalChunk[],
  base: ReturnType<typeof baseMetadataForQuestion>,
  chunk: {
    body: string
    chunkIndex?: number
    chunkType: RetrievalChunkType
    idSuffix: string
    title: string
  },
) {
  const body = chunk.body.trim()

  if (!body) {
    return
  }

  chunks.push({
    body,
    chunkIndex: chunk.chunkIndex,
    chunkType: chunk.chunkType,
    conceptTags: base.conceptTags,
    difficulty: base.difficulty,
    formulaRefs: [],
    id: `question-chunk:${base.questionId}:${chunk.idSuffix}`,
    keywords: base.keywords,
    priorityTier: base.priorityTier,
    questionId: base.questionId,
    review: base.review,
    reviewStatus: base.reviewStatus,
    source: base.source,
    sourceType: base.sourceType,
    title: chunk.title,
    topic: base.topic,
    topicId: base.topicId,
    trustLevel: base.trustLevel,
    visibility: base.visibility,
  })
}

function buildSolutionSummary(question: QuestionChunkInput) {
  const parts = [
    question.answerExplanation
      ? `Solution summary: ${question.answerExplanation}`
      : undefined,
    question.finalAnswer ? `Final answer: ${question.finalAnswer}` : undefined,
  ].filter((part): part is string => Boolean(part))

  return parts.join(" ")
}

function priorityTierForQuestion(
  question: Pick<QuestionChunkInput, "sourceType" | "trustLevel">,
): RetrievalPriorityTier {
  if (question.trustLevel === "generated_unverified") {
    return "admin_dev_draft"
  }

  if (
    question.sourceType === "generated_original" ||
    question.sourceType === "pattern_derived_original"
  ) {
    return "approved_generated"
  }

  if (question.sourceType === "original_demo") {
    return "safe_demo"
  }

  return "approved_professor_course"
}

function buildKeywords(values: string[]) {
  const terms = new Set<string>()

  for (const value of values) {
    for (const term of value.toLowerCase().split(/[^a-z0-9.%-]+/)) {
      if (term.length > 1 && !keywordStopWords.has(term)) {
        terms.add(term)
      }
    }
  }

  return [...terms].slice(0, 32)
}

function titleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ")
}
