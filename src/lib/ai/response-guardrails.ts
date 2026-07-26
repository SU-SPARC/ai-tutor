import "server-only"

import type { LlmTutorDisclosure } from "@/lib/ai/llm-tutor"

export type TutorResponseGuardrailViolation =
  | "copied_source_like_text"
  | "empty_response"
  | "full_solution_too_early"
  | "private_or_raw_content"
  | "too_long"
  | "unsupported_professor_approval"
  | "system_prompt_exposure"

export type TutorResponseGuardrailInput = {
  allowedDisclosure: LlmTutorDisclosure
  allowProfessorApprovalClaim?: boolean
  fallbackMessage?: string
  maxCharacters?: number
  response: string
}

export type TutorResponseGuardrailResult = {
  repaired: boolean
  response: string
  violations: TutorResponseGuardrailViolation[]
}

const DEFAULT_MAX_RESPONSE_CHARACTERS = 520
const DEFAULT_FALLBACK_MESSAGE =
  "Let's stay focused on the probability/statistics idea. Identify the relevant formula or sample space first, then work one step at a time."

const systemPromptSignals =
  /system prompt|developer message|hidden instruction|ignore previous|you are a probability\/statistics tutor|you are a probability and statistics tutor/i

const unsupportedProfessorApprovalSignals =
  /professor (approved|provided|confirmed|reviewed|endorsed)|approved by (the )?professor|course-approved|professor-approved/i

const privateOrRawSignals =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf/i

const copiedSourceSignals =
  /copied textbook|textbook question|textbook solution|textbook.*solution|from the book|as written in the textbook|solution is shown verbatim|verbatim.*solution|problem \d+(\.\d+)?|exercise \d+(\.\d+)?/i

const fullSolutionSignals =
  /final answer|the answer is|therefore the answer|complete solution|full solution|so the probability is|so p\(|=\s*\d+(?:\.\d+)?%?\s*$/i

export function applyTutorResponseGuardrails(
  input: TutorResponseGuardrailInput,
): TutorResponseGuardrailResult {
  const maxCharacters = input.maxCharacters ?? DEFAULT_MAX_RESPONSE_CHARACTERS
  const trimmed = input.response.trim()
  const violations = validateTutorResponseGuardrails(input)
  let response = trimmed

  if (
    violations.includes("empty_response") ||
    violations.includes("private_or_raw_content") ||
    violations.includes("copied_source_like_text") ||
    violations.includes("system_prompt_exposure")
  ) {
    response = safeFallbackMessage(input.fallbackMessage)
  } else {
    if (violations.includes("unsupported_professor_approval")) {
      response = removeUnsupportedApprovalClaims(response)
    }

    if (violations.includes("full_solution_too_early")) {
      response =
        "I should not reveal the full answer yet. Start by identifying the relevant formula or conditioned sample space, then do the next small step."
    }
  }

  response = truncateResponse(response, maxCharacters)

  return {
    repaired: violations.length > 0 || response !== trimmed,
    response,
    violations,
  }
}

export function validateTutorResponseGuardrails(
  input: TutorResponseGuardrailInput,
): TutorResponseGuardrailViolation[] {
  const response = input.response.trim()
  const maxCharacters = input.maxCharacters ?? DEFAULT_MAX_RESPONSE_CHARACTERS
  const violations: TutorResponseGuardrailViolation[] = []

  if (!response) {
    violations.push("empty_response")
    return violations
  }

  if (response.length > maxCharacters) {
    violations.push("too_long")
  }

  if (systemPromptSignals.test(response)) {
    violations.push("system_prompt_exposure")
  }

  if (
    !input.allowProfessorApprovalClaim &&
    unsupportedProfessorApprovalSignals.test(response)
  ) {
    violations.push("unsupported_professor_approval")
  }

  if (
    input.allowedDisclosure !== "full_solution_allowed" &&
    fullSolutionSignals.test(response)
  ) {
    violations.push("full_solution_too_early")
  }

  if (privateOrRawSignals.test(response)) {
    violations.push("private_or_raw_content")
  }

  if (copiedSourceSignals.test(response) || hasLongCopiedLookingParagraph(response)) {
    violations.push("copied_source_like_text")
  }

  return dedupeViolations(violations)
}

function removeUnsupportedApprovalClaims(response: string) {
  return response
    .replace(/\bprofessor[- ]approved\b/gi, "available")
    .replace(/\bcourse[- ]approved\b/gi, "available")
    .replace(/\bapproved by (the )?professor\b/gi, "available")
    .replace(/\bthe professor (approved|provided|confirmed|reviewed|endorsed)\b/gi, "the tutor can use")
    .replace(/\s+/g, " ")
    .trim()
}

function safeFallbackMessage(fallbackMessage: string | undefined) {
  return (fallbackMessage ?? DEFAULT_FALLBACK_MESSAGE).trim()
}

function truncateResponse(response: string, maxCharacters: number) {
  const trimmed = response.trim()

  if (trimmed.length <= maxCharacters) {
    return trimmed
  }

  const clipped = trimmed.slice(0, Math.max(0, maxCharacters - 3)).trimEnd()
  const sentenceEnd = Math.max(
    clipped.lastIndexOf("."),
    clipped.lastIndexOf("?"),
    clipped.lastIndexOf("!"),
  )

  if (sentenceEnd >= Math.floor(maxCharacters * 0.45)) {
    return clipped.slice(0, sentenceEnd + 1)
  }

  return `${clipped}...`
}

function hasLongCopiedLookingParagraph(response: string) {
  return response
    .split(/\n{2,}/)
    .some((paragraph) => paragraph.trim().split(/\s+/).length >= 70)
}

function dedupeViolations(
  violations: TutorResponseGuardrailViolation[],
): TutorResponseGuardrailViolation[] {
  return [...new Set(violations)]
}
