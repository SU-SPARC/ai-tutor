/**
 * The ordered verification gates for a schema-valid similar-question output.
 * Pure and deterministic: no network, no model, no evaluation of generated
 * text other than arithmetic through `evaluateEntry`.
 *
 * Every gate reports passed, failed, or skipped. A skipped required gate is
 * never treated as passed: the candidate cannot be verified.
 */

import { canonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import {
  questionIntakePromptFingerprint,
  rankQuestionIntakeDuplicates,
  significantTokens,
  jaccardSimilarity,
  type QuestionIntakeDuplicateCandidate,
} from "@/lib/question-intake/duplicates";
import {
  answerAppearsInSolution,
  hintRevealsAnswer,
  numericLiteralsInText,
  type AnswerEvidenceDraft,
} from "@/lib/question-intake/schema";
import {
  ALLOWED_COMPUTATION_CONSTANTS,
  computationNumbers,
  domainCheckSpec,
  evaluateComputation,
  operatorKinds,
  operatorSignature,
  valueCheckSpec,
} from "@/lib/similar-practice/computation";
import {
  SIMILARITY_MAX_SCORE,
  SOURCE_NOVELTY_MAX_JACCARD,
  type SimilarQuestionModelOutputV1,
  type SimilarQuestionSource,
  type SimilarityReport,
  type VerificationCheck,
  type VerificationGateCode,
  type VerificationReport,
  type VerificationTier,
} from "@/lib/similar-practice/contract";
import { scoreSimilarity, type SimilarityEvidence } from "@/lib/similar-practice/similarity";
import {
  checkTypedAnswer,
  validateAnswerSpec,
  type AnswerSpec,
  type NumericAnswerSpec,
} from "@/lib/tutor/answer/spec";
import { PRIVATE_SOURCE_SIGNAL } from "@/lib/tutor/question-publication-quality-gates";

/**
 * Deterministic code that computes the answer from the parameters, for a
 * known problem family. Only an agreeing oracle makes a candidate T1.
 */
export type DeterministicOracle = {
  id: string;
  computeAnswer(parameters: Record<string, number>): string | undefined;
};

export type VerificationContext = {
  /**
   * Other published questions to compare against (the source is excluded
   * automatically). Required so the duplicate check can never be skipped;
   * an empty array means "nothing else is published".
   */
  publishedQuestions: readonly QuestionIntakeDuplicateCandidate[];
  /** Content hashes already generated for this source. */
  existingContentHashes: ReadonlySet<string>;
  contentSha256: string;
  /** Overrides the canonical topic keywords as the concept vocabulary. */
  conceptVocabulary?: readonly string[];
  oracle?: DeterministicOracle;
};

/** Gates that may be skipped without blocking: they only raise the tier. */
const OPTIONAL_GATES = new Set<VerificationGateCode>(["deterministic_oracle"]);

const URL_PATTERN = /\bhttps?:\/\/|\bwww\.|javascript:|data:/i;
const HTML_TAG = /<\s*\/?\s*[a-z][^>]*>/i;
/** LaTeX commands the math renderer may receive in generated text. */
const ALLOWED_LATEX_COMMANDS = new Set([
  "frac", "dfrac", "tfrac", "cdot", "times", "div", "pm", "mp", "le", "ge",
  "leq", "geq", "ne", "neq", "approx", "sqrt", "binom", "choose", "left",
  "right", "mid", "cap", "cup", "setminus", "overline", "bar", "hat", "sum",
  "prod", "infty", "ldots", "cdots", "dots", "text", "mathrm", "operatorname",
  "alpha", "beta", "lambda", "mu", "sigma", "theta", "pi", "rho", "Pr", "P",
  "E", "Var", "in", "subset", "subseteq", "emptyset", "quad", "qquad",
]);

export type VerificationResult = {
  report: VerificationReport;
  similarity: SimilarityReport;
};

export function verifySimilarQuestionOutput(
  output: SimilarQuestionModelOutputV1,
  source: SimilarQuestionSource,
  context: VerificationContext,
): VerificationResult {
  const checks: VerificationCheck[] = [];
  const pass = (code: VerificationGateCode, detail?: string) =>
    checks.push({ code, status: "passed", detail });
  const fail = (code: VerificationGateCode, detail: string) =>
    checks.push({ code, status: "failed", detail });
  const skip = (code: VerificationGateCode, detail: string) =>
    checks.push({ code, status: "skipped", detail });
  const gate = (code: VerificationGateCode, ok: boolean, failure: string, success?: string) =>
    ok ? pass(code, success) : fail(code, failure);

  const variant = output.variant;
  const spec: AnswerSpec = variant.answer.spec;

  pass("schema_valid");

  // ── Course, topic, answer kind
  const courseMatch = variant.courseId === source.courseId;
  const topicMatch = variant.topicId === source.topicId;
  gate(
    "course_topic_match",
    courseMatch && topicMatch,
    `Expected ${source.courseId}/${source.topicId}, got ${variant.courseId}/${variant.topicId}.`,
  );
  gate(
    "supported_answer_kind",
    spec.kind === "numeric",
    `Answer kind ${spec.kind} cannot be verified in V1.`,
  );

  // ── Text safety and privacy (inert text only; nothing is interpreted)
  const texts = allStrings(output);
  const unsafe = texts.find(
    (value) => URL_PATTERN.test(value) || HTML_TAG.test(value) || disallowedLatex(value),
  );
  gate("text_safety", !unsafe, `Unsafe or unsupported markup: ${preview(unsafe)}.`);
  const privateSignal = texts.find((value) => PRIVATE_SOURCE_SIGNAL.test(value));
  gate("private_source_signal", !privateSignal, `Private-source wording: ${preview(privateSignal)}.`);

  // ── The answer spec and its own accepted answers
  const specIssues = validateAnswerSpec(spec);
  gate(
    "answer_spec_valid",
    specIssues.length === 0,
    specIssues.map((issue) => issue.message).join(" "),
  );
  const specValid = specIssues.length === 0 && spec.kind === "numeric";
  const numericSpec = specValid ? (spec as NumericAnswerSpec) : undefined;
  const valueSpec = numericSpec ? valueCheckSpec(numericSpec) : undefined;

  if (numericSpec) {
    const wrong = variant.answer.acceptedAnswers.filter(
      (answer) => checkTypedAnswer(answer, numericSpec).outcome !== "correct",
    );
    gate(
      "accepted_answers_correct",
      wrong.length === 0,
      `Accepted answers the spec does not grade correct: ${wrong.join(", ")}.`,
    );
  } else {
    skip("accepted_answers_correct", "Requires a valid numeric answer spec.");
  }

  // ── The computation, evaluated by the exact arithmetic evaluator
  const computed = evaluateComputation(variant.computation);
  gate(
    "computation_evaluates",
    computed.ok,
    computed.ok ? "" : computed.reason,
    computed.ok ? `= ${computed.sent}` : undefined,
  );
  if (computed.ok && valueSpec && numericSpec) {
    gate(
      "computation_matches_answer",
      checkTypedAnswer(computed.sent, valueSpec).isCorrect,
      `The computation gives ${computed.sent}; the answer is ${numericSpec.value}.`,
    );
    gate(
      "claimed_answer_matches",
      checkTypedAnswer(output.selfCheck.claimedAnswer, valueSpec).isCorrect,
      `The model claimed ${output.selfCheck.claimedAnswer}; the answer is ${numericSpec.value}.`,
    );
    const domainIssues = validateAnswerSpec(domainCheckSpec(numericSpec, computed.sent));
    gate(
      "answer_domain",
      domainIssues.length === 0,
      domainIssues.map((issue) => issue.message).join(" "),
    );
  } else {
    const reason = "Requires a valid numeric spec and an evaluable computation.";
    skip("computation_matches_answer", reason);
    skip("claimed_answer_matches", reason);
    skip("answer_domain", reason);
  }

  // ── The model must reproduce the SOURCE answer from its source computation
  const sourceSpec = source.answer.spec;
  let sourceComputationVerified = false;
  if (sourceSpec?.kind === "numeric" && validateAnswerSpec(sourceSpec).length === 0) {
    const sourceComputed = evaluateComputation(output.sourceAnalysis.sourceComputation);
    sourceComputationVerified =
      sourceComputed.ok &&
      checkTypedAnswer(sourceComputed.sent, valueCheckSpec(sourceSpec)).isCorrect;
    gate(
      "source_computation_matches_source",
      sourceComputationVerified,
      sourceComputed.ok
        ? `The source computation gives ${sourceComputed.sent}; the source answer is ${sourceSpec.value}.`
        : sourceComputed.reason,
    );
  } else {
    skip(
      "source_computation_matches_source",
      "The source question has no valid numeric typed answer spec, so its answer cannot be reproduced.",
    );
  }

  // ── Parameters: the prompt states exactly the parameters, and the
  //    computation uses only them (plus 0, 1, 2)
  const parameterValues = Object.values(variant.parameters);
  const promptNumbers = numbersInText(variant.prompt);
  const missingFromPrompt = parameterValues.filter((value) => !promptNumbers.includes(value));
  const undeclaredInPrompt = promptNumbers.filter((value) => !parameterValues.includes(value));
  const undeclaredInComputation = computationNumbers(variant.computation).filter(
    (value) =>
      !parameterValues.includes(value) &&
      !(ALLOWED_COMPUTATION_CONSTANTS as readonly number[]).includes(value),
  );
  gate(
    "parameters_consistent",
    missingFromPrompt.length === 0 &&
      undeclaredInPrompt.length === 0 &&
      undeclaredInComputation.length === 0,
    [
      missingFromPrompt.length ? `Parameters not in the prompt: ${missingFromPrompt.join(", ")}.` : "",
      undeclaredInPrompt.length ? `Prompt numbers not declared as parameters: ${undeclaredInPrompt.join(", ")}.` : "",
      undeclaredInComputation.length ? `Computation numbers not declared: ${undeclaredInComputation.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  // ── Answer evidence and leakage (reusing the intake's checks)
  const evidenceDraft: AnswerEvidenceDraft = {
    answer: variant.answer,
    answerType: "numeric",
    solutionSteps: variant.solutionSteps,
  };
  let leakPrompt = false;
  let leakHint = false;
  let matchTermCorrect = false;
  if (valueSpec) {
    gate(
      "answer_in_solution",
      answerAppearsInSolution(evidenceDraft),
      "The final answer does not appear in the explanation or solution steps.",
    );
    leakPrompt =
      hintRevealsAnswer(variant.prompt, evidenceDraft) ||
      gradesCorrect(numericLiteralsInText(variant.prompt), valueSpec);
    gate("no_answer_in_prompt", !leakPrompt, "The prompt states the answer.");
    leakHint =
      hintRevealsAnswer(variant.hints[0], evidenceDraft) ||
      gradesCorrect(numericLiteralsInText(variant.hints[0] ?? ""), valueSpec);
    gate("no_answer_in_first_hint", !leakHint, "The first hint reveals the answer.");
    const correctTerms = variant.misconceptions.flatMap((item) =>
      item.matchTerms.filter((term) => checkTypedAnswer(term, valueSpec).isCorrect),
    );
    matchTermCorrect = correctTerms.length > 0;
    gate(
      "misconception_terms_not_correct",
      !matchTermCorrect,
      `Misconception match terms that grade as correct: ${correctTerms.join(", ")}.`,
    );
  } else {
    const reason = "Requires a valid numeric answer spec.";
    skip("answer_in_solution", reason);
    skip("no_answer_in_prompt", reason);
    skip("no_answer_in_first_hint", reason);
    skip("misconception_terms_not_correct", reason);
  }

  // ── Novelty and duplicates (reusing the intake's duplicate ranking)
  const sourceCandidate: QuestionIntakeDuplicateCandidate = {
    prompt: source.prompt,
    questionId: source.questionId,
    title: source.title,
    topicId: source.topicId,
  };
  const sourceDuplicates = rankQuestionIntakeDuplicates({
    candidates: [sourceCandidate],
    prompt: variant.prompt,
    topicId: source.topicId,
  });
  const duplicateOfSource = sourceDuplicates.length > 0;
  gate(
    "not_duplicate_of_source",
    !duplicateOfSource,
    `Duplicates the source (${sourceDuplicates[0]?.reason}).`,
  );
  const sourceJaccard = jaccardSimilarity(
    significantTokens(source.prompt),
    significantTokens(variant.prompt),
  );
  gate(
    "novelty_threshold",
    sourceJaccard <= SOURCE_NOVELTY_MAX_JACCARD,
    `Prompt wording overlaps the source too much (Jaccard ${sourceJaccard.toFixed(2)} > ${SOURCE_NOVELTY_MAX_JACCARD.toFixed(2)}).`,
    `Jaccard ${sourceJaccard.toFixed(2)}`,
  );
  const numbersChanged =
    numberTuple(variant.prompt) !== numberTuple(source.prompt);
  gate("numbers_changed", numbersChanged, "The prompt uses the same numbers as the source.");
  gate(
    "change_categories",
    new Set(output.changes).size >= 2,
    "At least two kinds of change are required.",
  );
  const publishedDuplicates = rankQuestionIntakeDuplicates({
    candidates: context.publishedQuestions.filter(
      (candidate) => candidate.questionId !== source.questionId,
    ),
    prompt: variant.prompt,
    topicId: source.topicId,
  });
  const duplicateOfPublished = publishedDuplicates.length > 0;
  gate(
    "not_duplicate_published",
    !duplicateOfPublished,
    `Duplicates published question ${publishedDuplicates[0]?.questionId} (${publishedDuplicates[0]?.reason}).`,
  );
  gate(
    "content_hash_unique",
    !context.existingContentHashes.has(context.contentSha256),
    "The same content was already generated for this source.",
  );

  // ── Similarity rubric (deterministic evidence only)
  const vocabulary = (
    context.conceptVocabulary ??
    canonicalSyllabusTopics.find((topic) => topic.id === source.topicId)?.keywords
  )?.map(normalizeTag);
  const variantSignature = operatorSignature(variant.computation);
  const sourceSignature = operatorSignature(output.sourceAnalysis.sourceComputation);
  const evidence: SimilarityEvidence = {
    answerFormMatch: answerFormMatches(sourceSpec, spec),
    changeKinds: new Set(output.changes).size,
    conceptTagAllowed: vocabulary?.length
      ? vocabulary.includes(normalizeTag(output.sourceAnalysis.conceptTag))
      : undefined,
    courseMatch,
    difficultyLabelMatch: variant.difficulty === source.difficulty,
    duplicateOfPublished,
    duplicateOfSource,
    leakage: { firstHint: leakHint, matchTermCorrect, prompt: leakPrompt },
    numbersChanged,
    skill: sourceComputationVerified
      ? {
          sourceKinds: operatorKinds(sourceSignature),
          sourceSignature,
          variantKinds: operatorKinds(variantSignature),
          variantSignature,
        }
      : undefined,
    sourceJaccard,
    stepDelta: Math.abs(variant.solutionSteps.length - source.solutionSteps.length),
    topicMatch,
  };
  const similarity = scoreSimilarity(evidence);
  gate(
    "similarity_threshold",
    similarity.meetsThreshold,
    [
      `Score ${similarity.total}/${SIMILARITY_MAX_SCORE} (minimum ${similarity.threshold}).`,
      similarity.hardFailures.length ? `Failed: ${similarity.hardFailures.join(", ")}.` : "",
      similarity.undetermined.length ? `Undetermined: ${similarity.undetermined.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    `Score ${similarity.total}/${SIMILARITY_MAX_SCORE}.`,
  );

  // ── Deterministic oracle: the only way to T1
  if (!context.oracle) {
    skip("deterministic_oracle", "No deterministic oracle is registered for this problem family.");
  } else if (!valueSpec || !computed.ok) {
    skip("deterministic_oracle", "Requires a valid numeric spec and an evaluable computation.");
  } else {
    const oracleAnswer = safeOracle(context.oracle, variant.parameters);
    gate(
      "deterministic_oracle",
      oracleAnswer !== undefined &&
        checkTypedAnswer(oracleAnswer, valueSpec).isCorrect,
      `Oracle ${context.oracle.id} computed ${oracleAnswer ?? "nothing"}; the answer is ${(spec as NumericAnswerSpec).value}.`,
      `Oracle ${context.oracle.id} agrees.`,
    );
  }

  const failed = checks.filter((check) => check.status === "failed").map((check) => check.code);
  const skipped = checks.filter((check) => check.status === "skipped").map((check) => check.code);
  const blockingSkips = skipped.filter((code) => !OPTIONAL_GATES.has(code));
  const passed = failed.length === 0 && blockingSkips.length === 0;
  const oraclePassed = checks.some(
    (check) => check.code === "deterministic_oracle" && check.status === "passed",
  );
  const tier: VerificationTier = passed && oraclePassed ? "T1" : "T2";

  return {
    report: { checks, failed, passed, skipped, tier },
    similarity,
  };
}

/** Skipped verification report for an output that never reached the gates. */
export function schemaFailureReport(detail: string): VerificationReport {
  return {
    checks: [{ code: "schema_valid", detail, status: "failed" }],
    failed: ["schema_valid"],
    passed: false,
    skipped: [],
    tier: "T2",
  };
}

function gradesCorrect(literals: string[], spec: AnswerSpec) {
  return literals.some((literal) => checkTypedAnswer(literal, spec).isCorrect);
}

function numbersInText(text: string): number[] {
  return (text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function numberTuple(text: string) {
  return numbersInText(text)
    .sort((left, right) => left - right)
    .join(",");
}

function answerFormMatches(
  sourceSpec: AnswerSpec | undefined,
  variantSpec: AnswerSpec,
): boolean | undefined {
  // A source without a valid numeric spec cannot be compared in V1.
  if (
    !sourceSpec ||
    sourceSpec.kind !== "numeric" ||
    validateAnswerSpec(sourceSpec).length > 0
  ) {
    return undefined;
  }
  if (variantSpec.kind !== "numeric") return false;
  return (
    sourceSpec.domain === variantSpec.domain &&
    sourceSpec.percentMode === variantSpec.percentMode &&
    sourceSpec.requiredForm === variantSpec.requiredForm &&
    Boolean(sourceSpec.unit) === Boolean(variantSpec.unit)
  );
}

function normalizeTag(value: string) {
  return questionIntakePromptFingerprint(value);
}

function disallowedLatex(text: string) {
  for (const match of text.matchAll(/\\([A-Za-z]+)/g)) {
    if (!ALLOWED_LATEX_COMMANDS.has(match[1])) return true;
  }
  return false;
}

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

function preview(value: string | undefined) {
  if (!value) return "";
  return JSON.stringify(value.length > 60 ? `${value.slice(0, 60)}…` : value);
}

function safeOracle(
  oracle: DeterministicOracle,
  parameters: Record<string, number>,
) {
  try {
    return oracle.computeAnswer(parameters);
  } catch {
    return undefined;
  }
}
