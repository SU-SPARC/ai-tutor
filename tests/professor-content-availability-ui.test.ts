import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProfessorContentAvailabilityPanel } from "@/components/professor/professor-content-availability-panel";
import type { StudentContentAvailabilityDashboard } from "@/lib/types";

const dashboard: StudentContentAvailabilityDashboard = {
  assignmentScope: "global_only",
  auditEvents: [
    {
      actorDisplayName: "Professor Test",
      actorUserId: "user:professor-test",
      fromReleaseState: "published",
      id: 4,
      occurredAt: "2026-08-14T10:00:00.000Z",
      reason: "pilot_week_3",
      targetId: "quiz-question",
      targetType: "question",
      toReleaseState: "unpublished",
    },
  ],
  mode: "database",
  questions: [
    {
      audienceType: "global",
      availableFrom: "2026-08-20T10:00:00.000Z",
      effectiveAvailability: "scheduled",
      id: "quiz-question",
      publicationState: "published",
      releaseState: "published",
      targetType: "question",
      title: "Quiz probability",
      topicId: "binomial-models",
      topicTitle: "Binomial Models",
    },
    {
      audienceType: "global",
      effectiveAvailability: "unpublished",
      id: "approved-not-published",
      publicationState: "unpublished",
      releaseState: "published",
      targetType: "question",
      title: "Approved working version",
      topicId: "binomial-models",
      topicTitle: "Binomial Models",
    },
  ],
  readOnly: false,
  topics: [
    {
      audienceType: "global",
      effectiveAvailability: "available",
      id: "conditional-probability",
      publicationState: "published",
      releaseState: "published",
      targetType: "topic",
      title: "Conditional Probability",
    },
    {
      audienceType: "global",
      effectiveAvailability: "unpublished",
      id: "binomial-models",
      publicationState: "published",
      releaseState: "unpublished",
      targetType: "topic",
      title: "Binomial Models",
    },
  ],
};

describe("professor content availability UI", () => {
  it("shows ordered topic and question controls, scheduling, lifecycle gates, and audit attribution", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessorContentAvailabilityPanel, {
        initialDashboard: dashboard,
      }),
    );

    expect(markup).toContain("Separate release gate");
    expect(markup).toContain("unapproved or lifecycle-unpublished question");
    expect(markup).toContain("no course, cohort, membership, or enrollment");
    expect(markup).toContain("global only");
    expect(markup).toContain("Syllabus topic 1");
    expect(markup).toContain("Syllabus topic 2");
    expect(markup.indexOf("Conditional Probability")).toBeLessThan(
      markup.indexOf("Binomial Models"),
    );
    expect(markup).toContain("Published globally");
    expect(markup).toContain("Scheduled");
    expect(markup).toContain("Available from (optional)");
    expect(markup).toContain("Approved working version");
    expect(markup).toContain(
      "Use the lifecycle controls below before changing student availability",
    );
    expect(markup).toContain("Availability audit");
    expect(markup).toContain("Professor Test");
    expect(markup).toContain("pilot_week_3");
    expect(markup).not.toMatch(/canvas|blackboard|moodle|lms integration/i);
  });
});
