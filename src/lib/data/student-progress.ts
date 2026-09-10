import "server-only";

import type { AuthenticatedStudentAuthorization } from "@/lib/auth/authorization";
import { compareCanonicalTopicIds } from "@/lib/data/canonical-syllabus-topics";
import { getApprovedQuestions, getTopics } from "@/lib/data/data-store";
import { listTutorSessionsForStudent } from "@/lib/data/tutor-session-repository";
import { isMeaningfulTutorSession } from "@/lib/tutor/session-engagement";
import type { StudentProgressDashboard, TutorSessionRecord } from "@/lib/types";

const RECENT_SESSION_LIMIT = 8;

type QuestionProgress = StudentProgressDashboard["questions"][number];

type QuestionAccumulator = {
  attemptCount: number;
  available: boolean;
  completed: boolean;
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
  | "completedQuestions"
  | "inProgressQuestions"
  | "needsAnotherAttempt"
  | "previouslyCompletedQuestions"
>;

const EARLIER_COURSE_CONTENT = "Earlier course content";

function isAnswerAttempt(
  attempt: TutorSessionRecord["attempts"][number],
) {
  return attempt.mode === "check" || attempt.mode === undefined;
}

export async function getStudentProgress(
  authorization: AuthenticatedStudentAuthorization,
): Promise<StudentProgressDashboard> {
  const [{ mode, sessions: retainedSessions }, questions, topics] =
    await Promise.all([
      listTutorSessionsForStudent(authorization, { engagedOnly: true }),
      getApprovedQuestions(),
      getTopics(),
    ]);
  const sessions = retainedSessions.filter(isMeaningfulTutorSession);
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
  const assignedSessions = sessions.filter(
    (session) => session.practiceContext !== "reserve_practice",
  );
  const progressByQuestion = aggregateQuestionProgress(
    assignedSessions,
    questionsById,
    topicsById,
  );
  const questionProgress = [...progressByQuestion.values()]
    .map(toQuestionProgress)
    .filter(
      (question) => question.available || question.status === "completed",
    )
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
  let availableCompletedQuestions = 0;
  let inProgressQuestions = 0;
  let needsAnotherAttempt = 0;
  let previouslyCompletedQuestions = 0;

  for (const question of questionProgress) {
    const topic = progressByTopic.get(question.topicId) ?? {
      completedQuestions: 0,
      inProgressQuestions: 0,
      needsAnotherAttempt: 0,
      previouslyCompletedQuestions: 0,
    };

    if (question.status === "completed") {
      completedQuestions += 1;
      if (question.available) {
        availableCompletedQuestions += 1;
        topic.completedQuestions += 1;
      } else {
        previouslyCompletedQuestions += 1;
        topic.previouslyCompletedQuestions += 1;
      }
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
    previouslyCompletedQuestions:
      progressByTopic.get(topic.id)?.previouslyCompletedQuestions ?? 0,
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
        const reserveQuestion =
          session.practiceContext === "reserve_practice"
            ? session.questionVersion
            : undefined;
        const snapshotTitle =
          session.questionTitle ?? session.questionVersion?.title;
        const topicId =
          question?.topicId ??
          reserveQuestion?.topicId ??
          session.topicId ??
          session.questionVersion?.topicId;
        const topic = topicId ? topicsById.get(topicId) : undefined;

        if (!topicId || (!question && !reserveQuestion && !snapshotTitle)) {
          return [];
        }

        const progress = progressByQuestion.get(session.questionId);
        const available =
          session.status !== "content_unpublished" &&
          Boolean(
            topic &&
              (question ||
                (session.practiceContext === "reserve_practice" &&
                  reserveQuestion)),
          );
        const reserveCorrect = session.attempts.some(
          (attempt) => attempt.verdict === "correct",
        );
        const reserveIncorrect = session.attempts.some(
          (attempt) => attempt.verdict === "incorrect",
        );
        const completed =
          session.practiceContext === "reserve_practice"
            ? Boolean(session.solved || session.status === "completed")
            : Boolean(
                progress &&
                  (progress.completed || progress.correctAttempts > 0),
              );

        return [
          {
            attemptCount: session.attempts.filter(isAnswerAttempt).length,
            available,
            hintsUsed: session.revealedHints,
            lastSeenAt: session.lastSeenAt,
            needsAnotherAttempt:
              available &&
              (progress
                ? !progress.completed &&
                  progress.correctAttempts === 0 &&
                  progress.incorrectAttempts > 0
                : reserveIncorrect && !reserveCorrect),
            questionId: session.questionId,
            questionTitle:
              question?.title ??
              reserveQuestion?.title ??
              snapshotTitle ??
              "Earlier practice question",
            practiceContext: session.practiceContext ?? "published",
            sessionId: session.id,
            status: available
              ? completed
                ? ("completed" as const)
                : ("in_progress" as const)
              : ("unavailable" as const),
            stepsRevealed: session.revealedSteps,
            topicId,
            topicTitle: topic?.title ?? EARLIER_COURSE_CONTENT,
          },
        ];
      }),
    summary: {
      availableCompletedQuestions,
      availableQuestions: orderedQuestions.length,
      completedQuestions,
      extraPracticeSessions: sessions.filter(
        (session) => session.practiceContext === "reserve_practice",
      ).length,
      hintsUsed: assignedSessions.reduce(
        (total, session) => total + session.revealedHints,
        0,
      ),
      inProgressQuestions,
      needsAnotherAttempt,
      previouslyCompletedQuestions,
      topicsStarted: topicProgress.filter(
        (topic) =>
          topic.completedQuestions > 0 ||
          topic.inProgressQuestions > 0 ||
          topic.previouslyCompletedQuestions > 0,
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
    const questionTitle =
      question?.title ?? session.questionTitle ?? session.questionVersion?.title;
    const topicId =
      question?.topicId ?? session.topicId ?? session.questionVersion?.topicId;
    const topic = topicId ? topicsById.get(topicId) : undefined;

    if (!questionTitle || !topicId) {
      continue;
    }

    const available = Boolean(question && topic);
    const current = progressByQuestion.get(session.questionId) ?? {
      attemptCount: 0,
      available,
      completed: false,
      correctAttempts: 0,
      hintsUsed: 0,
      incorrectAttempts: 0,
      lastActiveAt: session.lastSeenAt,
      questionId: session.questionId,
      questionTitle,
      topicId,
      topicTitle: topic?.title ?? EARLIER_COURSE_CONTENT,
    };
    current.attemptCount += session.attempts.filter(isAnswerAttempt).length;
    current.hintsUsed += session.revealedHints;
    current.lastActiveAt = laterIsoDate(
      current.lastActiveAt,
      session.lastSeenAt,
    );

    if (session.solved || session.status === "completed") {
      current.completed = true;
      const completedAt = session.completedAt ?? session.lastSeenAt;
      current.completedAt = current.completedAt
        ? earlierIsoDate(current.completedAt, completedAt)
        : completedAt;
    }

    for (const attempt of session.attempts.filter(isAnswerAttempt)) {
      if (attempt.verdict === "correct") {
        current.completed = true;
        current.correctAttempts += 1;
        current.completedAt = current.completedAt
          ? earlierIsoDate(current.completedAt, attempt.createdAt)
          : attempt.createdAt;
      } else if (attempt.verdict === "incorrect") {
        current.incorrectAttempts += 1;
      }
    }

    if (
      available &&
      session.status === "active" &&
      (!current.latestActiveAt || session.lastSeenAt > current.latestActiveAt)
    ) {
      current.latestActiveAt = session.lastSeenAt;
      current.latestActiveSessionId = session.id;
    }

    progressByQuestion.set(session.questionId, current);
  }

  return progressByQuestion;
}

function toQuestionProgress(progress: QuestionAccumulator): QuestionProgress {
  const completed = progress.completed || progress.correctAttempts > 0;

  return {
    attemptCount: progress.attemptCount,
    available: progress.available,
    completedAt: progress.completedAt,
    hintsUsed: progress.hintsUsed,
    lastActiveAt: progress.lastActiveAt,
    needsAnotherAttempt:
      progress.available && !completed && progress.incorrectAttempts > 0,
    questionId: progress.questionId,
    questionTitle: progress.questionTitle,
    resumeSessionId: progress.available
      ? progress.latestActiveSessionId
      : undefined,
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
