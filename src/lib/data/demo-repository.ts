import "server-only";

import {
  assertAuthorization,
  isPublishedContent,
  isStudentSafeRetrievalContent,
  reviewerAttribution,
} from "@/lib/auth/authorization";
import {
  demoQuestions,
  demoTopics,
  retrievalChunks,
  reviewCandidates,
} from "@/lib/data/demo-data";
import {
  type AdminQuestionFilters,
  reviewStatusForAction,
  type ContentRepository,
  type QuestionCounts,
  type ReviewAction,
  type ReviewCandidateUpdate,
  type ReviewQueueFilters,
} from "@/lib/data/repository";
import {
  type GeneratedQuestionReviewOutcomes,
  type AdminQuestion,
  type ProfessorPracticeAnalytics,
  type ReviewCandidate,
  type TutorQuestion,
} from "@/lib/types";
import { emptyGeneratedQuestionReviewOutcomes } from "@/lib/tutor/professor-admin";

let reviewQueue: ReviewCandidate[] = reviewCandidates.map(cloneReviewCandidate);

export const demoContentRepository: ContentRepository = {
  async getAdminQuestions(authorization, filters) {
    assertAuthorization(authorization, "administrator");
    return filterAdminQuestions(
      [
        ...demoQuestions.map(adminQuestionFromTutorQuestion),
        ...reviewQueue.map(adminQuestionFromReviewCandidate),
      ],
      filters,
    ).map(cloneAdminQuestion);
  },

  async getQuestionById(questionId) {
    return listDemoQuestions().find((question) => question.id === questionId);
  },

  async getApprovedQuestionById(questionId) {
    return this.getQuestionById(questionId);
  },

  async getApprovedQuestions() {
    return this.listQuestions();
  },

  async getQuestionCounts() {
    return getQuestionCounts(listDemoQuestions());
  },

  async getProfessorPracticeAnalytics(authorization) {
    assertAuthorization(authorization, "analytics");
    return getDemoProfessorPracticeAnalytics();
  },

  async getRetrievalChunks() {
    return retrievalChunks.filter(isStudentSafeRetrievalContent);
  },

  async getReviewQueue(authorization, filters) {
    switch (authorization.permission) {
      case "administrator":
        assertAuthorization(authorization, "administrator");
        break;
      case "analytics":
        assertAuthorization(authorization, "analytics");
        break;
      default:
        assertAuthorization(authorization, "professor-review");
    }
    return filterReviewQueue(reviewQueue, filters).map(cloneReviewCandidate);
  },

  async getTopics() {
    return this.listTopics();
  },

  async importReviewCandidates(authorization, candidates) {
    assertAuthorization(authorization, "professor-review");
    const incoming = candidates.map(cloneReviewCandidate);
    const incomingIds = new Set(incoming.map((candidate) => candidate.id));
    reviewQueue = [
      ...reviewQueue.filter((candidate) => !incomingIds.has(candidate.id)),
      ...incoming,
    ];

    return {
      candidates: incoming.map(cloneReviewCandidate),
      imported: true,
      message:
        "Imported into the demo review queue. This import is non-durable and resets with the dev server.",
      mode: "demo",
      nonDurable: true,
    };
  },

  async listQuestions() {
    return listDemoQuestions();
  },

  async listQuestionsByTopic(topicId) {
    return listDemoQuestions().filter(
      (question) => question.topicId === topicId,
    );
  },

  async listTopics() {
    return demoTopics;
  },

  async updateReviewCandidates(authorization, input: ReviewCandidateUpdate) {
    assertAuthorization(authorization, "professor-review");
    const reviewer = reviewerAttribution(authorization);
    const ids = new Set(input.candidateIds);
    const updated: ReviewCandidate[] = [];

    reviewQueue = reviewQueue.map((candidate) => {
      if (!ids.has(candidate.id)) {
        return candidate;
      }

      const status = input.action
        ? reviewStatusForAction(input.action)
        : candidate.review.status;
      const next: ReviewCandidate = {
        ...candidate,
        difficulty: input.difficulty ?? candidate.difficulty,
        topicId: input.topicId ?? candidate.topicId,
        review: {
          ...candidate.review,
          notes: input.notes ?? candidate.review.notes,
          reviewedAt: input.action
            ? new Date().toISOString()
            : candidate.review.reviewedAt,
          reviewedBy:
            input.action || input.notes !== undefined
              ? reviewer.displayName
              : candidate.review.reviewedBy,
          reviewPriority:
            input.reviewPriority ?? candidate.review.reviewPriority ?? "normal",
          status,
        },
        source: {
          ...candidate.source,
          trustLevel:
            status === "approved"
              ? "professor_approved"
              : candidate.source.trustLevel,
        },
      };

      updated.push(cloneReviewCandidate(next));
      return next;
    });

    return updated;
  },

  async updateAdminQuestions(authorization) {
    assertAuthorization(authorization, "administrator");
    return [];
  },

  async regenerateAdminQuestion(authorization) {
    assertAuthorization(authorization, "administrator");
    return undefined;
  },

  async updateAdminQuestionDetail(authorization) {
    assertAuthorization(authorization, "administrator");
    return undefined;
  },

  async updateReviewCandidateStatus(
    authorization,
    candidateId: string,
    action: ReviewAction,
  ) {
    assertAuthorization(authorization, "professor-review");
    const updated = await this.updateReviewCandidates(authorization, {
      action,
      candidateIds: [candidateId],
    });

    return updated[0];
  },
};

