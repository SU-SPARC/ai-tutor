import "server-only"

import { readFile } from "node:fs/promises"
import path from "node:path"

import type {
  Difficulty,
  RetrievalChunk,
  RetrievalChunkType,
  ReviewStatus,
  SourceType,
  TrustLevel,
  Visibility,
} from "../types"
import {
  createOpenAIEmbeddingProvider,
  type EmbeddingProvider,
} from "./embeddings"

export type LocalRetrievalAudience = "admin_dev" | "server" | "student"

export type LocalRetrievalSourceLabel =
  | "demo_question_chunks"
  | "private_question_chunks"
  | "private_reference_chunks"

export type LocalKeywordRetrievalOptions = {
  audience?: LocalRetrievalAudience
  filters?: LocalRetrievalMetadataFilters
  maxChunkCharacters?: number
  maxContextCharacters?: number
  maxResults?: number
  repoRoot?: string
  sources?: LocalRetrievalSourceConfig[]
  topic?: string
  topicId?: string
}

export type LocalVectorRetrievalOptions = LocalKeywordRetrievalOptions & {
  embeddingProvider?: EmbeddingProvider
  embeddingsPath?: string
}

export type LocalRetrievalMetadataFilters = {
  questionId?: string | string[]
  reviewStatus?: ReviewStatus | ReviewStatus[]
  sourceType?: SourceType | SourceType[]
  topic?: string | string[]
  topicId?: string | string[]
  trustLevel?: TrustLevel | TrustLevel[]
}

export type LocalRetrievalMode = "keyword" | "vector"

export type LocalRetrievalSourceConfig = {
  label: LocalRetrievalSourceLabel
  path: string
  serverOnly?: boolean
}

export type LocalKeywordRetrievalResult = {
  debug?: LocalRetrievalDebugMetadata
  metadata: LocalRetrievalMetadata
  retrievalMode: LocalRetrievalMode
  score: number
  serverOnly: boolean
  sourceLabel: LocalRetrievalSourceLabel
  text: string
}

export type LocalRetrievalDebugMetadata = {
  approvedBoost: number
  contentHash?: string
  keywordOverlap: number
  keywordScore: number
  mode: LocalRetrievalMode
  topicBoost: number
  trustBoost: number
  vectorScore?: number
}

export type LocalRetrievalMetadata = {
  chunkId: string
  chunkType: RetrievalChunkType
  difficulty?: Difficulty
  questionId?: string
  reviewStatus: ReviewStatus
  sourceType: SourceType
  topic?: string
  topicId: string
  trustLevel: TrustLevel
  visibility: Visibility
}

type NormalizedLocalChunk = LocalRetrievalMetadata & {
  contentHash?: string
  keywords: string[]
  sourceLabel: LocalRetrievalSourceLabel
  text: string
}

type LocalEmbeddingRecord = {
  chunkId: string
  contentHash?: string
  embedding: number[]
}

const DEFAULT_MAX_RESULTS = 5
const DEFAULT_MAX_CHUNK_CHARACTERS = 700
const DEFAULT_MAX_CONTEXT_CHARACTERS = 1800

const copiedSourceSignal =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|textbook page/i

const stopWords = new Set([
  "and",
  "are",
  "for",
  "from",
  "has",
  "how",
  "into",
  "is",
  "of",
  "on",
  "or",
  "that",
  "the",
  "then",
  "this",
  "to",
  "use",
  "what",
  "when",
  "where",
  "with",
])

const trustBoosts: Record<TrustLevel, number> = {
  course_approved: 7,
  professor_approved: 7,
  public_original: 4,
  private_reference: 3,
  generated_unverified: 0,
}

export async function searchLocalRetrieval(
  query: string,
  options: LocalVectorRetrievalOptions = {},
): Promise<LocalKeywordRetrievalResult[]> {
  const audience = options.audience ?? "student"
  const queryTerms = tokenize(query)

  if (queryTerms.size === 0 && !options.topic && !options.topicId) {
    return []
  }

  const chunks = (await loadLocalRetrievalChunks(options)).filter(
    (chunk) =>
      isChunkAllowedForAudience(chunk, audience) &&
      matchesMetadataFilters(chunk, options),
  )
  const provider = options.embeddingProvider ?? createOpenAIEmbeddingProvider()
  const embeddings = await loadLocalEmbeddingRecords(options)

  if (provider.isConfigured() && embeddings.size > 0) {
    const embeddedQuery = await provider.embed(query)

    if (embeddedQuery.ok) {
      const vectorResults = scoreVectorResults(chunks, embeddings, {
        queryEmbedding: embeddedQuery.embedding,
        topic: options.topic,
        topicId: options.topicId,
      })

      if (vectorResults.length > 0) {
        return limitResultContext(
          sortAndLimitResults(vectorResults, options.maxResults),
          options,
        )
      }
    }
  }

  return searchLocalKeywordRetrieval(query, options)
}

