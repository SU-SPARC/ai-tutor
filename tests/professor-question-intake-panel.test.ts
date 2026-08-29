import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ProfessorQuestionIntakePanel } from "@/components/professor/professor-question-intake-panel";

describe("professor question intake panel", () => {
  it("renders the text and screenshot intake choices without a save side effect", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionIntakePanel, {
        readOnly: false,
        topics: [
          {
            id: "conditional-probability",
            title: "Conditional Probability",
          },
        ],
      }),
    );

    expect(markup).toContain("Add Question with AI");
    expect(markup).toContain("Paste or type the question");
    expect(markup).toContain("Screenshot");
    expect(markup).toContain("Analyze Question");
    expect(markup).not.toContain("Save Draft");
  });
});
