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