function listDemoQuestions() {
  return demoQuestions.filter(isPublishedContent);
}

function getQuestionCounts(questions: TutorQuestion[]): QuestionCounts {
  return questions.reduce<QuestionCounts>(
    (counts, question) => {
      counts.total += 1;
      counts.byTopic[question.topicId] =
        (counts.byTopic[question.topicId] ?? 0) + 1;
      return counts;
    },
    {
      byTopic: {},
      total: 0,
    },
  );
}

function getDemoProfessorPracticeAnalytics() {
  const questionStats = [
    {
      attempts: 22,
      correctAttempts: 14,
      hintsUsed: 12,
      llmAttempts: 2,
      stepsRevealed: 7,
    },
    {
      attempts: 18,
      correctAttempts: 10,
      hintsUsed: 9,
      llmAttempts: 1,
      stepsRevealed: 6,
    },
    {
      attempts: 14,
      correctAttempts: 11,
      hintsUsed: 4,
      llmAttempts: 0,
      stepsRevealed: 3,
    },
  ];
  const questions = demoQuestions.map((question, index) => {
    const stats = questionStats[index % questionStats.length];
    const topicTitle =
      demoTopics.find((topic) => topic.id === question.topicId)?.title ??
      question.topicId;

    return {
      ...stats,
      questionId: question.id,
      questionTitle: question.title,
      topicId: question.topicId,
      topicTitle,
    };
  });
  const byTopic = new Map<
    string,
    ProfessorPracticeAnalytics["topics"][number]
  >();

  for (const question of questions) {
    const current = byTopic.get(question.topicId) ?? {
      attempts: 0,
      correctAttempts: 0,
      hintsUsed: 0,
      llmAttempts: 0,
      stepsRevealed: 0,
      topicId: question.topicId,
      topicTitle: question.topicTitle,
    };

    current.attempts += question.attempts;
    current.correctAttempts += question.correctAttempts;
    current.hintsUsed += question.hintsUsed;
    current.llmAttempts += question.llmAttempts;
    current.stepsRevealed += question.stepsRevealed;
    byTopic.set(question.topicId, current);
  }

  return {
    commonMisconceptions: questions.flatMap((question) => {
      const source = demoQuestions.find(
        (item) => item.id === question.questionId,
      );
      const missedAttempts = Math.max(
        0,
        question.attempts - question.correctAttempts,
      );

      return (
        source?.misconceptions.map((misconception) => ({
          feedback: misconception.feedback,
          misconceptionId: misconception.id,
          missedAttempts,
          questionId: question.questionId,
          questionTitle: question.questionTitle,
          topicId: question.topicId,
          topicTitle: question.topicTitle,
        })) ?? []
      );
    }),
    generatedQuestionOutcomes: demoGeneratedQuestionOutcomes(),
    mode: "demo" as const,
    questions,
    summary: {
      totalAttempts: questions.reduce(
        (total, question) => total + question.attempts,
        0,
      ),
      totalHintsUsed: questions.reduce(
        (total, question) => total + question.hintsUsed,
        0,
      ),
      totalStepsRevealed: questions.reduce(
        (total, question) => total + question.stepsRevealed,
        0,
      ),
      totalTutorSessions: 26,
    },
    topics: [...byTopic.values()],
  };
}

