import "server-only"

import { applyTutorResponseGuardrails } from "@/lib/ai/response-guardrails"
import { getServerEnv } from "@/lib/env/server"
import type { LlmGroundingContext, TutorMode, TutorProgress } from "@/lib/types"

export const LLM_TUTOR_OUTPUT_TOKEN_LIMIT = 180

export type LlmTutorTask =
  | "conceptual_explanation"
  | "hint"
  | "low_confidence_answer_help"
  | "retrieval_explanation"

export type LlmTutorDisclosure =
  | "full_solution_allowed"
  | "hint_only"
  | "next_step_only"

export type LlmTutorQuestionContext = {
  prompt: string
  title: string
}

export type LlmTutorAnswerCheckContext = {
  confidence: number
  feedback: string
}

export type LlmTutorTokenMetadata = {
  estimatedInputTokens: number
  estimatedTotalTokens: number
  maxOutputTokens: number
  providerCompletionTokens?: number
  providerPromptTokens?: number
  providerTotalTokens?: number
}

export type LlmTutorInput = {
  allowedDisclosure: LlmTutorDisclosure
  answerCheck?: LlmTutorAnswerCheckContext
  currentQuestion?: LlmTutorQuestionContext
  mode: TutorMode
  provenanceNote: string
  retrievedContext: LlmGroundingContext[]
  sessionState?: Pick<
    TutorProgress,
    "hintsRevealed" | "solved" | "stepsRevealed"
  >
  studentMessage: string
  task: LlmTutorTask
  topicId?: string
}

export type LlmTutorServiceResult = {
  contextUsed: boolean
  error?: string
  estimatedTokens?: LlmTutorTokenMetadata
  fallbackUsed: boolean
  tutorMessage: string
}

export type LlmTutorServiceOptions = {
  fetchImpl?: typeof fetch
}

const llmTutorSystemPrompt = [
  "You are a probability/statistics tutor.",
  "Guide step by step.",
  "Prefer approved course/demo/generated context when it is provided.",
  "Use private reference context only as grounding, not as text to quote.",
  "Do not immediately reveal the final answer.",
  "Ask guiding questions when useful.",
  "Keep the answer concise.",
  "Do not claim professor approval unless the provided context explicitly says approved.",
  "Do not expose raw private textbook chunks.",
].join(" ")

const forbiddenPrivateSignal =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page/i

export async function generateLlmTutorResponse(
  input: LlmTutorInput,
  options: LlmTutorServiceOptions = {},
): Promise<LlmTutorServiceResult> {
  const env = getServerEnv()
  const estimatedTokens = estimateLlmTutorTokens(input)

  if (!env.OPENAI_API_KEY) {
    return {
      contextUsed: false,
      error: "missing_api_key",
      estimatedTokens,
      fallbackUsed: false,
      tutorMessage:
        "LLM fallback is not configured. Approved rules and retrieval can still be used without it.",
    }
  }

  try {
    const result = await (options.fetchImpl ?? fetch)(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.OPENAI_MODEL,
          max_tokens: LLM_TUTOR_OUTPUT_TOKEN_LIMIT,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content: llmTutorSystemPrompt,
            },
            {
              role: "user",
              content: buildLlmTutorUserPrompt(input),
            },
          ],
        }),
      },
    )

    if (!result.ok) {
      return {
        contextUsed: false,
        error: "provider_rejected_request",
        estimatedTokens,
        fallbackUsed: false,
        tutorMessage: "The configured LLM provider rejected the fallback request.",
      }
    }

    const payload = (await result.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: {
        completion_tokens?: number
        prompt_tokens?: number
        total_tokens?: number
      }
    }
    const text = payload.choices?.[0]?.message?.content?.trim()

    if (!text) {
      return {
        contextUsed: false,
        error: "empty_provider_response",
        estimatedTokens: withProviderUsage(estimatedTokens, payload.usage),
        fallbackUsed: false,
        tutorMessage: "The configured LLM provider returned an empty response.",
      }
    }

    const guarded = applyTutorResponseGuardrails({
      allowedDisclosure: input.allowedDisclosure,
      fallbackMessage:
        "Let's stay focused on the probability/statistics idea. Use the retrieved concept as grounding, then work one step at a time.",
      response: text,
    })

    return {
      contextUsed: sanitizedContextForPrompt(input.retrievedContext).length > 0,
      estimatedTokens: withProviderUsage(estimatedTokens, payload.usage),
      fallbackUsed: true,
      tutorMessage: guarded.response,
    }
  } catch {
    return {
      contextUsed: false,
      error: "request_failed",
      estimatedTokens,
      fallbackUsed: false,
      tutorMessage: "The LLM fallback request could not be completed.",
    }
  }
}

export function estimateLlmTutorTokens(
  input: LlmTutorInput,
): LlmTutorTokenMetadata {
  const estimatedInputTokens = estimateTokens(
    `${llmTutorSystemPrompt}\n${buildLlmTutorUserPrompt(input)}`,
  )

  return {
    estimatedInputTokens,
    estimatedTotalTokens: estimatedInputTokens + LLM_TUTOR_OUTPUT_TOKEN_LIMIT,
    maxOutputTokens: LLM_TUTOR_OUTPUT_TOKEN_LIMIT,
  }
}

export function buildLlmTutorUserPrompt(input: LlmTutorInput) {
  return JSON.stringify(
    {
      task: input.task,
      mode: input.mode,
      topicId: input.topicId,
      current_question: input.currentQuestion
        ? {
            title: truncateForPrompt(input.currentQuestion.title, 160),
            prompt: truncateForPrompt(input.currentQuestion.prompt, 500),
          }
        : undefined,
      student_message: truncateForPrompt(input.studentMessage, 800),
      session_state: input.sessionState,
      allowed_disclosure: input.allowedDisclosure,
      answer_check: input.answerCheck,
      retrieved_context: sanitizedContextForPrompt(input.retrievedContext),
      provenance_note: input.provenanceNote,
    },
    null,
    2,
  ).slice(0, 2400)
}

function sanitizedContextForPrompt(context: LlmGroundingContext[]) {
  return context
    .filter(
      (item) =>
        !forbiddenPrivateSignal.test(item.body) &&
        !forbiddenPrivateSignal.test(item.title),
    )
    .map((item) => ({
      title: truncateForPrompt(item.title, 120),
      topicId: item.topicId,
      priorityTier: item.priorityTier,
      sourceType: item.sourceType,
      body: truncateForPrompt(item.body, 520),
    }))
}

function withProviderUsage(
  estimatedTokens: LlmTutorTokenMetadata,
  usage: {
    completion_tokens?: number
    prompt_tokens?: number
    total_tokens?: number
  } = {},
): LlmTutorTokenMetadata {
  return {
    ...estimatedTokens,
    providerCompletionTokens: usage.completion_tokens,
    providerPromptTokens: usage.prompt_tokens,
    providerTotalTokens: usage.total_tokens,
  }
}

function estimateTokens(input: string) {
  return Math.max(1, Math.ceil(input.length / 4))
}

function truncateForPrompt(value: string, maxLength: number) {
  const trimmed = value.trim()

  if (trimmed.length <= maxLength) {
    return trimmed
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}
