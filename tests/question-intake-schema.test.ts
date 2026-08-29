import { describe, expect, it } from "vitest";

import {
  questionIntakePromptFingerprint,
  rankQuestionIntakeDuplicates,
} from "@/lib/question-intake/duplicates";
import {
  QUESTION_INTAKE_IMAGE_MAX_BYTES,
  QuestionIntakeImageError,
  validateQuestionIntakeImage,
} from "@/lib/question-intake/image";
import {
  hasBlockingQuestionIntakeFailure,
  originalityNoteForQuestionIntake,
  validateQuestionIntakeModelDraft,
  verifyQuestionIntakeDraft,
} from "@/lib/question-intake/schema";
import type {
  QuestionIntakeModelDraft,
  QuestionIntakeTopic,
} from "@/lib/question-intake/types";

const topics: QuestionIntakeTopic[] = [
  {
    description: "Condition on events and apply Bayes' formula.",
    id: "conditional-probability",
    title: "Conditional Probability",
  },
  {
    description: "Use named discrete models.",
    id: "binomial-models",
    title: "Binomial Models",
  },
];

describe("question intake structured schema", () => {
  it("accepts a complete typed numerical draft using only canonical values", () => {
    const validation = validateQuestionIntakeModelDraft(numericDraft(), topics);
    const verified = verifyQuestionIntakeDraft(validation.draft!, topics);

    expect(validation.errors).toEqual([]);
    expect(verified).toMatchObject({
      answerType: "numeric",
      difficulty: "intermediate",
      questionType: "free_response",
      topicId: "conditional-probability",
      review: { required: true, status: "needs_professor_review" },
    });
    expect(verified.hints).toHaveLength(3);
    expect(verified.solutionSteps.length).toBeGreaterThan(1);
    expect(hasBlockingQuestionIntakeFailure(verified)).toBe(false);
  });

  it("rejects invalid JSON shapes, invented topics, enums, and missing tutoring fields", () => {
    expect(
      validateQuestionIntakeModelDraft("not-json", topics).draft,
    ).toBeUndefined();

    const invalid = {
      ...numericDraft(),
      answer: { acceptedAnswers: [], explanation: "" },
      difficulty: "easy",
      hints: ["One hint only"],
      questionType: "multiple_choice",
      solutionSteps: [],
      topicId: "invented-topic",
    };
    const validation = validateQuestionIntakeModelDraft(invalid, topics);

    expect(validation.draft).toBeUndefined();
    expect(validation.errors.join(" ")).toMatch(
      /topicId|questionType|difficulty|acceptedAnswers|hints|solutionSteps/i,
    );
  });

  it("flags answer-solution disagreement and an answer-revealing first hint", () => {
    const candidate = numericDraft();
    candidate.answer.numericValue = 0.75;
    candidate.answer.acceptedAnswers = ["3/4"];
    candidate.hints[0] = "The final answer is 3/4.";
    const validation = validateQuestionIntakeModelDraft(candidate, topics);
    const verified = verifyQuestionIntakeDraft(validation.draft!, topics);

    expect(verified.review.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "answer_solution_consistency",
          status: "failed",
        }),
        expect.objectContaining({ code: "hint_progression", status: "failed" }),
      ]),
    );
    expect(hasBlockingQuestionIntakeFailure(verified)).toBe(true);
    expect(verified.warnings.join(" ")).toMatch(/could not verify/i);
  });

  it("allows a meaningful empty misconception state", () => {
    const candidate = numericDraft();
    candidate.misconceptions = [];

    expect(
      validateQuestionIntakeModelDraft(candidate, topics).draft?.misconceptions,
    ).toEqual([]);
  });

  it("uses professor-provided provenance notes without fabricating pattern IDs", () => {
    for (const source of [
      "professor_authored",
      "professor_provided_course_material",
      "licensed_approved_course_material",
      "unknown_needs_review",
    ] as const) {
      const note = originalityNoteForQuestionIntake(source);
      expect(note).toMatch(/Professor|professor/);
      expect(note).not.toMatch(/pattern[_ -]?id|pattern-derived/i);
    }
  });
});

describe("question intake duplicate detection", () => {
  it("finds normalized exact text and same-structure variants without blocking them", () => {
    const prompt = "A fair die is rolled 2 times. What is P(the sum is 7)?";
    const duplicates = rankQuestionIntakeDuplicates({
      candidates: [
        {
          prompt: "  A FAIR die is rolled 2 times. What is P(the sum is 7)? ",
          questionId: "question-exact",
          title: "Exact",
          topicId: "conditional-probability",
        },
        {
          prompt: "A fair die is rolled 3 times. What is P(the sum is 9)?",
          questionId: "question-variant",
          title: "Variant",
          topicId: "conditional-probability",
        },
      ],
      prompt,
      topicId: "conditional-probability",
    });

    expect(questionIntakePromptFingerprint(prompt)).toBe(
      "a fair die is rolled 2 times. what is p(the sum is 7)?",
    );
    expect(duplicates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          questionId: "question-exact",
          reason: "exact_text",
        }),
        expect.objectContaining({
          questionId: "question-variant",
          reason: "same_structure",
        }),
      ]),
    );
  });
});

describe("question intake image security", () => {
  it("accepts a signed PNG in memory and rejects extension or size mismatches", () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    const image = validateQuestionIntakeImage({
      bytes: pngBytes,
      name: "question.png",
      size: pngBytes.byteLength,
      type: "image/png",
    });

    expect(image.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(() =>
      validateQuestionIntakeImage({
        bytes: pngBytes,
        name: "question.jpg",
        size: pngBytes.byteLength,
        type: "image/jpeg",
      }),
    ).toThrow(QuestionIntakeImageError);
    expect(() =>
      validateQuestionIntakeImage({
        bytes: pngBytes,
        name: "large.png",
        size: QUESTION_INTAKE_IMAGE_MAX_BYTES + 1,
        type: "image/png",
      }),
    ).toThrow(/5MB/i);
  });
});

function numericDraft(): QuestionIntakeModelDraft {
  return {
    answer: {
      acceptedAnswers: ["1/2", "0.5", "50%"],
      explanation:
        "There are 18 favorable ordered outcomes among 36 equally likely outcomes, so the probability is 18/36 = 1/2.",
      numericValue: 0.5,
      tolerance: 0.0001,
    },
    answerType: "numeric",
    confidence: { answer: 0.96, extraction: 1, overall: 0.91, topic: 0.9 },
    difficulty: "intermediate",
    hints: [
      "List the equally likely ordered outcomes for the two rolls.",
      "Count the favorable outcomes, then divide by the total number of outcomes.",
      "Use 18 favorable outcomes out of 36 total outcomes.",
    ],
    misconceptions: [
      {
        feedback: "Use ordered outcomes consistently in both counts.",
        id: "unordered-outcomes",
        matchTerms: ["18", "21"],
      },
    ],
    prompt:
      "A fair die is rolled twice. What is the probability that exactly one roll is even?",
    questionType: "free_response",
    schemaVersion: 1,
    solutionSteps: [
      "There are 6 × 6 = 36 equally likely ordered outcomes.",
      "Choose which roll is even in 2 ways, then choose its even value in 3 ways and the odd value in 3 ways.",
      "The favorable count is 2 × 3 × 3 = 18.",
      "Therefore the requested probability is 18/36 = 1/2 = 0.5.",
    ],
    title: "Two-roll probability",
    topicId: "conditional-probability",
    unreadableSegments: [],
    warnings: [],
  };
}
