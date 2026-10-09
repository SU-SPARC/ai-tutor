import { describe, expect, it } from "vitest";

import {
  computationNumbers,
  evaluateComputation,
  operatorSignature,
} from "@/lib/similar-practice/computation";
import {
  SIMILARITY_MAX_SCORE,
  SIMILARITY_MIN_SCORE,
  SIMILAR_QUESTION_PROMPT_VERSION,
  SIMILAR_QUESTION_SCHEMA_VERSION,
  type GeneratedVariantContent,
} from "@/lib/similar-practice/contract";
import {
  evaluateSimilarQuestionCandidate,
  summarizeSimilarQuestionEvaluations,
} from "@/lib/similar-practice/evaluate";
import { canonicalJson, generatedVariantContentHash } from "@/lib/similar-practice/hash";
import { validateSimilarQuestionModelOutput } from "@/lib/similar-practice/schema";
import { scoreSimilarity, type SimilarityEvidence } from "@/lib/similar-practice/similarity";
import { toStudentGeneratedPracticeQuestion } from "@/lib/similar-practice/student-view";
import {
  badCases,
  goodCountOutput,
  goodProbabilityOutput,
  goodRealOutput,
  patched,
  probabilitySource,
} from "./fixtures/similar-practice";

describe("contract versions", () => {
  it("starts both the schema and the prompt at version 1", () => {
    expect(SIMILAR_QUESTION_SCHEMA_VERSION).toBe(1);
    expect(SIMILAR_QUESTION_PROMPT_VERSION).toBe(1);
    expect(SIMILARITY_MAX_SCORE).toBe(14);
    expect(SIMILARITY_MIN_SCORE).toBe(11);
  });
});

describe("closed model-output schema", () => {
  it.each([goodProbabilityOutput, goodCountOutput, goodRealOutput])(
    "accepts a well-formed output",
    (output) => {
      expect(validateSimilarQuestionModelOutput(output)).toMatchObject({ ok: true });
    },
  );

  it.each([
    ["schema version", "schemaVersion", 2, "schema_version"],
    ["difficulty", "variant.difficulty", "hard", "invalid_enum"],
    ["change kind", "changes", ["numbers", "colour"], "invalid_enum"],
    ["repeated change kind", "changes", ["numbers", "numbers"], "duplicate_value"],
    ["one solution step", "variant.solutionSteps", ["Only one."], "invalid_array"],
    ["one hint", "variant.hints", ["Only one."], "invalid_array"],
    [
      "five misconceptions",
      "variant.misconceptions",
      Array.from({ length: 5 }, (_, i) => ({ feedback: "f", id: `m-${i}`, matchTerms: ["1"] })),
      "invalid_array",
    ],
    [
      "duplicate misconception id",
      "variant.misconceptions",
      [
        { feedback: "f", id: "same", matchTerms: ["1"] },
        { feedback: "g", id: "same", matchTerms: ["2"] },
      ],
      "duplicate_value",
    ],
    ["misconception without terms", "variant.misconceptions.0.matchTerms", [], "invalid_array"],
    ["confidence above 1", "selfCheck.confidence", 1.5, "invalid_number"],
    ["non-finite parameter", "variant.parameters.total", Number.POSITIVE_INFINITY, "invalid_number"],
    ["bad parameter name", "variant.parameters", { "total-count": 25, favorable: 9 }, "unexpected_key"],
    ["no parameters", "variant.parameters", {}, "invalid_array"],
    ["empty title", "variant.title", "   ", "invalid_text"],
    ["source step count out of range", "sourceAnalysis.sourceStepCount", 0, "invalid_number"],
    [
      "number-list answer",
      "variant.answer.spec",
      { kind: "number_list", ordered: true, tolerance: { mode: "exact" }, values: ["1"] },
      "unsupported_answer_kind",
    ],
    ["extra nested key", "variant.answer.notes", "x", "unexpected_key"],
  ] as const)("rejects %s", (_name, path, value, code) => {
    const output = withValue(goodProbabilityOutput, path, value);
    const result = validateSimilarQuestionModelOutput(output);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.code)).toContain(code);
  });
});

/** A deep copy of `value` with one dotted path replaced, for schema tests. */
function withValue(value: unknown, path: string, replacement: unknown): unknown {
  const copy = structuredClone(value) as Record<string, unknown>;
  const keys = path.split(".");
  let target = copy;
  for (const key of keys.slice(0, -1)) {
    target = target[key] as Record<string, unknown>;
  }
  target[keys.at(-1)!] = structuredClone(replacement);
  return copy;
}

