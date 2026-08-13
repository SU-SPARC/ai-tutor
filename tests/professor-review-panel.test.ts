import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import topicData from "../data/canonical/syllabus-topics.json";
import {
  ProfessorFriendlyReviewPanel,
  professorReviewEmptyStateText,
} from "@/components/professor/professor-friendly-review-panel";
import type { ProfessorQuestionReviewDashboard } from "@/lib/types";

describe("professor-friendly review panel", () => {
  it("renders syllabus topic choices in fixture order before enabling queue load", () => {
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
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>.*Load review queue<\/button>/,
    );
    expect(markup).toContain(
      "Select one syllabus topic, then load its review queue.",
    );
    expect(markup).toContain("Needs review");
    expect(markup).toContain("Approved");
    expect(markup).toContain("Rejected / revision");
    expect(markup).toContain("Remaining");
    expect(markup).not.toContain("Question details must load later");
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
          "src/components/tutor/professor-review-panel.tsx",
        ),
        "utf8",
      ),
      readFileSync(
        path.join(
          process.cwd(),
          "src/components/professor/instructor-analytics-panel.tsx",
        ),
        "utf8",
      ),
    ].join("\n");

    expect(reviewPanelSource).toContain(
      "const current = dashboard.candidates[0]",
    );
    expect(reviewPanelSource).toContain("versionId: current.versionId");
    expect(reviewPanelSource).toContain("requestTopicDashboard(loadedTopicId)");
    expect(reviewPanelSource).toContain('action: "approve"');
    expect(reviewPanelSource).not.toContain('action: "publish"');
    expect(browserReviewSources).not.toMatch(
      /ADMIN_SECRET|x-professor-token|sessionStorage|localStorage|admin secret|review secret/i,
    );
  });

  it("distinguishes empty, completed, and revision-pending topics", () => {
    const topic = reviewDashboard().topics[0];

    expect(
      professorReviewEmptyStateText({
        loaded: true,
        selectedTopic: { ...topic, remaining: 0, total: 0 },
      }),
    ).toContain("has no question records");
    expect(
      professorReviewEmptyStateText({
        loaded: true,
        selectedTopic: { ...topic, remaining: 0, total: 4 },
      }),
    ).toContain("Review complete");
    expect(
      professorReviewEmptyStateText({
        loaded: true,
        selectedTopic: { ...topic, remaining: 2, total: 4 },
      }),
    ).toContain("2 draft or revision item(s) remain");
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
