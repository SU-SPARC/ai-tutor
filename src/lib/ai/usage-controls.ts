import "server-only"

import { createHmac } from "node:crypto"

import type { StudentOwner } from "@/lib/auth/principal"
import type {
  LlmTutorInput,
  LlmTutorServiceResult,
  LlmTutorTokenMetadata,
} from "@/lib/ai/llm-tutor"
import {
  buildLlmTutorUserPrompt,
  LLM_TUTOR_PROMPT_VERSION,
} from "@/lib/ai/llm-tutor"
import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor"
import { queryPostgres } from "@/lib/data/postgres"
import { getServerEnv } from "@/lib/env/server"
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode"
import type { TutorMode, TutorResponseLabel } from "@/lib/types"

const CACHE_TTL_MS = 15 * 60 * 1_000
const RESERVATION_TTL_MS = 30_000

type CachePayload = {
  contextUsed: boolean
  message: string
  responseLabel: TutorResponseLabel
  schemaVersion: 1
}

export type TutorAiExecutionContext = {
  eventId: string
  expectedRevision: number
  mode: TutorMode
  owner: StudentOwner
  questionId: string
  questionVersionId: number
  sessionId: string
  topicId: string
}

export type TutorAiAccounting = {
  cacheEntry?: CachePayload
  cacheHit: boolean
  estimatedInputTokens: number
  estimatedTotalTokens: number
  mode: TutorMode
  providerCalls: number
  providerInputTokens: number
  providerOutputTokens: number
  providerTotalTokens: number
  questionId: string
  questionKeyHash: string
  questionVersionId: number
  requestHash: string
  reservationId?: string
  sessionId: string
  sessionKeyHash: string
  studentKeyHash: string
  topicId: string
  usageIsEstimate: boolean
}

export type PreparedTutorAiGeneration =
  | {
      accounting: TutorAiAccounting
      cacheResult: LlmTutorServiceResult
      outcome: "cache_hit"
    }
  | {
      accounting: TutorAiAccounting
      outcome: "reserved"
    }

type CacheRow = {
  response_json: unknown
}

const memoryCache = new Map<
  string,
  { expiresAt: number; payload: CachePayload; studentKeyHash: string }
>()
const memoryReservations = new Map<
  string,
  { eventId: string; expiresAt: number; reservationId: string }
>()

export class AiGenerationInProgressError extends Error {
  constructor() {
    super("AI help is already being prepared for this tutor session.")
    this.name = "AiGenerationInProgressError"
  }
}

export async function prepareTutorAiGeneration(
  context: TutorAiExecutionContext,
  promptInput: LlmTutorInput,
  estimatedTokens: LlmTutorTokenMetadata,
): Promise<PreparedTutorAiGeneration> {
  const env = getServerEnv()
  const secret = env.AI_ENABLED ? env.AI_USAGE_HMAC_SECRET : undefined
  if (!secret) {
    throw new Error("AI usage controls are unavailable.")
  }

  const studentKeyHash = hmacOwner(secret, context.owner)
  const sessionKeyHash = hmacValue(secret, `session:${context.sessionId}`)
  const questionKeyHash = hmacValue(
    secret,
    `question:${context.questionId}:${context.questionVersionId}`,
  )
  const requestHash = hmacValue(
    secret,
    JSON.stringify({
      model: env.AI_MODEL,
      owner: studentKeyHash,
      prompt: buildLlmTutorUserPrompt(promptInput),
      promptVersion: LLM_TUTOR_PROMPT_VERSION,
      questionVersionId: context.questionVersionId,
      revision: context.expectedRevision,
    }),
  )
  const baseAccounting: TutorAiAccounting = {
    cacheHit: false,
    estimatedInputTokens: estimatedTokens.estimatedInputTokens,
    estimatedTotalTokens: estimatedTokens.estimatedTotalTokens,
    mode: context.mode,
    providerCalls: 0,
    providerInputTokens: 0,
    providerOutputTokens: 0,
    providerTotalTokens: 0,
    questionId: context.questionId,
    questionKeyHash,
    questionVersionId: context.questionVersionId,
    requestHash,
    sessionId: context.sessionId,
    sessionKeyHash,
    studentKeyHash,
    topicId: context.topicId,
    usageIsEstimate: false,
  }

  const policy = getOperatingModePolicy()
  if (policy.repositorySource === "database") {
    const cached = await readDatabaseCache(requestHash, studentKeyHash)
    if (cached) {
      return cacheHitResult(baseAccounting, cached)
    }

    const reservationId = hmacValue(
      secret,
      `reservation:${context.sessionId}:${context.eventId}`,
    )
    await reserveDatabaseGeneration(context, {
      ...baseAccounting,
      reservationId,
    })
    return {
      accounting: { ...baseAccounting, reservationId },
      outcome: "reserved",
    }
  }

  pruneMemoryControls()
  const memoryCached = memoryCache.get(requestHash)
  if (
    memoryCached &&
    memoryCached.studentKeyHash === studentKeyHash &&
    memoryCached.expiresAt > Date.now()
  ) {
    return cacheHitResult(baseAccounting, memoryCached.payload)
  }

  const activeReservation = memoryReservations.get(context.sessionId)
  if (activeReservation && activeReservation.expiresAt > Date.now()) {
    throw new AiGenerationInProgressError()
  }

  const reservationId = hmacValue(
    secret,
    `reservation:${context.sessionId}:${context.eventId}`,
  )
  memoryReservations.set(context.sessionId, {
    eventId: context.eventId,
    expiresAt: Date.now() + RESERVATION_TTL_MS,
    reservationId,
  })
  return {
    accounting: { ...baseAccounting, reservationId },
    outcome: "reserved",
  }
}

