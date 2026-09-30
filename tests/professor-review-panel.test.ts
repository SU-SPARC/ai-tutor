import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import topicData from "../data/canonical/probability-statistics/syllabus-topics.json";
import {
  decisionToastText,
  ProfessorFriendlyReviewPanel,
  professorReviewEmptyStateText,
} from "@/components/professor/professor-friendly-review-panel";
import { ProfessorReviewReasonFields } from "@/components/professor/professor-review-reason-fields";
import { PROFESSOR_REVIEW_REASONS } from "@/lib/tutor/professor-review-reasons";
import type { ProfessorQuestionReviewDashboard } from "@/lib/types";

describe("professor-friendly review panel", () => {
  it("renders syllabus topic choices in fixture order with waiting counts and no load button", () => {
    const dashboard = reviewDashboard();
    const markup = renderToStaticMarkup(
      createElement(ProfessorFriendlyReviewPanel, {
        initialDashboard: dashboard,
      }),
    );

    let previousIndex = -1;
    for (const topic of dashboard.topics) {
      const topicIndex = markup.indexOf(`value="${topic.topicId}"`);
      expect(topicIndex).toBeGreaterThan(previousIndex);
      previousIndex = topicIndex;
    }

    expect(markup).toContain("Choose a topic");
    expect(markup).toContain(">Topic</label>");
    expect(markup).toContain(`${dashboard.topics[0].title} (1 waiting)`);
    expect(markup).not.toContain("Load review queue");
    expect(markup).toContain("Choose a topic to review");
    // The topics table has two columns and a full-size Review link per row.
    expect(markup).toContain(">Waiting for you</th>");
    expect(markup).toContain(
      `href="/professor/review?topic=${encodeURIComponent(dashboard.topics[0].topicId)}"`,
    );
    expect(markup).toContain(">Review</a>");
    expect(markup).not.toContain("Rejected / revision");
    expect(markup).not.toContain("Remaining");
    expect(markup).not.toContain("Question details must load later");
  });

  it("says the professor is all caught up when nothing waits anywhere", () => {
    const dashboard = reviewDashboard();
    dashboard.topics = dashboard.topics.map((topic) => ({
      ...topic,
      needsReview: 0,
    }));
    const markup = renderToStaticMarkup(
      createElement(ProfessorFriendlyReviewPanel, {
        initialDashboard: dashboard,
      }),
    );

    expect(markup).toContain(
      "You&#x27;re all caught up. No questions are waiting for you.",
    );
    expect(markup).toContain('href="/professor/questions?tab=intake"');
    expect(markup).toContain("Add a question");
    expect(markup).not.toContain(">Topic</label>");
  });

  it("keeps one-question-at-a-time review without browser secret state", () => {
    const reviewPanelSource = readFileSync(
      path.join(
        process.cwd(),
        "src/components/professor/professor-friendly-review-panel.tsx",
      ),
      "utf8",
    );
    const browserReviewSources = [
      reviewPanelSource,
      readFileSync(
        path.join(
          process.cwd(),
          "src/components/professor/instructor-practice-performance.tsx",
        ),
        "utf8",
      ),
    ].join("\n");

    expect(reviewPanelSource).toContain(
      "const current = dashboard.candidates[0]",
    );
    expect(reviewPanelSource).toContain("versionId: current.versionId");
    expect(reviewPanelSource).toContain("difficulty: approvedDifficulty");
    expect(reviewPanelSource).toContain("requestTopicDashboard(loadedTopicId)");
    expect(reviewPanelSource).toContain('action: "approve"');
    expect(reviewPanelSource).not.toContain('action: "publish"');
    expect(browserReviewSources).not.toMatch(
      /ADMIN_SECRET|x-professor-token|sessionStorage|localStorage|admin secret|review secret/i,
    );
  });

  it("opens on a question with plain decisions and their consequences", () => {
    const dashboard = reviewDashboard();
    dashboard.selectedTopicId = dashboard.topics[0].topicId;
    dashboard.candidates = [reviewCandidate(dashboard.topics[0].topicId)];

    const markup = renderToStaticMarkup(
      createElement(ProfessorFriendlyReviewPanel, {
        initialDashboard: dashboard,
        initialTopicId: dashboard.topics[0].topicId,
      }),
    );

    expect(markup).toContain(">Difficulty</label>");
    expect(markup).toContain('value="foundational"');
    expect(markup).toContain('value="intermediate" selected=""');
    expect(markup).toContain('value="challenge"');
    expect(markup).toContain(
      "Change this if the suggested level is wrong. Your choice is saved when you approve.",
    );
    expect(markup).not.toContain("immutable");
    expect(markup).toContain(
      `Question 1 of 1 in ${dashboard.topics[0].title}`,
    );
    expect(markup).toContain("Previous");
    expect(markup).toContain("Next");
    for (const words of [
      "Approve",
      "It moves to your approved questions. Students won&#x27;t see it until you show it to them.",
      "Send back for changes",
      "It goes back to drafts so it can be edited, then returns here.",
      "Rewrite with AI",
      "A new draft is written for you and comes back here for review.",
      "Reject",
      "It is set aside and never shown to students.",
      "Where this question came from",
      "Imported public-safe question.",
    ]) {
      expect(markup).toContain(words);
    }
    // No version jargon, no repeated status chip, no code in list rows.
    expect(markup).not.toContain("Working version");
    expect(markup).not.toContain("Needs review");
    expect(markup).not.toContain("Load review queue");
    expect(markup).toContain("Intermediate · added ");
    // Reasons appear only once Send back or Reject is chosen.
    expect(markup).not.toContain(">Why?</label>");
    expect(markup).not.toContain("Note (optional)");
  });

  it("prints nothing for a missing or epoch-zero date and explains edits in words", () => {
    const dashboard = reviewDashboard();
    dashboard.selectedTopicId = dashboard.topics[0].topicId;
    dashboard.candidates = [
      {
        ...reviewCandidate(dashboard.topics[0].topicId),
        createdAt: "1970-01-01T00:00:00.000Z",
        publishedVersionId: 7,
        review: { reviewPriority: "priority", status: "needs_review" },
        source: {
          sourceType: "professor_provided",
          trustLevel: "public_original",
        },
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(ProfessorFriendlyReviewPanel, {
        initialDashboard: dashboard,
        initialTopicId: dashboard.topics[0].topicId,
      }),
    );

    expect(markup).not.toMatch(/1969|1970/);
    expect(markup).not.toContain("added");
    expect(markup).toContain(
      "This is an edit. Students still see the earlier wording until you approve this one and show it to them.",
    );
    expect(markup).not.toContain("remains live");
    expect(markup).toContain("Flagged by a student");
    expect(markup).not.toContain(">Priority<");
    expect(markup).toContain("No source noted.");
  });

  it("offers every reason under Why? with a plain optional note", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessorReviewReasonFields, {
        note: "",
        onNoteChange: () => {},
        onReasonCodeChange: () => {},
        reasonCode: "",
        reasonError: "Choose why you're sending this back.",
      }),
    );

    expect(markup).toContain(">Why?</label>");
    expect(markup).toContain(">Note (optional)</label>");
    expect(markup).toContain("Only instructors see this.");
    expect(markup).toContain("Choose why you&#x27;re sending this back.");
    expect(markup).not.toContain("Decision reason");
    expect(markup).not.toContain("Audit note");
    for (const { code, label } of PROFESSOR_REVIEW_REASONS) {
      expect(markup).toContain(`value="${code}"`);
      expect(markup).toContain(label);
    }
  });

  it("says what happened after each decision in plain words", () => {
    expect(decisionToastText({ action: "approve", title: "Two dice" })).toBe(
      "Approved “Two dice”. Students can't see it until you show it to them.",
    );
    expect(
      decisionToastText({
        action: "approve",
        difficulty: "intermediate",
        title: "Two dice",
      }),
    ).toBe(
      "Approved “Two dice”, marked Intermediate. Students can't see it until you show it to them.",
    );
    expect(
      decisionToastText({ action: "request_edit", title: "Two dice" }),
    ).toBe("“Two dice” was sent back for changes.");
    expect(
      decisionToastText({ action: "request_regeneration", title: "Two dice" }),
    ).toBe("“Two dice” will be rewritten and will come back here.");
    expect(decisionToastText({ action: "reject", title: "Two dice" })).toBe(
      "“Two dice” was rejected.",
    );
  });

  it("distinguishes empty, completed, and revision-pending topics", () => {
    const topic = reviewDashboard().topics[0];

    expect(
      professorReviewEmptyStateText({
        loaded: true,
        selectedTopic: { ...topic, remaining: 0, total: 0 },
      }),
    ).toBe(`${topic.title} has no questions yet.`);
    expect(
      professorReviewEmptyStateText({
        loaded: true,
        selectedTopic: { ...topic, remaining: 0, total: 4 },
      }),
    ).toBe(`All done with ${topic.title}.`);
    expect(
      professorReviewEmptyStateText({
        loaded: true,
        selectedTopic: { ...topic, remaining: 2, total: 4 },
      }),
    ).toBe(
      `Nothing to review in ${topic.title}. 2 questions are still being written.`,
    );
    expect(professorReviewEmptyStateText({ loaded: false })).toBe(
      "Choose a topic to start reviewing.",
    );
  });
});