export async function searchLocalKeywordRetrieval(
  query: string,
  options: LocalKeywordRetrievalOptions = {},
): Promise<LocalKeywordRetrievalResult[]> {
  const audience = options.audience ?? "student"
  const queryTerms = tokenize(query)

  if (queryTerms.size === 0 && !options.topic && !options.topicId) {
    return []
  }

  const chunks = await loadLocalRetrievalChunks(options)

  const results = chunks
    .filter(
      (chunk) =>
        isChunkAllowedForAudience(chunk, audience) &&
        matchesMetadataFilters(chunk, options),
    )
    .map((chunk) =>
      resultFromChunk(
        chunk,
        scoreKeywordChunk(chunk, {
          queryTerms,
          topic: options.topic,
          topicId: options.topicId,
        }),
      ),
    )
    .filter((result) => result.score > 0)

  return limitResultContext(sortAndLimitResults(results, options.maxResults), options)
}

export async function loadLocalRetrievalChunks(
  options: Pick<LocalKeywordRetrievalOptions, "repoRoot" | "sources"> = {},
): Promise<NormalizedLocalChunk[]> {
  const repoRoot = options.repoRoot ?? process.cwd()
  const sources = options.sources ?? defaultSources(repoRoot)
  const loadedSources = await Promise.all(
    sources.map((source) => readChunksFromSource(source, repoRoot)),
  )

  return loadedSources.flat()
}

export async function loadLocalEmbeddingRecords(
  options: Pick<LocalVectorRetrievalOptions, "embeddingsPath" | "repoRoot"> = {},
): Promise<Map<string, LocalEmbeddingRecord>> {
  const repoRoot = options.repoRoot ?? process.cwd()
  const embeddingsPath =
    options.embeddingsPath ??
    path.join(repoRoot, "data/private/generated/chunk-embeddings.json")
  const payload = await readJsonOptional(embeddingsPath)
  const embeddings =
    payload && typeof payload === "object" && "embeddings" in payload
      ? (payload.embeddings as unknown)
      : []
  const records = new Map<string, LocalEmbeddingRecord>()

  if (!Array.isArray(embeddings)) {
    return records
  }

  for (const item of embeddings) {
    if (!item || typeof item !== "object") {
      continue
    }

    const record = item as Record<string, unknown>
    const chunkId = stringValue(record.chunkId)
    const embedding = record.embedding

    if (chunkId && isNumberArray(embedding)) {
      records.set(chunkId, {
        chunkId,
        contentHash: stringValue(record.contentHash) || undefined,
        embedding,
      })
    }
  }

  return records
}

export function localResultToRetrievalChunk(
  result: LocalKeywordRetrievalResult,
): RetrievalChunk {
  return {
    body: result.text,
    chunkType: result.metadata.chunkType,
    conceptTags: [
      result.metadata.topic ?? result.metadata.topicId,
      result.metadata.difficulty ?? "",
    ].filter(Boolean),
    difficulty: result.metadata.difficulty,
    formulaRefs: [],
    id: result.metadata.chunkId,
    keywords: [],
    priorityTier:
      result.metadata.trustLevel === "generated_unverified"
        ? "admin_dev_draft"
        : result.metadata.sourceType === "generated_original" ||
            result.metadata.sourceType === "pattern_derived_original"
          ? "approved_generated"
          : result.metadata.sourceType === "original_demo"
            ? "safe_demo"
            : result.metadata.trustLevel === "private_reference"
              ? "private_reference"
              : "approved_professor_course",
    questionId: result.metadata.questionId,
    review: {
      status: result.metadata.reviewStatus,
    },
    source: {
      sourceType: result.metadata.sourceType,
      trustLevel: result.metadata.trustLevel,
      visibility: result.metadata.visibility,
    },
    title: `${result.sourceLabel}:${result.metadata.chunkType}`,
    topicId: result.metadata.topicId,
  }
}

