import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import {
  ProfessorQuestionIntakePanel,
  QUESTION_INTAKE_SAVE_FAILURE_MESSAGE,
  QuestionIntakeSavedNotice,
  questionIntakeSaveFailureMessage,
  questionIntakeSavedSummary,
  saveDraftButtonLabel,
} from "@/components/professor/professor-question-intake-panel";
import {
  LinesTextarea,
  linesDraftText,
  normalizeLines,
} from "@/components/professor/lines-textarea";
import { readFileSync } from "node:fs";

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
    expect(markup).not.toContain("Draft saved");
  });

  it("confirms a save with the destination and a direct link to the saved question", () => {
    const markup = renderToStaticMarkup(
      createElement(QuestionIntakeSavedNotice, {
        onAddAnother: vi.fn(),
        saved: {
          questionId: "ai-intake-exactly-one-head-1234abcd",
          state: "needs_review",
          title: "Exactly one head in two tosses",
          topicId: "conditional-probability",
        },
        topicTitle: "Conditional Probability",
      }),
    );

    expect(markup).toContain("Draft saved.");
    expect(markup).toContain("waiting in your Review Queue");
    expect(markup).toContain("Conditional Probability");
    expect(markup).toContain("Review and approve it before publishing");
    expect(markup).toContain("Students cannot see it yet");
    expect(markup).toContain(
      'href="/professor/questions/ai-intake-exactly-one-head-1234abcd"',
    );
    expect(markup).toContain("View Draft");
    expect(markup).toContain(
      'href="/professor/review?topic=conditional-probability&amp;question=ai-intake-exactly-one-head-1234abcd"',
    );
    expect(markup).toContain("Open in Review Queue");
    expect(markup).toContain("Add another question");
    expect(markup).not.toContain("needs_review");
  });

  it("describes saving, saved, and failure states in professor language", () => {
    expect(saveDraftButtonLabel({ isSaving: true, saved: false })).toBe(
      "Saving…",
    );
    expect(saveDraftButtonLabel({ isSaving: false, saved: true })).toBe(
      "Draft saved",
    );
    expect(saveDraftButtonLabel({ isSaving: false, saved: false })).toBe(
      "Save Draft",
    );
    expect(
      questionIntakeSavedSummary(
        {
          state: "draft",
          title: "Manual question",
          topicId: "conditional-probability",
        },
        "Conditional Probability",
      ),
    ).toContain("was filed under Conditional Probability");

    expect(
      questionIntakeSaveFailureMessage(503, { error: "storage down" }),
    ).toBe(QUESTION_INTAKE_SAVE_FAILURE_MESSAGE);
    expect(questionIntakeSaveFailureMessage(500, {})).toBe(
      QUESTION_INTAKE_SAVE_FAILURE_MESSAGE,
    );
    expect(
      questionIntakeSaveFailureMessage(409, {
        error: "A similar question may already exist.",
      }),
    ).toBe(
      "A similar question may already exist. Your generated question is still available on this page.",
    );
    expect(
      questionIntakeSaveFailureMessage(422, {
        error: "The editable question draft is incomplete or invalid.",
        reasons: ["hints must contain 2 to 4 entries"],
      }),
    ).toContain("hints must contain 2 to 4 entries");
  });
});