function reviewDashboard(): ProfessorQuestionReviewDashboard {
  return {
    candidates: [],
    mode: "database",
    readOnly: false,
    topics: topicData.map(({ id, title }, order) => ({
      approved: order,
      needsReview: order + 1,
      order,
      rejectedOrRevisionRequested: order + 2,
      remaining: order + 3,
      title,
      topicId: id,
      total: order + 6,
    })),
  };
}

function reviewCandidate(
  topicId: string,
): ProfessorQuestionReviewDashboard["candidates"][number] {
  return {
    allowedActions: ["approve", "request_revision", "reject"],
    answer: {
      acceptedAnswers: ["1/2"],
      explanation: "Divide the favorable outcomes by all outcomes.",
    },
    createdAt: "2026-09-05T12:00:00.000Z",
    createdBy: {
      displayName: "Question Import",
      occurredAt: "2026-09-05T12:00:00.000Z",
    },
    creationMethod: "imported",
    difficulty: "intermediate",
    hints: ["Count the outcomes."],
    id: "review-difficulty-question",
    misconceptions: [
      { feedback: "Use the complete outcome space.", id: "denominator" },
    ],
    prompt: "What fraction of the outcomes are favorable?",
    questionId: "review-difficulty-question",
    review: { reviewPriority: "normal", status: "needs_review" },
    solutionSteps: ["Count, then divide."],
    source: {
      originalityNote: "Imported public-safe question.",
      sourceType: "professor_provided",
      trustLevel: "public_original",
    },
    state: "needs_review",
    title: "Review difficulty question",
    topicId,
    validationStatus: "valid",
    versionId: 41,
    versionNumber: 2,
  };
}
