import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  PracticeSimilarProblemAction,
  similarProblemStatusMessage,
} from "@/components/tutor/practice-similar-problem-action";

describe("PracticeSimilarProblemAction", () => {
  it("offers professor-checked extra practice in student language", () => {
    const html = renderToStaticMarkup(
      createElement(PracticeSimilarProblemAction, {
        disabled: false,
        onMatch: vi.fn(),
        sessionId: "session:completed",
      }),
    );

    expect(html).toContain("Try a similar problem");
    expect(html).toContain(
      "Optional: one more problem like this one, checked by your professor.",
    );
    expect(html).toContain("Your professor decides if it counts.");
    expect(html).not.toMatch(/does not count/i);
    expect(html).not.toMatch(/partial practice credit|instructor|animate-spin/);
    expect(html).not.toMatch(/Reserve|candidate|generated/);
  });

  it("uses the graceful no-match message", () => {
    expect(similarProblemStatusMessage("none")).toBe(
      "No similar problem is available right now. You can continue to the next question or choose another topic.",
    );
  });
});
