import "server-only"

import {
  buildLlmTutorUserPrompt,
  generateLlmTutorResponse,
  LLM_TUTOR_OUTPUT_TOKEN_LIMIT,
  type LlmTutorDisclosure,
  type LlmTutorInput,
  type LlmTutorTask,
} from "@/lib/ai/llm-tutor"
import type { LlmGroundingContext, TutorMode, TutorProgress } from "@/lib/types"

export const LLM_FALLBACK_OUTPUT_TOKEN_LIMIT = LLM_TUTOR_OUTPUT_TOKEN_LIMIT

export type LlmFallbackTask = LlmTutorTask

export type LlmFallbackDisclosure = LlmTutorDisclosure

export type LlmFallbackPromptInput = {
  allowedDisclosure: LlmFallbackDisclosure
  answerCheck?: {
    confidence: number
    feedback: string
  }
  mode: TutorMode
  progress?: Pick<
    TutorProgress,
    "hintsRevealed" | "solved" | "stepsRevealed"
  >
  provenanceNote: string
  question?: {
    prompt: string
    title: string
  }
  retrievedContext: LlmGroundingContext[]
  studentInput: string
  task: LlmFallbackTask
  topicId?: string
}

type FallbackResult =
  | {
      ok: true
      text: string
    }
  | {
      ok: false
      reason: string
    }

export async function generateLlmFallback(
  input: LlmFallbackPromptInput,
): Promise<FallbackResult> {
  const result = await generateLlmTutorResponse(toTutorInput(input))

  if (!result.fallbackUsed) {
    return {
      ok: false,
      reason: result.tutorMessage,
    }
  }

  return {
    ok: true,
    text: result.tutorMessage,
  }
}

export function buildLlmFallbackPrompt(input: LlmFallbackPromptInput) {
  return buildLlmTutorUserPrompt(toTutorInput(input))
}

function toTutorInput(input: LlmFallbackPromptInput): LlmTutorInput {
  return {
    allowedDisclosure: input.allowedDisclosure,
    answerCheck: input.answerCheck,
    currentQuestion: input.question,
    mode: input.mode,
    provenanceNote: input.provenanceNote,
    retrievedContext: input.retrievedContext,
    sessionState: input.progress,
    studentMessage: input.studentInput,
    task: input.task,
    topicId: input.topicId,
  }
}
