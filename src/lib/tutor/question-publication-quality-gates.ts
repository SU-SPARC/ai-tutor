import type {
  QuestionPublicationBlocker,
  QuestionPublicationGateCode,
  QuestionVersionDto,
  QuestionVersionState,
  SourceMetadata,
} from "@/lib/types";

export const QUESTION_PUBLICATION_GATE_CODES = [
  "invalid_syllabus_topic",
  "missing_question_text",
  "missing_final_answer",
  "invalid_answer_schema",
  "missing_solution_steps",
  "missing_required_hint",
  "forbidden_private_source_metadata",
  "invalid_source_classification",
  "duplicate_question_id",
  "invalid_review_state",
  "deterministic_validation_failed",
  "professor_approval_missing",
] as const satisfies readonly QuestionPublicationGateCode[];

export type QuestionPublicationGateInput = {
  activeSyllabusTopic: boolean;
  deterministicValidationPasses: boolean;
  duplicateQuestionId: boolean;
  hintsRequired: boolean;
  professorApprovalExists: boolean;
  questionId: string;
  rawMetadata?: unknown;
  snapshotQuestionId?: string;
  version: QuestionVersionDto;
};

const CURRENT_QUESTION_SCHEMA_VERSION = 2;
const ALLOWED_STATES = new Set<QuestionVersionState>([
  "approved",
  "unpublished",
]);
const PRIVATE_SOURCE_SIGNAL =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number/i;
const FORBIDDEN_PRIVATE_METADATA_KEYS =
  /^(?:answerKey|embedding|embeddings|extractedText|locator|page|pageNumber|privateNotes|privatePrompt|promptTemplate|rawText|sourceId|sourceIds|sourceLocator|sourceMetadata|sourcePage|sourceText|textbookText)$/i;
const VALID_CONTENT_HASH = /^[0-9a-f]{64}$/;
const MAX_ACCEPTED_ANSWERS = 20;
const MAX_HINTS = 12;
const MAX_MISCONCEPTIONS = 12;
const MAX_SOLUTION_STEPS = 20;
const MAX_LONG_TEXT_LENGTH = 8_000;
const MAX_SHORT_TEXT_LENGTH = 500;

export function evaluateQuestionPublicationQualityGates(
  input: QuestionPublicationGateInput,
): QuestionPublicationBlocker[] {
  const blockers: QuestionPublicationBlocker[] = [];
  const version = input.version;

  if (!input.activeSyllabusTopic || !version.topicId.trim()) {
    blockers.push({
      code: "invalid_syllabus_topic",
      message: "The question must reference an active syllabus topic.",
    });
  }

  if (!version.prompt.trim()) {
    blockers.push({
      code: "missing_question_text",
      message: "Question text is required before publication.",
    });
  }

  if (!hasFinalAnswer(version.answer.acceptedAnswers)) {
    blockers.push({
      code: "missing_final_answer",
      message: "At least one non-empty final answer is required.",
    });
  }

  if (!answerSchemaIsValid(version.answer)) {
    blockers.push({
      code: "invalid_answer_schema",
      message:
        "The final answer must satisfy the accepted-answer, explanation, numeric-value, and tolerance schema.",
    });
  }

  if (!hasNonEmptyText(version.solutionSteps)) {
    blockers.push({
      code: "missing_solution_steps",
      message: "At least one non-empty solution step is required.",
    });
  }

  if (
    input.hintsRequired &&
    !version.hints.some((hint) => usefulHint(hint, version))
  ) {
    blockers.push({
      code: "missing_required_hint",
      message:
        "At least one useful hint is required and must provide guidance without duplicating the question, solution, or final answer.",
    });
  }

  if (
    findForbiddenPrivateMetadataPath(input.rawMetadata) ||
    PRIVATE_SOURCE_SIGNAL.test(version.source.originalityNote ?? "")
  ) {
    blockers.push({
      code: "forbidden_private_source_metadata",
      message:
        "Private-source text, locators, extraction fields, embeddings, or generation prompts cannot be published.",
    });
  }

  if (!sourceClassificationIsValid(version.source)) {
    blockers.push({
      code: "invalid_source_classification",
      message:
        "The question requires a public-safe source type, compatible trust classification, and originality note.",
    });
  }

  if (
    input.duplicateQuestionId ||
    version.id !== input.questionId ||
    (input.snapshotQuestionId !== undefined &&
      input.snapshotQuestionId !== input.questionId)
  ) {
    blockers.push({
      code: "duplicate_question_id",
      message: "The immutable version must retain a unique stable question ID.",
    });
  }

  if (!ALLOWED_STATES.has(version.state)) {
    blockers.push({
      code: "invalid_review_state",
      message:
        "Only an approved or previously unpublished version can be published.",
    });
  }

  if (
    !input.deterministicValidationPasses ||
    version.validationStatus !== "valid" ||
    version.schemaVersion !== CURRENT_QUESTION_SCHEMA_VERSION ||
    !VALID_CONTENT_HASH.test(version.contentHash) ||
    !contentStructureIsDeterministic(version, input.questionId)
  ) {
    blockers.push({
      code: "deterministic_validation_failed",
      message:
        "The immutable version must pass the current deterministic schema and content-hash validation.",
    });
  }

  if (!input.professorApprovalExists) {
    blockers.push({
      code: "professor_approval_missing",
      message:
        "An immutable professor approval for this exact version is required before publication.",
    });
  }

  return blockers;
}

