import "server-only";

import type { StudentAuthorization } from "@/lib/auth/authorization";
import { isPublishedContent } from "@/lib/auth/authorization";
import {
  getApprovedQuestionById,
  getApprovedQuestions,
} from "@/lib/data/data-store";
import {
  getTutorSession,
  listTutorSessionsForStudent,
} from "@/lib/data/tutor-session-repository";
import type { SimilarPublishedQuestionDto, TutorQuestion } from "@/lib/types";

export type SimilarPublishedQuestionResult =
  | { outcome: "match"; question: SimilarPublishedQuestionDto }
  | { outcome: "none" }
  | { outcome: "not_completed" }
  | { outcome: "session_unavailable" };

/**
 * Finds a public, currently available follow-up using only existing content.
 * Full question metadata stays on the server; the browser receives a routing
 * summary and creates the next session through the normal session endpoint.
 */
export async function findSimilarPublishedQuestion(
  authorization: StudentAuthorization,
  sessionId: string,
): Promise<SimilarPublishedQuestionResult> {
  const session = await getTutorSession(authorization, sessionId);
  if (!session) return { outcome: "session_unavailable" };
  if (!session.solved && session.status !== "completed") {
    return { outcome: "not_completed" };
  }

  const [currentPublicQuestion, publishedQuestions, studentSessions] =
    await Promise.all([
      getApprovedQuestionById(session.questionId),
      getApprovedQuestions(),
      listTutorSessionsForStudent(authorization),
    ]);
  const currentQuestion = session.questionVersion ?? currentPublicQuestion;
  if (!currentQuestion) return { outcome: "none" };

  const completedQuestionIds = new Set(
    studentSessions.sessions
      .filter(
        (candidate) => candidate.solved || candidate.status === "completed",
      )
      .map((candidate) => candidate.questionId),
  );
  const question = rankSimilarPublishedQuestions({
    candidates: publishedQuestions,
    completedQuestionIds,
    currentQuestion,
  })[0];

  return question
    ? {
        outcome: "match",
        question: {
          difficulty: question.difficulty,
          questionId: question.id,
          title: question.title,
          topicId: question.topicId,
        },
      }
    : { outcome: "none" };
}

export function rankSimilarPublishedQuestions({
  candidates,
  completedQuestionIds,
  currentQuestion,
}: {
  candidates: TutorQuestion[];
  completedQuestionIds: ReadonlySet<string>;
  currentQuestion: TutorQuestion;
}) {
  return candidates
    .filter(
      (candidate) =>
        candidate.id !== currentQuestion.id &&
        candidate.topicId === currentQuestion.topicId &&
        isPublishedContent(candidate),
    )
    .map((candidate) => ({
      candidate,
      score: similarityScore(currentQuestion, candidate, completedQuestionIds),
    }))
    .sort(
      (left, right) =>
        compareScore(right.score, left.score) ||
        left.candidate.id.localeCompare(right.candidate.id),
    )
    .map(({ candidate }) => candidate);
}

function similarityScore(
  current: TutorQuestion,
  candidate: TutorQuestion,
  completedQuestionIds: ReadonlySet<string>,
) {
  return [
    Number(candidate.difficulty === current.difficulty),
    Number(hasSharedPattern(current, candidate)),
    sharedMisconceptionCount(current, candidate),
    Number(!completedQuestionIds.has(candidate.id)),
  ] as const;
}

function compareScore(
  left: ReturnType<typeof similarityScore>,
  right: ReturnType<typeof similarityScore>,
) {
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