describe("computation helpers", () => {
  it("evaluates exactly with the existing evaluator", () => {
    expect(evaluateComputation("C(10,4)")).toEqual({ ok: true, sent: "210" });
    expect(evaluateComputation("1*0.4+3*0.35+8*0.25")).toEqual({ ok: true, sent: "69/20" });
    expect(evaluateComputation("9/25")).toEqual({ ok: true, sent: "9/25" });
  });

  it.each(["1/0", "9/(25-25)", "x + 1", "25%", "pi", "\\frac{1}{2}", "", "alert(1)"])(
    "refuses %s",
    (expression) => {
      expect(evaluateComputation(expression).ok).toBe(false);
    },
  );

  it("summarises the operations used", () => {
    expect(operatorSignature("C(8,3)")).toBe("choose:1");
    expect(operatorSignature("1 - 9/25")).toBe("divide:1,subtract:1");
    expect(operatorSignature("2*0.3+5*0.5+10*0.2")).toBe("add:2,multiply:3");
    expect(computationNumbers("C(10,4) / 2.5")).toEqual([10, 4, 2.5]);
  });
});

describe("similarity scorer", () => {
  const perfect: SimilarityEvidence = {
    answerFormMatch: true,
    changeKinds: 3,
    conceptTagAllowed: true,
    courseMatch: true,
    difficultyLabelMatch: true,
    duplicateOfPublished: false,
    duplicateOfSource: false,
    leakage: { firstHint: false, matchTermCorrect: false, prompt: false },
    numbersChanged: true,
    skill: {
      sourceKinds: new Set(["divide"]),
      sourceSignature: "divide:1",
      variantKinds: new Set(["divide"]),
      variantSignature: "divide:1",
    },
    sourceJaccard: 0.2,
    stepDelta: 0,
    topicMatch: true,
  };

  it("scores a perfect candidate 14/14", () => {
    const report = scoreSimilarity(perfect);
    expect(report.total).toBe(14);
    expect(report.meetsThreshold).toBe(true);
    expect(report.dimensions.every((dimension) => dimension.score === 2)).toBe(true);
  });

  it("allows borderline outcomes while the total stays at or above 11", () => {
    const report = scoreSimilarity({
      ...perfect,
      skill: { ...perfect.skill!, variantSignature: "divide:2" },
      sourceJaccard: 0.5,
      stepDelta: 2,
    });
    expect(report.total).toBe(11);
    expect(report.hardFailures).toEqual([]);
    expect(report.meetsThreshold).toBe(true);
  });

  it("fails below 11 even without a hard failure", () => {
    const report = scoreSimilarity({
      ...perfect,
      skill: { ...perfect.skill!, variantSignature: "divide:2" },
      sourceJaccard: 0.5,
      stepDelta: 2,
      // Three borderline dimensions plus one that code cannot establish.
      conceptTagAllowed: undefined,
    });
    expect(report.total).toBe(9);
    expect(report.meetsThreshold).toBe(false);
  });

  it.each([
    ["courseTopic", { topicMatch: false }],
    ["concept", { conceptTagAllowed: false }],
    ["difficulty", { difficultyLabelMatch: false }],
    ["answerForm", { answerFormMatch: false }],
    ["novelty", { sourceJaccard: 0.61 }],
    ["novelty", { numbersChanged: false }],
    ["novelty", { changeKinds: 1 }],
    ["novelty", { duplicateOfPublished: true }],
    ["leakage", { leakage: { firstHint: true, matchTermCorrect: false, prompt: false } }],
  ] as const)("a zero on %s is a hard failure", (dimension, change) => {
    const report = scoreSimilarity({ ...perfect, ...change } as SimilarityEvidence);
    expect(report.hardFailures).toContain(dimension);
    expect(report.meetsThreshold).toBe(false);
  });

  it("never scores an undetermined dimension as a pass", () => {
    const report = scoreSimilarity({ ...perfect, answerFormMatch: undefined, skill: undefined });
    expect(report.undetermined).toEqual(["skill", "answerForm"]);
    expect(report.total).toBe(10);
    expect(report.meetsThreshold).toBe(false);
    expect(report.hardFailures).toEqual([]);
  });

  it("does not need a model to score", () => {
    // Same evidence, same report: the scorer is a pure function.
    expect(scoreSimilarity(perfect)).toEqual(scoreSimilarity(perfect));
  });
});

