import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import topicData from "../data/demo/topics.json";
import { ProfessorFriendlyReviewPanel } from "@/components/admin/professor-friendly-review-panel";

describe("professor-friendly review panel", () => {
  it("renders syllabus topic choices in fixture order before enabling queue load", () => {
    const topics = topicData.map(({ id, title }) => ({ id, title }));
    const markup = renderToStaticMarkup(
      createElement(ProfessorFriendlyReviewPanel, { topics }),
    );

    let previousIndex = -1;
    for (const topic of topics) {
      const topicIndex = markup.indexOf(`value="${topic.id}"`);
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
  });

  it("keeps one-question-at-a-time review without browser secret state", () => {
    const reviewPanelSource = readFileSync(
      path.join(
        process.cwd(),
        "src/components/admin/professor-friendly-review-panel.tsx",
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
          "src/components/admin/instructor-analytics-panel.tsx",
        ),
        "utf8",
      ),
    ].join("\n");

    expect(reviewPanelSource).toContain("const current = candidates[0]");
    expect(reviewPanelSource).toContain("candidateId: current.id");
    expect(reviewPanelSource).toContain("items.slice(1)");
    expect(browserReviewSources).not.toMatch(
      /ADMIN_SECRET|x-professor-token|sessionStorage|localStorage|admin secret|review secret/i,
    );
  });
});
