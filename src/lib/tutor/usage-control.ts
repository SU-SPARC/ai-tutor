import "server-only"

import { createHmac, randomUUID } from "node:crypto"

import type { Pool, PoolClient } from "pg"

import { getPostgresPool } from "@/lib/data/postgres"
import { getServerEnv } from "@/lib/env/server"
import type {
  LlmUsageLimitReason,
  TutorResponseLabel,
  TutorSource,
  UsageDashboard,
  UsageDashboardDay,
  UsageDashboardTotals,
} from "@/lib/types"

const RESERVATION_TTL_MS = 5 * 60 * 1000

export type UsageScope = {
  questionKeyHash: string
  sessionId: string
  studentKeyHash: string
}

export type LlmBudgetReservation = {
  id: string
  reservedTotalTokens: number
  scope: UsageScope
}

export type CachedLlmTutorResponse = {
  contextUsed: boolean
  message: string
  responseLabel: TutorResponseLabel
}

export type LlmTokenSettlement = {
  estimatedTokens: number
  providerCompletionTokens?: number
  providerPromptTokens?: number
  providerTotalTokens?: number
}

type LlmBudgetResult =
  | {
      allowed: true
      reservation: LlmBudgetReservation
    }
  | {
      allowed: false
      reason: LlmUsageLimitReason
    }

type UsageInteraction = {
  estimatedTokens: number
  source: TutorSource
}

type StoredReservation = LlmBudgetReservation & {
  expiresAt: number
  status: "pending" | "released" | "settled"
}

type SessionCounters = {
  llmCalls: number
  totalTokens: number
}

type UsageController = {
  getDashboard(): Promise<UsageDashboard>
  getLlmFallbacksRemaining(sessionId: string): Promise<number>
  readCache(
    scope: UsageScope,
    requestHash: string,
  ): Promise<CachedLlmTutorResponse | undefined>
  recordCacheHit(scope: UsageScope): Promise<void>
  recordInteraction(input: UsageInteraction): Promise<void>
  recordLimitBlock(): Promise<void>
  release(reservation: LlmBudgetReservation): Promise<void>
  reserve(input: {
    scope: UsageScope
    totalTokens: number
  }): Promise<LlmBudgetResult>
  settle(
    reservation: LlmBudgetReservation,
    settlement: LlmTokenSettlement,
  ): Promise<void>
  writeCache(input: {
    response: CachedLlmTutorResponse
    scope: UsageScope
    requestHash: string
  }): Promise<void>
}

const emptyTotals = (): UsageDashboardTotals => ({
  cacheHits: 0,
  estimatedLlmTokens: 0,
  inputTokens: 0,
  interactions: 0,
  limitBlocks: 0,
  llmCalls: 0,
  outputTokens: 0,
  totalTokens: 0,
})

const memoryController = createMemoryUsageController()

export function createUsageScope(input: {
  questionId?: string
  sessionId: string
  studentId?: string
  topicId?: string
}): UsageScope {
  const secret = usageSecret()
  const studentKeyHash = hmac(secret, input.studentId ?? input.sessionId)
  const questionKey = input.questionId ?? `topic:${input.topicId ?? "general"}`

  return {
    questionKeyHash: hmac(secret, `${studentKeyHash}:${questionKey}`),
    sessionId: input.sessionId,
    studentKeyHash,
  }
}

export async function reserveLlmBudget(input: {
  scope: UsageScope
  totalTokens: number
}): Promise<LlmBudgetResult> {
  const controller = getUsageController()
  let result: LlmBudgetResult

  try {
    result = await controller.reserve(input)
  } catch {
    return {
      allowed: false,
      reason: "usage_persistence_unavailable",
    }
  }

  if (!result.allowed) {
    await controller.recordLimitBlock().catch(() => undefined)
  }

  return result
}

export async function settleLlmBudget(
  reservation: LlmBudgetReservation,
  settlement: LlmTokenSettlement,
) {
  await getUsageController()
    .settle(reservation, settlement)
    .catch(() => undefined)
}

