import "server-only";

import { getApprovedQuestionById } from "@/lib/data/data-store";
import type {
  TutorMode,
  TutorResponseLabel,
  TutorSessionRecord,
  TutorSource,
  TutorState,
  TutorVerdict,
} from "@/lib/types";

export type TutorSessionAttemptDto = {
  createdAt: string;
  fallbackUsed: boolean;
  misconceptionFeedback: string[];
  mode?: TutorMode;
  normalizedAnswer?: string;
  responseLabel?: TutorResponseLabel;
  source?: TutorSource;
  state?: TutorState;
  submittedAnswer?: string;
  verdict?: TutorVerdict;
};

export type TutorSessionDto = {
  aiFallbackUsed: boolean;
  attemptCount: number;
  attempts: TutorSessionAttemptDto[];
  completedAt?: string;
  createdAt?: string;
  currentState: TutorState;
  expiresAt?: string;
  id: string;
  lastSeenAt?: string;
  questionId: string;
  questionVersionId?: number;
  revealedHints: number;
  revealedSteps: number;
  revision: number;
  solved: boolean;
  wrongAttemptCount: number;
};

/**
 * Returns only the owned recovery state the browser needs. Internal owner ids,
 * answer fingerprints, retrieval context, model prompts, and provider payloads
 * never cross this boundary.
 */
export function toTutorSessionDto(
  session: Pick<TutorSessionRecord, "id" | "questionId"> &
    Partial<TutorSessionRecord>,
): TutorSessionDto {
  return {
    aiFallbackUsed:
      (session.llmUsed ?? false) ||
      (session.attempts ?? []).some((attempt) => attempt.fallbackUsed),
    attemptCount: session.attemptCount ?? session.attempts?.length ?? 0,
    attempts: (session.attempts ?? []).map((attempt) => ({
      createdAt: attempt.createdAt,
      fallbackUsed: attempt.fallbackUsed ?? false,
      misconceptionFeedback: [...(attempt.misconceptionFeedback ?? [])],
      mode: attempt.mode,
      normalizedAnswer: attempt.normalizedAnswer,
      responseLabel: attempt.responseLabel,
      source: attempt.source,
      state: attempt.state,
      submittedAnswer: attempt.submittedAnswer,
      verdict: attempt.verdict,
    })),
    completedAt: session.completedAt,
    createdAt: session.createdAt,
    currentState: session.currentState ?? "working",
    expiresAt: session.expiresAt,
    id: session.id,
    lastSeenAt: session.lastSeenAt,
    questionId: session.questionId,
    questionVersionId: session.questionVersionId,
    revealedHints: session.revealedHints ?? 0,
    revealedSteps: session.revealedSteps ?? 0,
    revision: session.revision ?? 0,
    solved: session.solved ?? false,
    wrongAttemptCount: session.wrongAttemptCount ?? 0,
  };
}

/**
 * Student APIs conceal sessions whose question is no longer student-facing,
 * while preserving their server-side audit and retention lifecycle.
 */
export async function toStudentTutorSessionDto(session: TutorSessionRecord) {
  if (session.status === "content_unpublished") {
    return undefined;
  }
  const question = await getApprovedQuestionById(session.questionId);
  return question ? toTutorSessionDto(session) : undefined;
}