describe("content hashing", () => {
  const content: GeneratedVariantContent = {
    answer: goodProbabilityOutput.variant.answer,
    difficulty: goodProbabilityOutput.variant.difficulty,
    hints: goodProbabilityOutput.variant.hints,
    misconceptions: goodProbabilityOutput.variant.misconceptions,
    prompt: goodProbabilityOutput.variant.prompt,
    solutionSteps: goodProbabilityOutput.variant.solutionSteps,
    title: goodProbabilityOutput.variant.title,
  };

  it("gives the same content the same hash regardless of key order", () => {
    const reordered = Object.fromEntries(
      Object.entries(content).reverse(),
    ) as GeneratedVariantContent;
    expect(generatedVariantContentHash(reordered)).toBe(
      generatedVariantContentHash(content),
    );
    expect(generatedVariantContentHash(content)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when the content changes meaningfully", () => {
    expect(
      generatedVariantContentHash({ ...content, prompt: `${content.prompt} Round to two decimals.` }),
    ).not.toBe(generatedVariantContentHash(content));
    expect(
      generatedVariantContentHash({ ...content, hints: [...content.hints].reverse() }),
    ).not.toBe(generatedVariantContentHash(content));
  });

  it("does not hash model metadata into the identity", () => {
    const fromModelA = evaluateSimilarQuestionCandidate({
      generation: { model: "model-a", provider: "openrouter", recordedFixtureId: "a" },
      output: goodProbabilityOutput,
      source: probabilitySource,
    });
    const fromModelB = evaluateSimilarQuestionCandidate({
      generation: { model: "model-b", provider: "openrouter", recordedFixtureId: "b" },
      output: patched(goodProbabilityOutput, (o) => {
        o.selfCheck.confidence = 0.1;
        o.sourceAnalysis.skill = "Different wording of the same skill.";
      }),
      source: probabilitySource,
    });
    expect(fromModelA.contentSha256).toBe(fromModelB.contentSha256);
    expect(fromModelA.variant?.generation.model).toBe("model-a");
    expect(fromModelB.variant?.generation.model).toBe("model-b");
  });

  it("serialises canonically", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: undefined }] })).toBe(
      '{"a":[2,{"d":3}],"b":1}',
    );
  });
});

describe("student-visible projection", () => {
  const variant = evaluateSimilarQuestionCandidate({
    generation: { model: "secret-model-name", provider: "openrouter" },
    output: goodProbabilityOutput,
    source: probabilitySource,
  }).variant!;

  it("exposes only display fields and a derived answer format", () => {
    const view = toStudentGeneratedPracticeQuestion(variant);
    expect(Object.keys(view).sort()).toEqual([
      "answerFormat",
      "contentKind",
      "courseId",
      "difficulty",
      "hintCount",
      "label",
      "prompt",
      "sourceQuestionId",
      "stepCount",
      "title",
      "topicId",
      "variantId",
    ]);
    expect(view).toMatchObject({
      answerFormat: { kind: "numeric", percentMode: "either" },
      contentKind: "generated_practice",
      hintCount: 3,
      label: "AI-generated practice",
      stepCount: 3,
    });
  });

  it("never contains answers, computation, parameters, match terms, reports, or model data", () => {
    const serialized = JSON.stringify(toStudentGeneratedPracticeQuestion(variant));
    for (const forbidden of [
      "9/25",
      "0.36",
      "36%",
      goodProbabilityOutput.variant.answer.explanation,
      "favorable",
      "computation",
      "parameters",
      "0.5625",
      "9/16",
      goodProbabilityOutput.variant.misconceptions[0].feedback,
      goodProbabilityOutput.variant.hints[0],
      goodProbabilityOutput.variant.solutionSteps[0],
      goodProbabilityOutput.sourceAnalysis.skill,
      "basic probability",
      "6/16",
      "secret-model-name",
      "openrouter",
      "verification",
      "similarity",
      "tolerance",
      "selfCheck",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("evaluation summary", () => {
  it("counts dispositions and the gates that failed most", () => {
    const evaluations = [
      evaluateSimilarQuestionCandidate({ output: goodProbabilityOutput, source: probabilitySource }),
      ...badCases.map(({ output, source }) =>
        evaluateSimilarQuestionCandidate({ output, source }),
      ),
    ];
    const summary = summarizeSimilarQuestionEvaluations(evaluations);

    expect(summary.candidates).toBe(1 + badCases.length);
    expect(summary.byDisposition).toEqual({
      awaiting_review: 1,
      rejected: badCases.length,
      verified_t1: 0,
    });
    expect(summary.schemaRejections).toBe(
      badCases.filter((testCase) => testCase.schemaIssue).length,
    );
    expect(summary.failedGates[0].code).toBe("similarity_threshold");
    expect(summary.meanSimilarityScore).toBeGreaterThan(0);
  });
});