export async function releaseLlmBudget(reservation: LlmBudgetReservation) {
  await getUsageController()
    .release(reservation)
    .catch(() => undefined)
}

export async function readLlmResponseCache(
  scope: UsageScope,
  requestHash: string,
) {
  return getUsageController()
    .readCache(scope, requestHash)
    .catch(() => undefined)
}

export async function writeLlmResponseCache(input: {
  response: CachedLlmTutorResponse
  scope: UsageScope
  requestHash: string
}) {
  await getUsageController()
    .writeCache(input)
    .catch(() => undefined)
}

export async function recordLlmCacheHit(scope: UsageScope) {
  await getUsageController()
    .recordCacheHit(scope)
    .catch(() => undefined)
}

export async function recordTutorUsageInteraction(input: UsageInteraction) {
  await getUsageController()
    .recordInteraction(input)
    .catch(() => undefined)
}

export async function getUsageDashboard() {
  return getUsageController().getDashboard()
}

export async function getBudgetFallbacksRemaining(sessionId: string) {
  return getUsageController()
    .getLlmFallbacksRemaining(sessionId)
    .catch(() => 0)
}

export function resetUsageControlForTests() {
  memoryController.reset()
}

function getUsageController(): UsageController {
  const env = getServerEnv()

  if (env.APP_DEMO_MODE) {
    return memoryController
  }

  if (!env.DATABASE_URL || !env.USAGE_KEY_SECRET) {
    return unavailableUsageController()
  }

  return createPostgresUsageController()
}

function unavailableUsageController(): UsageController {
  return {
    async getDashboard() {
      return createDashboard("demo", [])
    },
    async getLlmFallbacksRemaining() {
      return 0
    },
    async readCache() {
      return undefined
    },
    async recordCacheHit() {},
    async recordInteraction() {},
    async recordLimitBlock() {},
    async release() {},
    async reserve() {
      return {
        allowed: false,
        reason: "usage_persistence_unavailable",
      }
    },
    async settle() {},
    async writeCache() {},
  }
}

