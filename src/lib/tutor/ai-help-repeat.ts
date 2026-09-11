import "server-only";

import {
  normalizedTutorAnswerForPersistence,
  redactTutorSessionText,
} from "@/lib/tutor/session-persistence";
import type {
  PracticeQuestion,
  TutorMode,
  TutorResponse,
  TutorSessionAttempt,
  TutorSessionRecord,
  TutorSource,
} from "@/lib/types";

/**
 * Sources that only an AI-help request ("Ask AI for help") can produce for a
 * course question. A plain answer check never escalates past the rule engine.
 */
const AI_HELP_SOURCES = new Set<TutorSource>(["retrieval", "llm", "cache"]);

export const REPEATED_AI_HELP_MESSAGE =
  "You already have help for this attempt. Try a new answer, and I can help further.";

/**
 * Detects a repeated AI-help request for an unchanged tutoring state. The
 * session's most recent completed attempt is the only durable witness of the
 * current state: if it was itself an AI-help reply for the same message, no
 * answer, hint, or solution transition has happened since. Any later attempt,
 * a different message, a different question, or a new session breaks the
 * match, so a legitimate follow-up request still proceeds.
 */
export function findRepeatedAiHelpAttempt(
  session: Pick<TutorSessionRecord, "attempts">,
  input: { answer: string; mode: TutorMode },
): TutorSessionAttempt | undefined {
  const last = [...session.attempts]
    .reverse()
    .find((attempt) => Boolean(attempt.verdict));

  if (
    !last ||
    last.mode !== input.mode ||
    last.verdict !== "guidance" ||
    !last.source ||
    !AI_HELP_SOURCES.has(last.source)
  ) {
    return undefined;
  }

  const previousAnswer = last.normalizedAnswer ?? last.submittedAnswer ?? "";
  const requestedAnswer =
    normalizedTutorAnswerForPersistence(input.answer) ??
    redactTutorSessionText(input.answer) ??
    "";

  return previousAnswer === requestedAnswer ? last : undefined;
}

/**
 * The reply for a repeated same-state request: no transition, no retrieval,
 * no provider call. Progress mirrors the saved session so the client stays in
 * sync.
 */
export function repeatedAiHelpResponse(
  session: TutorSessionRecord,
  question: PracticeQuestion,
): TutorResponse {
  const hintsRevealed = session.revealedHints ?? 0;
  const solved = session.solved ?? false;

  return {
    hints: [],
    message: REPEATED_AI_HELP_MESSAGE,
    misconceptions: [],
    progress: {
      attemptCount: session.attemptCount ?? session.attempts.length,
      hintsRevealed,
      llmUsed: session.llmUsed ?? false,
      retrievalUsed: session.retrievalUsed ?? false,
      solved,
      state: session.currentState ?? "working",
      stepsRevealed: session.revealedSteps ?? 0,
      wrongAttemptCount: session.wrongAttemptCount ?? 0,
    },
    retrievedContext: [],
    source: "rule",
    steps: [],
    usage: {
      contextUsed: false,
      estimatedTokens: 0,
      fallbackUsed: false,
      llmFallbackEligible: !solved && hintsRevealed >= question.hints.length,
    },
    verdict: "guidance",
  };
}
