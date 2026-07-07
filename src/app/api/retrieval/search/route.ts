import { NextResponse } from "next/server"

import {
  searchLocalRetrieval,
  type LocalKeywordRetrievalResult,
  type LocalRetrievalAudience,
  type LocalRetrievalMode,
} from "@/lib/ai/retrieval"
import { authorizeProfessorReview } from "@/lib/tutor/professor-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RetrievalSearchBody = {
  limit?: unknown
  mode?: unknown
  query?: unknown
  questionId?: unknown
  topic?: unknown
}

type RetrievalSearchInput = {
  limit: number
  mode: LocalRetrievalAudience
  query: string
  questionId?: string
  topic?: string
}

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10
const MAX_QUERY_CHARACTERS = 1000
const MAX_FILTER_CHARACTERS = 160
const MAX_CHUNK_CHARACTERS = 520
const MAX_CONTEXT_CHARACTERS = 2400

export async function POST(request: Request) {
  const auth = authorizeProfessorReview(request.headers)

  if (!auth.authorized) {
    return NextResponse.json(
      { error: auth.reason },
      { status: auth.status },
    )
  }

  let body: RetrievalSearchBody

  try {
    body = (await request.json()) as RetrievalSearchBody
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    )
  }

  const parsed = parseRetrievalSearchInput(body)

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  try {
    const results = await searchLocalRetrieval(parsed.input.query, {
      audience: parsed.input.mode,
      filters: parsed.input.questionId
        ? {
            questionId: parsed.input.questionId,
          }
        : undefined,
      maxChunkCharacters: MAX_CHUNK_CHARACTERS,
      maxContextCharacters: Math.min(
        MAX_CONTEXT_CHARACTERS,
        parsed.input.limit * MAX_CHUNK_CHARACTERS,
      ),
      maxResults: parsed.input.limit,
      topic: parsed.input.topic,
    })

    return NextResponse.json({
      chunks: results.map((result) => toApiChunk(result)),
      count: results.length,
      mode: parsed.input.mode,
      retrievalMode: resultRetrievalMode(results),
    })
  } catch {
    return NextResponse.json(
      { error: "Retrieval search failed." },
      { status: 500 },
    )
  }
}

function parseRetrievalSearchInput(body: RetrievalSearchBody):
  | {
      input: RetrievalSearchInput
      ok: true
    }
  | {
      error: string
      ok: false
    } {
  const query = optionalBoundedString(body.query, MAX_QUERY_CHARACTERS)

  if (query.error) {
    return { error: `query ${query.error}`, ok: false }
  }

  if (!query.value) {
    return { error: "query is required.", ok: false }
  }

  const topic = optionalBoundedString(body.topic, MAX_FILTER_CHARACTERS)

  if (topic.error) {
    return { error: `topic ${topic.error}`, ok: false }
  }

  const questionId = optionalBoundedString(
    body.questionId,
    MAX_FILTER_CHARACTERS,
  )

  if (questionId.error) {
    return { error: `questionId ${questionId.error}`, ok: false }
  }

  const limit = parseLimit(body.limit)

  if (!limit.ok) {
    return { error: limit.error, ok: false }
  }

  const mode = parseMode(body.mode)

  if (!mode.ok) {
    return { error: mode.error, ok: false }
  }

  return {
    input: {
      limit: limit.value,
      mode: mode.value,
      query: query.value,
      questionId: questionId.value,
      topic: topic.value,
    },
    ok: true,
  }
}

function optionalBoundedString(value: unknown, maxCharacters: number) {
  if (value === undefined || value === null) {
    return { value: undefined }
  }

  if (typeof value !== "string") {
    return { error: "must be a string." }
  }

  const trimmed = value.trim()

  if (trimmed.length > maxCharacters) {
    return {
      error: `must be ${maxCharacters} characters or fewer.`,
    }
  }

  return { value: trimmed || undefined }
}

function parseLimit(value: unknown):
  | {
      ok: true
      value: number
    }
  | {
      error: string
      ok: false
    } {
  if (value === undefined || value === null) {
    return { ok: true, value: DEFAULT_LIMIT }
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { error: "limit must be an integer.", ok: false }
  }

  if (value < 1 || value > MAX_LIMIT) {
    return {
      error: `limit must be between 1 and ${MAX_LIMIT}.`,
      ok: false,
    }
  }

  return { ok: true, value }
}

function parseMode(value: unknown):
  | {
      ok: true
      value: LocalRetrievalAudience
    }
  | {
      error: string
      ok: false
    } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: "student" }
  }

  if (value === "student" || value === "server" || value === "admin_dev") {
    return { ok: true, value }
  }

  if (value === "admin") {
    return { ok: true, value: "admin_dev" }
  }

  return {
    error: "mode must be one of: student, server, admin_dev.",
    ok: false,
  }
}

function resultRetrievalMode(
  results: LocalKeywordRetrievalResult[],
): LocalRetrievalMode {
  return results.some((result) => result.retrievalMode === "vector")
    ? "vector"
    : "keyword"
}

function toApiChunk(result: LocalKeywordRetrievalResult) {
  return {
    id: result.metadata.chunkId,
    metadata: result.metadata,
    retrievalMode: result.retrievalMode,
    score: result.score,
    serverOnly: result.serverOnly,
    sourceLabel: result.sourceLabel,
    text: apiSafeText(result),
    ...(result.debug ? { debug: result.debug } : {}),
  }
}

function apiSafeText(result: LocalKeywordRetrievalResult) {
  if (
    result.sourceLabel === "private_reference_chunks" ||
    result.metadata.sourceType === "private_reference_pattern" ||
    result.metadata.trustLevel === "private_reference"
  ) {
    return "Private reference match retained server-side. Use safe summaries or synthesized guidance for student-facing responses."
  }

  return result.text
}
