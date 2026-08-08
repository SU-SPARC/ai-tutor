import "server-only";

import { getApprovedQuestions, getTopics } from "@/lib/data/data-store";
import { listTutorSessionsForStudent } from "@/lib/data/tutor-session-repository";
import type { StudentProgressDashboard } from "@/lib/types";
import type { StudentAuthorization } from "@/lib/auth/authorization";

const RECENT_SESSION_LIMIT = 8;

export async function getStudentProgress(
  authorization: StudentAuthorization,
): Promise<StudentProgressDashboard> {
  const [{ mode, sessions }, questions, topics] = await Promise.all([
    listTutorSessionsForStudent(authorization),
    getApprovedQuestions(),
    getTopics(),
  ]);
  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const activeSessions = sessions.filter(
    (session) =>
      session.attempts.length > 0 ||
      session.revealedHints > 0 ||
      session.revealedSteps > 0,
  );
  const attemptedQuestionIds = new Set<string>();
  const practicedTopicIds = new Set<string>();
  let correctAttempts = 0;
  let hintsUsed = 0;
  let stepsRevealed = 0;

  for (const session of activeSessions) {
    const question = questionsById.get(session.questionId);
    const topicId = question?.topicId ?? session.topicId;

    if (!topicId) {
      continue;
    }

    if (session.attempts.length > 0) {
      attemptedQuestionIds.add(session.questionId);
    }

    practicedTopicIds.add(topicId);
    correctAttempts += session.attempts.filter(
      (attempt) => attempt.verdict === "correct",
    ).length;
    hintsUsed += session.revealedHints;
    stepsRevealed += session.revealedSteps;
  }

  return {
    mode,
    recentSessions: activeSessions
      .flatMap((session) => {
        const question = questionsById.get(session.questionId);
        const topicId = question?.topicId ?? session.topicId;
        const topic = topicId ? topicsById.get(topicId) : undefined;

        if (!topic) {
          return [];
        }

        return [
          {
            attemptCount: session.attempts.length,
            correctAttempts: session.attempts.filter(
              (attempt) => attempt.verdict === "correct",
            ).length,
            hintsUsed: session.revealedHints,
            lastSeenAt: session.lastSeenAt,
            questionId: session.questionId,
            questionTitle:
              session.status === "content_unpublished"
                ? "Unavailable question"
                : (question?.title ?? session.questionTitle ?? "Question"),
            stepsRevealed: session.revealedSteps,
            topicId: topic.id,
            topicTitle: topic.title,
          },
        ];
      })
      .slice(0, RECENT_SESSION_LIMIT),
    summary: {
      attemptedQuestions: attemptedQuestionIds.size,
      correctAttempts,
      hintsUsed,
      stepsRevealed,
      topicsPracticed: practicedTopicIds.size,
    },
    topics: topics
      .filter((topic) => practicedTopicIds.has(topic.id))
      .map(({ id, title }) => ({ id, title })),
  };
}
