import "server-only"

import {
  getApprovedQuestions,
  getRetrievalChunks,
  getReviewQueue,
} from "@/lib/data/data-store"
import { chunkQuestion } from "@/lib/ai/chunk-question"
import {
  localResultToRetrievalChunk,
  searchLocalRetrieval,
} from "@/lib/ai/retrieval"
import {
  isApprovedPublicTrustedContent,
  type LlmGroundingContext,
  type RetrievalChunk,
  type RetrievalMatch,
  type RetrievalPriorityTier,
  type ReviewCandidate,
  type TutorQuestion,
  type TutorRetrievalResult,
} from "@/lib/types"

export type RetrievalAudience = "admin_dev" | "student"

export type RetrievalOptions = {
  audience?: RetrievalAudience
  includeQuestionExamples?: boolean
  maxResults?: number
  topicId?: string
}

export type GroundingContextOptions = {
  maxCharsPerChunk?: number
  maxItems?: number
  maxTotalChars?: number
}

const DEFAULT_MAX_RESULTS = 3
const DEFAULT_MAX_GROUNDING_ITEMS = 4
const DEFAULT_MAX_GROUNDING_CHARS_PER_CHUNK = 520
const DEFAULT_MAX_GROUNDING_CHARS_TOTAL = 1600
const DEFAULT_MAX_BROWSER_CHARS_PER_CHUNK = 700

const forbiddenPrivateSignal =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page/i

const stopWords = new Set([
  "and",
  "are",
  "for",
  "has",
  "how",
  "is",
  "of",
  "on",
  "or",
  "the",
  "that",
  "then",
  "this",
  "to",
  "use",
  "what",
  "when",
  "where",
  "with",
])

const priorityRank: Record<RetrievalPriorityTier, number> = {
  approved_professor_course: 50,
  approved_generated: 40,
  private_reference: 30,
  safe_demo: 20,
  admin_dev_draft: 10,
}

export async function retrieveCourseContext(query: string, topicId?: string) {
  const result = await retrieveTutorContext(query, {
    maxResults: 2,
    topicId,
  })

  return result.retrievedContext
}

export async function retrieveTutorContext(
  query: string,
  options: RetrievalOptions = {},
): Promise<TutorRetrievalResult> {
  const audience = options.audience ?? "student"
  const includeQuestionExamples = options.includeQuestionExamples ?? true
  const [storedChunks, approvedQuestions, reviewCandidates, localResults] =
    await Promise.all([
      getRetrievalChunks(),
      includeQuestionExamples ? getApprovedQuestions() : Promise.resolve([]),
      audience === "admin_dev" ? getReviewQueue() : Promise.resolve([]),
      searchLocalRetrieval(query, {
        audience: audience === "admin_dev" ? "admin_dev" : "student",
        maxResults: options.maxResults ?? 3,
        topicId: options.topicId,
      }),
    ])
  const chunks = [
    ...storedChunks,
    ...localResults.map(localResultToRetrievalChunk),
    ...approvedQuestions.flatMap(questionToRetrievalChunks),
    ...reviewCandidates.flatMap(reviewCandidateToRetrievalChunks),
  ]
  const matches = rankRetrievalChunks(query, chunks, {
    ...options,
    audience,
  })

  return {
    matches,
    retrievedContext: matches.map((match) => match.chunk),
    groundingContext: buildLlmGroundingContext(matches),
  }
}