export function accountingForGeneratedResponse(
  accounting: TutorAiAccounting,
  result: LlmTutorServiceResult,
  responseLabel: TutorResponseLabel,
): TutorAiAccounting {
  const providerInputTokens =
    result.estimatedTokens?.providerPromptTokens ??
    result.estimatedTokens?.estimatedInputTokens ??
    accounting.estimatedInputTokens
  const providerOutputTokens =
    result.estimatedTokens?.providerCompletionTokens ??
    Math.max(0, accounting.estimatedTotalTokens - accounting.estimatedInputTokens)
  const providerTotalTokens =
    result.estimatedTokens?.providerTotalTokens ??
    providerInputTokens + providerOutputTokens

  const nextAccounting: TutorAiAccounting = {
    ...accounting,
    cacheEntry: result.fallbackUsed
      ? {
          contextUsed: result.contextUsed,
          message: result.tutorMessage,
          responseLabel,
          schemaVersion: 1,
        }
      : undefined,
    providerCalls: result.providerAttempts ?? 0,
    providerInputTokens: result.fallbackUsed ? providerInputTokens : 0,
    providerOutputTokens: result.fallbackUsed ? providerOutputTokens : 0,
    providerTotalTokens: result.fallbackUsed ? providerTotalTokens : 0,
    usageIsEstimate: Boolean(
      result.fallbackUsed &&
        result.estimatedTokens?.providerTotalTokens === undefined,
    ),
  }

  logAiUsageEvent("provider_result", nextAccounting, {
    contextItemsUsed: result.contextUsed ? 1 : 0,
    error: result.error,
    guardrailViolations: result.guardrailViolations ?? [],
    latencyMs: result.latencyMs ?? 0,
    outcome: result.fallbackUsed ? "generated" : "unavailable",
    providerAttempts: result.providerAttempts ?? 0,
  })

  return nextAccounting
}

export async function applyTutorAiAccounting(
  accounting: TutorAiAccounting,
  query?: DatabaseQueryExecutor,
) {
  if (query) {
    await applyDatabaseAccounting(query, accounting)
    return
  }

  if (accounting.cacheEntry) {
    memoryCache.set(accounting.requestHash, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload: accounting.cacheEntry,
      studentKeyHash: accounting.studentKeyHash,
    })
  }
  if (accounting.reservationId) {
    const reservation = memoryReservations.get(accounting.sessionId)
    if (reservation?.reservationId === accounting.reservationId) {
      memoryReservations.delete(accounting.sessionId)
    }
  }
}

export async function releaseTutorAiReservation(
  accounting: TutorAiAccounting | undefined,
) {
  if (!accounting?.reservationId) {
    return
  }

  if (getOperatingModePolicy().repositorySource === "database") {
    await queryPostgres(
      `update ai_llm_reservations
       set status = 'released', updated_at = now()
       where id = $1 and status = 'pending'`,
      [accounting.reservationId],
    )
    return
  }

  const reservation = memoryReservations.get(accounting.sessionId)
  if (reservation?.reservationId === accounting.reservationId) {
    memoryReservations.delete(accounting.sessionId)
  }
}

export function resetAiUsageControlsForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("AI usage control reset is restricted to tests.")
  }
  memoryCache.clear()
  memoryReservations.clear()
}

