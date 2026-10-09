/**
 * "Give me a similar question" — the versioned contract (Phase 1).
 *
 * The LLM proposes; code decides. A model output is untrusted until the
 * deterministic gates in `verify.ts` pass, and a free-form (T2) candidate is
 * never student-servable without professor review. Phase 1 has no routes,
 * storage, provider calls, or serving; see docs/similar-practice-phase-1.md.
 */

import type { AnswerSpec } from "@/lib/tutor/answer/spec";
import type { Difficulty, QuestionContent } from "@/lib/types";

export const SIMILAR_QUESTION_SCHEMA_VERSION = 1;
export const SIMILAR_QUESTION_PROMPT_VERSION = 1;

/** Answer kinds a generated variant may use in V1: only what code can compute. */
export const SUPPORTED_GENERATED_ANSWER_KINDS = ["numeric"] as const;
export type SupportedGeneratedAnswerKind =
  (typeof SUPPORTED_GENERATED_ANSWER_KINDS)[number];

export const SIMILAR_QUESTION_CHANGE_KINDS = [
  "numbers",
  "context",
  "wording",
  "structure",
] as const;
export type SimilarQuestionChangeKind =
  (typeof SIMILAR_QUESTION_CHANGE_KINDS)[number];

export const SIMILAR_QUESTION_LIMITS = {
  title: 160,
  prompt: 800,
  explanation: 600,
  acceptedAnswer: 100,
  acceptedAnswers: { min: 1, max: 6 },
  computation: 200,
  conceptTag: 80,
  identifier: 64,
  skill: 120,
  hint: 300,
  hints: { min: 2, max: 4 },
  solutionStep: 400,
  solutionSteps: { min: 2, max: 8 },
  sourceStepCount: { min: 1, max: 12 },
  misconceptions: { min: 0, max: 4 },
  misconceptionFeedback: 300,
  matchTerm: 60,
  matchTerms: { min: 1, max: 6 },
  parameters: { min: 1, max: 12 },
  changes: { min: 2, max: 4 },
  claimedAnswer: 100,
} as const;

// ---------------------------------------------------------------------------
// What the model returns (forced tool call). Never shown to a student.
// ---------------------------------------------------------------------------

export type GeneratedMisconception = {
  feedback: string;
  id: string;
  matchTerms: string[];
};

export type SimilarQuestionModelOutputV1 = {
  schemaVersion: 1;
  sourceAnalysis: {
    /** Must be one of the source topic's canonical keywords. */
    conceptTag: string;
    /** Free text, audit only. */
    skill: string;
    /** A checker-grammar expression for the SOURCE question's answer. */
    sourceComputation: string;
    sourceStepCount: number;
  };
  variant: {
    /** Echoed from the request; must equal the source's course and topic. */
    courseId: string;
    topicId: string;
    title: string;
    prompt: string;
    difficulty: Difficulty;
    answer: {
      acceptedAnswers: string[];
      explanation: string;
      spec: AnswerSpec;
    };
    /** A checker-grammar expression that must evaluate to the answer. */
    computation: string;
    /** Every number the prompt states, by name. */
    parameters: Record<string, number>;
    hints: string[];
    solutionSteps: string[];
    misconceptions: GeneratedMisconception[];
  };
  changes: SimilarQuestionChangeKind[];
  /** Advisory only: the model's own claim is never authoritative. */
  selfCheck: { claimedAnswer: string; confidence: number };
};

// ---------------------------------------------------------------------------
// The source question, as the validators see it (a published version).
// ---------------------------------------------------------------------------

