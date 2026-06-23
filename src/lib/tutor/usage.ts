import "server-only"

import type { TutorSource, UsageSummary } from "@/lib/types"

export const DEFAULT_USAGE_POLICY = {
  maxInputCharacters: 800,
  maxLlmFallbacksPerSession: 2,
  maxEstimatedTokensPerSession: 1200,
}

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
  sessionUsage.clear()
}