function createMemoryUsageController(): UsageController & { reset(): void } {
  const cache = new Map<
    string,
    { expiresAt: number; response: CachedLlmTutorResponse }
  >()
  const daily = new Map<string, UsageDashboardTotals>()
  const reservations = new Map<string, StoredReservation>()
  const sessions = new Map<string, SessionCounters>()

  function sessionCounters(sessionId: string) {
    const existing = sessions.get(sessionId)

    if (existing) {
      return existing
    }

    const created = { llmCalls: 0, totalTokens: 0 }
    sessions.set(sessionId, created)
    return created
  }

  function dailyTotals(
    scope: "global" | "student" | "student_question",
    key: string,
    date = dateKey(),
  ) {
    const mapKey = `${scope}:${key}:${date}`
    const existing = daily.get(mapKey)

    if (existing) {
      return existing
    }

    const created = emptyTotals()
    daily.set(mapKey, created)
    return created
  }

  function cleanupReservations() {
    const now = Date.now()
    for (const reservation of reservations.values()) {
      if (reservation.status === "pending" && reservation.expiresAt <= now) {
        reservation.status = "released"
      }
    }
  }

  function pending(scope: UsageScope) {
    cleanupReservations()
    let sessionCalls = 0
    let sessionTokens = 0
    let questionCalls = 0
    let studentCalls = 0
    let globalCalls = 0

    for (const reservation of reservations.values()) {
      if (reservation.status !== "pending") {
        continue
      }

      if (reservation.scope.sessionId === scope.sessionId) {
        sessionCalls += 1
        sessionTokens += reservation.reservedTotalTokens
      }
      if (reservation.scope.questionKeyHash === scope.questionKeyHash) {
        questionCalls += 1
      }
      if (reservation.scope.studentKeyHash === scope.studentKeyHash) {
        studentCalls += 1
      }
      globalCalls += 1
    }

    return {
      globalCalls,
      questionCalls,
      sessionCalls,
      sessionTokens,
      studentCalls,
    }
  }

  function reserveReason(
    scope: UsageScope,
    totalTokens: number,
  ): LlmUsageLimitReason | undefined {
    const env = getServerEnv()
    const session = sessionCounters(scope.sessionId)
    const active = pending(scope)
    const question = dailyTotals("student_question", scope.questionKeyHash)
    const student = dailyTotals("student", scope.studentKeyHash)
    const global = dailyTotals("global", "app")

    if (
      session.llmCalls + active.sessionCalls >=
      env.MAX_LLM_CALLS_PER_SESSION
    ) {
      return "session_call_limit"
    }
    if (
      session.totalTokens + active.sessionTokens + totalTokens >
      env.MAX_LLM_TOKENS_PER_SESSION
    ) {
      return "session_token_budget"
    }
    if (
      question.llmCalls + active.questionCalls >=
      env.MAX_LLM_CALLS_PER_QUESTION_PER_DAY
    ) {
      return "question_daily_limit"
    }
    if (
      student.llmCalls + active.studentCalls >=
      env.MAX_LLM_CALLS_PER_STUDENT_PER_DAY
    ) {
      return "student_daily_limit"
    }
    if (global.llmCalls + active.globalCalls >= env.MAX_DAILY_LLM_CALLS) {
      return "global_daily_limit"
    }
  }

  function addLlmUsage(scope: UsageScope, settlement: LlmTokenSettlement) {
    const total = settlement.providerTotalTokens ?? settlement.estimatedTokens
    const input = settlement.providerPromptTokens ?? 0
    const output = settlement.providerCompletionTokens ?? 0
    const estimated = settlement.providerTotalTokens === undefined ? total : 0

    for (const [kind, key] of [
      ["global", "app"],
      ["student", scope.studentKeyHash],
      ["student_question", scope.questionKeyHash],
    ] as const) {
      const totals = dailyTotals(kind, key)
      totals.estimatedLlmTokens += estimated
      totals.inputTokens += input
      totals.llmCalls += 1
      totals.outputTokens += output
      totals.totalTokens += total
    }
  }

  return {
    async getDashboard() {
      return createDashboard(
        "demo",
        recentDates().map((date) => ({
          ...dailyTotals("global", "app", date),
          date,
        })),
      )
    },

    async getLlmFallbacksRemaining(sessionId) {
      cleanupReservations()
      const session = sessionCounters(sessionId)
      const pendingCalls = [...reservations.values()].filter(
        (reservation) =>
          reservation.status === "pending" &&
          reservation.scope.sessionId === sessionId,
      ).length
      return Math.max(
        0,
        getServerEnv().MAX_LLM_CALLS_PER_SESSION -
          session.llmCalls -
          pendingCalls,
      )
    },

    async readCache(scope, requestHash) {
      const record = cache.get(`${scope.studentKeyHash}:${requestHash}`)
      if (!record || record.expiresAt <= Date.now()) {
        cache.delete(`${scope.studentKeyHash}:${requestHash}`)
        return undefined
      }
      return { ...record.response }
    },

    async recordCacheHit(scope) {
      dailyTotals("global", "app").cacheHits += 1
      dailyTotals("student", scope.studentKeyHash).cacheHits += 1
      dailyTotals("student_question", scope.questionKeyHash).cacheHits += 1
    },

    async recordInteraction() {
      const totals = dailyTotals("global", "app")
      totals.interactions += 1
    },

    async recordLimitBlock() {
      dailyTotals("global", "app").limitBlocks += 1
    },

    async release(reservation) {
      const existing = reservations.get(reservation.id)
      if (existing?.status === "pending") {
        existing.status = "released"
      }
    },

    async reserve({ scope, totalTokens }) {
      const reason = reserveReason(scope, totalTokens)
      if (reason) {
        return { allowed: false, reason }
      }

      const reservation: StoredReservation = {
        id: randomUUID(),
        reservedTotalTokens: totalTokens,
        scope,
        expiresAt: Date.now() + RESERVATION_TTL_MS,
        status: "pending",
      }
      reservations.set(reservation.id, reservation)
      return { allowed: true, reservation }
    },

    async settle(reservation, settlement) {
      const existing = reservations.get(reservation.id)
      if (!existing || existing.status !== "pending") {
        return
      }

      existing.status = "settled"
      const session = sessionCounters(reservation.scope.sessionId)
      session.llmCalls += 1
      session.totalTokens +=
        settlement.providerTotalTokens ?? settlement.estimatedTokens
      addLlmUsage(reservation.scope, settlement)
    },

    async writeCache({ response, scope, requestHash }) {
      cache.set(`${scope.studentKeyHash}:${requestHash}`, {
        expiresAt: Date.now() + getServerEnv().LLM_CACHE_TTL_SECONDS * 1000,
        response: { ...response },
      })
    },

    reset() {
      cache.clear()
      daily.clear()
      reservations.clear()
      sessions.clear()
    },
  }
}