function demoGeneratedQuestionOutcomes(): GeneratedQuestionReviewOutcomes {
  return reviewQueue.reduce((counts, candidate) => {
    counts[candidate.review.status] += 1;
    return counts;
  }, emptyGeneratedQuestionReviewOutcomes());
}

export function resetDemoReviewQueueForTests() {
  reviewQueue = reviewCandidates.map(cloneReviewCandidate);
}

export {
  isPublishedContent as isStudentFacingQuestion,
  isStudentSafeRetrievalContent as isStudentFacingRetrievalChunk,
};

function filterReviewQueue(
  candidates: ReviewCandidate[],
  filters: ReviewQueueFilters = {},
) {
  return candidates.filter((candidate) => {
    if (filters.status && candidate.review.status !== filters.status) {
      return false;
    }

    if (
      filters.reviewPriority &&
      (candidate.review.reviewPriority ?? "normal") !== filters.reviewPriority
    ) {
      return false;
    }

    if (filters.difficulty && candidate.difficulty !== filters.difficulty) {
      return false;
    }

    if (filters.topicId && candidate.topicId !== filters.topicId) {
      return false;
    }

    return true;
  });
}

function filterAdminQuestions(
  questions: AdminQuestion[],
  filters: AdminQuestionFilters = {},
) {
  return questions.filter((question) => {
    if (filters.status && question.review.status !== filters.status) {
      return false;
    }

    if (filters.topicId && question.topicId !== filters.topicId) {
      return false;
    }

    if (
      filters.sourceType &&
      question.source.sourceType !== filters.sourceType
    ) {
      return false;
    }

    if (
      filters.generatedOnly &&
      !["generated_original", "pattern_derived_original"].includes(
        question.source.sourceType,
      )
    ) {
      return false;
    }

    return true;
  });
}

function adminQuestionFromTutorQuestion(
  question: TutorQuestion,
): AdminQuestion {
  return {
    ...question,
    topicTitle:
      demoTopics.find((topic) => topic.id === question.topicId)?.title ??
      question.topicId,
  };
}

function adminQuestionFromReviewCandidate(
  candidate: ReviewCandidate,
): AdminQuestion {
  return {
    ...candidate,
    patternSource: candidate.patternSource,
    topicTitle:
      candidate.topic ??
      demoTopics.find((topic) => topic.id === candidate.topicId)?.title ??
      candidate.topicId,
  };
}

function cloneReviewCandidate(candidate: ReviewCandidate): ReviewCandidate {
  return {
    ...candidate,
    answer: {
      ...candidate.answer,
      acceptedAnswers: [...candidate.answer.acceptedAnswers],
    },
    hints: [...candidate.hints],
    misconceptions: candidate.misconceptions.map((misconception) => ({
      ...misconception,
      matchTerms: [...misconception.matchTerms],
    })),
    review: { ...candidate.review },
    solutionSteps: [...candidate.solutionSteps],
    source: {
      ...candidate.source,
      patternIds: candidate.source.patternIds
        ? [...candidate.source.patternIds]
        : undefined,
    },
  };
}

function cloneAdminQuestion(question: AdminQuestion): AdminQuestion {
  return {
    ...question,
    answer: {
      ...question.answer,
      acceptedAnswers: [...question.answer.acceptedAnswers],
    },
    hints: [...question.hints],
    misconceptions: question.misconceptions.map((misconception) => ({
      ...misconception,
      matchTerms: [...misconception.matchTerms],
    })),
    review: { ...question.review },
    solutionSteps: [...question.solutionSteps],
    source: {
      ...question.source,
      patternIds: question.source.patternIds
        ? [...question.source.patternIds]
        : undefined,
    },
  };
}