function defaultSources(repoRoot: string): LocalRetrievalSourceConfig[] {
  return [
    {
      label: "demo_question_chunks",
      path: path.join(repoRoot, "data/processed/demo-question-chunks.json"),
      serverOnly: false,
    },
    {
      label: "private_question_chunks",
      path: path.join(repoRoot, "data/private/generated/question-chunks.json"),
      serverOnly: true,
    },
    {
      label: "private_reference_chunks",
      path: path.join(repoRoot, "data/private/generated/reference-chunks.json"),
      serverOnly: true,
    },
    {
      label: "private_reference_chunks",
      path: path.join(
        repoRoot,
        "data/private/generated/book-reference-chunks.json",
      ),
      serverOnly: true,
    },
  ]
}

async function readChunksFromSource(
  source: LocalRetrievalSourceConfig,
  repoRoot: string,
) {
  try {
    const payload = await readJsonOptional(source.path)
    const chunks = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && "chunks" in payload
        ? (payload.chunks as unknown)
        : []

    if (!Array.isArray(chunks)) {
      return []
    }

    return chunks
      .map((chunk) => normalizeChunk(chunk, source, repoRoot))
      .filter((chunk): chunk is NormalizedLocalChunk => Boolean(chunk))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return []
      }
    }

    throw error
  }
}

async function readJsonOptional(inputPath: string) {
  try {
    return JSON.parse(await readFile(inputPath, "utf8")) as unknown
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return undefined
      }
    }

    throw error
  }
}

function normalizeChunk(
  value: unknown,
  source: LocalRetrievalSourceConfig,
  repoRoot: string,
): NormalizedLocalChunk | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const chunk = value as Record<string, unknown>
  const rawText =
    stringValue(chunk.body) ||
    stringValue(chunk.text) ||
    stringValue(chunk.content) ||
    stringValue(chunk.llmSafeSummary) ||
    stringValue(chunk.publicSafeSummary)
  const text =
    source.label === "private_reference_chunks"
      ? stringValue(chunk.llmSafeSummary) ||
        stringValue(chunk.publicSafeSummary) ||
        rawText
      : rawText

  if (!text || copiedSourceSignal.test(text)) {
    return undefined
  }

  const sourceObject =
    chunk.source && typeof chunk.source === "object"
      ? (chunk.source as Record<string, unknown>)
      : {}
  const reviewObject =
    chunk.review && typeof chunk.review === "object"
      ? (chunk.review as Record<string, unknown>)
      : {}
  const visibility = visibilityValue(
    chunk.visibility ?? sourceObject.visibility,
    source.serverOnly ? "private" : "public",
  )
  const trustLevel = trustLevelValue(
    chunk.trustLevel ?? sourceObject.trustLevel,
    source.label === "private_reference_chunks"
      ? "private_reference"
      : visibility === "private"
        ? "generated_unverified"
        : "public_original",
  )
  const reviewStatus = reviewStatusValue(
    chunk.reviewStatus ?? reviewObject.status,
    source.label === "private_reference_chunks" ? "approved" : "needs_review",
  )
  const sourceType = sourceTypeValue(
    chunk.sourceType ?? sourceObject.sourceType,
    source.label === "private_reference_chunks"
      ? "private_reference_pattern"
      : trustLevel === "generated_unverified"
        ? "generated_original"
        : "original_demo",
  )
  const topic = stringValue(chunk.topic)
  const topicId =
    stringValue(chunk.topicId) ||
    (topic ? slug(topic) : source.label.replace(/_/g, "-"))

  return {
    chunkId: stringValue(chunk.id) || path.relative(repoRoot, source.path),
    chunkType: chunkTypeValue(chunk.chunkType, "concept"),
    contentHash: stringValue(chunk.contentHash) || undefined,
    difficulty: difficultyValue(chunk.difficulty),
    keywords: [
      ...stringArray(chunk.keywords),
      ...stringArray(chunk.conceptTags),
      ...stringArray(chunk.formulaRefs),
    ],
    questionId: stringValue(chunk.questionId) || undefined,
    reviewStatus,
    sourceLabel: source.label,
    sourceType,
    text,
    topic,
    topicId,
    trustLevel,
    visibility,
  }
}

function isChunkAllowedForAudience(
  chunk: NormalizedLocalChunk,
  audience: LocalRetrievalAudience,
) {
  if (audience === "student") {
    return (
      chunk.sourceLabel === "demo_question_chunks" &&
      chunk.visibility === "public" &&
      chunk.reviewStatus === "approved" &&
      chunk.trustLevel !== "generated_unverified"
    )
  }

  if (audience === "server") {
    return (
      chunk.reviewStatus === "approved" &&
      chunk.trustLevel !== "generated_unverified"
    )
  }

  return (
    chunk.reviewStatus === "approved" ||
    (chunk.reviewStatus === "needs_review" &&
      chunk.trustLevel === "generated_unverified")
  )
}

