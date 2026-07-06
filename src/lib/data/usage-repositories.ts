import "server-only"

import type {
  TutorCacheRecord,
  UsageRepository,
} from "@/lib/data/repository"
import { getServerEnv } from "@/lib/env/server"
import type { TutorSource, UsageSummary } from "@/lib/types"

type QueryValue = Date | null | number | string
type QueryExecutor = (
  sql: string,
  params?: QueryValue[],
) => Promise<Record<string, unknown>[]>

export const DEFAULT_USAGE_LIMITS = {
  maxDailyLlmFallbacks: getServerEnv().MAX_DAILY_LLM_CALLS,
  maxEstimatedTokensPerSession: 1200,
  maxLlmFallbacksPerSession: getServerEnv().MAX_LLM_CALLS_PER_SESSION,
}

export function createMemoryUsageRepository(): UsageRepository {
  const dailyLlmFallbacks = new Map<string, number>()
  const sessionUsage = new Map<string, UsageSummary>()
  const cache = new Map<string, TutorCacheRecord>()

  function getSessionUsage(sessionId: string): UsageSummary {
    return (
      sessionUsage.get(sessionId) ?? {
        estimatedTokens: 0,
        interactions: 0,
        llmFallbacks: 0,
      }
    )
  }

  return {
    async canUseLlmFallback(sessionId, estimatedTokens) {
      const current = getSessionUsage(sessionId)

      if (current.llmFallbacks >= DEFAULT_USAGE_LIMITS.maxLlmFallbacksPerSession) {
        return {
          allowed: false,
          reason: "The session has reached its LLM fallback limit.",
        }
      }

      if (
        (dailyLlmFallbacks.get(getDateKey()) ?? 0) >=
        DEFAULT_USAGE_LIMITS.maxDailyLlmFallbacks
      ) {
        return {
          allowed: false,
          reason: "The app has reached its daily LLM fallback limit.",
        }
      }

      if (
        current.estimatedTokens + estimatedTokens >
        DEFAULT_USAGE_LIMITS.maxEstimatedTokensPerSession
      ) {
        return {
          allowed: false,
          reason: "The session has reached its estimated token budget.",
        }
      }

      return {
        allowed: true,
        reason: "LLM fallback is allowed by the current session policy.",
      }
    },

    async getGlobalUsageSummary() {
      return Array.from(sessionUsage.values()).reduce<UsageSummary>(
        (summary, usage) => ({
          estimatedTokens: summary.estimatedTokens + usage.estimatedTokens,
          interactions: summary.interactions + usage.interactions,
          llmFallbacks: summary.llmFallbacks + usage.llmFallbacks,
        }),
        {
          estimatedTokens: 0,
          interactions: 0,
          llmFallbacks: 0,
        },
      )
    },

    async getLlmFallbacksRemaining(sessionId) {
      const current = getSessionUsage(sessionId)
      return Math.max(
        0,
        DEFAULT_USAGE_LIMITS.maxLlmFallbacksPerSession - current.llmFallbacks,
      )
    },

    async getSessionUsage(sessionId) {
      return getSessionUsage(sessionId)
    },

    async readTutorCache(requestHash) {
      const record = cache.get(requestHash)

      if (!record || record.expiresAt.getTime() <= Date.now()) {
        cache.delete(requestHash)
        return undefined
      }

      return record
    },

    async recordTutorAttempt(input) {
      await this.recordTutorInteraction(
        input.sessionId,
        input.estimatedTokens,
        input.source,
      )
    },

    async recordTutorInteraction(sessionId, estimatedTokens, source) {
      const current = getSessionUsage(sessionId)

      sessionUsage.set(sessionId, {
        estimatedTokens: current.estimatedTokens + estimatedTokens,
        interactions: current.interactions + 1,
        llmFallbacks: current.llmFallbacks + (source === "llm" ? 1 : 0),
      })

      if (source === "llm") {
        const dateKey = getDateKey()
        dailyLlmFallbacks.set(dateKey, (dailyLlmFallbacks.get(dateKey) ?? 0) + 1)
      }
    },

    async writeTutorCache(record) {
      if (record.response.source === "llm") {
        return
      }

      cache.set(record.requestHash, record)
    },
  }
}

