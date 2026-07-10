import "server-only"

import { getServerEnv } from "@/lib/env/server"
import type { TutorSource, UsageSummary } from "@/lib/types"

export const DEFAULT_USAGE_POLICY = {
  maxInputCharacters: getServerEnv().MAX_TUTOR_INPUT_CHARS,
  maxDailyLlmFallbacks: getServerEnv().MAX_DAILY_LLM_CALLS,
  maxEstimatedTokensPerSession: getServerEnv().MAX_LLM_TOKENS_PER_SESSION,
  maxLlmFallbacksPerSession: getServerEnv().MAX_LLM_CALLS_PER_SESSION,
}

const dailyLlmFallbacks = new Map<string, number>()
const sessionUsage = new Map<string, UsageSummary>()

export function estimateTokens(input: string) {
  return Math.max(1, Math.ceil(input.length / 4))
}

export function getSessionUsage(sessionId: string): UsageSummary {
  return (
    sessionUsage.get(sessionId) ?? {
      estimatedTokens: 0,
      interactions: 0,
      llmFallbacks: 0,
    }
  )
}

export async function getGlobalUsageSummary(): Promise<UsageSummary> {
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
}

export function recordTutorInteraction(
  sessionId: string,
  estimatedTokens: number,
  source: TutorSource,
) {
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
}

export function canUseLlmFallback(sessionId: string, estimatedTokens: number) {
  const current = getSessionUsage(sessionId)

  if (current.llmFallbacks >= DEFAULT_USAGE_POLICY.maxLlmFallbacksPerSession) {
    return {
      allowed: false,
      reason: "The session has reached its LLM fallback limit.",
    }
  }

  if (
    (dailyLlmFallbacks.get(getDateKey()) ?? 0) >=
    DEFAULT_USAGE_POLICY.maxDailyLlmFallbacks
  ) {
    return {
      allowed: false,
      reason: "The app has reached its daily LLM fallback limit.",
    }
  }

  if (
    current.estimatedTokens + estimatedTokens >
    DEFAULT_USAGE_POLICY.maxEstimatedTokensPerSession
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
}

export function getLlmFallbacksRemaining(sessionId: string) {
  const current = getSessionUsage(sessionId)
  return Math.max(
    0,
    DEFAULT_USAGE_POLICY.maxLlmFallbacksPerSession - current.llmFallbacks,
  )
}

export function resetUsageForTests() {
  dailyLlmFallbacks.clear()
  sessionUsage.clear()
}

function getDateKey() {
  return new Date().toISOString().slice(0, 10)
}