function createPostgresUsageController(): UsageController {
  return {
    async getDashboard() {
      const pool = getPostgresPool()
      const result = await pool.query<UsageDashboardDay>(
        `
          select
            date_key::text as date,
            cache_hits as "cacheHits",
            estimated_llm_tokens as "estimatedLlmTokens",
            llm_input_tokens as "inputTokens",
            interactions,
            limit_blocks as "limitBlocks",
            llm_fallbacks as "llmCalls",
            llm_output_tokens as "outputTokens",
            llm_total_tokens as "totalTokens"
          from ai_usage
          where scope = 'global'
            and scope_key = 'app'
            and date_key >= current_date - interval '6 days'
          order by date_key
        `,
      )
      const rows = new Map(
        result.rows.map((row) => [row.date, normalizeTotals(row)]),
      )
      return createDashboard(
        "database",
        recentDates().map((date) => ({
          ...(rows.get(date) ?? emptyTotals()),
          date,
        })),
      )
    },

    async getLlmFallbacksRemaining(sessionId) {
      const pool = getPostgresPool()
      const result = await pool.query<{ llm_calls: number }>(
        `
          select
            ts.llm_calls + coalesce((
              select count(*)::int
              from ai_llm_reservations reservations
              where reservations.session_id = ts.id
                and reservations.status = 'pending'
                and reservations.expires_at > now()
            ), 0) as llm_calls
          from tutor_sessions ts
          where ts.id = $1
          limit 1
        `,
        [sessionId],
      )
      return Math.max(
        0,
        getServerEnv().MAX_LLM_CALLS_PER_SESSION -
          Number(result.rows[0]?.llm_calls ?? 0),
      )
    },

    async readCache(scope, requestHash) {
      const pool = getPostgresPool()
      const result = await pool.query<{ response_json: unknown }>(
        `
          select response_json
          from ai_response_cache
          where request_hash = $1
            and student_key_hash = $2
            and expires_at > now()
          limit 1
        `,
        [requestHash, scope.studentKeyHash],
      )
      return cacheResponseFromUnknown(result.rows[0]?.response_json)
    },

    async recordCacheHit(scope) {
      const pool = getPostgresPool()
      await Promise.all([
        upsertUsageMetric(pool, "global", "app", { cacheHits: 1 }),
        upsertUsageMetric(pool, "student", scope.studentKeyHash, {
          cacheHits: 1,
        }),
        upsertUsageMetric(pool, "student_question", scope.questionKeyHash, {
          cacheHits: 1,
        }),
      ])
    },

    async recordInteraction() {
      await upsertUsageMetric(getPostgresPool(), "global", "app", {
        interactions: 1,
      })
    },

    async recordLimitBlock() {
      await upsertUsageMetric(getPostgresPool(), "global", "app", {
        limitBlocks: 1,
      })
    },

    async release(reservation) {
      await getPostgresPool().query(
        `
          update ai_llm_reservations
          set status = 'released', updated_at = now()
          where id = $1 and status = 'pending'
        `,
        [reservation.id],
      )
    },

    async reserve({ scope, totalTokens }) {
      const client = await getPostgresPool().connect()
      try {
        await client.query("begin")
        await lockUsageScopes(client, scope)
        await client.query(
          "update ai_llm_reservations set status = 'released', updated_at = now() where status = 'pending' and expires_at <= now()",
        )

        const reason = await postgresReserveReason(client, scope, totalTokens)
        if (reason) {
          await client.query("rollback")
          return { allowed: false, reason }
        }

        const reservation: LlmBudgetReservation = {
          id: randomUUID(),
          reservedTotalTokens: totalTokens,
          scope,
        }
        await client.query(
          `
            insert into ai_llm_reservations (
              id, session_id, student_key_hash, question_key_hash,
              reserved_total_tokens, status, expires_at
            ) values ($1, $2, $3, $4, $5, 'pending', now() + interval '5 minutes')
          `,
          [
            reservation.id,
            scope.sessionId,
            scope.studentKeyHash,
            scope.questionKeyHash,
            totalTokens,
          ],
        )
        await client.query("commit")
        return { allowed: true, reservation }
      } catch (error) {
        await client.query("rollback").catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async settle(reservation, settlement) {
      const client = await getPostgresPool().connect()
      try {
        await client.query("begin")
        const pending = await client.query<{ id: string }>(
          "select id from ai_llm_reservations where id = $1 and status = 'pending' for update",
          [reservation.id],
        )
        if (!pending.rows[0]) {
          await client.query("rollback")
          return
        }

        const total =
          settlement.providerTotalTokens ?? settlement.estimatedTokens
        const input = settlement.providerPromptTokens ?? 0
        const output = settlement.providerCompletionTokens ?? 0
        const estimated =
          settlement.providerTotalTokens === undefined ? total : 0
        await client.query(
          `
            update tutor_sessions
            set llm_calls = llm_calls + 1,
                llm_input_tokens = llm_input_tokens + $2,
                llm_output_tokens = llm_output_tokens + $3,
                llm_total_tokens = llm_total_tokens + $4,
                last_seen_at = now()
            where id = $1
          `,
          [reservation.scope.sessionId, input, output, total],
        )
        await Promise.all([
          upsertUsageMetric(client, "global", "app", {
            estimatedLlmTokens: estimated,
            inputTokens: input,
            llmCalls: 1,
            outputTokens: output,
            totalTokens: total,
          }),
          upsertUsageMetric(
            client,
            "student",
            reservation.scope.studentKeyHash,
            {
              estimatedLlmTokens: estimated,
              inputTokens: input,
              llmCalls: 1,
              outputTokens: output,
              totalTokens: total,
            },
          ),
          upsertUsageMetric(
            client,
            "student_question",
            reservation.scope.questionKeyHash,
            {
              estimatedLlmTokens: estimated,
              inputTokens: input,
              llmCalls: 1,
              outputTokens: output,
              totalTokens: total,
            },
          ),
        ])
        await client.query(
          `
            update ai_llm_reservations
            set status = 'settled',
                actual_input_tokens = $2,
                actual_output_tokens = $3,
                actual_total_tokens = $4,
                updated_at = now()
            where id = $1
          `,
          [reservation.id, input, output, total],
        )
        await client.query("commit")
      } catch (error) {
        await client.query("rollback").catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async writeCache({ response, scope, requestHash }) {
      await getPostgresPool().query(
        `
          insert into ai_response_cache (
            request_hash, student_key_hash, source, response_json, expires_at
          ) values ($1, $2, 'llm', $3::jsonb, now() + ($4 * interval '1 second'))
          on conflict (request_hash)
          do update set
            student_key_hash = excluded.student_key_hash,
            source = excluded.source,
            response_json = excluded.response_json,
            expires_at = excluded.expires_at,
            updated_at = now()
        `,
        [
          requestHash,
          scope.studentKeyHash,
          JSON.stringify(response),
          getServerEnv().LLM_CACHE_TTL_SECONDS,
        ],
      )
    },
  }
}

async function postgresReserveReason(
  client: PoolClient,
  scope: UsageScope,
  totalTokens: number,
): Promise<LlmUsageLimitReason | undefined> {
  const env = getServerEnv()
  const [sessionResult, usageResult, pendingResult] = await Promise.all([
    client.query<{ llm_calls: number; llm_total_tokens: number }>(
      "select llm_calls, llm_total_tokens from tutor_sessions where id = $1 for update",
      [scope.sessionId],
    ),
    client.query<{ llm_fallbacks: number; scope: string; scope_key: string }>(
      `
        select scope, scope_key, llm_fallbacks
        from ai_usage
        where date_key = current_date
          and (
            (scope = 'global' and scope_key = 'app')
            or (scope = 'student' and scope_key = $1)
            or (scope = 'student_question' and scope_key = $2)
          )
      `,
      [scope.studentKeyHash, scope.questionKeyHash],
    ),
    client.query<{
      global_calls: number
      question_calls: number
      session_calls: number
      session_tokens: number
      student_calls: number
    }>(
      `
        select
          count(*) filter (where session_id = $1)::int as session_calls,
          coalesce(sum(reserved_total_tokens) filter (where session_id = $1), 0)::int as session_tokens,
          count(*) filter (where student_key_hash = $2)::int as student_calls,
          count(*) filter (where question_key_hash = $3)::int as question_calls,
          count(*)::int as global_calls
        from ai_llm_reservations
        where status = 'pending' and expires_at > now()
      `,
      [scope.sessionId, scope.studentKeyHash, scope.questionKeyHash],
    ),
  ])
  const session = sessionResult.rows[0]
  if (!session) {
    return "usage_persistence_unavailable"
  }
  const usage = new Map(
    usageResult.rows.map((row) => [
      `${row.scope}:${row.scope_key}`,
      Number(row.llm_fallbacks),
    ]),
  )
  const pending = pendingResult.rows[0]
  const sessionCalls =
    Number(session.llm_calls ?? 0) + Number(pending?.session_calls ?? 0)
  const sessionTokens =
    Number(session.llm_total_tokens ?? 0) + Number(pending?.session_tokens ?? 0)
  const questionCalls =
    Number(usage.get(`student_question:${scope.questionKeyHash}`) ?? 0) +
    Number(pending?.question_calls ?? 0)
  const studentCalls =
    Number(usage.get(`student:${scope.studentKeyHash}`) ?? 0) +
    Number(pending?.student_calls ?? 0)
  const globalCalls =
    Number(usage.get("global:app") ?? 0) + Number(pending?.global_calls ?? 0)

  if (sessionCalls >= env.MAX_LLM_CALLS_PER_SESSION) {
    return "session_call_limit"
  }
  if (sessionTokens + totalTokens > env.MAX_LLM_TOKENS_PER_SESSION) {
    return "session_token_budget"
  }
  if (questionCalls >= env.MAX_LLM_CALLS_PER_QUESTION_PER_DAY) {
    return "question_daily_limit"
  }
  if (studentCalls >= env.MAX_LLM_CALLS_PER_STUDENT_PER_DAY) {
    return "student_daily_limit"
  }
  if (globalCalls >= env.MAX_DAILY_LLM_CALLS) {
    return "global_daily_limit"
  }
}

async function lockUsageScopes(client: PoolClient, scope: UsageScope) {
  const lockKeys = [
    `global:app:${dateKey()}`,
    `question:${scope.questionKeyHash}:${dateKey()}`,
    `session:${scope.sessionId}`,
    `student:${scope.studentKeyHash}:${dateKey()}`,
  ].sort()

  for (const key of lockKeys) {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [key])
  }
}

async function upsertUsageMetric(
  queryable: Pick<Pool, "query"> | PoolClient,
  scope: "global" | "student" | "student_question",
  scopeKey: string,
  metric: Partial<UsageDashboardTotals>,
) {
  await queryable.query(
    `
      insert into ai_usage (
        scope, scope_key, date_key, interactions, estimated_tokens,
        llm_fallbacks, llm_input_tokens, llm_output_tokens,
        llm_total_tokens, estimated_llm_tokens, cache_hits, limit_blocks
      ) values ($1, $2, current_date, $3, 0, $4, $5, $6, $7, $8, $9, $10)
      on conflict (scope, scope_key, date_key)
      do update set
        interactions = ai_usage.interactions + excluded.interactions,
        llm_fallbacks = ai_usage.llm_fallbacks + excluded.llm_fallbacks,
        llm_input_tokens = ai_usage.llm_input_tokens + excluded.llm_input_tokens,
        llm_output_tokens = ai_usage.llm_output_tokens + excluded.llm_output_tokens,
        llm_total_tokens = ai_usage.llm_total_tokens + excluded.llm_total_tokens,
        estimated_llm_tokens = ai_usage.estimated_llm_tokens + excluded.estimated_llm_tokens,
        cache_hits = ai_usage.cache_hits + excluded.cache_hits,
        limit_blocks = ai_usage.limit_blocks + excluded.limit_blocks,
        updated_at = now()
    `,
    [
      scope,
      scopeKey,
      metric.interactions ?? 0,
      metric.llmCalls ?? 0,
      metric.inputTokens ?? 0,
      metric.outputTokens ?? 0,
      metric.totalTokens ?? 0,
      metric.estimatedLlmTokens ?? 0,
      metric.cacheHits ?? 0,
      metric.limitBlocks ?? 0,
    ],
  )
}

function createDashboard(
  mode: "database" | "demo",
  daily: UsageDashboardDay[],
): UsageDashboard {
  const today = daily.find((day) => day.date === dateKey()) ?? {
    ...emptyTotals(),
    date: dateKey(),
  }
  const env = getServerEnv()

  return {
    daily,
    mode,
    policy: {
      maxDailyLlmCalls: env.MAX_DAILY_LLM_CALLS,
      maxLlmCallsPerQuestionPerDay: env.MAX_LLM_CALLS_PER_QUESTION_PER_DAY,
      maxLlmCallsPerSession: env.MAX_LLM_CALLS_PER_SESSION,
      maxLlmCallsPerStudentPerDay: env.MAX_LLM_CALLS_PER_STUDENT_PER_DAY,
      maxLlmOutputTokens: env.MAX_LLM_OUTPUT_TOKENS,
      maxLlmTokensPerSession: env.MAX_LLM_TOKENS_PER_SESSION,
      maxTutorInputChars: env.MAX_TUTOR_INPUT_CHARS,
    },
    today: normalizeTotals(today),
  }
}

function cacheResponseFromUnknown(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const response = value as Partial<CachedLlmTutorResponse>
  if (
    typeof response.message !== "string" ||
    typeof response.contextUsed !== "boolean" ||
    !isResponseLabel(response.responseLabel)
  ) {
    return undefined
  }

  return {
    contextUsed: response.contextUsed,
    message: response.message,
    responseLabel: response.responseLabel,
  }
}

function isResponseLabel(value: unknown): value is TutorResponseLabel {
  return [
    "approved_course_content",
    "generated_approved_content",
    "general_ai_help",
    "private_reference_grounded_explanation",
  ].includes(String(value))
}

function normalizeTotals(value: Partial<UsageDashboardTotals>) {
  return {
    cacheHits: Number(value.cacheHits ?? 0),
    estimatedLlmTokens: Number(value.estimatedLlmTokens ?? 0),
    inputTokens: Number(value.inputTokens ?? 0),
    interactions: Number(value.interactions ?? 0),
    limitBlocks: Number(value.limitBlocks ?? 0),
    llmCalls: Number(value.llmCalls ?? 0),
    outputTokens: Number(value.outputTokens ?? 0),
    totalTokens: Number(value.totalTokens ?? 0),
  }
}

function usageSecret() {
  return getServerEnv().USAGE_KEY_SECRET ?? "demo-usage-control-secret"
}

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex")
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function recentDates() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setUTCDate(date.getUTCDate() - (6 - index))
    return dateKey(date)
  })
}
