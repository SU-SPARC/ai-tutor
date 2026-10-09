/**
 * Offline evaluation harness: a source question plus a recorded candidate
 * output in, a full explained disposition out. No provider is called; Phase 2
 * will feed real recorded outputs through the same function.
 */

import type { QuestionIntakeDuplicateCandidate } from "@/lib/question-intake/duplicates";
import {
  SIMILAR_QUESTION_PROMPT_VERSION,
  SIMILAR_QUESTION_SCHEMA_VERSION,
  type GeneratedPracticeVariant,
  type GeneratedVariantContent,
  type GeneratedVariantDisposition,
  type GenerationMetadata,
  type SimilarQuestionSource,
  type SimilarityReport,
  type VerificationGateCode,
  type VerificationReport,
  type VerificationTier,
} from "@/lib/similar-practice/contract";
import { generatedVariantContentHash } from "@/lib/similar-practice/hash";
import {
  validateSimilarQuestionModelOutput,
  type SchemaIssue,
} from "@/lib/similar-practice/schema";
import {
  schemaFailureReport,
  verifySimilarQuestionOutput,
  type DeterministicOracle,
} from "@/lib/similar-practice/verify";

export type SimilarQuestionEvaluationInput = {
  source: SimilarQuestionSource;
  /** The raw, untrusted model output (or a recorded fixture of one). */
  output: unknown;
  publishedQuestions?: readonly QuestionIntakeDuplicateCandidate[];
  existingContentHashes?: ReadonlySet<string>;
  conceptVocabulary?: readonly string[];
  oracle?: DeterministicOracle;
  generation?: Partial<GenerationMetadata>;
};

export type SimilarQuestionEvaluation = {
  contentSha256?: string;
  disposition: GeneratedVariantDisposition;
  /** Why, in order: every failed or blocking-skipped gate, or the review rule. */
  reasons: string[];
  requiresProfessorReview: boolean;
  schema: { ok: boolean; issues: SchemaIssue[] };
  similarity?: SimilarityReport;
  tier: VerificationTier;
  /** Built only for candidates that are not rejected. */
  variant?: GeneratedPracticeVariant;
  verification: VerificationReport;
};

export function evaluateSimilarQuestionCandidate(
  input: SimilarQuestionEvaluationInput,
): SimilarQuestionEvaluation {
  const schema = validateSimilarQuestionModelOutput(input.output);
  if (!schema.ok) {
    return {
      disposition: "rejected",
      reasons: schema.issues.map((issue) => `schema_valid: ${issue.path} — ${issue.message}`),
      requiresProfessorReview: false,
      schema: { issues: schema.issues, ok: false },
      tier: "T2",
      verification: schemaFailureReport(
        `${schema.issues.length} schema issue(s).`,
      ),
    };
  }

  const output = schema.output;
  const content: GeneratedVariantContent = {
    answer: output.variant.answer,
    difficulty: output.variant.difficulty,
    hints: output.variant.hints,
    misconceptions: output.variant.misconceptions,
    prompt: output.variant.prompt,
    solutionSteps: output.variant.solutionSteps,
    title: output.variant.title,
  };
  const contentSha256 = generatedVariantContentHash(content);
  const { report, similarity } = verifySimilarQuestionOutput(output, input.source, {
    conceptVocabulary: input.conceptVocabulary,
    contentSha256,
    existingContentHashes: input.existingContentHashes ?? new Set(),
    oracle: input.oracle,
    publishedQuestions: input.publishedQuestions ?? [],
  });

  const disposition: GeneratedVariantDisposition = !report.passed
    ? "rejected"
    : report.tier === "T1"
      ? "verified_t1"
      : "awaiting_review";
  const requiresProfessorReview = disposition === "awaiting_review";

  const evaluation: SimilarQuestionEvaluation = {
    contentSha256,
    disposition,
    reasons: reasonsFor(report, disposition),
    requiresProfessorReview,
    schema: { issues: [], ok: true },
    similarity,
    tier: report.tier,
    verification: report,
  };

  if (disposition !== "rejected") {
    evaluation.variant = {
      content,
      contentSha256,
      derivation: {
        computation: output.variant.computation,
        conceptTag: output.sourceAnalysis.conceptTag,
        parameters: output.variant.parameters,
        skill: output.sourceAnalysis.skill,
        sourceComputation: output.sourceAnalysis.sourceComputation,
      },
      disposition,
      generation: {
        generatorKind: input.generation?.generatorKind ?? "llm",
        promptVersion: input.generation?.promptVersion ?? SIMILAR_QUESTION_PROMPT_VERSION,
        schemaVersion: SIMILAR_QUESTION_SCHEMA_VERSION,
        ...(input.generation?.provider ? { provider: input.generation.provider } : {}),
        ...(input.generation?.model ? { model: input.generation.model } : {}),
        ...(input.generation?.recordedFixtureId
          ? { recordedFixtureId: input.generation.recordedFixtureId }
          : {}),
      },
      id: `gv_${contentSha256.slice(0, 32)}`,
      requiresProfessorReview,
      schemaVersion: SIMILAR_QUESTION_SCHEMA_VERSION,
      similarity,
      source: {
        courseId: input.source.courseId,
        questionId: input.source.questionId,
        questionVersionId: input.source.questionVersionId,
        topicId: input.source.topicId,
      },
      verification: report,
    };
  }

  return evaluation;
}

function reasonsFor(
  report: VerificationReport,
  disposition: GeneratedVariantDisposition,
): string[] {
  const failures = report.checks
    .filter((check) => check.status === "failed")
    .map((check) => `${check.code}: ${check.detail ?? "failed"}`);
  const blockingSkips = report.checks
    .filter((check) => check.status === "skipped" && check.code !== "deterministic_oracle")
    .map((check) => `${check.code} (not verified): ${check.detail ?? "skipped"}`);
  if (disposition === "rejected") return [...failures, ...blockingSkips];
  if (disposition === "awaiting_review") {
    return [
      "T2: every gate passed, but code cannot prove the problem's wording describes its computation. Professor review is required before any student sees it.",
    ];
  }
  return ["T1: a deterministic oracle computed the same answer from the parameters."];
}

export type SimilarQuestionEvaluationSummary = {
  candidates: number;
  byDisposition: Record<GeneratedVariantDisposition, number>;
  /** How often each gate failed, most frequent first. */
  failedGates: Array<{ code: VerificationGateCode; count: number }>;
  schemaRejections: number;
  meanSimilarityScore: number | undefined;
};

/** Aggregates a batch of evaluations, for offline review of a fixture set. */
export function summarizeSimilarQuestionEvaluations(
  evaluations: readonly SimilarQuestionEvaluation[],
): SimilarQuestionEvaluationSummary {
  const byDisposition: Record<GeneratedVariantDisposition, number> = {
    awaiting_review: 0,
    rejected: 0,
    verified_t1: 0,
  };
  const gateCounts = new Map<VerificationGateCode, number>();
  const scores: number[] = [];
  let schemaRejections = 0;
  for (const evaluation of evaluations) {
    byDisposition[evaluation.disposition] += 1;
    if (!evaluation.schema.ok) schemaRejections += 1;
    if (evaluation.similarity) scores.push(evaluation.similarity.total);
    for (const code of evaluation.verification.failed) {
      gateCounts.set(code, (gateCounts.get(code) ?? 0) + 1);
    }
  }
  return {
    byDisposition,
    candidates: evaluations.length,
    failedGates: [...gateCounts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code)),
    meanSimilarityScore: scores.length
      ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2))
      : undefined,
    schemaRejections,
  };
}