function hasFinalAnswer(acceptedAnswers: string[]) {
  return (
    Array.isArray(acceptedAnswers) &&
    acceptedAnswers.some((answer) => answer.trim().length > 0)
  );
}

function answerSchemaIsValid(answer: QuestionVersionDto["answer"]) {
  if (
    !Array.isArray(answer.acceptedAnswers) ||
    answer.acceptedAnswers.length === 0 ||
    answer.acceptedAnswers.length > MAX_ACCEPTED_ANSWERS ||
    answer.acceptedAnswers.some(
      (candidate) =>
        !shortText(candidate) || candidate.length > MAX_SHORT_TEXT_LENGTH,
    ) ||
    !longText(answer.explanation)
  ) {
    return false;
  }
  if (
    answer.numericValue !== undefined &&
    !Number.isFinite(answer.numericValue)
  ) {
    return false;
  }
  if (
    answer.tolerance !== undefined &&
    (answer.numericValue === undefined ||
      !Number.isFinite(answer.tolerance) ||
      answer.tolerance < 0)
  ) {
    return false;
  }
  return (
    answer.numericValue === undefined ||
    answer.acceptedAnswers.some((candidate) =>
      numericAnswerMatches(
        candidate,
        answer.numericValue!,
        answer.tolerance ?? 1e-9,
      ),
    )
  );
}

function sourceClassificationIsValid(source: SourceMetadata) {
  if (
    source.visibility !== "public" ||
    !longText(source.originalityNote ?? "") ||
    source.trustLevel === "private_reference" ||
    source.sourceType === "private_reference_pattern"
  ) {
    return false;
  }
  if (
    source.sourceType === "generated_original" ||
    source.sourceType === "pattern_derived_original"
  ) {
    return (
      (source.trustLevel === "generated_unverified" ||
        source.trustLevel === "professor_approved") &&
      (source.sourceType !== "pattern_derived_original" ||
        Boolean(source.patternIds?.length))
    );
  }
  return (
    source.trustLevel === "public_original" ||
    source.trustLevel === "course_approved" ||
    source.trustLevel === "professor_approved"
  );
}

function contentStructureIsDeterministic(
  version: QuestionVersionDto,
  questionId: string,
) {
  const misconceptionIds = version.misconceptions.map((item) => item.id);
  return (
    version.id === questionId &&
    shortText(version.title) &&
    shortText(version.topicId) &&
    longText(version.prompt) &&
    longText(version.answer.explanation) &&
    ["foundational", "intermediate", "challenge"].includes(
      version.difficulty,
    ) &&
    version.hints.length <= MAX_HINTS &&
    version.misconceptions.length <= MAX_MISCONCEPTIONS &&
    version.solutionSteps.length > 0 &&
    version.solutionSteps.length <= MAX_SOLUTION_STEPS &&
    version.hints.every(longText) &&
    version.solutionSteps.every(longText) &&
    version.misconceptions.every(
      (item) =>
        shortText(item.id) &&
        longText(item.feedback) &&
        item.matchTerms.every(shortText),
    ) &&
    new Set(misconceptionIds).size === misconceptionIds.length
  );
}

function usefulHint(hint: string, version: QuestionVersionDto) {
  const normalized = normalizeText(hint);
  if (
    normalized.length < 8 ||
    /^(?:the\s+)?(?:final\s+)?answer\s+is\b/i.test(normalized)
  ) {
    return false;
  }
  const duplicatedText = [
    version.prompt,
    version.answer.explanation,
    ...version.answer.acceptedAnswers,
    ...version.solutionSteps,
  ].map(normalizeText);
  return !duplicatedText.includes(normalized);
}

function findForbiddenPrivateMetadataPath(
  value: unknown,
  path = "$",
): string | undefined {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = findForbiddenPrivateMetadataPath(
        item,
        `${path}[${index}]`,
      );
      if (result) return result;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (FORBIDDEN_PRIVATE_METADATA_KEYS.test(key)) return nextPath;
    const result = findForbiddenPrivateMetadataPath(item, nextPath);
    if (result) return result;
  }
  return undefined;
}

function hasNonEmptyText(values: string[]) {
  return (
    Array.isArray(values) && values.some((value) => value.trim().length > 0)
  );
}

function normalizeText(value: string) {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function shortText(value: string) {
  return value.trim().length > 0 && value.length <= MAX_SHORT_TEXT_LENGTH;
}

function longText(value: string) {
  return value.trim().length > 0 && value.length <= MAX_LONG_TEXT_LENGTH;
}

function numericAnswerMatches(
  rawAnswer: string,
  numericValue: number,
  tolerance: number,
) {
  const answer = rawAnswer.trim().replaceAll(",", "").replace(/^\$/, "");
  let parsed: number;
  if (/^[-+]?\d+(?:\.\d+)?%$/.test(answer)) {
    parsed = Number(answer.slice(0, -1)) / 100;
  } else if (/^[-+]?\d+(?:\.\d+)?\s*\/\s*[-+]?\d+(?:\.\d+)?$/.test(answer)) {
    const [numerator, denominator] = answer.split("/").map(Number);
    if (!denominator) return false;
    parsed = numerator / denominator;
  } else {
    parsed = Number(answer);
  }
  return (
    Number.isFinite(parsed) &&
    Math.abs(parsed - numericValue) <= Math.max(tolerance, 1e-9)
  );
}