export function createDatabaseUsageRepository(
  databaseUrl: string,
  query: QueryExecutor = createUnavailableQueryExecutor(databaseUrl),
): UsageRepository {
  return {
    async canUseLlmFallback(sessionId, estimatedTokens) {
      const current = await this.getSessionUsage(sessionId)
      const daily = await query(
        `
          select llm_fallbacks
          from ai_usage
          where scope = 'global' and scope_key = 'app' and date_key = $1
        `,
        [getDateKey()],
      )
      const dailyFallbacks = Number(daily[0]?.llm_fallbacks ?? 0)

      if (current.llmFallbacks >= DEFAULT_USAGE_LIMITS.maxLlmFallbacksPerSession) {
        return {
          allowed: false,
          reason: "The session has reached its LLM fallback limit.",
        }
      }

      if (dailyFallbacks >= DEFAULT_USAGE_LIMITS.maxDailyLlmFallbacks) {
        return {
          allowed: false,
          reason: "The app has reached its daily LLM fallback limit.",
        }
      }

      if (
        current.estimatedTokens + estimatedTokens >
        DEFAULT_USAGE_LIMITS.maxEstimatedTokensPerSession
      ) {
        return {
          allowed: false,
          reason: "The session has reached its estimated token budget.",
        }
      }

      return {
        allowed: true,
        reason: "LLM fallback is allowed by the current session policy.",
      }
    },

    async getGlobalUsageSummary() {
      const rows = await query(`
        select
          coalesce(sum(interactions), 0) as interactions,
          coalesce(sum(estimated_tokens), 0) as estimated_tokens,
          coalesce(sum(llm_fallbacks), 0) as llm_fallbacks
        from ai_usage
      `)
      return usageSummaryFromRow(rows[0])
    },

    async getLlmFallbacksRemaining(sessionId) {
      const current = await this.getSessionUsage(sessionId)
      return Math.max(
        0,
        DEFAULT_USAGE_LIMITS.maxLlmFallbacksPerSession - current.llmFallbacks,
      )
    },

    async getSessionUsage(sessionId) {
      const rows = await query(
        `
          select interactions, estimated_tokens, llm_fallbacks
          from ai_usage
          where scope = 'session' and scope_key = $1
        `,
        [sessionId],
      )
      return usageSummaryFromRow(rows[0])
    },

    async readTutorCache(requestHash) {
      const rows = await query(
        `
          select request_hash, response_json, expires_at
          from ai_response_cache
          where request_hash = $1 and expires_at > now()
          limit 1
        `,
        [requestHash],
      )
      const row = rows[0]

      if (!row) {
        return undefined
      }

      return {
        expiresAt: new Date(String(row.expires_at)),
        requestHash: String(row.request_hash),
        response: row.response_json as TutorCacheRecord["response"],
      }
    },

    async recordTutorAttempt(input) {
      await query(
        `
          insert into tutor_sessions (id, last_seen_at)
          values ($1, now())
          on conflict (id) do update set last_seen_at = excluded.last_seen_at
        `,
        [input.sessionId],
      )
      await query(
        `
          insert into attempts (
            session_id,
            question_id,
            topic_id,
            mode,
            answer_hash,
            answer_preview,
            source,
            verdict,
            estimated_tokens
          )
          values ($1, $2, $3, $4, null, $5, $6, $7, $8)
        `,
        [
          input.sessionId,
          input.questionId ?? null,
          input.topicId ?? null,
          input.mode ?? null,
          input.answerPreview ?? null,
          input.source,
          input.verdict ?? null,
          input.estimatedTokens,
        ],
      )
      await this.recordTutorInteraction(
        input.sessionId,
        input.estimatedTokens,
        input.source,
      )
    },

    async recordTutorInteraction(sessionId, estimatedTokens, source) {
      await upsertUsageCounter(query, "session", sessionId, estimatedTokens, source)
      await upsertUsageCounter(query, "global", "app", estimatedTokens, source)
    },

    async writeTutorCache(record) {
      if (record.response.source === "llm") {
        return
      }

      await query(
        `
          insert into ai_response_cache (
            request_hash,
            question_id,
            topic_id,
            mode,
            source,
            response_json,
            expires_at
          )
          values ($1, null, null, null, $2, $3, $4)
          on conflict (request_hash)
          do update set
            source = excluded.source,
            response_json = excluded.response_json,
            expires_at = excluded.expires_at,
            updated_at = now()
        `,
        [
          record.requestHash,
          record.response.source,
          JSON.stringify(record.response),
          record.expiresAt,
        ],
      )
    },
  }
}

function usageSummaryFromRow(row: Record<string, unknown> | undefined) {
  return {
    estimatedTokens: Number(row?.estimated_tokens ?? 0),
    interactions: Number(row?.interactions ?? 0),
    llmFallbacks: Number(row?.llm_fallbacks ?? 0),
  }
}

async function upsertUsageCounter(
  query: QueryExecutor,
  scope: string,
  scopeKey: string,
  estimatedTokens: number,
  source: TutorSource,
) {
  await query(
    `
      insert into ai_usage (
        scope,
        scope_key,
        date_key,
        interactions,
        estimated_tokens,
        llm_fallbacks
      )
      values ($1, $2, $3, 1, $4, $5)
      on conflict (scope, scope_key, date_key)
      do update set
        interactions = ai_usage.interactions + 1,
        estimated_tokens = ai_usage.estimated_tokens + excluded.estimated_tokens,
        llm_fallbacks = ai_usage.llm_fallbacks + excluded.llm_fallbacks,
        updated_at = now()
    `,
    [scope, scopeKey, getDateKey(), estimatedTokens, source === "llm" ? 1 : 0],
  )
}

function getDateKey() {
  return new Date().toISOString().slice(0, 10)
}

function createUnavailableQueryExecutor(databaseUrl: string): QueryExecutor {
  return async () => {
    const host = new URL(databaseUrl).host
    throw new Error(
      `Database usage repository selected for ${host}, but no Postgres driver is configured. Add a server-only query executor or keep APP_DEMO_MODE=true for demo fallback.`,
    )
  }
}
