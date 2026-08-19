import { describe, expect, it } from "vitest";

import { summarizeProfessorWorkspace } from "@/lib/professor/workspace-overview";
import type {
  ProfessorQuestionReviewDashboard,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionVersionDto,
  StudentContentAvailabilityDashboard,
  StudentContentAvailabilityTarget,
} from "@/lib/types";

function version(
  overrides: Partial<QuestionVersionDto> & Pick<QuestionVersionDto, "state">,
): QuestionVersionDto {
  return {
    allowedActions: [],
    answer: { type: "numeric", value: 1 },
    contentHash: "hash",
    createdAt: "2026-08-01T00:00:00.000Z",
    createdBy: {
      displayName: "Professor Test",
      occurredAt: "2026-08-01T00:00:00.000Z",
      userId: "user:professor",
    },
    creationMethod: "generated",
    difficulty: "foundational",
    generationMetadata: {},
    hints: [],
    id: "question",
    misconceptions: [],
    schemaVersion: 1,
    solutionSteps: ["step"],
    source: {
      originalityNote: "note",
      sourceType: "generated_original",
      trustLevel: "generated_unverified",
    },
    text: "text",
    title: "Question title",
    topicId: "conditional-probability",
    validationStatus: "passed",
    versionId: 1,
    versionNumber: 1,
    ...overrides,
  } as QuestionVersionDto;
}

function lifecycleQuestion(
  overrides: Partial<QuestionLifecycleDto>,
): QuestionLifecycleDto {
  return {
    allowedActions: [],
    events: [],
    questionId: "question",
    recordState: "active",
    regenerationAllowed: false,
    versions: [],
    workingVersion: version({ state: "draft" }),
    ...overrides,
  };
}

function lifecycleDashboard(
  questions: QuestionLifecycleDto[],
): QuestionLifecycleDashboard {
  return {
    inspections: [],
    mode: "database",
    questions,
    readOnly: false,
    topics: [],
  };
}

function availabilityTarget(
  overrides: Partial<StudentContentAvailabilityTarget>,
): StudentContentAvailabilityTarget {
  return {
    audienceType: "global",
    effectiveAvailability: "available",
    id: "question",
    publicationState: "published",
    releaseState: "published",
    targetType: "question",
    title: "Question title",
    ...overrides,
  };
}

function availabilityDashboard(
  questions: StudentContentAvailabilityTarget[],
  auditEvents: StudentContentAvailabilityDashboard["auditEvents"] = [],
): StudentContentAvailabilityDashboard {
  return {
    assignmentScope: "global_only",
    auditEvents,
    mode: "database",
    questions,
    readOnly: false,
    topics: [],
  };
}

function reviewDashboard(
  topics: ProfessorQuestionReviewDashboard["topics"],
): ProfessorQuestionReviewDashboard {
  return { candidates: [], mode: "database", readOnly: false, topics };
}