async function readDatabaseCache(
  requestHash: string,
  studentKeyHash: string,
): Promise<CachePayload | undefined> {
  const rows = (await readDatabaseRows(
    queryPostgres,
    `select response_json
     from ai_response_cache
     where request_hash = $1
       and student_key_hash = $2
       and expires_at > now()
     limit 1`,
    [requestHash, studentKeyHash],
  )) as CacheRow[]
  return parseCachePayload(rows[0]?.response_json)
}

async function reserveDatabaseGeneration(
  context: TutorAiExecutionContext,
  accounting: TutorAiAccounting & { reservationId: string },
) {
  await runDatabaseTransaction(queryPostgres, async (transactionQuery) => {
    const ownerId = ownerIdentifier(context.owner)
    const sessions = await transactionQuery(
      `select id
       from tutor_sessions
       where id = $1
         and revision = $2
         and status = 'active'
         and expires_at > now()
         and (
           ($3 = 'user' and user_id = $4 and anonymous_user_id is null)
           or
           ($3 = 'anonymous' and anonymous_user_id = $4 and user_id is null)
         )
       for update`,
      [
        context.sessionId,
        context.expectedRevision,
        context.owner.kind,
        ownerId,
      ],
    )
    if (!sessions[0]) {
      throw new AiGenerationInProgressError()
    }

    await transactionQuery(
      `update ai_llm_reservations
       set status = 'released', updated_at = now()
       where session_id = $1
         and status = 'pending'
         and expires_at <= now()`,
      [context.sessionId],
    )
    const active = await transactionQuery(
      `select id
       from ai_llm_reservations
       where session_id = $1 and status = 'pending' and expires_at > now()
       limit 1`,
      [context.sessionId],
    )
    if (active[0]) {
      throw new AiGenerationInProgressError()
    }

    const inserted = await transactionQuery(
      `insert into ai_llm_reservations (
         id, session_id, student_key_hash, question_key_hash,
         reserved_total_tokens, status, expires_at, idempotency_key,
         request_hash, usage_is_estimate
       ) values ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, false)
       on conflict (session_id, idempotency_key) do update
       set request_hash = excluded.request_hash,
           reserved_total_tokens = excluded.reserved_total_tokens,
           actual_input_tokens = null,
           actual_output_tokens = null,
           actual_total_tokens = null,
           status = 'pending',
           expires_at = excluded.expires_at,
           usage_is_estimate = false,
           updated_at = now()
       where ai_llm_reservations.status = 'released'
       returning id`,
      [
        accounting.reservationId,
        context.sessionId,
        accounting.studentKeyHash,
        accounting.questionKeyHash,
        accounting.estimatedTotalTokens,
        new Date(Date.now() + RESERVATION_TTL_MS),
        context.eventId,
        accounting.requestHash,
      ],
    )
    if (!inserted[0]) {
      throw new AiGenerationInProgressError()
    }
  })
}

async function applyDatabaseAccounting(
  query: DatabaseQueryExecutor,
  accounting: TutorAiAccounting,
) {
  if (accounting.reservationId) {
    await query(
      `update ai_llm_reservations
       set actual_input_tokens = $2,
           actual_output_tokens = $3,
           actual_total_tokens = $4,
           usage_is_estimate = $5,
           status = $6,
           updated_at = now()
       where id = $1 and status = 'pending'`,
      [
        accounting.reservationId,
        accounting.providerInputTokens || null,
        accounting.providerOutputTokens || null,
        accounting.providerTotalTokens || null,
        accounting.usageIsEstimate,
        accounting.cacheEntry ? "settled" : "released",
      ],
    )
  }

  if (accounting.cacheEntry) {
    await query(
      `insert into ai_response_cache (
         request_hash, question_id, question_version_id, topic_id, mode,
         source, response_json, expires_at, student_key_hash
       ) values ($1, $2, $3, $4, $5, 'llm', $6::jsonb, $7, $8)
       on conflict (request_hash) do update
       set response_json = excluded.response_json,
           expires_at = excluded.expires_at,
           updated_at = now()
       where ai_response_cache.student_key_hash = excluded.student_key_hash`,
      [
        accounting.requestHash,
        accounting.questionId,
        accounting.questionVersionId,
        accounting.topicId,
        accounting.mode,
        JSON.stringify(accounting.cacheEntry),
        new Date(Date.now() + CACHE_TTL_MS),
        accounting.studentKeyHash,
      ],
    )
  }

  const scopes = [
    ["global", "all"],
    ["session", accounting.sessionKeyHash],
    ["student", accounting.studentKeyHash],
    ["student_question", `${accounting.studentKeyHash}:${accounting.questionKeyHash}`],
  ] as const
  for (const [scope, scopeKey] of scopes) {
    await query(
      `insert into ai_usage (
         scope, scope_key, date_key, interactions, estimated_tokens,
         llm_fallbacks, llm_input_tokens, llm_output_tokens,
         llm_total_tokens, estimated_llm_tokens, cache_hits
       ) values ($1, $2, current_date, 1, $3, $4, $5, $6, $7, $8, $9)
       on conflict (scope, scope_key, date_key) do update
       set interactions = ai_usage.interactions + 1,
           estimated_tokens = ai_usage.estimated_tokens + excluded.estimated_tokens,
           llm_fallbacks = ai_usage.llm_fallbacks + excluded.llm_fallbacks,
           llm_input_tokens = ai_usage.llm_input_tokens + excluded.llm_input_tokens,
           llm_output_tokens = ai_usage.llm_output_tokens + excluded.llm_output_tokens,
           llm_total_tokens = ai_usage.llm_total_tokens + excluded.llm_total_tokens,
           estimated_llm_tokens = ai_usage.estimated_llm_tokens + excluded.estimated_llm_tokens,
           cache_hits = ai_usage.cache_hits + excluded.cache_hits,
           updated_at = now()`,
      [
        scope,
        scopeKey,
        accounting.estimatedTotalTokens,
        accounting.cacheEntry && !accounting.cacheHit ? 1 : 0,
        accounting.providerInputTokens,
        accounting.providerOutputTokens,
        accounting.providerTotalTokens,
        accounting.usageIsEstimate ? accounting.providerTotalTokens : 0,
        accounting.cacheHit ? 1 : 0,
      ],
    )
  }
}

