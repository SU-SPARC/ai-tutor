import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PracticeSimilarProblemAction,
  similarProblemStatusMessage,
} from "@/components/tutor/practice-similar-problem-action";

describe("PracticeSimilarProblemAction", () => {
  it("offers published-content practice without promising generation", () => {
    const html = renderToStaticMarkup(
      createElement(PracticeSimilarProblemAction, {
        disabled: false,
        onMatch: vi.fn(),
        sessionId: "session:completed",
      }),
    );

    expect(html).toContain("Practice a similar problem");
    expect(html).toContain("professor-approved published question");
    expect(html).toContain("No new problem is generated");
  });

  it("uses the graceful no-match message", () => {
    expect(similarProblemStatusMessage("none")).toBe(
      "No similar published problem is available yet.",
    );
  });
});
