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
  it("shows ordered topics and questions in plain words, a way to courses, blocked questions with a link, and recent changes", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessorContentAvailabilityPanel, {
        initialDashboard: dashboard,
      }),
    );

    expect(markup).toContain("Students only see questions you have approved.");
    expect(markup).toContain(
      "To choose what one section sees and when, open Courses → your course → the section.",
    );
    expect(markup).toContain('href="/professor/courses"');
    expect(markup).toContain("Go to my courses");
    expect(markup).toContain("Topic 1");
    expect(markup).toContain("Topic 2");
    expect(markup).not.toContain("Syllabus topic");
    expect(markup.indexOf("Conditional Probability")).toBeLessThan(
      markup.indexOf("Binomial Models"),
    );
    expect(markup).toContain("Students can see it");
    expect(markup).toContain("Scheduled");
    expect(markup).toContain("Students will see it on Thu 20 Aug");
    expect(markup).toContain(">Change<");
    expect(markup).toContain("Approved working version");
    expect(markup).toContain("Approve and publish this question first.");
    expect(markup).toContain('href="/professor/questions/approved-not-published"');
    expect(markup).toContain("Open question");
    expect(markup).toContain("Recent changes");
    expect(markup).toContain(">Hidden<");
    expect(markup).toContain("Professor Test");
    expect(markup).toContain("pilot_week_3");
    expect(markup).not.toMatch(
      /separate release gate|global only|lifecycle|availability audit|published globally|audit reason/i,
    );
    expect(markup).not.toMatch(/canvas|blackboard|moodle|lms integration/i);
  });
});