function cacheHitResult(
  accounting: TutorAiAccounting,
  payload: CachePayload,
): PreparedTutorAiGeneration {
  logAiUsageEvent("cache_hit", accounting, {
    contextItemsUsed: payload.contextUsed ? 1 : 0,
    outcome: "cache_hit",
    providerAttempts: 0,
  })
  return {
    accounting: {
      ...accounting,
      cacheHit: true,
      cacheEntry: payload,
    },
    cacheResult: {
      contextUsed: payload.contextUsed,
      estimatedTokens: {
        estimatedInputTokens: accounting.estimatedInputTokens,
        estimatedTotalTokens: 0,
        maxOutputTokens: 0,
      },
      fallbackUsed: true,
      providerAttempts: 0,
      tutorMessage: payload.message,
    },
    outcome: "cache_hit",
  }
}

function parseCachePayload(value: unknown): CachePayload | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    typeof record.contextUsed !== "boolean" ||
    typeof record.message !== "string" ||
    !isTutorResponseLabel(record.responseLabel)
  ) {
    return undefined
  }
  return {
    contextUsed: record.contextUsed,
    message: record.message,
    responseLabel: record.responseLabel,
    schemaVersion: 1,
  }
}

function isTutorResponseLabel(value: unknown): value is TutorResponseLabel {
  return [
    "approved_course_content",
    "generated_approved_content",
    "general_ai_help",
    "private_reference_grounded_explanation",
  ].includes(String(value))
}

function hmacOwner(secret: string, owner: StudentOwner) {
  return hmacValue(secret, `${owner.kind}:${ownerIdentifier(owner)}`)
}

function hmacValue(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex")
}

function ownerIdentifier(owner: StudentOwner) {
  return owner.kind === "user" ? owner.userId : owner.anonymousId
}

function pruneMemoryControls() {
  const now = Date.now()
  for (const [key, value] of memoryCache) {
    if (value.expiresAt <= now) {
      memoryCache.delete(key)
    }
  }
  for (const [key, value] of memoryReservations) {
    if (value.expiresAt <= now) {
      memoryReservations.delete(key)
    }
  }
}

function logAiUsageEvent(
  event: "cache_hit" | "provider_result",
  accounting: TutorAiAccounting,
  details: Record<string, unknown>,
) {
  const env = getServerEnv()
  if (env.LOG_LEVEL === "silent") {
    return
  }

  console.info("AI tutor usage event.", {
    event,
    model: env.AI_ENABLED ? env.AI_MODEL : undefined,
    questionKey: accounting.questionKeyHash.slice(0, 16),
    requestKey: accounting.requestHash.slice(0, 16),
    sessionKey: accounting.sessionKeyHash.slice(0, 16),
    studentKey: accounting.studentKeyHash.slice(0, 16),
    tokenTotal: accounting.providerTotalTokens,
    usageIsEstimate: accounting.usageIsEstimate,
    ...details,
  })
}
