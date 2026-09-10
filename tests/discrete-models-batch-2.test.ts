import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import candidates from "../data/demo/discrete-models-batch-2-review-candidates.json";
import topics from "../data/canonical/syllabus-topics.json";
import { checkAnswer } from "@/lib/tutor/answer-checker";
import {
  parseRational,
  rationalToNumber,
  withinTolerance,
} from "@/lib/tutor/answer/rational";
import { validateAnswerSpec, type AnswerSpec } from "@/lib/tutor/answer/spec";
import { detectMisconceptions } from "@/lib/tutor/misconceptions";
import { demoQuestions, reviewCandidates } from "@/lib/data/demo-data";
import {
  loadPublicReviewCandidateFixtures,
  REVIEW_CANDIDATE_FILES,
} from "../scripts/lib/review-candidate-import.mjs";

const fixtureFile = "data/demo/discrete-models-batch-2-review-candidates.json";
const prefix = "generated-discrete-batch-2-";
type Candidate = (typeof candidates)[number];

// Independent oracles: convolve Bernoulli indicators rather than using the
// authored binomial coefficient formulas or importing generator calculations.
function binomialMasses(n: number, p: number) {
  let masses = [1];
  for (let trial = 0; trial < n; trial++) {
    const next = Array<number>(masses.length + 1).fill(0);
    masses.forEach((mass, successes) => {
      next[successes] += mass * (1 - p);
      next[successes + 1] += mass * p;
    });
    masses = next;
  }
  return masses;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function stoppingProbability() {
  let probability = 0;
  // Enumerate seven-trial sequences with success on trial seven and exactly
  // three successes total. This counts the valid stopping sequences directly.
  for (let mask = 0; mask < 128; mask++) {
    if (!(mask & 64)) continue;
    let successes = 0,
      weight = 1;
    for (let i = 0; i < 7; i++) {
      const success = Boolean(mask & (1 << i));
      successes += Number(success);
      weight *= success ? 0.35 : 0.65;
    }
    if (successes === 3) probability += weight;
  }
  return probability;
}

function languageProbability() {
  let probability = 0;
  for (let code = 0; code < 3 ** 8; code++) {
    let remaining = code,
      weight = 1;
    const counts = [0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const category = remaining % 3;
      remaining = Math.floor(remaining / 3);
      counts[category]++;
      weight *= [0.5, 0.3, 0.2][category];
    }
    if (counts[0] === 3 && counts[1] === 3 && counts[2] === 2)
      probability += weight;
  }
  return probability;
}

function poissonMasses(lambda: number, last: number) {
  // Evaluate exp(-lambda) via the reciprocal Taylor series for exp(lambda),
  // then obtain successive Poisson masses by their ratio lambda / j.
  let term = 1,
    exponential = 1;
  for (let j = 1; j <= 80; j++) {
    term *= lambda / j;
    exponential += term;
  }
  const masses = [1 / exponential];
  for (let j = 1; j <= last; j++) masses.push((masses[j - 1] * lambda) / j);
  return masses;
}

const redemptionMasses = binomialMasses(48, 0.25);
const mean = sum(redemptionMasses.map((mass, j) => mass * j));
const variance = sum(redemptionMasses.map((mass, j) => mass * (j - mean) ** 2));
const oracles: Record<
  string,
  { correct: number[]; wrong: number; wrongAnswer?: string }
> = {
  "binomial-at-least": {
    correct: [sum(binomialMasses(9, 0.4).slice(3))],
    wrong: binomialMasses(9, 0.4)[3],
  },
  "binomial-at-most": {
    correct: [sum(binomialMasses(12, 0.15).slice(0, 3))],
    wrong: sum(binomialMasses(12, 0.15).slice(3)),
  },
  "binomial-mean-sd": {
    correct: [mean, Math.sqrt(variance)],
    wrong: variance,
    wrongAnswer: "12, 9",
  },
  "negative-binomial-third-success": {
    correct: [stoppingProbability()],
    wrong: binomialMasses(6, 0.35)[2],
  },
  "multinomial-three-categories": {
    correct: [languageProbability()],
    wrong: 0.5 * 0.5 * 0.5 * 0.3 * 0.3 * 0.3 * 0.2 * 0.2,
  },
  "geometric-tail": {
    correct: [1 - sum(Array.from({ length: 5 }, (_, i) => 0.82 ** i * 0.18))],
    wrong: 0.82 ** 4 * 0.18,
  },
  "poisson-rate-rescaling": {
    correct: [poissonMasses((4.8 * 25) / 60, 3)[3]],
    wrong: poissonMasses(4.8, 3)[3],
  },
  "poisson-binomial-approximation": {
    correct: [sum(poissonMasses(1800 * 0.0015, 1))],
    wrong: sum(poissonMasses(0.0015, 1)),
  },
};

function check(candidate: Candidate, studentAnswer: string) {
  return checkAnswer({
    acceptedAnswers: candidate.answer.acceptedAnswers,
    spec: candidate.answer.spec as AnswerSpec,
    studentAnswer,
  });
}

function detected(candidate: Candidate, studentAnswer: string) {
  return detectMisconceptions({
    studentAnswer,
    topicId: candidate.topicId,
    questionMisconceptions: candidate.misconceptions,
  })
    .filter((match) => match.source === "question")
    .map((match) => match.id);
}

// Frozen pre-cleanup grading fields: prose and match-term edits must not
// change canonical values, accepted forms, answer kinds, or tolerances.
const gradingBeforeCleanup = {
  "binomial-at-least": {
    acceptedAnswers: ["0.768212992", "76.8212992%"],
    numericValue: 0.768212992,
    tolerance: 0.001,
    spec: {
      kind: "numeric",
      value: "0.768212992",
      domain: "probability",
      percentMode: "either",
      tolerance: {
        mode: "absolute",
        value: 0.001,
      },
    },
  },
  "binomial-at-most": {
    acceptedAnswers: [
      "0.735818086223450927734375",
      "73.5818086223450927734375%",
    ],
    numericValue: 0.7358180862234509,
    tolerance: 0.001,
    spec: {
      kind: "numeric",
      value: "0.735818086223450927734375",
      domain: "probability",
      percentMode: "either",
      tolerance: {
        mode: "absolute",
        value: 0.001,
      },
    },
  },
  "binomial-mean-sd": {
    acceptedAnswers: ["12, 3", "12.0; 3.0"],
    spec: {
      kind: "number_list",
      values: ["12", "3"],
      ordered: true,
      tolerance: {
        mode: "exact",
      },
    },
  },
  "negative-binomial-third-success": {
    acceptedAnswers: ["0.11480183203125", "11.480183203125%"],
    numericValue: 0.11480183203125,
    tolerance: 0.001,
    spec: {
      kind: "numeric",
      value: "0.11480183203125",
      domain: "probability",
      percentMode: "either",
      tolerance: {
        mode: "absolute",
        value: 0.001,
      },
    },
  },
  "multinomial-three-categories": {
    acceptedAnswers: ["0.0756", "189/2500", "7.56%"],
    numericValue: 0.0756,
    tolerance: 0.001,
    spec: {
      kind: "numeric",
      value: "189/2500",
      domain: "probability",
      percentMode: "either",
      tolerance: {
        mode: "absolute",
        value: 0.001,
      },
    },
  },
  "geometric-tail": {
    acceptedAnswers: ["0.3707398432", "37.07398432%"],
    numericValue: 0.3707398432,
    tolerance: 0.001,
    spec: {
      kind: "numeric",
      value: "0.3707398432",
      domain: "probability",
      percentMode: "either",
      tolerance: {
        mode: "absolute",
        value: 0.001,
      },
    },
  },
  "poisson-rate-rescaling": {
    acceptedAnswers: ["0.180447044315484", "18.0447044315484%"],
    numericValue: 0.180447044315484,
    tolerance: 0.001,
    spec: {
      kind: "numeric",
      value: "0.180447044315484",
      domain: "probability",
      percentMode: "either",
      tolerance: {
        mode: "absolute",
        value: 0.001,
      },
    },
  },
  "poisson-binomial-approximation": {
    acceptedAnswers: ["0.248660397137074", "24.8660397137074%"],
    numericValue: 0.248660397137074,
    tolerance: 0.001,
    spec: {
      kind: "numeric",
      value: "0.248660397137074",
      domain: "probability",
      percentMode: "either",
      tolerance: {
        mode: "absolute",
        value: 0.001,
      },
    },
  },
};

describe("targeted discrete models batch 2", () => {
  it.each(candidates)(
    "preserves every pre-cleanup grading field and the single misconception for $id",
    (candidate) => {
      const grading = Object.fromEntries(
        Object.entries(candidate.answer).filter(
          ([key]) => key !== "explanation",
        ),
      );
      const key = candidate.id.slice(
        prefix.length,
      ) as keyof typeof gradingBeforeCleanup;
      expect(grading).toEqual(gradingBeforeCleanup[key]);
      expect(candidate.misconceptions).toHaveLength(1);
    },
  );

  it.each([
    [
      "binomial-at-least",
      "point-instead-of-upper-tail",
      "0.2508",
      4,
      "nearest",
    ],
    ["binomial-at-least", "point-instead-of-upper-tail", "0.251", 3, "nearest"],
    [
      "binomial-at-most",
      "complement-of-requested-lower-tail",
      "0.2642",
      4,
      "nearest",
    ],
    [
      "binomial-at-most",
      "complement-of-requested-lower-tail",
      "0.264",
      3,
      "nearest",
    ],
    [
      "negative-binomial-third-success",
      "final-success-omitted",
      "0.3280",
      4,
      "nearest",
    ],
    [
      "negative-binomial-third-success",
      "final-success-omitted",
      "0.328",
      3,
      "nearest",
    ],
    [
      "geometric-tail",
      "point-instead-of-geometric-tail",
      "0.0814",
      4,
      "nearest",
    ],
    [
      "geometric-tail",
      "point-instead-of-geometric-tail",
      "0.081",
      3,
      "nearest",
    ],
    [
      "poisson-rate-rescaling",
      "hourly-mean-not-rescaled",
      "0.1517",
      4,
      "nearest",
    ],
    [
      "poisson-rate-rescaling",
      "hourly-mean-not-rescaled",
      "0.152",
      3,
      "nearest",
    ],
    [
      "poisson-binomial-approximation",
      "single-trial-probability-as-mean",
      "1.0",
      1,
      "nearest",
    ],
    [
      "poisson-binomial-approximation",
      "single-trial-probability-as-mean",
      "0.99999",
      5,
      "toward-zero",
    ],
  ] as const)(
    "%s recognizes the independently verified rounded wrong answer %s / %s",
    (key, misconceptionKey, term, places, rounding) => {
      const candidate = candidates.find(
        (entry) => entry.id === `${prefix}${key}`,
      )!;
      const wrong = oracles[key].wrong;
      // 0.99999 is a directed rounding (truncation), not rounding to nearest.
      const rounded =
        rounding === "toward-zero"
          ? (Math.trunc(wrong * 10 ** places) / 10 ** places).toFixed(places)
          : wrong.toFixed(places);
      expect(rounded).toBe(term);
      const expectedId = `misconception-discrete-batch-2-${misconceptionKey}`;
      expect(candidate.misconceptions).toHaveLength(1);
      expect(candidate.misconceptions[0].id).toBe(expectedId);
      expect(candidate.misconceptions[0].matchTerms).toContain(term);
      const spec = candidate.answer.spec as AnswerSpec;
      if (spec.kind !== "numeric")
        throw new Error("Expected a numeric probability spec.");
      expect(
        withinTolerance(
          parseRational(term)!,
          parseRational(spec.value)!,
          parseRational("0.001")!,
        ),
      ).toBe(false);
      expect(check(candidate, term).outcome).toBe("incorrect");
      const matches = detectMisconceptions({
        studentAnswer: term,
        topicId: candidate.topicId,
        questionMisconceptions: candidate.misconceptions,
      });
      expect(matches.map(({ id, source }) => ({ id, source }))).toEqual([
        { id: expectedId, source: "question" },
      ]);
    },
  );

  it("keeps the probability-as-mean term decimal so unrelated fraction parts do not match", () => {
    const candidate = candidates.find(
      (entry) => entry.id === `${prefix}poisson-binomial-approximation`,
    )!;
    expect(candidate.misconceptions[0].matchTerms).toContain("1.0");
    expect(candidate.misconceptions[0].matchTerms).not.toContain("1");
    for (const answer of ["1/2", "2/1", "7/11"]) {
      expect(detected(candidate, answer)).toEqual([]);
    }
  });

  it.each(candidates)(
    "validates the real typed spec and answer forms for $id",
    (candidate) => {
      const spec = candidate.answer.spec as AnswerSpec;
      expect(
        validateAnswerSpec(spec, candidate.answer.acceptedAnswers),
      ).toEqual([]);
      const canonical =
        spec.kind === "number_list"
          ? spec.values.join(", ")
          : spec.kind === "numeric"
            ? spec.value
            : "";
      expect(check(candidate, canonical).outcome).toBe("correct");
      for (const accepted of candidate.answer.acceptedAnswers) {
        expect(check(candidate, accepted).outcome, accepted).toBe("correct");
        expect(detected(candidate, accepted), accepted).toEqual([]);
      }
      // Additional equivalents are not accepted-answer aliases.
      const equivalent =
        spec.kind === "number_list"
          ? "24/2, 6/2"
          : `${candidate.answer.numericValue}e0`;
      expect(check(candidate, equivalent).outcome).toBe("correct");
      for (const malformed of [
        "",
        "not a number",
        "1/0",
        "--2",
        "1e999",
        "12,,3",
        "<script>",
        "9".repeat(501),
      ]) {
        expect(() => check(candidate, malformed), malformed).not.toThrow();
        expect(check(candidate, malformed).isCorrect, malformed).toBe(false);
      }
    },
  );

  it.each(candidates)(
    "agrees with an independent mathematical oracle for $id",
    (candidate) => {
      const oracle = oracles[candidate.id.slice(prefix.length)];
      expect(oracle).toBeDefined();
      const spec = candidate.answer.spec as AnswerSpec;
      const values =
        spec.kind === "number_list"
          ? spec.values
          : spec.kind === "numeric"
            ? [spec.value]
            : [];
      expect(values).toHaveLength(oracle.correct.length);
      values.forEach((value, index) => {
        expect(rationalToNumber(parseRational(value)!)).toBeCloseTo(
          oracle.correct[index],
          13,
        );
      });
      if (spec.kind === "numeric") {
        expect(candidate.answer.numericValue).toBeCloseTo(
          oracle.correct[0],
          13,
        );
        expect(spec).toMatchObject({
          domain: "probability",
          percentMode: "either",
          tolerance: { mode: "absolute", value: 0.001 },
        });
        expect(candidate.answer.tolerance).toBe(0.001);
      } else {
        expect(spec).toMatchObject({
          kind: "number_list",
          ordered: true,
          tolerance: { mode: "exact" },
        });
        expect(check(candidate, "3, 12").outcome).toBe("incorrect");
      }
    },
  );

  it.each(candidates)(
    "rejects independently computed misconception values and identifies the intended error for $id",
    (candidate) => {
      const oracle = oracles[candidate.id.slice(prefix.length)];
      const misconception = candidate.misconceptions[0];
      expect(
        rationalToNumber(parseRational(misconception.matchTerms[0])!),
      ).toBeCloseTo(oracle.wrong, 13);
      const wrongAnswer = oracle.wrongAnswer ?? misconception.matchTerms[0];
      expect(check(candidate, wrongAnswer).outcome).toBe("incorrect");
      expect(detected(candidate, wrongAnswer)).toEqual([misconception.id]);
      for (const term of misconception.matchTerms) {
        expect(check(candidate, term).outcome, term).toBe("incorrect");
        expect(detected(candidate, term), term).toEqual([misconception.id]);
        // Equivalent rational representations work through the current matcher.
        const rational = parseRational(term)!;
        expect(detected(candidate, `${rational.n}/${rational.d}`)).toEqual([
          misconception.id,
        ]);
      }
    },
  );

  it("has eight distinct tasks with the required difficulty mix and truthful review gates", () => {
    expect(candidates).toHaveLength(8);
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(8);
    expect(
      candidates.map((candidate) => candidate.id.slice(prefix.length)).sort(),
    ).toEqual(Object.keys(oracles).sort());
    expect(
      candidates.filter((c) => c.difficulty === "foundational"),
    ).toHaveLength(1);
    expect(
      candidates.filter((c) => c.difficulty === "intermediate"),
    ).toHaveLength(4);
    expect(candidates.filter((c) => c.difficulty === "challenge")).toHaveLength(
      3,
    );
    const topic = topics.find((entry) => entry.id === "binomial-models")!;
    for (const candidate of candidates) {
      expect(candidate.topicId).toBe(topic.id);
      expect(candidate.topic).toBe(topic.title);
      expect(candidate.source).toMatchObject({
        sourceType: "generated_original",
        trustLevel: "generated_unverified",
        visibility: "public",
      });
      expect(candidate.review.status).toBe("needs_review");
      expect(candidate.review).not.toHaveProperty("reviewPriority");
      expect(candidate).not.toHaveProperty("patternId");
      expect(candidate.source).not.toHaveProperty("patternIds");
    }
  });

  it("has three progressive hints and three to five meaningful solution steps each", () => {
    const allHints = candidates.flatMap((candidate) => candidate.hints);
    expect(new Set(allHints).size).toBe(24);
    for (const candidate of candidates) {
      expect(candidate.hints).toHaveLength(3);
      expect(candidate.solutionSteps.length).toBeGreaterThanOrEqual(3);
      expect(candidate.solutionSteps.length).toBeLessThanOrEqual(5);
      expect(candidate.answer.explanation).toBe(candidate.solutionSteps.at(-1));
      expect(candidate.misconceptions.length).toBeGreaterThanOrEqual(1);
      expect(candidate.misconceptions.length).toBeLessThanOrEqual(2);
      for (const hint of candidate.hints) {
        expect(hint).not.toBe(candidate.prompt);
        for (const accepted of candidate.answer.acceptedAnswers)
          expect(hint).not.toContain(accepted);
      }
    }
  });

  it("loads through the normal review path and never adds an approved demo question", () => {
    for (const candidate of candidates) {
      expect(
        reviewCandidates.find((entry) => entry.id === candidate.id),
      ).toEqual(candidate);
      expect(demoQuestions.some((entry) => entry.id === candidate.id)).toBe(
        false,
      );
    }
  });

  it("passes the repository fixture validator without repeated historical IDs or prompts", async () => {
    expect(REVIEW_CANDIDATE_FILES).toContain(fixtureFile);
    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());
    expect(
      fixtures.candidates.filter((entry) => entry.sourceFile === fixtureFile),
    ).toHaveLength(8);
    const historical = fixtures.candidates.filter(
      (entry) => entry.sourceFile !== fixtureFile,
    );
    for (const candidate of candidates) {
      expect(
        historical.some((entry) => entry.candidate.id === candidate.id),
      ).toBe(false);
      expect(
        historical.some((entry) => entry.candidate.prompt === candidate.prompt),
      ).toBe(false);
    }
  });

  it("reproduces the committed fixture and validates every registered group without a database", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/generate-discrete-models-batch-2.mjs", "--check"],
      { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "8 typed drafts; fixture validator passed (264 total candidates)",
    );
  });
});
