/**
 * The similarity rubric, computed from deterministic evidence only. No model
 * is consulted. A dimension that code cannot establish is reported as
 * `undetermined` with score 0; it is never given a guessed score.
 */

import {
  SIMILARITY_MIN_SCORE,
  SOURCE_NOVELTY_CLEAR_JACCARD,
  SOURCE_NOVELTY_MAX_JACCARD,
  type SimilarityDimension,
  type SimilarityDimensionResult,
  type SimilarityReport,
} from "@/lib/similar-practice/contract";

export type SimilarityEvidence = {
  courseMatch: boolean;
  topicMatch: boolean;
  /** Undefined when the source topic has no known concept vocabulary. */
  conceptTagAllowed: boolean | undefined;
  /**
   * Operator signatures; the source's is trusted only when the model's
   * `sourceComputation` reproduced the source's own answer. Undefined when it
   * could not be checked.
   */
  skill:
    | { sourceSignature: string; variantSignature: string; sourceKinds: Set<string>; variantKinds: Set<string> }
    | undefined;
  difficultyLabelMatch: boolean;
  /** |variant steps − source steps|. */
  stepDelta: number;
  /** Undefined when the source has no typed answer spec to compare with. */
  answerFormMatch: boolean | undefined;
  /** Prompt-token Jaccard with the source. */
  sourceJaccard: number;
  duplicateOfSource: boolean;
  duplicateOfPublished: boolean;
  numbersChanged: boolean;
  changeKinds: number;
  leakage: { prompt: boolean; firstHint: boolean; matchTermCorrect: boolean };
};

const HARD_DIMENSIONS = new Set<SimilarityDimension>([
  "courseTopic",
  "concept",
  "skill",
  "difficulty",
  "answerForm",
  "novelty",
  "leakage",
]);

export function scoreSimilarity(evidence: SimilarityEvidence): SimilarityReport {
  const dimensions: SimilarityDimensionResult[] = [
    courseTopic(evidence),
    concept(evidence),
    skill(evidence),
    difficulty(evidence),
    answerForm(evidence),
    novelty(evidence),
    leakage(evidence),
  ];
  const total = dimensions.reduce((sum, item) => sum + item.score, 0);
  const hardFailures = dimensions
    .filter((item) => item.hardFailure)
    .map((item) => item.dimension);
  const undetermined = dimensions
    .filter((item) => item.status === "undetermined")
    .map((item) => item.dimension);
  return {
    dimensions,
    hardFailures,
    meetsThreshold:
      hardFailures.length === 0 &&
      undetermined.length === 0 &&
      total >= SIMILARITY_MIN_SCORE,
    threshold: SIMILARITY_MIN_SCORE,
    total,
    undetermined,
  };
}

function scored(
  dimension: SimilarityDimension,
  score: 0 | 1 | 2,
  basis: string,
): SimilarityDimensionResult {
  return {
    basis,
    dimension,
    hardFailure: score === 0 && HARD_DIMENSIONS.has(dimension),
    score,
    status: "scored",
  };
}

function undetermined(
  dimension: SimilarityDimension,
  basis: string,
): SimilarityDimensionResult {
  return { basis, dimension, hardFailure: false, score: 0, status: "undetermined" };
}

function courseTopic(evidence: SimilarityEvidence) {
  return evidence.courseMatch && evidence.topicMatch
    ? scored("courseTopic", 2, "Same course and topic as the source.")
    : scored(
        "courseTopic",
        0,
        evidence.courseMatch
          ? "The topic differs from the source's."
          : "The course differs from the source's.",
      );
}

function concept(evidence: SimilarityEvidence) {
  if (evidence.conceptTagAllowed === undefined) {
    return undetermined("concept", "The source topic has no concept vocabulary.");
  }
  return evidence.conceptTagAllowed
    ? scored("concept", 2, "The declared concept is one of the topic's concepts.")
    : scored("concept", 0, "The declared concept is not one of the topic's concepts.");
}

function skill(evidence: SimilarityEvidence) {
  if (!evidence.skill) {
    return undetermined(
      "skill",
      "The source computation could not be verified against the source answer.",
    );
  }
  const { sourceKinds, sourceSignature, variantKinds, variantSignature } =
    evidence.skill;
  if (sourceSignature === variantSignature) {
    return scored("skill", 2, `Same operations (${variantSignature}).`);
  }
  const sameKinds =
    sourceKinds.size === variantKinds.size &&
    [...sourceKinds].every((kind) => variantKinds.has(kind));
  return sameKinds
    ? scored(
        "skill",
        1,
        `Same kinds of operations, different counts (${sourceSignature} vs ${variantSignature}).`,
      )
    : scored(
        "skill",
        0,
        `Different operations (${sourceSignature} vs ${variantSignature}).`,
      );
}

function difficulty(evidence: SimilarityEvidence) {
  if (!evidence.difficultyLabelMatch) {
    return scored("difficulty", 0, "The difficulty label differs from the source's.");
  }
  if (evidence.stepDelta <= 1) {
    return scored("difficulty", 2, `Solution length within ±1 step (Δ${evidence.stepDelta}).`);
  }
  if (evidence.stepDelta === 2) {
    return scored("difficulty", 1, "Solution length differs by 2 steps.");
  }
  return scored("difficulty", 0, `Solution length differs by ${evidence.stepDelta} steps.`);
}

function answerForm(evidence: SimilarityEvidence) {
  if (evidence.answerFormMatch === undefined) {
    return undetermined("answerForm", "The source has no typed answer spec to compare.");
  }
  return evidence.answerFormMatch
    ? scored("answerForm", 2, "Same answer kind, domain, percent mode, and required form.")
    : scored("answerForm", 0, "The answer form differs from the source's.");
}

function novelty(evidence: SimilarityEvidence) {
  const jaccard = evidence.sourceJaccard.toFixed(2);
  if (evidence.duplicateOfSource) {
    return scored("novelty", 0, "Same text or same structure as the source.");
  }
  if (evidence.duplicateOfPublished) {
    return scored("novelty", 0, "Duplicates another published question in the topic.");
  }
  if (!evidence.numbersChanged) {
    return scored("novelty", 0, "Uses the same numbers as the source.");
  }
  if (evidence.changeKinds < 2) {
    return scored("novelty", 0, "Declares fewer than two kinds of change.");
  }
  if (evidence.sourceJaccard > SOURCE_NOVELTY_MAX_JACCARD) {
    return scored("novelty", 0, `Wording too close to the source (Jaccard ${jaccard}).`);
  }
  return evidence.sourceJaccard <= SOURCE_NOVELTY_CLEAR_JACCARD
    ? scored("novelty", 2, `New wording (Jaccard ${jaccard}).`)
    : scored("novelty", 1, `Borderline wording overlap (Jaccard ${jaccard}).`);
}

function leakage(evidence: SimilarityEvidence) {
  const { firstHint, matchTermCorrect, prompt } = evidence.leakage;
  if (prompt) return scored("leakage", 0, "The answer appears in the prompt.");
  if (firstHint) return scored("leakage", 0, "The first hint reveals the answer.");
  if (matchTermCorrect) {
    return scored("leakage", 0, "A misconception match term grades as correct.");
  }
  return scored("leakage", 2, "No answer leakage found.");
}
