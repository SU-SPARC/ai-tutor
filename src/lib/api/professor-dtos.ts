import type {
  InstructorAnalyticsDashboard,
  ProfessorAnalyticsDashboard,
  ProfessorPracticeAnalytics,
  ProfessorReviewAnalytics,
  ReviewCandidate,
} from "@/lib/types";

export type ProfessorReviewCandidateDto = Omit<
  ReviewCandidate,
  "misconceptions" | "review" | "source"
> & {
  misconceptions: Array<{ feedback: string; id: string }>;
  review: Pick<
    ReviewCandidate["review"],
    "notes" | "reviewPriority" | "status"
  >;
  source: Pick<
    ReviewCandidate["source"],
    "originalityNote" | "sourceType" | "trustLevel"
  >;
};

export type ProfessorAnalyticsDto = {
  instructor: InstructorAnalyticsDashboard;
  mode: ProfessorAnalyticsDashboard["mode"];
  practice: Pick<ProfessorPracticeAnalytics, "questions" | "topics">;
  review: ProfessorReviewAnalytics;
};

export function toProfessorReviewCandidateDto(
  candidate: ReviewCandidate,
): ProfessorReviewCandidateDto {
  return {
    answer: {
      ...candidate.answer,
      acceptedAnswers: [...candidate.answer.acceptedAnswers],
    },
    difficulty: candidate.difficulty,
    hints: [...candidate.hints],
    id: candidate.id,
    misconceptions: candidate.misconceptions.map(({ feedback, id }) => ({
      feedback,
      id,
    })),
    patternSource: candidate.patternSource,
    prompt: candidate.prompt,
    review: {
      notes: candidate.review.notes,
      reviewPriority: candidate.review.reviewPriority,
      status: candidate.review.status,
    },
    solutionSteps: [...candidate.solutionSteps],
    source: {
      originalityNote: candidate.source.originalityNote,
      sourceType: candidate.source.sourceType,
      trustLevel: candidate.source.trustLevel,
    },
    title: candidate.title,
    topic: candidate.topic,
    topicId: candidate.topicId,
  };
}

export function toProfessorAnalyticsDto(
  analytics: ProfessorAnalyticsDashboard,
): ProfessorAnalyticsDto {
  return {
    instructor: analytics.instructor,
    mode: analytics.mode,
    practice: {
      questions: analytics.practice.questions,
      topics: analytics.practice.topics,
    },
    review: analytics.review,
  };
}