export type SimilarQuestionSource = {
  courseId: string;
  questionId: string;
  questionVersionId: number;
  topicId: string;
  title: string;
  prompt: string;
  difficulty: Difficulty;
  answer: Pick<QuestionContent["answer"], "acceptedAnswers" | "spec">;
  hints: string[];
  solutionSteps: string[];
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * `skipped` means the check could not run (for example, a source question with
 * no typed answer spec). A skipped check is never treated as passed.
 */
export type VerificationCheckStatus = "passed" | "failed" | "skipped";

export type VerificationCheck = {
  code: VerificationGateCode;
  status: VerificationCheckStatus;
  detail?: string;
};

export const VERIFICATION_GATE_CODES = [
  "schema_valid",
  "course_topic_match",
  "supported_answer_kind",
  "text_safety",
  "private_source_signal",
  "answer_spec_valid",
  "accepted_answers_correct",
  "computation_evaluates",
  "computation_matches_answer",
  "claimed_answer_matches",
  "answer_domain",
  "source_computation_matches_source",
  "parameters_consistent",
  "answer_in_solution",
  "no_answer_in_prompt",
  "no_answer_in_first_hint",
  "misconception_terms_not_correct",
  "not_duplicate_of_source",
  "novelty_threshold",
  "numbers_changed",
  "change_categories",
  "not_duplicate_published",
  "content_hash_unique",
  "similarity_threshold",
  "deterministic_oracle",
] as const;
export type VerificationGateCode = (typeof VERIFICATION_GATE_CODES)[number];

/**
 * T1: the answer is established by deterministic code from the parameters (a
 * registered oracle agreed). T2: the candidate is internally consistent, but
 * code cannot prove the words describe the computation; professor review is
 * required before any student sees it.
 */
export type VerificationTier = "T1" | "T2";

export type VerificationReport = {
  checks: VerificationCheck[];
  failed: VerificationGateCode[];
  passed: boolean;
  skipped: VerificationGateCode[];
  tier: VerificationTier;
};

export const SIMILARITY_DIMENSIONS = [
  "courseTopic",
  "concept",
  "skill",
  "difficulty",
  "answerForm",
  "novelty",
  "leakage",
] as const;
export type SimilarityDimension = (typeof SIMILARITY_DIMENSIONS)[number];

/** Each dimension scores 0–2; seven dimensions give a maximum of 14. */
export const SIMILARITY_MAX_SCORE = 14;
export const SIMILARITY_MIN_SCORE = 11;
/** Prompt-token Jaccard with the source must not exceed this. */
export const SOURCE_NOVELTY_MAX_JACCARD = 0.6;
/** At or below this the wording is clearly new (score 2); above, borderline. */
export const SOURCE_NOVELTY_CLEAR_JACCARD = 0.45;

export type SimilarityDimensionResult = {
  dimension: SimilarityDimension;
  /** `undetermined` when code cannot establish it; the score is then 0. */
  status: "scored" | "undetermined";
  score: 0 | 1 | 2;
  /** A 0 on a hard dimension rejects the candidate regardless of the total. */
  hardFailure: boolean;
  basis: string;
};

export type SimilarityReport = {
  dimensions: SimilarityDimensionResult[];
  hardFailures: SimilarityDimension[];
  meetsThreshold: boolean;
  threshold: number;
  total: number;
  undetermined: SimilarityDimension[];
};

// ---------------------------------------------------------------------------
// Stored record (Phase 2 will persist it; Phase 1 only builds it in memory)
// ---------------------------------------------------------------------------

/**
 * Phase 1 dispositions. Serving statuses (available, quarantined, …) arrive
 * with the pool in a later phase.
 */
export type GeneratedVariantDisposition =
  | "rejected"
  | "awaiting_review"
  | "verified_t1";

export type GeneratedVariantContent = {
  title: string;
  prompt: string;
  difficulty: Difficulty;
  answer: SimilarQuestionModelOutputV1["variant"]["answer"];
  hints: string[];
  solutionSteps: string[];
  misconceptions: GeneratedMisconception[];
};

export type GeneratedPracticeVariant = {
  id: `gv_${string}`;
  schemaVersion: typeof SIMILAR_QUESTION_SCHEMA_VERSION;
  /** SHA-256 of `content` only; generation metadata is not identity. */
  contentSha256: string;
  source: {
    courseId: string;
    questionId: string;
    questionVersionId: number;
    topicId: string;
  };
  content: GeneratedVariantContent;
  derivation: {
    computation: string;
    conceptTag: string;
    parameters: Record<string, number>;
    skill: string;
    sourceComputation: string;
  };
  similarity: SimilarityReport;
  verification: VerificationReport;
  generation: GenerationMetadata;
  disposition: Exclude<GeneratedVariantDisposition, "rejected">;
  requiresProfessorReview: boolean;
};

export type GenerationMetadata = {
  generatorKind: "llm" | "pattern";
  promptVersion: number;
  schemaVersion: number;
  provider?: "openrouter";
  model?: string;
  /** Set when the output came from a recorded offline fixture. */
  recordedFixtureId?: string;
};

// ---------------------------------------------------------------------------
// What a student would see (A). Answers, computation, parameters, match
// terms, reports, model metadata, and source analysis never cross this line.
// ---------------------------------------------------------------------------

export type StudentGeneratedPracticeQuestion = {
  contentKind: "generated_practice";
  label: "AI-generated practice";
  variantId: GeneratedPracticeVariant["id"];
  courseId: string;
  topicId: string;
  sourceQuestionId: string;
  title: string;
  prompt: string;
  difficulty: Difficulty;
  answerFormat: {
    kind: SupportedGeneratedAnswerKind;
    percentMode?: "decimal" | "percent" | "either";
    requiredForm?:
      | "decimal"
      | "fraction"
      | "simplified_fraction"
      | "percent"
      | "integer";
    unitLabel?: string;
  };
  hintCount: number;
  stepCount: number;
};
