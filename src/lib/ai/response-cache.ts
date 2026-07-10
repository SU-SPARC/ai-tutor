import "server-only"

import { createHmac } from "node:crypto"

import { getServerEnv } from "@/lib/env/server"
import {
  readLlmResponseCache,
  recordLlmCacheHit,
  writeLlmResponseCache,
  type CachedLlmTutorResponse,
  type UsageScope,
} from "@/lib/tutor/usage-control"
import type {
  LlmGroundingContext,
  TutorMode,
  TutorResponseLabel,
} from "@/lib/types"

const RESPONSE_CACHE_POLICY_VERSION = "ai-response-cache-v1"
const RESPONSE_GUARDRAIL_VERSION = "tutor-response-guardrails-v1"

export type AiResponseCacheKeyInput = {
  allowedDisclosure: string
  model: string
  mode: TutorMode
  questionId?: string
  retrievedContext: LlmGroundingContext[]
  studentKeyHash: string
  studentMessage: string
  task: string
  topicId?: string
}

type SaveAiResponseCacheInput = {
  contextUsed: boolean
  message: string
  requestHash: string
  responseLabel: TutorResponseLabel
  scope: UsageScope
}

export function createAiResponseCacheKey(input: AiResponseCacheKeyInput) {
  const secret = responseCacheSecret()
  const canonical = JSON.stringify({
    allowedDisclosure: input.allowedDisclosure,
    contextContentHashes: input.retrievedContext.map((item) =>
      hmac(secret, item.body),
    ),
    guardrailVersion: RESPONSE_GUARDRAIL_VERSION,
    maxOutputTokens: getServerEnv().MAX_LLM_OUTPUT_TOKENS,
    mode: input.mode,
    model: input.model,
    policy: RESPONSE_CACHE_POLICY_VERSION,
    questionId: input.questionId,
    retrievedContextIds: input.retrievedContext.map((item) => item.id),
    studentKeyHash: input.studentKeyHash,
    studentMessage: normalizeStudentMessage(input.studentMessage),
    task: input.task,
    topicId: input.topicId,
  })

  return hmac(secret, canonical)
}

export async function getCachedAiTutorResponse(
  scope: UsageScope,
  requestHash: string,
): Promise<CachedLlmTutorResponse | undefined> {
  const cached = await readLlmResponseCache(scope, requestHash)

  if (cached) {
    await recordLlmCacheHit(scope)
  }

  return cached
}

export async function saveAiTutorResponseCache({
  contextUsed,
  message,
  requestHash,
  responseLabel,
  scope,
}: SaveAiResponseCacheInput) {
  await writeLlmResponseCache({
    requestHash,
    response: {
      contextUsed,
      message,
      responseLabel,
    },
    scope,
  })
}

export function normalizeStudentMessage(message: string) {
  return message.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase()
}

function responseCacheSecret() {
  return getServerEnv().USAGE_KEY_SECRET ?? "demo-usage-control-secret"
}

function hmac(secret: string, value: string) {
  return createHmac("sha256", secret).update(value).digest("hex")
}
