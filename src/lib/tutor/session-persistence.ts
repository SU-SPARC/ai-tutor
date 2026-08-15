import "server-only";

import { normalizeAnswerText } from "@/lib/tutor/answer-checker";

export const AUTHENTICATED_TUTOR_SESSION_RETENTION_DAYS = 180;
export const MAX_STORED_TUTOR_ANSWER_LENGTH = 500;
export const MAX_STORED_MISCONCEPTION_FEEDBACK_LENGTH = 240;
export const MAX_STORED_MISCONCEPTION_FEEDBACK_ITEMS = 3;

const PRIVATE_CONTEXT_SIGNAL =
  /\b(?:raw private|private (?:retrieval )?chunk|retrieval context|embedding vector|professor-only note|source page|answer key|solution key|copied from|verbatim excerpt)\b/i;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const BEARER_TOKEN = /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/giu;
const NAMED_SECRET =
  /\b(api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*\S+/giu;
const US_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

export function redactTutorSessionText(
  value: string | undefined,
  maximumLength = MAX_STORED_TUTOR_ANSWER_LENGTH,
) {
  const normalized = value
    ?.normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim();

  if (!normalized) {
    return undefined;
  }

  if (PRIVATE_CONTEXT_SIGNAL.test(normalized)) {
    return "[private context redacted]";
  }

  const redacted = normalized
    .replace(BEARER_TOKEN, "[credential redacted]")
    .replace(NAMED_SECRET, "$1=[redacted]")
    .replace(EMAIL_ADDRESS, "[email redacted]")
    .replace(US_SSN, "[identifier redacted]")
    .replace(/\s+/g, " ")
    .trim();

  return redacted ? redacted.slice(0, maximumLength) : undefined;
}

export function normalizedTutorAnswerForPersistence(value: string | undefined) {
  const redacted = redactTutorSessionText(value);
  const normalized = redacted ? normalizeAnswerText(redacted) : "";
  return normalized
    ? normalized.slice(0, MAX_STORED_TUTOR_ANSWER_LENGTH)
    : undefined;
}

export function misconceptionFeedbackForPersistence(values: string[]) {
  return values
    .slice(0, MAX_STORED_MISCONCEPTION_FEEDBACK_ITEMS)
    .map((value) =>
      redactTutorSessionText(value, MAX_STORED_MISCONCEPTION_FEEDBACK_LENGTH),
    )
    .filter((value): value is string => Boolean(value));
}

export function isTutorSessionIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,128}$/.test(value);
}
