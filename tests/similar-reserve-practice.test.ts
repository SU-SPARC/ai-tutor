import { describe, expect, it } from "vitest";

import { rankSimilarReservePracticeQuestions } from "@/lib/tutor/similar-reserve-practice";
import type { ReservePracticeCandidate } from "@/lib/data/reserve-practice-repository";
import type { TutorQuestion } from "@/lib/types";

describe("Reserve similar-practice ranking", () => {
  it("prefers same difficulty, shared patterns, and shared misconceptions", () => {
    const current = question("current", {
      misconceptionIds: ["misconception:conditional"],
      patternIds: ["pattern:tree"],
    });
    const ranked = rankSimilarReservePracticeQuestions({
      candidates: [
        candidate("different-difficulty", { difficulty: "challenge" }),
        candidate("same-difficulty-no-pattern"),
        candidate("same-difficulty-pattern", { patternIds: ["pattern:tree"] }),
        candidate("best", {
          misconceptionIds: ["misconception:conditional"],
          patternIds: ["pattern:tree"],
        }),
      ],
      currentQuestion: current,
      practicedQuestionIds: new Set(),
    });

    expect(ranked.map(({ question }) => question.id)).toEqual([
      "best",
      "same-difficulty-pattern",
      "same-difficulty-no-pattern",
      "different-difficulty",
    ]);
  });

  it("prefers unseen Reserve content when similarity signals tie", () => {
    const ranked = rankSimilarReservePracticeQuestions({
      candidates: [candidate("seen"), candidate("unseen")],
      currentQuestion: question("current"),
      practicedQuestionIds: new Set(["seen"]),
    });
    expect(ranked.map(({ question }) => question.id)).toEqual([
      "unseen",
      "seen",
    ]);
  });

  it("excludes the current question and Reserve questions outside the topic", () => {
    const current = question("current");
    const ranked = rankSimilarReservePracticeQuestions({
      candidates: [
        {
          question: current,
          reservedAt: "2026-01-01T00:00:00.000Z",
          versionId: 1,
        },
        candidate("other-topic", { topicId: "topic:other" }),
        candidate("eligible"),
      ],
      currentQuestion: current,
      practicedQuestionIds: new Set(),
    });
    expect(ranked.map(({ question }) => question.id)).toEqual(["eligible"]);
  });
});

function candidate(
  id: string,
  overrides: Parameters<typeof question>[1] = {},
): ReservePracticeCandidate {
  return {
    question: question(id, overrides),
    reservedAt: `2026-01-${id === "seen" ? "01" : "02"}T00:00:00.000Z`,
    versionId: id.length + 1,
  };
}

function question(
  id: string,
  overrides: {
    difficulty?: TutorQuestion["difficulty"];
    misconceptionIds?: string[];
    patternIds?: string[];
    topicId?: string;
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
    review: { status: "approved" },
    solutionSteps: ["Compute the result."],
    source: {
      originalityNote: "Original professor-approved test question.",
      patternIds: overrides.patternIds,
      sourceType: "professor_provided",
      trustLevel: "professor_approved",
      visibility: "private",
    },
    title: `Question ${id}`,
    topicId: overrides.topicId ?? "topic:probability",
  };
}
