import { describe, expect, it } from "vitest";

import type { LinkedReservePracticeCandidate } from "@/lib/data/question-similarity-repository";
import { rankLinkedSimilarPracticeQuestions } from "@/lib/tutor/similar-reserve-practice";
import type { TutorQuestion } from "@/lib/types";

describe("linked Reserve similar-practice ordering", () => {
  it("prefers an unseen explicitly linked sibling before a seen sibling", () => {
    const ranked = rankLinkedSimilarPracticeQuestions({
      candidates: [candidate("seen", 1), candidate("unseen", 2)],
      practicedQuestionIds: new Set(["seen"]),
    });

    expect(ranked.map(({ question }) => question.id)).toEqual([
      "unseen",
      "seen",
    ]);
  });

  it("uses professor-assigned slot order instead of inferred content similarity", () => {
    const ranked = rankLinkedSimilarPracticeQuestions({
      candidates: [candidate("slot-three", 3), candidate("slot-one", 1)],
      practicedQuestionIds: new Set(),
    });

    expect(ranked.map(({ question }) => question.id)).toEqual([
      "slot-one",
      "slot-three",
    ]);
  });

  it("uses reservation time and stable id only as deterministic tie-breakers", () => {
    const ranked = rankLinkedSimilarPracticeQuestions({
      candidates: [
        candidate("later", 1, "2026-01-03T00:00:00.000Z"),
        candidate("earlier", 1, "2026-01-01T00:00:00.000Z"),
      ],
      practicedQuestionIds: new Set(),
    });

    expect(ranked.map(({ question }) => question.id)).toEqual([
      "earlier",
      "later",
    ]);
  });
});

function candidate(
  id: string,
  slot: 1 | 2 | 3,
  reservedAt = "2026-01-02T00:00:00.000Z",
): LinkedReservePracticeCandidate {
  return {
    originQuestionId: "origin",
    originVersionId: 17,
    question: question(id),
    reservedAt,
    slot,
    versionId: id.length + 1,
  };
}

function question(id: string): TutorQuestion {
  return {
    answer: { acceptedAnswers: ["0.5"], explanation: "Divide one by two." },
    difficulty: "intermediate",
    hints: ["Count outcomes."],
    id,
    misconceptions: [],
    prompt: `Prompt for ${id}`,
    review: { status: "approved" },
    solutionSteps: ["Compute the result."],
    source: {
      originalityNote: "Original professor-approved test question.",
      sourceType: "professor_provided",
      trustLevel: "professor_approved",
      visibility: "private",
    },
    title: `Question ${id}`,
    topicId: "topic:probability",
  };
}
