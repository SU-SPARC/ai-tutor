import "server-only";

import type { AuthenticatedStudentAuthorization } from "@/lib/auth/authorization";
import { compareCanonicalTopicIds } from "@/lib/data/canonical-syllabus-topics";
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store";
import { listTutorSessionsForStudent } from "@/lib/data/tutor-session-repository";
import type { StudentProgressDashboard, TutorSessionRecord } from "@/lib/types";

const RECENT_SESSION_LIMIT = 8;

type QuestionProgress = StudentProgressDashboard["questions"][number];

type QuestionAccumulator = {
  attemptCount: number;
  completedAt?: string;
  correctAttempts: number;
  hintsUsed: number;
  incorrectAttempts: number;
  lastActiveAt: string;
  latestActiveAt?: string;
  latestActiveSessionId?: string;
  questionId: string;
  questionTitle: string;
  topicId: string;
  topicTitle: string;
};

type TopicAccumulator = Pick<
  StudentProgressDashboard["topics"][number],
  "completedQuestions" | "inProgressQuestions" | "needsAnotherAttempt"
>;

export async function getStudentProgress(
  authorization: AuthenticatedStudentAuthorization,
): Promise<StudentProgressDashboard> {
  const [{ mode, sessions }, questions, topics] = await Promise.all([
    listTutorSessionsForStudent(authorization),
    getApprovedQuestions(),
    getTopics(),
  ]);
  const orderedTopics = [...topics].sort(
    (left, right) =>
      compareCanonicalTopicIds(left.id, right.id) ||
      left.order - right.order ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
  const topicsById = new Map(orderedTopics.map((topic) => [topic.id, topic]));
  const orderedQuestions = [...questions].sort(
    (left, right) =>
      compareCanonicalTopicIds(left.topicId, right.topicId) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
  const questionsById = new Map(
    orderedQuestions.map((question) => [question.id, question]),
  );
  const progressByQuestion = aggregateQuestionProgress(
    sessions,
    questionsById,
    topicsById,
  );
  const questionProgress = [...progressByQuestion.values()]
    .map(toQuestionProgress)
    .sort(
      (left, right) =>
        compareCanonicalTopicIds(left.topicId, right.topicId) ||
        right.lastActiveAt.localeCompare(left.lastActiveAt) ||
        left.questionTitle.localeCompare(right.questionTitle) ||
        left.questionId.localeCompare(right.questionId),
    );
  const availableQuestionCountByTopic = new Map<string, number>();

  for (const question of orderedQuestions) {
    availableQuestionCountByTopic.set(
      question.topicId,
      (availableQuestionCountByTopic.get(question.topicId) ?? 0) + 1,
    );
  }

  const progressByTopic = new Map<string, TopicAccumulator>();
  let completedQuestions = 0;
  let inProgressQuestions = 0;
  let needsAnotherAttempt = 0;

  for (const question of questionProgress) {
    const topic = progressByTopic.get(question.topicId) ?? {
      completedQuestions: 0,
      inProgressQuestions: 0,
      needsAnotherAttempt: 0,
    };

    if (question.status === "completed") {
      completedQuestions += 1;
      topic.completedQuestions += 1;
    } else {
      inProgressQuestions += 1;
      topic.inProgressQuestions += 1;
    }

    if (question.needsAnotherAttempt) {
      needsAnotherAttempt += 1;
      topic.needsAnotherAttempt += 1;
    }

    progressByTopic.set(question.topicId, topic);
  }

  const topicProgress = orderedTopics.map((topic) => ({
    availableQuestions: availableQuestionCountByTopic.get(topic.id) ?? 0,
    completedQuestions: progressByTopic.get(topic.id)?.completedQuestions ?? 0,
    id: topic.id,
    inProgressQuestions:
      progressByTopic.get(topic.id)?.inProgressQuestions ?? 0,
    needsAnotherAttempt:
      progressByTopic.get(topic.id)?.needsAnotherAttempt ?? 0,
    title: topic.title,
  }));

  return {
    mode,
    questions: questionProgress,
    recentSessions: sessions
      .slice()
      .sort(
        (left, right) =>
          right.lastSeenAt.localeCompare(left.lastSeenAt) ||
          right.createdAt.localeCompare(left.createdAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, RECENT_SESSION_LIMIT)
      .flatMap((session) => {
        const question = questionsById.get(session.questionId);
        const topicId = question?.topicId ?? session.topicId;
        const topic = topicId ? topicsById.get(topicId) : undefined;

        if (!topicId || !topic) {
          return [];
        }

        const progress = progressByQuestion.get(session.questionId);
        const available = Boolean(question);

        return [
          {
            attemptCount: session.attempts.length,
            available,
            hintsUsed: session.revealedHints,
            lastSeenAt: session.lastSeenAt,
            needsAnotherAttempt: progress
              ? progress.correctAttempts === 0 && progress.incorrectAttempts > 0
              : false,
            questionId: session.questionId,
            questionTitle: available
              ? (session.questionTitle ?? question?.title ?? "Question")
              : "Unavailable question",
            sessionId: session.id,
            status: available
              ? progress && progress.correctAttempts > 0
                ? ("completed" as const)
                : ("in_progress" as const)
              : ("unavailable" as const),
            stepsRevealed: session.revealedSteps,
            topicId,
            topicTitle: topic.title,
          },
        ];
      }),
    summary: {
      availableQuestions: orderedQuestions.length,
      completedQuestions,
      hintsUsed: sessions.reduce(
        (total, session) => total + session.revealedHints,
        0,
      ),
      inProgressQuestions,
      needsAnotherAttempt,
      topicsStarted: topicProgress.filter(
        (topic) =>
          topic.completedQuestions > 0 || topic.inProgressQuestions > 0,
      ).length,
    },
    topics: topicProgress,
  };
}

function aggregateQuestionProgress(
  sessions: TutorSessionRecord[],
  questionsById: Map<
    string,
    Awaited<ReturnType<typeof getApprovedQuestions>>[number]
  >,
  topicsById: Map<string, Awaited<ReturnType<typeof getTopics>>[number]>,
) {
  const progressByQuestion = new Map<string, QuestionAccumulator>();

  for (const session of sessions) {
    const question = questionsById.get(session.questionId);
    const topic = question ? topicsById.get(question.topicId) : undefined;

    if (!question || !topic) {
      continue;
    }

    const current = progressByQuestion.get(question.id) ?? {
      attemptCount: 0,
      correctAttempts: 0,
      hintsUsed: 0,
      incorrectAttempts: 0,
      lastActiveAt: session.lastSeenAt,
      questionId: question.id,
      questionTitle: question.title,
      topicId: topic.id,
      topicTitle: topic.title,
    };
    current.attemptCount += session.attempts.length;
    current.hintsUsed += session.revealedHints;
    current.lastActiveAt = laterIsoDate(
      current.lastActiveAt,
      session.lastSeenAt,
    );

    for (const attempt of session.attempts) {
      if (attempt.verdict === "correct") {
        current.correctAttempts += 1;
        current.completedAt = current.completedAt
          ? earlierIsoDate(current.completedAt, attempt.createdAt)
          : attempt.createdAt;
      } else if (attempt.verdict === "incorrect") {
        current.incorrectAttempts += 1;
      }
    }

    if (
      session.status === "active" &&
      (!current.latestActiveAt || session.lastSeenAt > current.latestActiveAt)
    ) {
      current.latestActiveAt = session.lastSeenAt;
      current.latestActiveSessionId = session.id;
    }

    progressByQuestion.set(question.id, current);
  }

  return progressByQuestion;
}

function toQuestionProgress(progress: QuestionAccumulator): QuestionProgress {
  const completed = progress.correctAttempts > 0;

  return {
    attemptCount: progress.attemptCount,
    completedAt: progress.completedAt,
    hintsUsed: progress.hintsUsed,
    lastActiveAt: progress.lastActiveAt,
    needsAnotherAttempt: !completed && progress.incorrectAttempts > 0,
    questionId: progress.questionId,
    questionTitle: progress.questionTitle,
    resumeSessionId: progress.latestActiveSessionId,
    status: completed ? "completed" : "in_progress",
    topicId: progress.topicId,
    topicTitle: progress.topicTitle,
  };
}

function laterIsoDate(left: string, right: string) {
  return left >= right ? left : right;
}

function earlierIsoDate(left: string, right: string) {
  return left <= right ? left : right;
}
