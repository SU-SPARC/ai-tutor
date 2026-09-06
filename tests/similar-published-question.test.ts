import { describe, expect, it } from "vitest";

import { rankSimilarPublishedQuestions } from "@/lib/tutor/similar-published-question";
import type { TutorQuestion } from "@/lib/types";

describe("similar published question ranking", () => {
  it("prefers same difficulty, then legitimate shared patterns and misconceptions", () => {
    const current = question("current", {
      misconceptionIds: ["misconception:conditional"],
      patternIds: ["pattern:tree"],
    });
    const ranked = rankSimilarPublishedQuestions({
      candidates: [
        question("different-difficulty", {
          difficulty: "challenge",
          misconceptionIds: ["misconception:conditional"],
          patternIds: ["pattern:tree"],
        }),
        question("same-difficulty-no-pattern"),
        question("same-difficulty-pattern", {
          patternIds: ["pattern:tree"],
        }),
        question("same-difficulty-pattern-misconception", {
          misconceptionIds: ["misconception:conditional"],
          patternIds: ["pattern:tree"],
        }),
      ],
      completedQuestionIds: new Set(),
      currentQuestion: current,
    });

    expect(ranked.map(({ id }) => id)).toEqual([
      "same-difficulty-pattern-misconception",
      "same-difficulty-pattern",
      "same-difficulty-no-pattern",
      "different-difficulty",
    ]);
  });

  it("prefers an uncompleted question when stronger similarity signals tie", () => {
    const current = question("current");
    const ranked = rankSimilarPublishedQuestions({
      candidates: [question("completed"), question("unattempted")],
      completedQuestionIds: new Set(["completed"]),
      currentQuestion: current,
    });

    expect(ranked.map(({ id }) => id)).toEqual(["unattempted", "completed"]);
  });

  it("excludes the current question and non-published student-ineligible content", () => {
    const current = question("current");
    const ranked = rankSimilarPublishedQuestions({
      candidates: [
        current,
        question("draft", { reviewStatus: "needs_review" }),
        question("rejected", { reviewStatus: "rejected" }),
        question("private", { visibility: "private" }),
        question("invalid-provenance", {
          sourceType: "private_reference_pattern",
          trustLevel: "private_reference",
          visibility: "private",
        }),
        question("published"),
      ],
      completedQuestionIds: new Set(),
      currentQuestion: current,
    });

    expect(ranked.map(({ id }) => id)).toEqual(["published"]);
  });

  it("falls back to another published question in the same topic", () => {
    const current = question("current");
    const ranked = rankSimilarPublishedQuestions({
      candidates: [
        question("other-topic", { topicId: "topic:other" }),
        question("same-topic-fallback", { difficulty: "challenge" }),
      ],
      completedQuestionIds: new Set(["same-topic-fallback"]),
      currentQuestion: current,
    });

    expect(ranked.map(({ id }) => id)).toEqual(["same-topic-fallback"]);
  });

  it("returns no result when no other published question shares the topic", () => {
    const current = question("current");
    expect(
      rankSimilarPublishedQuestions({
        candidates: [
          current,
          question("other-topic", { topicId: "topic:other" }),
        ],
        completedQuestionIds: new Set(),
        currentQuestion: current,
      }),
    ).toEqual([]);
  });
});

function question(
  id: string,
  overrides: {
    difficulty?: TutorQuestion["difficulty"];
    misconceptionIds?: string[];
    patternIds?: string[];
    reviewStatus?: TutorQuestion["review"]["status"];
    sourceType?: TutorQuestion["source"]["sourceType"];
    topicId?: string;
    trustLevel?: TutorQuestion["source"]["trustLevel"];
    visibility?: TutorQuestion["source"]["visibility"];
  } = {},
): TutorQuestion {
  return {
    answer: { acceptedAnswers: ["0.5"], explanation: "Divide one by two." },
    difficulty: overrides.difficulty ?? "intermediate",
    hints: ["Count outcomes."],
    id,
    misconceptions: (overrides.misconceptionIds ?? []).map(
      (misconceptionId) => ({
        feedback: "Review the setup.",
        id: misconceptionId,
        matchTerms: [],
      }),
    ),
    prompt: `Prompt for ${id}`,
    review: { status: overrides.reviewStatus ?? "approved" },
    solutionSteps: ["Compute the result."],
    source: {
      originalityNote: "Original public-safe test question.",
      patternIds: overrides.patternIds,
      sourceType: overrides.sourceType ?? "professor_provided",
      trustLevel: overrides.trustLevel ?? "professor_approved",
      visibility: overrides.visibility ?? "public",
    },
    title: `Question ${id}`,
    topicId: overrides.topicId ?? "topic:probability",
  };
}
