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
// Longer than the complete provider deadline so an in-flight generation can
// never lose its single-session reservation before the provider call returns.
const RESERVATION_TTL_MS = 60_000

export type AiUsageLimitReason =
  | "burst_limit"
  | "daily_limit"
  | "question_limit"
  | "session_limit"

const AI_DISABLED_MESSAGE =
  "AI assistance is currently unavailable. Your saved progress is unchanged; continue with the available course guidance or try again later."
const AI_ALLOWANCE_MESSAGE =
  "The AI help allowance has been reached for now. Your saved progress is unchanged; continue with the available course guidance or try again later."

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

export type TutorAiUsageControlOptions = {
  query?: DatabaseQueryExecutor
  repositorySource?: "database" | "demo"
}

export type PreparedTutorAiGeneration =
  | {
      message: string
      outcome: "blocked"
      reason: "ai_disabled" | AiUsageLimitReason
      retryAfterSeconds?: number
    }
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
const memoryUsageEvents = new Map<
  string,
  {
    createdAt: number
    questionKeyHash: string
    sessionId: string
    studentKeyHash: string
  }
>()

export class AiGenerationInProgressError extends Error {
  constructor(
    message = "AI help is already being prepared for this tutor session.",
  ) {
    super(message)
    this.name = "AiGenerationInProgressError"
  }
}

export async function prepareTutorAiGeneration(
  context: TutorAiExecutionContext,
  promptInput: LlmTutorInput,
  estimatedTokens: LlmTutorTokenMetadata,
  options: TutorAiUsageControlOptions = {},
): Promise<PreparedTutorAiGeneration> {
  const env = getServerEnv()
  if (!env.AI_ENABLED) {
    return {
      message: AI_DISABLED_MESSAGE,
      outcome: "blocked",
      reason: "ai_disabled",
    }
  }
  const secret = env.AI_USAGE_HMAC_SECRET

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
  if ((options.repositorySource ?? policy.repositorySource) === "database") {
    const query = options.query ?? queryPostgres
    const cached = await readDatabaseCache(query, requestHash, studentKeyHash)
    if (cached) {
      return cacheHitResult(baseAccounting, cached)
    }

    const reservationId = hmacValue(
      secret,
      `reservation:${context.sessionId}:${context.eventId}`,
    )
    const reservation = await reserveDatabaseGeneration(query, context, {
      ...baseAccounting,
      reservationId,
    })
    if (reservation.outcome === "blocked") {
      logAiUsageEvent("usage_limit", baseAccounting, {
        outcome: "blocked",
        reason: reservation.reason,
        retryAfterSeconds: reservation.retryAfterSeconds,
      })
      return {
        message: AI_ALLOWANCE_MESSAGE,
        outcome: "blocked",
        reason: reservation.reason,
        retryAfterSeconds: reservation.retryAfterSeconds,
      }
    }
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
  const memoryLimit = memoryUsageEvents.has(reservationId)
    ? undefined
    : memoryUsageLimit(context, baseAccounting, Date.now())
  if (memoryLimit) {
    logAiUsageEvent("usage_limit", baseAccounting, {
      outcome: "blocked",
      reason: memoryLimit.reason,
      retryAfterSeconds: memoryLimit.retryAfterSeconds,
    })
    return {
      message: AI_ALLOWANCE_MESSAGE,
      outcome: "blocked",
      ...memoryLimit,
    }
  }
  memoryReservations.set(context.sessionId, {
    eventId: context.eventId,
    expiresAt: Date.now() + RESERVATION_TTL_MS,
    reservationId,
  })
  if (!memoryUsageEvents.has(reservationId)) {
    memoryUsageEvents.set(reservationId, {
      createdAt: Date.now(),
      questionKeyHash,
      sessionId: context.sessionId,
      studentKeyHash,
    })
  }
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
  const providerCalls = result.providerAttempts ?? 0
  const hasReportedUsage =
    result.estimatedTokens?.providerTotalTokens !== undefined
  const providerInputTokens =
    result.estimatedTokens?.providerPromptTokens ??
    (providerCalls > 0 ? accounting.estimatedInputTokens * providerCalls : 0)
  const providerOutputTokens =
    result.estimatedTokens?.providerCompletionTokens ??
    (providerCalls > 0
      ? Math.max(
          0,
          accounting.estimatedTotalTokens - accounting.estimatedInputTokens,
        ) * providerCalls
      : 0)
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
    providerCalls,
    providerInputTokens,
    providerOutputTokens,
    providerTotalTokens,
    usageIsEstimate: providerCalls > 0 && !hasReportedUsage,
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

  if (accounting.cacheEntry && !accounting.cacheHit) {
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
  queryOverride?: DatabaseQueryExecutor,
) {
  if (!accounting?.reservationId) {
    return
  }

  if (
    queryOverride ||
    getOperatingModePolicy().repositorySource === "database"
  ) {
    await runDatabaseTransaction(
      queryOverride ?? queryPostgres,
      async (transactionQuery) => {
        await applyDatabaseAccounting(transactionQuery, {
          ...accounting,
          cacheEntry: undefined,
          cacheHit: false,
        })
      },
    )
    return
  }

  const reservation = memoryReservations.get(accounting.sessionId)
  if (reservation?.reservationId === accounting.reservationId) {
    memoryReservations.delete(accounting.sessionId)
  }
  if (accounting.providerCalls === 0) {
    memoryUsageEvents.delete(accounting.reservationId)
  }
}

export function resetAiUsageControlsForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("AI usage control reset is restricted to tests.")
  }
  memoryCache.clear()
  memoryReservations.clear()
  memoryUsageEvents.clear()
}