describe("summarizeProfessorWorkspace", () => {
  it("counts each pipeline stage from working and published versions", () => {
    const overview = summarizeProfessorWorkspace({
      availability: availabilityDashboard([]),
      lifecycle: lifecycleDashboard([
        lifecycleQuestion({ workingVersion: version({ state: "draft" }) }),
        lifecycleQuestion({
          workingVersion: version({ state: "needs_review" }),
        }),
        lifecycleQuestion({ workingVersion: version({ state: "approved" }) }),
        lifecycleQuestion({
          publishedVersion: version({ state: "published" }),
          workingVersion: version({ state: "published" }),
        }),
        lifecycleQuestion({ recordState: "archived" }),
      ]),
      review: reviewDashboard([]),
    });

    expect(overview.pipeline).toEqual({
      approvedNotPublished: 1,
      archived: 1,
      drafts: 1,
      needsReview: 1,
      published: 1,
    });
  });

  it("does not count an approved question that already has a published version as awaiting publication", () => {
    const overview = summarizeProfessorWorkspace({
      availability: availabilityDashboard([]),
      lifecycle: lifecycleDashboard([
        lifecycleQuestion({
          publishedVersion: version({ state: "published" }),
          workingVersion: version({ state: "approved" }),
        }),
      ]),
      review: reviewDashboard([]),
    });

    expect(overview.pipeline.approvedNotPublished).toBe(0);
    expect(overview.pipeline.published).toBe(1);
  });

  it("folds expired releases into held back and reports the earliest scheduled date", () => {
    const overview = summarizeProfessorWorkspace({
      availability: availabilityDashboard([
        availabilityTarget({ effectiveAvailability: "available", id: "a" }),
        availabilityTarget({ effectiveAvailability: "expired", id: "b" }),
        availabilityTarget({ effectiveAvailability: "unpublished", id: "c" }),
        availabilityTarget({ effectiveAvailability: "archived", id: "d" }),
        availabilityTarget({
          availableFrom: "2026-09-10T09:00:00.000Z",
          effectiveAvailability: "scheduled",
          id: "e",
        }),
        availabilityTarget({
          availableFrom: "2026-09-02T09:00:00.000Z",
          effectiveAvailability: "scheduled",
          id: "f",
        }),
      ]),
      lifecycle: lifecycleDashboard([]),
      review: reviewDashboard([]),
    });

    expect(overview.availability).toEqual({
      archived: 1,
      available: 1,
      heldBack: 2,
      nextScheduledAt: "2026-09-02T09:00:00.000Z",
      scheduled: 2,
    });
  });

  it("orders review topics by syllabus order and drops settled ones", () => {
    const overview = summarizeProfessorWorkspace({
      availability: availabilityDashboard([]),
      lifecycle: lifecycleDashboard([]),
      review: reviewDashboard([
        {
          approved: 0,
          needsReview: 2,
          order: 3,
          rejectedOrRevisionRequested: 0,
          remaining: 2,
          title: "Bayes",
          topicId: "bayes",
          total: 2,
        },
        {
          approved: 4,
          needsReview: 0,
          order: 2,
          rejectedOrRevisionRequested: 0,
          remaining: 0,
          title: "Settled",
          topicId: "settled",
          total: 4,
        },
        {
          approved: 0,
          needsReview: 3,
          order: 1,
          rejectedOrRevisionRequested: 0,
          remaining: 3,
          title: "Conditional",
          topicId: "conditional",
          total: 3,
        },
      ]),
    });

    expect(overview.reviewTopics.map((topic) => topic.topicId)).toEqual([
      "conditional",
      "bayes",
    ]);
    expect(overview.totalNeedsReview).toBe(5);
  });

  it("merges lifecycle and release decisions newest first and skips system actions", () => {
    const overview = summarizeProfessorWorkspace({
      availability: availabilityDashboard(
        [],
        [
          {
            actorDisplayName: "R. Chen",
            actorUserId: "user:chen",
            fromReleaseState: "unpublished",
            id: 7,
            occurredAt: "2026-08-19T10:00:00.000Z",
            targetId: "question-b",
            targetType: "question",
            toReleaseState: "published",
          },
        ],
      ),
      lifecycle: lifecycleDashboard([
        lifecycleQuestion({
          events: [
            {
              action: "approve",
              actor: {
                displayName: "You",
                occurredAt: "2026-08-20T10:00:00.000Z",
                userId: "user:professor",
              },
              actorRole: "professor",
              id: 1,
              versionId: 1,
            },
            {
              action: "migrate",
              actor: {
                displayName: "System",
                occurredAt: "2026-08-21T10:00:00.000Z",
                userId: "system",
              },
              actorRole: "system",
              id: 2,
              versionId: 1,
            },
          ],
        }),
      ]),
      review: reviewDashboard([]),
    });

    expect(overview.recentDecisions).toHaveLength(2);
    expect(overview.recentDecisions[0]).toMatchObject({
      id: "lifecycle:1",
      kind: "lifecycle",
    });
    expect(overview.recentDecisions[1]).toMatchObject({
      id: "availability:7",
      kind: "availability",
    });
  });
});
