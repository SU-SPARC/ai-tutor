import "server-only";

import { createHash } from "node:crypto";

import type { StudentAuthorization } from "@/lib/auth/authorization";
import { getApprovedQuestionById } from "@/lib/data/data-store";
import {
  listEligibleSimilarQuestionsForOrigin,
  type LinkedReservePracticeCandidate,
} from "@/lib/data/question-similarity-repository";
import {
  createReservePracticeTutorSession,
  getTutorSession,
  listTutorSessionsForStudent,
  ReservePracticeEligibilityChangedError,
} from "@/lib/data/tutor-session-repository";
import { similarProblemOriginQualifies } from "@/lib/tutor/practice-credit";
export type SimilarReservePracticeResult =
  | {
      candidate: LinkedReservePracticeCandidate;
      outcome: "match";
      sessionId: string;
    }
  | { outcome: "none" }
  | { outcome: "not_completed" }
  | { outcome: "session_unavailable" };

export async function startSimilarReservePractice(
  authorization: StudentAuthorization,
  originSessionId: string,
): Promise<SimilarReservePracticeResult> {
  const origin = await getTutorSession(authorization, originSessionId);
  if (!origin) return { outcome: "session_unavailable" };

  // Dedicated similar practice is defined only from an assigned, published
  // origin. Reserve-to-Reserve chaining is intentionally unsupported.
  if (
    (origin.practiceContext ?? "published") !== "published" ||
    !origin.questionVersionId
  ) {
    return { outcome: "session_unavailable" };
  }

  const [currentQuestion, candidates, studentSessions] = await Promise.all([
    getApprovedQuestionById(origin.questionId),
    listEligibleSimilarQuestionsForOrigin(
      origin.questionId,
      origin.questionVersionId,
    ),
    listTutorSessionsForStudent(authorization),
  ]);
  if (!currentQuestion) return { outcome: "session_unavailable" };
  // The same rule the database trigger applies: a solved origin, or the
  // partial-credit route (three valid attempts and the worked solution).
  if (
    !similarProblemOriginQualifies({
      origin,
      stepCount: (origin.questionVersion ?? currentQuestion).solutionSteps
        .length,
      studentSessions: studentSessions.sessions,
    })
  ) {
    return { outcome: "not_completed" };
  }

  const practicedQuestionIds = new Set(
    studentSessions.sessions.map((session) => session.questionId),
  );
  const candidate = rankLinkedSimilarPracticeQuestions({
    candidates,
    practicedQuestionIds,
  })[0];
  if (!candidate) return { outcome: "none" };

  const idempotencyKey = createHash("sha256")
    .update(`reserve-practice:${originSessionId}:${candidate.question.id}`)
    .digest("hex");
  let session;
  try {
    session = await createReservePracticeTutorSession(authorization, {
      idempotencyKey,
      originSessionId,
      questionId: candidate.question.id,
      questionVersionId: candidate.versionId,
    });
  } catch (cause) {
    if (cause instanceof ReservePracticeEligibilityChangedError) {
      return { outcome: "none" };
    }
    throw cause;
  }

  return { candidate, outcome: "match", sessionId: session.id };
}

export function rankLinkedSimilarPracticeQuestions({
  candidates,
  practicedQuestionIds,
}: {
  candidates: LinkedReservePracticeCandidate[];
  practicedQuestionIds: ReadonlySet<string>;
}) {
  return [...candidates].sort(
    (left, right) =>
      Number(practicedQuestionIds.has(left.question.id)) -
        Number(practicedQuestionIds.has(right.question.id)) ||
      left.slot - right.slot ||
      left.reservedAt.localeCompare(right.reservedAt) ||
      left.question.id.localeCompare(right.question.id),
  );
}