async function readDatabaseCache(
  query: DatabaseQueryExecutor,
  requestHash: string,
  studentKeyHash: string,
): Promise<CachePayload | undefined> {
  const rows = (await readDatabaseRows(
    query,
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
  query: DatabaseQueryExecutor,
  context: TutorAiExecutionContext,
  accounting: TutorAiAccounting & { reservationId: string },
) {
  const env = getServerEnv()
  return runDatabaseTransaction(query, async (transactionQuery) => {
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

    // This row lock serializes allowance decisions for the same HMAC-scoped
    // student across separate tutor sessions and serverless instances.
    await transactionQuery(
      `insert into ai_usage (scope, scope_key, date_key)
       values ('student', $1, timezone('UTC', now())::date)
       on conflict (scope, scope_key, date_key) do nothing`,
      [accounting.studentKeyHash],
    )
    await transactionQuery(
      `select scope_key
       from ai_usage
       where scope = 'student'
         and scope_key = $1
         and date_key = timezone('UTC', now())::date
       for update`,
      [accounting.studentKeyHash],
    )

    await transactionQuery(
      `update ai_llm_reservations
       set status = 'released', updated_at = now()
       where student_key_hash = $1
         and status = 'pending'
         and expires_at <= now()`,
      [accounting.studentKeyHash],
    )

    const existing = await transactionQuery(
      `select id, status, limit_reason, provider_calls
       from ai_llm_reservations
       where session_id = $1 and idempotency_key = $2
       limit 1`,
      [context.sessionId, context.eventId],
    )
    if (existing[0]?.status === "blocked") {
      return {
        outcome: "blocked" as const,
        reason: limitReason(existing[0].limit_reason),
      }
    }
    if (
      existing[0]?.status === "pending" ||
      existing[0]?.status === "settled"
    ) {
      throw new AiGenerationInProgressError()
    }
    if (existing[0]?.status === "released") {
      if (countValue(existing[0].provider_calls) > 0) {
        throw new AiGenerationInProgressError(
          "AI help for this request was already attempted. Please submit a new request if you still need help.",
        )
      }
      const reactivated = await transactionQuery(
        `update ai_llm_reservations
         set request_hash = $2,
             reserved_total_tokens = $3,
             actual_input_tokens = null,
             actual_output_tokens = null,
             actual_total_tokens = null,
             provider_calls = 0,
             status = 'pending',
             expires_at = $4,
             usage_is_estimate = false,
             counts_toward_limit = true,
             limit_reason = null,
             accounted_at = null,
             updated_at = now()
         where id = $1 and status = 'released' and provider_calls = 0
         returning id`,
        [
          accounting.reservationId,
          accounting.requestHash,
          accounting.estimatedTotalTokens,
          new Date(Date.now() + RESERVATION_TTL_MS),
        ],
      )
      if (!reactivated[0]) {
        throw new AiGenerationInProgressError()
      }
      return { outcome: "reserved" as const }
    }

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

    const usageRows = await transactionQuery(
      `select
         (select count(*)::integer
          from ai_llm_reservations
          where session_id = $1 and counts_toward_limit) as session_requests,
         (select count(*)::integer
          from ai_llm_reservations
          where student_key_hash = $2
            and question_key_hash = $3
            and counts_toward_limit) as question_requests,
         (select count(*)::integer
          from ai_llm_reservations
          where student_key_hash = $2
            and usage_date = timezone('UTC', now())::date
            and counts_toward_limit) as daily_requests,
         (select count(*)::integer
          from ai_llm_reservations
          where student_key_hash = $2
            and counts_toward_limit
            and created_at > now() - ($4 * interval '1 second')) as burst_requests`,
      [
        context.sessionId,
        accounting.studentKeyHash,
        accounting.questionKeyHash,
        env.AI_LLM_BURST_WINDOW_SECONDS,
      ],
    )
    const usage = usageRows[0] ?? {}
    const limit = exceededLimit(usage, env)
    if (limit) {
      const inserted = await recordDatabaseLimitBlock(
        transactionQuery,
        context,
        accounting,
        limit.reason,
      )
      if (!inserted) {
        throw new AiGenerationInProgressError()
      }
      return {
        outcome: "blocked" as const,
        reason: limit.reason,
        retryAfterSeconds:
          limit.reason === "burst_limit"
            ? env.AI_LLM_BURST_WINDOW_SECONDS
            : undefined,
      }
    }

    const inserted = await transactionQuery(
      `insert into ai_llm_reservations (
         id, session_id, student_key_hash, question_key_hash,
         reserved_total_tokens, status, expires_at, idempotency_key,
         request_hash, usage_is_estimate, usage_date, counts_toward_limit
       ) values (
         $1, $2, $3, $4, $5, 'pending', $6, $7, $8, false,
         timezone('UTC', now())::date, true
       )
       on conflict (session_id, idempotency_key) do update
       set request_hash = excluded.request_hash,
           reserved_total_tokens = excluded.reserved_total_tokens,
           actual_input_tokens = null,
           actual_output_tokens = null,
           actual_total_tokens = null,
           status = 'pending',
           expires_at = excluded.expires_at,
           usage_is_estimate = false,
           provider_calls = 0,
           counts_toward_limit = true,
           limit_reason = null,
           accounted_at = null,
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
    return { outcome: "reserved" as const }
  })
}

async function applyDatabaseAccounting(
  query: DatabaseQueryExecutor,
  accounting: TutorAiAccounting,
) {
  let usageDate: unknown
  if (accounting.reservationId) {
    const settled = await query(
      `update ai_llm_reservations
       set actual_input_tokens = $2,
           actual_output_tokens = $3,
           actual_total_tokens = $4,
           usage_is_estimate = $5,
           status = $6,
           provider_calls = $7,
           counts_toward_limit = $8,
           accounted_at = now(),
           updated_at = now()
       where id = $1
         and status = 'pending'
         and accounted_at is null
       returning usage_date`,
      [
        accounting.reservationId,
        accounting.providerInputTokens || null,
        accounting.providerOutputTokens || null,
        accounting.providerTotalTokens || null,
        accounting.usageIsEstimate,
        accounting.cacheEntry ? "settled" : "released",
        accounting.providerCalls,
        accounting.providerCalls > 0,
      ],
    )
    if (!settled[0]) {
      return
    }
    usageDate = dateKeyValue(settled[0].usage_date)
    if (accounting.providerCalls === 0) {
      return
    }
  }

  if (accounting.cacheEntry && !accounting.cacheHit) {
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
    [
      "student_question",
      `${accounting.studentKeyHash}:${accounting.questionKeyHash}`,
    ],
  ] as const
  const providerRequest = accounting.providerCalls > 0 ? 1 : 0
  for (const [scope, scopeKey] of scopes) {
    await query(
      `insert into ai_usage (
         scope, scope_key, date_key, interactions, estimated_tokens,
         llm_fallbacks, llm_input_tokens, llm_output_tokens,
         llm_total_tokens, estimated_llm_tokens, cache_hits,
         llm_requests, llm_provider_calls
       ) values (
         $1, $2, coalesce($3::date, timezone('UTC', now())::date),
         1, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )
       on conflict (scope, scope_key, date_key) do update
       set interactions = ai_usage.interactions + 1,
           estimated_tokens = ai_usage.estimated_tokens + excluded.estimated_tokens,
           llm_fallbacks = ai_usage.llm_fallbacks + excluded.llm_fallbacks,
           llm_input_tokens = ai_usage.llm_input_tokens + excluded.llm_input_tokens,
           llm_output_tokens = ai_usage.llm_output_tokens + excluded.llm_output_tokens,
           llm_total_tokens = ai_usage.llm_total_tokens + excluded.llm_total_tokens,
           estimated_llm_tokens = ai_usage.estimated_llm_tokens + excluded.estimated_llm_tokens,
           cache_hits = ai_usage.cache_hits + excluded.cache_hits,
           llm_requests = ai_usage.llm_requests + excluded.llm_requests,
           llm_provider_calls = ai_usage.llm_provider_calls + excluded.llm_provider_calls,
           updated_at = now()`,
      [
        scope,
        scopeKey,
        usageDate ? String(usageDate) : null,
        accounting.estimatedTotalTokens,
        accounting.cacheEntry && !accounting.cacheHit ? 1 : 0,
        accounting.providerInputTokens,
        accounting.providerOutputTokens,
        accounting.providerTotalTokens,
        accounting.usageIsEstimate ? accounting.providerTotalTokens : 0,
        accounting.cacheHit ? 1 : 0,
        providerRequest,
        accounting.providerCalls,
      ],
    )
  }
}

async function recordDatabaseLimitBlock(
  query: DatabaseQueryExecutor,
  context: TutorAiExecutionContext,
  accounting: TutorAiAccounting & { reservationId: string },
  reason: AiUsageLimitReason,
) {
  const inserted = await query(
    `insert into ai_llm_reservations (
       id, session_id, student_key_hash, question_key_hash,
       reserved_total_tokens, status, expires_at, idempotency_key,
       request_hash, usage_is_estimate, provider_calls, usage_date,
       counts_toward_limit, limit_reason, accounted_at
     ) values (
       $1, $2, $3, $4, $5, 'blocked', now() + interval '1 second', $6, $7, false, 0,
       timezone('UTC', now())::date, false, $8, now()
     )
     on conflict (session_id, idempotency_key) do nothing
     returning id`,
    [
      accounting.reservationId,
      context.sessionId,
      accounting.studentKeyHash,
      accounting.questionKeyHash,
      accounting.estimatedTotalTokens,
      context.eventId,
      accounting.requestHash,
      reason,
    ],
  )
  if (!inserted[0]) {
    return false
  }

  const scopes = [
    ["global", "all"],
    ["session", accounting.sessionKeyHash],
    ["student", accounting.studentKeyHash],
    [
      "student_question",
      `${accounting.studentKeyHash}:${accounting.questionKeyHash}`,
    ],
  ] as const
  for (const [scope, scopeKey] of scopes) {
    await query(
      `insert into ai_usage (scope, scope_key, date_key, limit_blocks)
       values ($1, $2, timezone('UTC', now())::date, 1)
       on conflict (scope, scope_key, date_key) do update
       set limit_blocks = ai_usage.limit_blocks + 1,
           updated_at = now()`,
      [scope, scopeKey],
    )
  }
  return true
}

function exceededLimit(
  usage: Record<string, unknown>,
  env: ReturnType<typeof getServerEnv>,
): { reason: AiUsageLimitReason } | undefined {
  if (
    countValue(usage.session_requests) >= env.AI_LLM_MAX_REQUESTS_PER_SESSION
  ) {
    return { reason: "session_limit" }
  }
  if (
    countValue(usage.question_requests) >=
    env.AI_LLM_MAX_REQUESTS_PER_STUDENT_QUESTION
  ) {
    return { reason: "question_limit" }
  }
  if (
    env.AI_LLM_DAILY_REQUEST_LIMIT !== undefined &&
    countValue(usage.daily_requests) >= env.AI_LLM_DAILY_REQUEST_LIMIT
  ) {
    return { reason: "daily_limit" }
  }
  if (countValue(usage.burst_requests) >= env.AI_LLM_BURST_MAX_REQUESTS) {
    return { reason: "burst_limit" }
  }
  return undefined
}

function memoryUsageLimit(
  context: TutorAiExecutionContext,
  accounting: TutorAiAccounting,
  now: number,
): { reason: AiUsageLimitReason; retryAfterSeconds?: number } | undefined {
  const env = getServerEnv()
  const events = [...memoryUsageEvents.values()]
  const sessionRequests = events.filter(
    (event) => event.sessionId === context.sessionId,
  ).length
  const questionRequests = events.filter(
    (event) =>
      event.studentKeyHash === accounting.studentKeyHash &&
      event.questionKeyHash === accounting.questionKeyHash,
  ).length
  const utcDate = new Date(now).toISOString().slice(0, 10)
  const dailyRequests = events.filter(
    (event) =>
      event.studentKeyHash === accounting.studentKeyHash &&
      new Date(event.createdAt).toISOString().slice(0, 10) === utcDate,
  ).length
  const burstRequests = events.filter(
    (event) =>
      event.studentKeyHash === accounting.studentKeyHash &&
      event.createdAt > now - env.AI_LLM_BURST_WINDOW_SECONDS * 1_000,
  ).length
  const exceeded = exceededLimit(
    {
      burst_requests: burstRequests,
      daily_requests: dailyRequests,
      question_requests: questionRequests,
      session_requests: sessionRequests,
    },
    env,
  )
  return exceeded?.reason === "burst_limit"
    ? {
        reason: exceeded.reason,
        retryAfterSeconds: env.AI_LLM_BURST_WINDOW_SECONDS,
      }
    : exceeded
}

function countValue(value: unknown) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function dateKeyValue(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
  const parsed = String(value ?? "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(parsed) ? parsed : undefined
}

function limitReason(value: unknown): AiUsageLimitReason {
  return [
    "burst_limit",
    "daily_limit",
    "question_limit",
    "session_limit",
  ].includes(String(value))
    ? (value as AiUsageLimitReason)
    : "session_limit"
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
  event: "cache_hit" | "provider_result" | "usage_limit",
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
