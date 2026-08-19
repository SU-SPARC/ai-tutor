import type {
  ProfessorQuestionReviewDashboard,
  QuestionLifecycleDashboard,
  QuestionLifecycleEventAction,
  StudentContentAvailabilityDashboard,
  StudentContentReleaseState,
} from "@/lib/types";

/**
 * Counts for the workspace pipeline strip.
 *
 * These buckets deliberately overlap: a question can carry a published
 * version *and* a working draft, so `published` and `drafts` can both
 * include it. The strip reads as "how much sits at each stage", not as a
 * partition of the catalog, and the labels in the UI say so.
 */
export type ProfessorWorkspacePipeline = {
  approvedNotPublished: number;
  archived: number;
  drafts: number;
  needsReview: number;
  published: number;
};

export type ProfessorWorkspaceAvailability = {
  archived: number;
  available: number;
  heldBack: number;
  nextScheduledAt?: string;
  scheduled: number;
};

export type ProfessorWorkspaceReviewTopic = {
  needsReview: number;
  title: string;
  topicId: string;
};

/**
 * One entry in the recent-decisions list. Lifecycle transitions and student
 * release changes are two separate records in two separate stores; this is
 * the merged, attributed view of both.
 */
export type ProfessorWorkspaceDecision = {
  actorDisplayName: string;
  id: string;
  occurredAt: string;
  targetTitle: string;
} & (
  | { action: QuestionLifecycleEventAction; kind: "lifecycle" }
  | { kind: "availability"; releaseState: StudentContentReleaseState }
);

export type ProfessorWorkspaceOverview = {
  availability: ProfessorWorkspaceAvailability;
  pipeline: ProfessorWorkspacePipeline;
  recentDecisions: ProfessorWorkspaceDecision[];
  reviewTopics: ProfessorWorkspaceReviewTopic[];
  totalNeedsReview: number;
};

const RECENT_DECISION_LIMIT = 6;

/**
 * Lifecycle events carry no timestamp of their own; the actor attribution
 * records when the action happened.
 */
function eventOccurredAt(actor: { occurredAt: string }) {
  return actor.occurredAt;
}

function summarizePipeline(
  lifecycle: QuestionLifecycleDashboard,
): ProfessorWorkspacePipeline {
  const pipeline: ProfessorWorkspacePipeline = {
    approvedNotPublished: 0,
    archived: 0,
    drafts: 0,
    needsReview: 0,
    published: 0,
  };

  for (const question of lifecycle.questions) {
    if (question.recordState === "archived") {
      pipeline.archived += 1;
      continue;
    }
    if (question.publishedVersion) {
      pipeline.published += 1;
    }
    switch (question.workingVersion.state) {
      case "draft":
        pipeline.drafts += 1;
        break;
      case "needs_review":
        pipeline.needsReview += 1;
        break;
      case "approved":
        if (!question.publishedVersion) {
          pipeline.approvedNotPublished += 1;
        }
        break;
      default:
        break;
    }
  }

  return pipeline;
}

function summarizeAvailability(
  availability: StudentContentAvailabilityDashboard,
): ProfessorWorkspaceAvailability {
  const summary: ProfessorWorkspaceAvailability = {
    archived: 0,
    available: 0,
    heldBack: 0,
    scheduled: 0,
  };

  for (const question of availability.questions) {
    switch (question.effectiveAvailability) {
      case "available":
        summary.available += 1;
        break;
      case "scheduled":
        summary.scheduled += 1;
        if (
          question.availableFrom &&
          (!summary.nextScheduledAt ||
            question.availableFrom < summary.nextScheduledAt)
        ) {
          summary.nextScheduledAt = question.availableFrom;
        }
        break;
      case "archived":
        summary.archived += 1;
        break;
      default:
        // `unpublished` and `expired` are both "approved content a student
        // cannot currently reach", which is one row to a professor.
        summary.heldBack += 1;
        break;
    }
  }

  return summary;
}

function summarizeReviewTopics(
  review: ProfessorQuestionReviewDashboard,
): ProfessorWorkspaceReviewTopic[] {
  return review.topics
    .filter((topic) => topic.needsReview > 0)
    .sort((left, right) => left.order - right.order)
    .map((topic) => ({
      needsReview: topic.needsReview,
      title: topic.title,
      topicId: topic.topicId,
    }));
}

function collectDecisions(
  lifecycle: QuestionLifecycleDashboard,
  availability: StudentContentAvailabilityDashboard,
): ProfessorWorkspaceDecision[] {
  const decisions: ProfessorWorkspaceDecision[] = [];

  for (const question of lifecycle.questions) {
    for (const event of question.events) {
      if (event.actorRole !== "professor") {
        continue;
      }
      decisions.push({
        action: event.action,
        actorDisplayName: event.actor.displayName,
        id: `lifecycle:${event.id}`,
        kind: "lifecycle",
        occurredAt: eventOccurredAt(event.actor),
        targetTitle: question.workingVersion.title,
      });
    }
  }

  for (const event of availability.auditEvents) {
    decisions.push({
      actorDisplayName: event.actorDisplayName,
      id: `availability:${event.id}`,
      kind: "availability",
      occurredAt: event.occurredAt,
      releaseState: event.toReleaseState,
      targetTitle: event.targetId,
    });
  }

  return decisions
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, RECENT_DECISION_LIMIT);
}

/**
 * Folds the three professor dashboards into the workspace overview. Pure and
 * synchronous: every read has already happened behind its own authorization
 * check by the time this runs.
 */
export function summarizeProfessorWorkspace({
  availability,
  lifecycle,
  review,
}: {
  availability: StudentContentAvailabilityDashboard;
  lifecycle: QuestionLifecycleDashboard;
  review: ProfessorQuestionReviewDashboard;
}): ProfessorWorkspaceOverview {
  const reviewTopics = summarizeReviewTopics(review);
  return {
    availability: summarizeAvailability(availability),
    pipeline: summarizePipeline(lifecycle),
    recentDecisions: collectDecisions(lifecycle, availability),
    reviewTopics,
    totalNeedsReview: reviewTopics.reduce(
      (total, topic) => total + topic.needsReview,
      0,
    ),
  };
}