export function rankRetrievalChunks(
  query: string,
  chunks: RetrievalChunk[],
  options: RetrievalOptions = {},
): RetrievalMatch[] {
  const audience = options.audience ?? "student"
  const queryTerms = tokenizeText(query)
  const normalizedQuery = normalizeText(query)

  if (queryTerms.size === 0 && !options.topicId) {
    return []
  }

  return chunks
    .map((chunk) => sanitizeChunkForAudience(chunk, audience))
    .filter((chunk): chunk is RetrievalChunk => Boolean(chunk))
    .map((chunk) => ({
      chunk,
      priorityTier: chunk.priorityTier,
      score: scoreChunk(chunk, {
        normalizedQuery,
        queryTerms,
        topicId: options.topicId,
      }),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      if (priorityRank[right.priorityTier] !== priorityRank[left.priorityTier]) {
        return priorityRank[right.priorityTier] - priorityRank[left.priorityTier]
      }

      return left.chunk.id.localeCompare(right.chunk.id)
    })
    .slice(0, options.maxResults ?? DEFAULT_MAX_RESULTS)
}

export function buildLlmGroundingContext(
  matches: RetrievalMatch[],
  options: GroundingContextOptions = {},
): LlmGroundingContext[] {
  const maxItems = options.maxItems ?? DEFAULT_MAX_GROUNDING_ITEMS
  const maxCharsPerChunk =
    options.maxCharsPerChunk ?? DEFAULT_MAX_GROUNDING_CHARS_PER_CHUNK
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_GROUNDING_CHARS_TOTAL
  const context: LlmGroundingContext[] = []
  let remainingChars = maxTotalChars

  for (const match of matches) {
    if (context.length >= maxItems || remainingChars <= 0) {
      break
    }

    const rawBody = contextBodyForChunk(match.chunk)
    if (!rawBody || hasForbiddenPrivateSignal(rawBody)) {
      continue
    }

    const body = truncateText(rawBody, Math.min(maxCharsPerChunk, remainingChars))
    if (!body) {
      continue
    }

    context.push({
      body,
      id: match.chunk.id,
      priorityTier: match.priorityTier,
      sourceType: match.chunk.source.sourceType,
      title: match.chunk.title,
      topicId: match.chunk.topicId,
    })
    remainingChars -= body.length
  }

  return context
}

export function hasForbiddenPrivateSignal(text: string) {
  return forbiddenPrivateSignal.test(text)
}

function questionToRetrievalChunks(question: TutorQuestion): RetrievalChunk[] {
  return chunkQuestion({
    id: question.id,
    topic: question.topicId,
    topicId: question.topicId,
    title: question.title,
    difficulty: question.difficulty,
    questionText: question.prompt,
    finalAnswer: question.answer.acceptedAnswers[0],
    answerExplanation: question.answer.explanation,
    solutionSteps: question.solutionSteps,
    hints: question.hints,
    misconceptions: question.misconceptions,
    sourceType: question.source.sourceType,
    trustLevel: question.source.trustLevel,
    reviewStatus: question.review.status,
    visibility: question.source.visibility,
    priorityTier: priorityTierForContent(question),
  })
}

function reviewCandidateToRetrievalChunks(
  candidate: ReviewCandidate,
): RetrievalChunk[] {
  return questionToRetrievalChunks(candidate).map((chunk) => ({
    ...chunk,
    priorityTier: "admin_dev_draft",
  }))
}

function sanitizeChunkForAudience(
  chunk: RetrievalChunk,
  audience: RetrievalAudience,
): RetrievalChunk | undefined {
  const priorityTier = chunk.priorityTier ?? priorityTierForContent(chunk)
  const normalizedChunk = {
    ...chunk,
    conceptTags: chunk.conceptTags ?? [],
    formulaRefs: chunk.formulaRefs ?? [],
    priorityTier,
  }

  if (normalizedChunk.source.trustLevel === "generated_unverified") {
    if (audience !== "admin_dev") {
      return undefined
    }

    return safeChunkWithBody(normalizedChunk, normalizedChunk.body, {
      priorityTier: "admin_dev_draft",
    })
  }

  if (isPrivateReferenceChunk(normalizedChunk)) {
    const summary = normalizedChunk.llmSafeSummary?.trim()

    if (
      normalizedChunk.review.status !== "approved" ||
      !summary ||
      hasForbiddenPrivateSignal(summary)
    ) {
      return undefined
    }

    return safeChunkWithBody(normalizedChunk, summary, {
      priorityTier: "private_reference",
    })
  }

  if (!isApprovedPublicTrustedContent(normalizedChunk)) {
    return undefined
  }

  if (hasForbiddenPrivateSignal(normalizedChunk.body)) {
    return undefined
  }

  return safeChunkWithBody(normalizedChunk, normalizedChunk.body, {
    priorityTier,
  })
}

function safeChunkWithBody(
  chunk: RetrievalChunk,
  body: string,
  overrides: Partial<Pick<RetrievalChunk, "priorityTier">> = {},
): RetrievalChunk {
  const safeBody = truncateText(body, DEFAULT_MAX_BROWSER_CHARS_PER_CHUNK)

  return {
    ...chunk,
    ...overrides,
    body: safeBody,
    llmSafeSummary: chunk.llmSafeSummary
      ? truncateText(chunk.llmSafeSummary, DEFAULT_MAX_BROWSER_CHARS_PER_CHUNK)
      : undefined,
  }
}

function scoreChunk(
  chunk: RetrievalChunk,
  input: {
    normalizedQuery: string
    queryTerms: Set<string>
    topicId?: string
  },
) {
  let score = 0

  if (input.topicId && chunk.topicId === input.topicId) {
    score += 8
  }

  score += scorePhrases(chunk.formulaRefs, input, 6)
  score += scorePhrases(chunk.conceptTags, input, 5)
  score += scorePhrases(chunk.keywords, input, 4)
  score += scorePhrases([chunk.title], input, 3)
  score += scoreText(chunk.llmSafeSummary ?? chunk.body, input.queryTerms)

  return score
}

function scorePhrases(
  phrases: string[],
  input: {
    normalizedQuery: string
    queryTerms: Set<string>
  },
  weight: number,
) {
  return phrases.reduce((score, phrase) => {
    const normalizedPhrase = normalizeText(phrase)
    const phraseTerms = tokenizeText(phrase)
    const hasExactMatch =
      normalizedPhrase.length > 0 &&
      input.normalizedQuery.length > 0 &&
      phraseTerms.size > 1 &&
      (input.normalizedQuery.includes(normalizedPhrase) ||
        normalizedPhrase.includes(input.normalizedQuery))
    const hasTermMatch = [...phraseTerms].some((term) =>
      input.queryTerms.has(term),
    )

    return score + (hasExactMatch || hasTermMatch ? weight : 0)
  }, 0)
}

function scoreText(text: string, queryTerms: Set<string>) {
  const terms = tokenizeText(text)
  let score = 0

  for (const term of queryTerms) {
    if (terms.has(term)) {
      score += 1
    }
  }

  return score
}

function contextBodyForChunk(chunk: RetrievalChunk) {
  if (isPrivateReferenceChunk(chunk)) {
    return chunk.llmSafeSummary ?? chunk.body
  }

  return chunk.body
}

function priorityTierForContent(content: {
  source: RetrievalChunk["source"]
}): RetrievalPriorityTier {
  if (content.source.trustLevel === "generated_unverified") {
    return "admin_dev_draft"
  }

  if (
    content.source.sourceType === "generated_original" ||
    content.source.sourceType === "pattern_derived_original"
  ) {
    return "approved_generated"
  }

  if (isPrivateReferenceSource(content.source)) {
    return "private_reference"
  }

  if (content.source.sourceType === "original_demo") {
    return "safe_demo"
  }

  return "approved_professor_course"
}

function isPrivateReferenceChunk(chunk: RetrievalChunk) {
  return isPrivateReferenceSource(chunk.source)
}

function isPrivateReferenceSource(source: RetrievalChunk["source"]) {
  return (
    source.visibility === "private" ||
    source.trustLevel === "private_reference" ||
    source.sourceType === "private_reference_pattern"
  )
}

function tokenizeText(text: string) {
  return new Set(
    normalizeText(text)
      .split(/[^a-z0-9.%-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 1 && !stopWords.has(term)),
  )
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function truncateText(text: string, maxLength: number) {
  const trimmed = text.trim()

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}
