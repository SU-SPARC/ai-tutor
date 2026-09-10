import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import remediated from "../data/demo/remediated-syllabus-review-candidates.json";
import originals from "../data/demo/syllabus-review-candidates.json";
import { checkAnswer } from "@/lib/tutor/answer-checker";
import { validateAnswerSpec, type AnswerSpec } from "@/lib/tutor/answer/spec";
import { detectMisconceptions } from "@/lib/tutor/misconceptions";
import {
  REVIEW_CANDIDATE_FILES,
  loadPublicReviewCandidateFixtures,
} from "../scripts/lib/review-candidate-import.mjs";

const REMEDIATED_FILE = "data/demo/remediated-syllabus-review-candidates.json";
const BOILERPLATE_HINT =
  /identify whether this is|write the relevant counts|check that the result has the correct scale/i;
// The only v2s whose wording differs from the original; answers are unchanged.
const REWORDED_IDS = new Set([
  "generated-syllabus-product-route-code-v2",
  "generated-syllabus-uniform-numbered-tiles-v2",
]);
// Documented difficulty relabels from the batch 1 content audit.
const RELABELED_DIFFICULTY = new Map([
  ["generated-syllabus-role-volunteers-v2", "intermediate"],
  ["generated-syllabus-role-editors-v2", "intermediate"],
  ["generated-syllabus-addition-disjoint-checks-v2", "foundational"],
]);
const originalsById = new Map(originals.map((entry) => [entry.id, entry]));

function byId(id: string) {
  const candidate = remediated.find((entry) => entry.id === id);
  expect(candidate, id).toBeDefined();
  return candidate!;
}

function detectedIds(candidate: (typeof remediated)[number], answer: string) {
  return detectMisconceptions({
    questionMisconceptions: candidate.misconceptions,
    studentAnswer: answer,
    topicId: candidate.topicId,
  })
    .filter((match) => match.source === "question")
    .map((match) => match.id);
}

function originalOf(candidate: (typeof remediated)[number]) {
  const original = originalsById.get(candidate.id.replace(/-v2$/, ""));
  expect(original, candidate.id).toBeDefined();
  return original!;
}

