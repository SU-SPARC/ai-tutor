import "server-only";

import { createHash } from "node:crypto";

import type { StudentAuthorization } from "@/lib/auth/authorization";
import { getApprovedQuestionById } from "@/lib/data/data-store";
import {
  getEligibleReservePracticeQuestion,
  listEligibleReservePracticeQuestions,
  type ReservePracticeCandidate,
} from "@/lib/data/reserve-practice-repository";
import {
  createReservePracticeTutorSession,
  getTutorSession,
  listTutorSessionsForStudent,
  ReservePracticeEligibilityChangedError,
} from "@/lib/data/tutor-session-repository";
import type { TutorQuestion } from "@/lib/types";

export type SimilarReservePracticeResult =
  | {
      candidate: ReservePracticeCandidate;
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
  if (!origin.solved && origin.status !== "completed") {
    return { outcome: "not_completed" };
  }

  const [publicQuestion, reserveOrigin, candidates, studentSessions] =
    await Promise.all([
      getApprovedQuestionById(origin.questionId),
      origin.practiceContext === "reserve_practice" && origin.questionVersionId
        ? getEligibleReservePracticeQuestion(
            origin.questionId,
            origin.questionVersionId,
          )
        : Promise.resolve(undefined),
      listEligibleReservePracticeQuestions(),
      listTutorSessionsForStudent(authorization),
    ]);
  const currentQuestion =
    origin.practiceContext === "reserve_practice"
      ? reserveOrigin?.question
      : publicQuestion;
  if (!currentQuestion) return { outcome: "session_unavailable" };

  const practicedQuestionIds = new Set(
    studentSessions.sessions.map((session) => session.questionId),
  );
  const candidate = rankSimilarReservePracticeQuestions({
    candidates,
    currentQuestion,
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

export function rankSimilarReservePracticeQuestions({
  candidates,
  currentQuestion,
  practicedQuestionIds,
}: {
  candidates: ReservePracticeCandidate[];
  currentQuestion: TutorQuestion;
  practicedQuestionIds: ReadonlySet<string>;
}) {
  return candidates
    .filter(
      (candidate) =>
        candidate.question.id !== currentQuestion.id &&
        candidate.question.topicId === currentQuestion.topicId,
    )
    .map((candidate) => ({
      candidate,
      score: similarityScore(
        currentQuestion,
        candidate.question,
        practicedQuestionIds,
      ),
    }))
    .sort(
      (left, right) =>
        compareScore(right.score, left.score) ||
        left.candidate.reservedAt.localeCompare(right.candidate.reservedAt) ||
        left.candidate.question.id.localeCompare(right.candidate.question.id),
    )
    .map(({ candidate }) => candidate);
}

function similarityScore(
  current: TutorQuestion,
  candidate: TutorQuestion,
  practicedQuestionIds: ReadonlySet<string>,
) {
  return [
    Number(candidate.difficulty === current.difficulty),
    Number(hasSharedPattern(current, candidate)),
    sharedMisconceptionCount(current, candidate),
    Number(!practicedQuestionIds.has(candidate.id)),
  ] as const;
}

function compareScore(left: readonly number[], right: readonly number[]) {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

function hasSharedPattern(left: TutorQuestion, right: TutorQuestion) {
  const leftIds = new Set(left.source.patternIds ?? []);
  return (right.source.patternIds ?? []).some((id) => leftIds.has(id));
}

function sharedMisconceptionCount(left: TutorQuestion, right: TutorQuestion) {
  const leftIds = new Set(left.misconceptions.map(({ id }) => id));
  return right.misconceptions.reduce(
    (count, misconception) => count + Number(leftIds.has(misconception.id)),
    0,
  );
}