function isServerOnlyChunk(chunk: Pick<NormalizedLocalChunk, "visibility" | "sourceLabel">) {
  return (
    chunk.visibility === "private" ||
    chunk.sourceLabel === "private_question_chunks" ||
    chunk.sourceLabel === "private_reference_chunks"
  )
}

function scoreKeywordChunk(
  chunk: NormalizedLocalChunk,
  input: {
    queryTerms: Set<string>
    topic?: string
    topicId?: string
  },
) {
  const chunkTerms = new Set([
    ...tokenize(chunk.text),
    ...chunk.keywords.flatMap((keyword) => [...tokenize(keyword)]),
  ])
  let keywordOverlap = 0

  for (const term of input.queryTerms) {
    if (chunkTerms.has(term)) {
      keywordOverlap += 1
    }
  }

  const keywordScore = keywordOverlap * 4
  const topicBoost = topicBoostFor(chunk, input)
  const trustBoost = trustBoosts[chunk.trustLevel]
  const approvedBoost = chunk.reviewStatus === "approved" ? 6 : 0
  const relevanceScore = keywordScore + topicBoost

  if (relevanceScore === 0) {
    return {
      approvedBoost,
      keywordOverlap,
      keywordScore,
      mode: "keyword" as const,
      score: 0,
      topicBoost,
      trustBoost,
    }
  }

  return {
    approvedBoost,
    keywordOverlap,
    keywordScore,
    mode: "keyword" as const,
    score: relevanceScore + trustBoost + approvedBoost,
    topicBoost,
    trustBoost,
  }
}

function topicBoostFor(
  chunk: NormalizedLocalChunk,
  input: {
    topic?: string
    topicId?: string
  },
) {
  let boost = 0

  if (input.topicId && chunk.topicId === input.topicId) {
    boost += 8
  }

  if (input.topic && normalize(input.topic) === normalize(chunk.topic ?? "")) {
    boost += 8
  }

  return boost
}

function scoreVectorResults(
  chunks: NormalizedLocalChunk[],
  embeddings: Map<string, LocalEmbeddingRecord>,
  input: {
    queryEmbedding: number[]
    topic?: string
    topicId?: string
  },
) {
  return chunks
    .map((chunk) => {
      const record = embeddings.get(chunk.chunkId)

      if (!record) {
        return undefined
      }

      const similarity = cosineSimilarity(input.queryEmbedding, record.embedding)
      const vectorScore = Math.max(0, similarity) * 100
      const topicBoost = topicBoostFor(chunk, input)
      const trustBoost = trustBoosts[chunk.trustLevel]
      const approvedBoost = chunk.reviewStatus === "approved" ? 6 : 0

      if (vectorScore === 0 && topicBoost === 0) {
        return undefined
      }

      return resultFromChunk(chunk, {
        approvedBoost,
        contentHash: record.contentHash,
        keywordOverlap: 0,
        keywordScore: 0,
        mode: "vector",
        score: vectorScore + topicBoost + trustBoost + approvedBoost,
        topicBoost,
        trustBoost,
        vectorScore,
      })
    })
    .filter((result): result is LocalKeywordRetrievalResult => Boolean(result))
}

function resultFromChunk(
  chunk: NormalizedLocalChunk,
  score: LocalRetrievalDebugMetadata & { score: number },
): LocalKeywordRetrievalResult {
  return {
    debug: shouldIncludeDebug()
      ? {
          approvedBoost: score.approvedBoost,
          contentHash: score.contentHash ?? chunk.contentHash,
          keywordOverlap: score.keywordOverlap,
          keywordScore: score.keywordScore,
          mode: score.mode,
          topicBoost: score.topicBoost,
          trustBoost: score.trustBoost,
          vectorScore: score.vectorScore,
        }
      : undefined,
    metadata: {
      chunkId: chunk.chunkId,
      chunkType: chunk.chunkType,
      difficulty: chunk.difficulty,
      questionId: chunk.questionId,
      reviewStatus: chunk.reviewStatus,
      sourceType: chunk.sourceType,
      topic: chunk.topic,
      topicId: chunk.topicId,
      trustLevel: chunk.trustLevel,
      visibility: chunk.visibility,
    },
    retrievalMode: score.mode,
    score: score.score,
    serverOnly: isServerOnlyChunk(chunk),
    sourceLabel: chunk.sourceLabel,
    text: chunk.text,
  }
}