describe("intake accepted answers multiline input", () => {
  it("keeps a trailing newline typeable and persists both answers without blank entries", () => {
    // Each element is the textarea value after one keystroke. The field emits
    // normalizeLines(value) through updateAnswer and re-renders from
    // linesDraftText(value, acceptedAnswers), exactly as LinesTextarea does.
    const keystrokes = [
      "0",
      "0.",
      "0.5",
      "0.5\n",
      "0.5\n1",
      "0.5\n1/",
      "0.5\n1/2",
    ];
    let acceptedAnswers: string[] = [];
    for (const typed of keystrokes) {
      acceptedAnswers = normalizeLines(typed);
      // The UI keeps the raw text, so the newline survives the re-render.
      expect(linesDraftText(typed, acceptedAnswers)).toBe(typed);
      expect(acceptedAnswers).not.toContain("");
    }
    expect(normalizeLines("0.5\n")).toEqual(["0.5"]);
    expect(linesDraftText("0.5\n", ["0.5"])).toBe("0.5\n");
    expect(acceptedAnswers).toEqual(["0.5", "1/2"]);
    // The previous controlled value would have dropped the newline immediately.
    expect(["0.5"].join("\n")).toBe("0.5");
  });

  it("trims lines, drops whitespace-only lines, and mirrors external entries", () => {
    expect(normalizeLines("  0.5 \n   \n\t1/2\t\n\n")).toEqual(["0.5", "1/2"]);
    // A draft that no longer matches the entries (external change) is replaced.
    expect(linesDraftText("0.5\n", ["0.25"])).toBe("0.25");
    expect(linesDraftText(undefined, ["0.5", "1/2"])).toBe("0.5\n1/2");
    expect(
      renderToStaticMarkup(
        createElement(LinesTextarea, {
          values: ["0.5", "1/2"],
          onChange: () => {},
        }),
      ),
    ).toContain(">0.5\n1/2</textarea>");
  });

  it("wires the accepted-answers field through the shared multiline component", () => {
    const source = readFileSync(
      "src/components/professor/professor-question-intake-panel.tsx",
      "utf8",
    );
    const field = source.slice(
      source.indexOf("Correct accepted answers (one per line)"),
      source.indexOf("</Field>", source.indexOf("Correct accepted answers")),
    );
    expect(field).toContain("<LinesTextarea");
    expect(field).toContain("values={draft.answer.acceptedAnswers}");
    expect(field).not.toContain("lines(event.target.value)");
  });
});

describe("intake hints and solution steps multiline inputs", () => {
  // Each element is the textarea value after one keystroke; the field emits
  // normalizeLines(value) through update() and re-renders from
  // linesDraftText(value, entries), exactly as LinesTextarea does.
  function type(keystrokes: string[]) {
    let entries: string[] = [];
    for (const typed of keystrokes) {
      entries = normalizeLines(typed);
      expect(linesDraftText(typed, entries)).toBe(typed);
      expect(entries).not.toContain("");
    }
    return entries;
  }

  it("lets the professor start a second hint after pressing Enter", () => {
    expect(normalizeLines("First hint\n")).toEqual(["First hint"]);
    expect(linesDraftText("First hint\n", ["First hint"])).toBe("First hint\n");
    expect(
      type([
        "First hint",
        "First hint\n",
        "First hint\nS",
        "First hint\nSecond hint",
      ]),
    ).toEqual(["First hint", "Second hint"]);
    expect(normalizeLines("First hint\nSecond hint")).toEqual([
      "First hint",
      "Second hint",
    ]);
  });

  it("lets the professor start a second solution step after pressing Enter", () => {
    expect(normalizeLines("Step one\n")).toEqual(["Step one"]);
    expect(linesDraftText("Step one\n", ["Step one"])).toBe("Step one\n");
    expect(
      type(["Step one", "Step one\n", "Step one\nS", "Step one\nStep two"]),
    ).toEqual(["Step one", "Step two"]);
    expect(normalizeLines("Step one\nStep two")).toEqual([
      "Step one",
      "Step two",
    ]);
  });

  it("trims, drops blank lines, keeps order, and persists no empty hint or step", () => {
    expect(normalizeLines("  First hint \n\n   \nSecond hint\t\n")).toEqual([
      "First hint",
      "Second hint",
    ]);
    expect(normalizeLines("Step one\n \nStep two\nStep three\n\n")).toEqual([
      "Step one",
      "Step two",
      "Step three",
    ]);
  });

  it("wires both fields through the shared multiline component", () => {
    const source = readFileSync(
      "src/components/professor/professor-question-intake-panel.tsx",
      "utf8",
    );
    for (const [label, values] of [
      ["Progressive hints (2–4, one per line)", "values={draft.hints}"],
      ["Full solution steps (one per line)", "values={draft.solutionSteps}"],
    ]) {
      const start = source.indexOf(label);
      expect(start).toBeGreaterThan(-1);
      const field = source.slice(start, source.indexOf("</Field>", start));
      expect(field).toContain("<LinesTextarea");
      expect(field).toContain(values);
    }
    expect(source).not.toContain("lines(event.target.value)");
    expect(source).not.toMatch(/^function lines\(/m);
  });
});