describe("remediated syllabus review candidates (batch 1)", () => {
  it("derives 22 v2 candidates from intact originals without changing answers", () => {
    expect(remediated).toHaveLength(22);
    expect(new Set(remediated.map((entry) => entry.id)).size).toBe(22);
    for (const candidate of remediated) {
      expect(candidate.id.endsWith("-v2")).toBe(true);
      const original = originalOf(candidate);
      expect(candidate.topicId).toBe(original.topicId);
      expect(candidate.difficulty).toBe(
        RELABELED_DIFFICULTY.get(candidate.id) ?? original.difficulty,
      );
      expect(candidate.patternSource).toBe(original.patternSource);
      expect(candidate.answer.acceptedAnswers).toEqual(
        original.answer.acceptedAnswers,
      );
      expect(candidate.answer.numericValue).toBe(original.answer.numericValue);
      expect(candidate.answer.tolerance).toBe(original.answer.tolerance);
      if (!REWORDED_IDS.has(candidate.id))
        expect(candidate.prompt).toBe(original.prompt);
      expect(candidate.source).toMatchObject({
        sourceType: "generated_original",
        trustLevel: "generated_unverified",
        visibility: "public",
      });
      expect(candidate.source.originalityNote).toContain(original.id);
      expect(candidate.review.status).toBe("needs_review");
      expect(candidate.review.notes).toContain(original.id);
    }
    // The historical originals stay byte-for-byte as the importer knows them.
    expect(originals).toHaveLength(40);
    expect(originals.every((entry) => !("spec" in entry.answer))).toBe(true);
    expect(new Set(originals.map((entry) => entry.topicId)).size).toBe(2);
  });

  it("gives every candidate three specific, progressive hints that never state the answer", () => {
    for (const candidate of remediated) {
      expect(candidate.hints, candidate.id).toHaveLength(3);
      expect(new Set(candidate.hints).size).toBe(3);
      for (const hint of candidate.hints) {
        expect(hint, candidate.id).not.toMatch(BOILERPLATE_HINT);
        expect(hint.trim().length).toBeGreaterThan(12);
        expect(hint, candidate.id).not.toBe(candidate.prompt);
        for (const accepted of candidate.answer.acceptedAnswers)
          expect(hint, `${candidate.id}: ${hint}`).not.toContain(accepted);
      }
      expect(candidate.solutionSteps.length).toBeGreaterThanOrEqual(3);
      expect(candidate.solutionSteps.at(-1)).toBe(candidate.answer.explanation);
      expect(candidate.solutionSteps.join(" ")).not.toMatch(
        /(?:^|\s)(\S+) = \1(?=\.|\s|$)/, // no "5/12 = 5/12." template artifacts
      );
    }
  });

  it("grades every accepted answer correct under its typed spec", () => {
    for (const candidate of remediated) {
      const spec = candidate.answer.spec as AnswerSpec;
      expect(spec.kind).toBe("numeric");
      expect(
        validateAnswerSpec(spec, candidate.answer.acceptedAnswers),
        candidate.id,
      ).toEqual([]);
      if (spec.kind === "numeric") {
        expect(
          spec.domain === "count" ? spec.tolerance : spec.tolerance,
        ).toEqual(
          spec.domain === "count"
            ? { mode: "exact" }
            : { mode: "absolute", value: candidate.answer.tolerance },
        );
        if (spec.domain === "count") expect(spec.requiredForm).toBe("integer");
        else expect(spec.percentMode).toBe("either");
      }
      for (const accepted of candidate.answer.acceptedAnswers)
        expect(
          checkAnswer({
            acceptedAnswers: candidate.answer.acceptedAnswers,
            spec,
            studentAnswer: accepted,
          }).outcome,
          `${candidate.id}: ${accepted}`,
        ).toBe("correct");
    }
  });

  it("uses computed wrong values that grade incorrect and trigger their own misconception first", () => {
    for (const candidate of remediated) {
      expect(candidate.misconceptions.length).toBeGreaterThanOrEqual(1);
      expect(candidate.misconceptions.length).toBeLessThanOrEqual(2);
      // The database snapshot orders misconceptions by id; the fixture must
      // match that order or the importer's idempotent re-import breaks.
      expect(candidate.misconceptions.map((entry) => entry.id)).toEqual(
        [...candidate.misconceptions.map((entry) => entry.id)].sort(),
      );
      const spec = candidate.answer.spec as AnswerSpec;
      for (const misconception of candidate.misconceptions) {
        expect(
          misconception.matchTerms.length,
          misconception.id,
        ).toBeGreaterThan(0);
        expect(misconception.feedback).not.toMatch(BOILERPLATE_HINT);
        for (const term of misconception.matchTerms) {
          const graded = checkAnswer({
            acceptedAnswers: candidate.answer.acceptedAnswers,
            spec,
            studentAnswer: term,
          });
          expect(graded.outcome, `${candidate.id}: ${term}`).toBe("incorrect");
          const detected = detectMisconceptions({
            questionMisconceptions: candidate.misconceptions,
            studentAnswer: term,
            topicId: candidate.topicId,
          });
          expect(detected[0]?.id, `${candidate.id}: ${term}`).toBe(
            misconception.id,
          );
          expect(detected[0]?.source).toBe("question");
        }
      }
    }
  });

  it("records the publish or Reserve disposition in review notes and pairs siblings", () => {
    const ids = new Set(remediated.map((entry) => entry.id));
    const publish = remediated.filter((entry) =>
      /publish candidate/.test(entry.review.notes),
    );
    const reserve = remediated.filter((entry) =>
      /Reserve candidate/.test(entry.review.notes),
    );
    expect(publish).toHaveLength(15);
    expect(reserve).toHaveLength(7);
    expect(publish.length + reserve.length).toBe(remediated.length);
    // Priority stays a professor decision; the fixture never pre-sets it.
    expect(
      remediated.every((entry) => !("reviewPriority" in entry.review)),
    ).toBe(true);
    for (const entry of reserve) {
      const sibling = entry.review.notes.match(
        /sibling of (generated-syllabus-[a-z0-9-]+-v2)/,
      )?.[1];
      expect(sibling, entry.id).toBeDefined();
      expect(ids.has(sibling!)).toBe(true);
      const partner = remediated.find((candidate) => candidate.id === sibling)!;
      expect(partner.review.notes).toMatch(/publish candidate/);
      expect(partner.topicId).toBe(entry.topicId);
      expect(partner.patternSource).toBe(entry.patternSource);
    }
    // Reserve siblings never share a misconception ID with any other question;
    // sibling grouping lives only in the review notes until a truthful
    // grouping field exists.
    const misconceptionIds = remediated.flatMap((entry) =>
      entry.misconceptions.map((misconception) => misconception.id),
    );
    expect(new Set(misconceptionIds).size).toBe(misconceptionIds.length);
    expect(remediated.every((entry) => !("patternIds" in entry.source))).toBe(
      true,
    );
  });

  it("keeps the batch 1 substring-collision fixes: removed terms never fire, retained terms still do", () => {
    // venn-neither-newsletter: "7/45" was dropped because it also fired inside
    // "27/45", the not-evening answer that belongs to complement-of-one-group.
    const neither = byId("generated-syllabus-venn-neither-newsletter-v2");
    const overlapTwice =
      "misconception-venn-neither-newsletter-overlap-subtracted-twice";
    const oneGroup =
      "misconception-venn-neither-newsletter-complement-of-one-group";
    const neitherTerms = (id: string) =>
      neither.misconceptions.find((entry) => entry.id === id)!.matchTerms;
    expect(neitherTerms(overlapTwice)).not.toContain("7/45");
    expect(neitherTerms(oneGroup)).toEqual(
      expect.arrayContaining(["25/45", "5/9", "27/45", "3/5", "60%"]),
    );
    // "0.6" would also fire on 0.667, the union left uncomplemented (30/45).
    expect(neitherTerms(oneGroup)).not.toContain("0.6");
    for (const answer of ["27/45", "3/5", "60%"])
      expect(detectedIds(neither, answer), answer).toEqual([oneGroup]);
    for (const answer of ["7/45", "0.667", "30/45", "2/3"])
      expect(detectedIds(neither, answer), answer).not.toContain(overlapTwice);
    for (const answer of ["0.667", "30/45", "2/3"])
      expect(detectedIds(neither, answer), answer).not.toContain(oneGroup);
    for (const answer of ["0.156", "0.16", "15.56%", "15.6%"])
      expect(detectedIds(neither, answer), answer).toEqual([overlapTwice]);

    // uniform-library-cards: "0.6" was dropped because it also fired on 0.625,
    // the 10/16 complement error.
    const library = byId("generated-syllabus-uniform-library-cards-v2");
    const odds = "misconception-uniform-library-cards-odds-instead-of-probability";
    const libraryOdds = library.misconceptions.find(
      (entry) => entry.id === odds,
    )!.matchTerms;
    expect(libraryOdds).toEqual(["6/10", "3/5", "60%"]);
    for (const answer of ["0.625", "10/16", "62.5%"])
      expect(detectedIds(library, answer), answer).not.toContain(odds);
    // The value-based matcher lets "0.6" reach the odds misconception through
    // its retained equivalents even though the literal term was dropped.
    for (const answer of ["6/10", "3/5", "60%", "0.6"])
      expect(detectedIds(library, answer), answer).toEqual([odds]);

    // combination-books: "40" was dropped because it also fired inside "5040"
    // and "840"; with no safe spelling the misconception itself is absent.
    const books = byId("generated-syllabus-combination-books-v2");
    const permutation =
      "misconception-combination-books-permutation-instead-of-combination";
    expect(books.misconceptions.map((entry) => entry.id)).toEqual([
      permutation,
    ]);
    expect(
      books.misconceptions.flatMap((entry) => entry.matchTerms),
    ).not.toContain("40");
    expect(detectedIds(books, "5040")).toEqual([permutation]);
    for (const answer of ["840", "40", "140", "240"])
      expect(detectedIds(books, answer), answer).toEqual([]);
  });

  it("makes the numbered-tiles student count the multiples so the missed-endpoint misconception is reachable", () => {
    const tiles = byId("generated-syllabus-uniform-numbered-tiles-v2");
    const original = originalOf(tiles);
    expect(original.prompt).toMatch(/Six of the numbers are multiples of 3/);
    expect(tiles.prompt).toBe(
      "One tile is chosen at random from tiles numbered 1 through 18. What is the probability of choosing a multiple of 3?",
    );
    expect(tiles.prompt).not.toMatch(/\bsix\b|\b6\b/i);
    expect(tiles.answer).toMatchObject({
      acceptedAnswers: original.answer.acceptedAnswers,
      numericValue: original.answer.numericValue,
      tolerance: original.answer.tolerance,
    });
    expect(tiles.review.notes).toMatch(/prompt wording was clarified/);
    const missedEndpoint =
      "misconception-uniform-numbered-tiles-missed-endpoint-multiple";
    for (const answer of ["5/18", "0.278", "27.8%"])
      expect(detectedIds(tiles, answer), answer).toEqual([missedEndpoint]);
  });

  it("carries the three audited difficulty relabels and no others", () => {
    for (const [id, difficulty] of RELABELED_DIFFICULTY) {
      const candidate = byId(id);
      expect(candidate.difficulty, id).toBe(difficulty);
      expect(candidate.difficulty).not.toBe(originalOf(candidate).difficulty);
      expect(candidate.review.notes, id).toContain(
        `Difficulty relabeled from ${originalOf(candidate).difficulty} to ${difficulty}.`,
      );
    }
    for (const candidate of remediated) {
      if (RELABELED_DIFFICULTY.has(candidate.id)) continue;
      expect(candidate.difficulty, candidate.id).toBe(
        originalOf(candidate).difficulty,
      );
      expect(candidate.review.notes).not.toMatch(/Difficulty relabeled/);
    }
  });

  it("is registered with the importer, passes the fixture validator, and is current", async () => {
    expect(REVIEW_CANDIDATE_FILES).toContain(REMEDIATED_FILE);
    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());
    expect(
      fixtures.candidates.filter(
        (entry) => entry.sourceFile === REMEDIATED_FILE,
      ),
    ).toHaveLength(22);
    const check = spawnSync(
      process.execPath,
      [
        path.join(
          process.cwd(),
          "scripts/generate-remediated-syllabus-review-candidates.mjs",
        ),
        "--check",
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
    );
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });
});