function sortAndLimitResults(
  results: LocalKeywordRetrievalResult[],
  maxResults = DEFAULT_MAX_RESULTS,
) {
  return [...results]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return left.metadata.chunkId.localeCompare(right.metadata.chunkId)
    })
    .slice(0, maxResults)
}

function limitResultContext(
  results: LocalKeywordRetrievalResult[],
  options: Pick<
    LocalKeywordRetrievalOptions,
    "maxChunkCharacters" | "maxContextCharacters"
  >,
) {
  const maxChunkCharacters =
    options.maxChunkCharacters ?? DEFAULT_MAX_CHUNK_CHARACTERS
  const maxContextCharacters =
    options.maxContextCharacters ?? DEFAULT_MAX_CONTEXT_CHARACTERS
  const limited: LocalKeywordRetrievalResult[] = []
  let usedCharacters = 0

  for (const result of results) {
    if (usedCharacters >= maxContextCharacters) {
      break
    }

    const remainingCharacters = maxContextCharacters - usedCharacters
    const text = truncateText(
      result.text,
      Math.min(maxChunkCharacters, remainingCharacters),
    )

    if (!text) {
      continue
    }

    limited.push({
      ...result,
      text,
    })
    usedCharacters += text.length
  }

  return limited
}

function matchesMetadataFilters(
  chunk: NormalizedLocalChunk,
  options: Pick<LocalKeywordRetrievalOptions, "filters">,
) {
  const filters = options.filters

  if (!filters) {
    return true
  }

  return (
    matchesFilterValue(chunk.questionId, filters.questionId) &&
    matchesFilterValue(chunk.topic, filters.topic, normalize) &&
    matchesFilterValue(chunk.topicId, filters.topicId) &&
    matchesFilterValue(chunk.sourceType, filters.sourceType) &&
    matchesFilterValue(chunk.trustLevel, filters.trustLevel) &&
    matchesFilterValue(chunk.reviewStatus, filters.reviewStatus)
  )
}

function matchesFilterValue<T extends string>(
  value: T | string | undefined,
  filter: T | T[] | string | string[] | undefined,
  normalizeValue: (input: string) => string = (input) => input,
) {
  if (!filter) {
    return true
  }

  const values = Array.isArray(filter) ? filter : [filter]
  const normalizedValue = value ? normalizeValue(value) : undefined

  return values.some(
    (item) => normalizedValue === normalizeValue(String(item)),
  )
}

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length)

  if (length === 0) {
    return 0
  }

  let dotProduct = 0
  let leftMagnitude = 0
  let rightMagnitude = 0

  for (let index = 0; index < length; index += 1) {
    dotProduct += left[index] * right[index]
    leftMagnitude += left[index] ** 2
    rightMagnitude += right[index] ** 2
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude))
}

function truncateText(text: string, maxLength: number) {
  const trimmed = text.trim()

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

function shouldIncludeDebug() {
  return process.env.NODE_ENV === "development"
}

function tokenize(text: string) {
  return new Set(
    normalize(text)
      .split(/[^a-z0-9.%-]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 1 && !stopWords.has(term)),
  )
}

function normalize(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function difficultyValue(value: unknown): Difficulty | undefined {
  return ["foundational", "intermediate", "challenge"].includes(String(value))
    ? (value as Difficulty)
    : undefined
}

function chunkTypeValue(value: unknown, fallback: RetrievalChunkType) {
  return [
    "concept",
    "example",
    "formula",
    "hint",
    "misconception",
    "pattern",
    "question",
    "solution_step",
    "solution_summary",
  ].includes(String(value))
    ? (value as RetrievalChunkType)
    : fallback
}

function sourceTypeValue(value: unknown, fallback: SourceType) {
  return [
    "original_demo",
    "professor_provided",
    "generated_original",
    "pattern_derived_original",
    "private_reference_pattern",
  ].includes(String(value))
    ? (value as SourceType)
    : fallback
}

function trustLevelValue(value: unknown, fallback: TrustLevel) {
  return [
    "public_original",
    "professor_approved",
    "course_approved",
    "generated_unverified",
    "private_reference",
  ].includes(String(value))
    ? (value as TrustLevel)
    : fallback
}

function reviewStatusValue(value: unknown, fallback: ReviewStatus) {
  return [
    "approved",
    "needs_review",
    "rejected",
    "needs_edit",
    "needs_regeneration",
  ].includes(String(value))
    ? (value as ReviewStatus)
    : fallback
}

function visibilityValue(value: unknown, fallback: Visibility) {
  return ["public", "private"].includes(String(value))
    ? (value as Visibility)
    : fallback
}

function slug(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return normalized || "untitled"
}
