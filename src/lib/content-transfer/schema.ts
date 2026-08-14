import {
  activeCanonicalSyllabusTopics,
  compareCanonicalTopicIds,
} from "@/lib/data/canonical-syllabus-topics";
import type { QuestionLifecycleDto, QuestionVersionDto } from "@/lib/types";
import {
  CONTENT_TRANSFER_FORMAT,
  CONTENT_TRANSFER_IMPORT_STATES,
  CONTENT_TRANSFER_SCHEMA_VERSION,
  isContentTransferDraftState,
  isContentTransferImportState,
  type ContentTransferDocument,
  type ContentTransferExportScope,
  type ContentTransferImportState,
  type ContentTransferPreview,
  type ContentTransferPreviewRow,
  type ContentTransferQuestion,
  type ContentTransferStorageInspection,
  type ContentTransferTopicMapping,
} from "@/lib/content-transfer/types";

const ROOT_FIELDS = new Set([
  "exportedAt",
  "format",
  "questions",
  "schemaVersion",
  "topics",
]);
const TOPIC_FIELDS = new Set(["id", "order", "title"]);
const QUESTION_FIELDS = new Set([
  "answer",
  "difficulty",
  "hints",
  "misconceptions",
  "prompt",
  "reviewState",
  "solutionSteps",
  "stableId",
  "title",
  "topicId",
]);
const ANSWER_FIELDS = new Set([
  "acceptedAnswers",
  "explanation",
  "numericValue",
  "tolerance",
]);
const MISCONCEPTION_FIELDS = new Set(["feedback", "id", "matchTerms"]);
const DIFFICULTIES = new Set(["foundational", "intermediate", "challenge"]);
const FORBIDDEN_KEYS =
  /^(?:attempts?|chunk|chunks|email|embedding|embeddings|extractedText|locator|page|pageNumber|privateNotes|progress|rawText|session|sessions|source|sourceId|sourceIds|sourceMetadata|sourceText|studentData|studentId|textbookText|userId)$/i;
const PRIVATE_SOURCE_TEXT =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number/i;
const STABLE_ID = /^[a-z0-9][a-z0-9:_-]{0,127}$/;
const MAX_QUESTIONS = 100;
const MAX_TOPICS = 100;
const MAX_ACCEPTED_ANSWERS = 20;
const MAX_HINTS = 12;
const MAX_MISCONCEPTIONS = 12;
const MAX_SOLUTION_STEPS = 20;
const MAX_LONG_TEXT = 8_000;
const MAX_SHORT_TEXT = 500;

export type ContentTransferValidation = {
  document?: ContentTransferDocument;
  preview: ContentTransferPreview;
};

export function validateContentTransferDocument(
  value: unknown,
): ContentTransferValidation {
  const rootErrors: string[] = [];
  const root = recordValue(value);
  if (!root) {
    return validationResult(
      ["The transfer document must be a JSON object."],
      [],
      undefined,
    );
  }

  const forbidden = findForbiddenKey(value);
  if (forbidden) {
    rootErrors.push(
      `Unsupported private or student-data field at ${forbidden}.`,
    );
  }
  const unsupportedRoot = Object.keys(root).find(
    (field) => !ROOT_FIELDS.has(field),
  );
  if (unsupportedRoot) {
    rootErrors.push(`Unsupported transfer field: ${unsupportedRoot}.`);
  }
  if (root.format !== CONTENT_TRANSFER_FORMAT) {
    rootErrors.push(`format must be ${CONTENT_TRANSFER_FORMAT}.`);
  }
  if (root.schemaVersion !== CONTENT_TRANSFER_SCHEMA_VERSION) {
    rootErrors.push(
      `schemaVersion must be ${CONTENT_TRANSFER_SCHEMA_VERSION}.`,
    );
  }
  if (
    root.exportedAt !== undefined &&
    (typeof root.exportedAt !== "string" || !isIsoDateTime(root.exportedAt))
  ) {
    rootErrors.push("exportedAt must be an ISO date-time string when present.");
  }

  const topics = parseTopicMappings(root.topics, rootErrors);
  const rows = parseQuestionRows(root.questions, topics, rootErrors);
  markFileDuplicates(rows);
  const questions = rows.flatMap((row) => (row.question ? [row.question] : []));
  const hasRowErrors = rows.some((row) => row.preview.errors.length > 0);
  const document =
    rootErrors.length === 0 && !hasRowErrors
      ? {
          exportedAt:
            typeof root.exportedAt === "string" ? root.exportedAt : undefined,
          format: CONTENT_TRANSFER_FORMAT,
          questions,
          schemaVersion: CONTENT_TRANSFER_SCHEMA_VERSION,
          topics,
        }
      : undefined;

  return validationResult(
    rootErrors,
    rows.map((row) => row.preview),
    document,
  );
}

export function addStoredImportErrors(
  validation: ContentTransferValidation,
  inspection: ContentTransferStorageInspection,
): ContentTransferValidation {
  const existingContentFingerprints = new Set(
    inspection.existingContentFingerprints,
  );
  const existingQuestionIds = new Set(inspection.existingQuestionIds);
  const existingMisconceptionIds = new Set(inspection.existingMisconceptionIds);
  const unavailableTopicIds = new Set(inspection.unavailableTopicIds);
  const questions = new Map(
    validation.document?.questions.map((question) => [
      question.stableId,
      question,
    ]) ?? [],
  );
  for (const row of validation.preview.rows) {
    if (row.stableId && existingQuestionIds.has(row.stableId)) {
      row.errors.push("A question with this stable ID already exists.");
      row.status = "duplicate";
    }
    const question = row.stableId ? questions.get(row.stableId) : undefined;
    if (
      question &&
      existingContentFingerprints.has(
        contentTransferPromptFingerprint(question.prompt),
      )
    ) {
      row.errors.push("Question content matches an existing question.");
      row.status = "duplicate";
    }
    const duplicateMisconceptions = question?.misconceptions
      .map((item) => item.id)
      .filter((id) => existingMisconceptionIds.has(id));
    if (duplicateMisconceptions?.length) {
      row.errors.push(
        `Misconception IDs already exist: ${duplicateMisconceptions.join(", ")}.`,
      );
      row.status = "duplicate";
    }
    if (row.topicId && unavailableTopicIds.has(row.topicId)) {
      row.errors.push("The mapped topic is unavailable in content storage.");
      if (row.status !== "duplicate") row.status = "invalid";
    }
  }
  validation.preview.storageChecked = true;
  validation.preview.canApply =
    Boolean(validation.document) &&
    validation.preview.rootErrors.length === 0 &&
    validation.preview.rows.every((row) => row.status === "ready");
  validation.preview.summary = summarizeRows(validation.preview.rows);
  return validation;
}

export function contentTransferPromptFingerprint(prompt: string) {
  return prompt.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function buildQuestionContentExport(input: {
  exportedAt?: string;
  questions: QuestionLifecycleDto[];
  scope: ContentTransferExportScope;
}): ContentTransferDocument {
  const questions = input.questions
    .flatMap((question) => {
      const version = exportVersion(question, input.scope);
      return version ? [versionToTransferQuestion(version)] : [];
    })
    .sort(
      (left, right) =>
        compareCanonicalTopicIds(left.topicId, right.topicId) ||
        left.stableId.localeCompare(right.stableId),
    );

  return {
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    format: CONTENT_TRANSFER_FORMAT,
    questions,
    schemaVersion: CONTENT_TRANSFER_SCHEMA_VERSION,
    topics: activeCanonicalSyllabusTopics.map(({ id, order, title }) => ({
      id,
      order,
      title,
    })),
  };
}

function parseTopicMappings(value: unknown, errors: string[]) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_TOPICS
  ) {
    errors.push(`topics must contain 1 to ${MAX_TOPICS} canonical mappings.`);
    return [];
  }
  const canonical = new Map(
    activeCanonicalSyllabusTopics.map((topic) => [topic.id, topic]),
  );
  const seen = new Set<string>();
  const topics: ContentTransferTopicMapping[] = [];
  value.forEach((candidate, index) => {
    const item = recordValue(candidate);
    const label = `topics[${index}]`;
    if (!item) {
      errors.push(`${label} must be an object.`);
      return;
    }
    const unsupported = Object.keys(item).find(
      (field) => !TOPIC_FIELDS.has(field),
    );
    if (unsupported) errors.push(`${label}.${unsupported} is unsupported.`);
    const id = stringValue(item.id);
    const title = stringValue(item.title);
    const order = positiveInteger(item.order);
    if (!id || !title || !order) {
      errors.push(`${label} requires id, title, and positive order.`);
      return;
    }
    if (seen.has(id)) errors.push(`${label}.id duplicates ${id}.`);
    seen.add(id);
    const expected = canonical.get(id);
    if (!expected || expected.title !== title || expected.order !== order) {
      errors.push(`${label} does not match the canonical syllabus mapping.`);
      return;
    }
    topics.push({ id, order, title });
  });
  return topics.sort((left, right) => left.order - right.order);
}

type ParsedRow = {
  preview: ContentTransferPreviewRow;
  question?: ContentTransferQuestion;
};

function parseQuestionRows(
  value: unknown,
  topics: ContentTransferTopicMapping[],
  rootErrors: string[],
): ParsedRow[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_QUESTIONS
  ) {
    rootErrors.push(
      `questions must contain 1 to ${MAX_QUESTIONS} question rows.`,
    );
    return [];
  }
  const topicIds = new Set(topics.map((topic) => topic.id));
  return value.map((candidate, index) =>
    parseQuestionRow(candidate, index, topicIds),
  );
}

function parseQuestionRow(
  value: unknown,
  index: number,
  topicIds: ReadonlySet<string>,
): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];
  const item = recordValue(value);
  const preview: ContentTransferPreviewRow = {
    errors,
    index,
    status: "invalid",
    warnings,
  };
  if (!item) {
    errors.push("Question row must be a JSON object.");
    return { preview };
  }
  const unsupported = Object.keys(item).find(
    (field) => !QUESTION_FIELDS.has(field),
  );
  if (unsupported) errors.push(`Unsupported question field: ${unsupported}.`);

  const stableId = stringValue(item.stableId);
  const topicId = stringValue(item.topicId);
  const title = stringValue(item.title);
  const prompt = stringValue(item.prompt);
  const reviewState = stringValue(item.reviewState);
  preview.stableId = stableId;
  preview.topicId = topicId;
  preview.title = title;
  if (isContentTransferImportState(reviewState)) {
    preview.reviewState = reviewState;
  }

  if (!stableId || !STABLE_ID.test(stableId)) {
    errors.push(
      "stableId must be a lowercase stable identifier up to 128 characters.",
    );
  }
  if (!topicId || !topicIds.has(topicId)) {
    errors.push("topicId must reference a supplied canonical topic mapping.");
  }
  if (!shortText(title))
    errors.push("title is required and must not exceed 500 characters.");
  if (!longText(prompt))
    errors.push("prompt is required and must not exceed 8,000 characters.");
  if (!isContentTransferImportState(reviewState)) {
    errors.push(
      `reviewState must be one of ${CONTENT_TRANSFER_IMPORT_STATES.join(", ")}.`,
    );
  }
  if (!DIFFICULTIES.has(String(item.difficulty))) {
    errors.push("difficulty must be foundational, intermediate, or challenge.");
  }

  const answer = parseAnswer(item.answer, errors);
  const hints = strictTextArray(item.hints, "hints", MAX_HINTS, true, errors);
  const solutionSteps = strictTextArray(
    item.solutionSteps,
    "solutionSteps",
    MAX_SOLUTION_STEPS,
    false,
    errors,
  );
  const misconceptions = parseMisconceptions(item.misconceptions, errors);
  if (PRIVATE_SOURCE_TEXT.test(JSON.stringify(item))) {
    errors.push(
      "Question row contains private-source or copied-textbook wording.",
    );
  }

  const question =
    errors.length === 0 &&
    answer &&
    hints &&
    solutionSteps &&
    misconceptions &&
    stableId &&
    topicId &&
    title &&
    prompt &&
    isContentTransferImportState(reviewState) &&
    DIFFICULTIES.has(String(item.difficulty))
      ? {
          answer,
          difficulty: item.difficulty as ContentTransferQuestion["difficulty"],
          hints,
          misconceptions,
          prompt,
          reviewState,
          solutionSteps,
          stableId,
          title,
          topicId,
        }
      : undefined;
  preview.status = question ? "ready" : "invalid";
  return { preview, question };
}

function parseAnswer(value: unknown, errors: string[]) {
  const item = recordValue(value);
  if (!item) {
    errors.push("answer must be an object.");
    return undefined;
  }
  const unsupported = Object.keys(item).find(
    (field) => !ANSWER_FIELDS.has(field),
  );
  if (unsupported) errors.push(`Unsupported answer field: ${unsupported}.`);
  const acceptedAnswers = strictTextArray(
    item.acceptedAnswers,
    "answer.acceptedAnswers",
    MAX_ACCEPTED_ANSWERS,
    false,
    errors,
    true,
  );
  const explanation = stringValue(item.explanation);
  if (!longText(explanation)) {
    errors.push(
      "answer.explanation is required and must not exceed 8,000 characters.",
    );
  }
  const numericValue = optionalFiniteNumber(item.numericValue);
  const tolerance = optionalFiniteNumber(item.tolerance);
  if (numericValue === null || tolerance === null) {
    errors.push("Numeric answer and tolerance must be finite numbers.");
  }
  if (
    tolerance !== undefined &&
    tolerance !== null &&
    (numericValue == null || tolerance < 0)
  ) {
    errors.push(
      "Answer tolerance requires a numeric answer and cannot be negative.",
    );
  }
  if (
    acceptedAnswers &&
    numericValue !== undefined &&
    numericValue !== null &&
    !acceptedAnswers.some((answer) =>
      numericAnswerMatches(answer, numericValue, tolerance ?? 1e-9),
    )
  ) {
    errors.push("An accepted answer must match numericValue within tolerance.");
  }
  return acceptedAnswers &&
    longText(explanation) &&
    numericValue !== null &&
    tolerance !== null
    ? {
        acceptedAnswers,
        explanation,
        numericValue,
        tolerance,
      }
    : undefined;
}

function parseMisconceptions(value: unknown, errors: string[]) {
  if (!Array.isArray(value) || value.length > MAX_MISCONCEPTIONS) {
    errors.push(
      `misconceptions must be an array with at most ${MAX_MISCONCEPTIONS} items.`,
    );
    return undefined;
  }
  const ids = new Set<string>();
  return value.flatMap((candidate, index) => {
    const item = recordValue(candidate);
    if (!item) {
      errors.push(`misconceptions[${index}] must be an object.`);
      return [];
    }
    const unsupported = Object.keys(item).find(
      (field) => !MISCONCEPTION_FIELDS.has(field),
    );
    if (unsupported) {
      errors.push(`misconceptions[${index}].${unsupported} is unsupported.`);
    }
    const id = stringValue(item.id);
    const feedback = stringValue(item.feedback);
    const matchTerms = strictTextArray(
      item.matchTerms,
      `misconceptions[${index}].matchTerms`,
      12,
      true,
      errors,
      true,
    );
    if (!shortText(id)) errors.push(`misconceptions[${index}].id is required.`);
    if (!longText(feedback))
      errors.push(`misconceptions[${index}].feedback is required.`);
    if (id && ids.has(id))
      errors.push(`Misconception ID ${id} is duplicated in this row.`);
    ids.add(id);
    return id && feedback && matchTerms ? [{ feedback, id, matchTerms }] : [];
  });
}

function markFileDuplicates(rows: ParsedRow[]) {
  const ids = new Map<string, ParsedRow[]>();
  const content = new Map<string, ParsedRow[]>();
  const misconceptionIds = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    if (row.preview.stableId) {
      ids.set(row.preview.stableId, [
        ...(ids.get(row.preview.stableId) ?? []),
        row,
      ]);
    }
    if (row.question) {
      const fingerprint = JSON.stringify({
        ...row.question,
        reviewState: undefined,
        stableId: undefined,
      });
      content.set(fingerprint, [...(content.get(fingerprint) ?? []), row]);
      for (const misconception of row.question.misconceptions) {
        misconceptionIds.set(misconception.id, [
          ...(misconceptionIds.get(misconception.id) ?? []),
          row,
        ]);
      }
    }
  }
  for (const group of ids.values()) {
    if (group.length > 1)
      markDuplicate(group, "stableId is duplicated in this file.");
  }
  for (const group of content.values()) {
    if (group.length > 1)
      markDuplicate(group, "Question content is duplicated in this file.");
  }
  for (const [id, group] of misconceptionIds) {
    if (group.length > 1) {
      markDuplicate(
        group,
        `Misconception ID ${id} is duplicated in this file.`,
      );
    }
  }
}

function markDuplicate(rows: ParsedRow[], message: string) {
  rows.forEach((row) => {
    if (!row.preview.errors.includes(message)) row.preview.errors.push(message);
    row.preview.status = "duplicate";
    row.question = undefined;
  });
}

function exportVersion(
  question: QuestionLifecycleDto,
  scope: ContentTransferExportScope,
) {
  const eligible = (version: QuestionVersionDto | undefined) =>
    version?.source.visibility === "public" &&
    version.source.sourceType !== "private_reference_pattern" &&
    version.source.trustLevel !== "private_reference"
      ? version
      : undefined;

  if (scope === "approved") {
    if (question.publishedVersion) return eligible(question.publishedVersion);
    return question.workingVersion.state === "approved" ||
      question.workingVersion.state === "unpublished"
      ? eligible(question.workingVersion)
      : undefined;
  }
  if (scope === "drafts") {
    return isContentTransferDraftState(question.workingVersion.state)
      ? eligible(question.workingVersion)
      : undefined;
  }
  return eligible(question.workingVersion);
}

function versionToTransferQuestion(
  version: QuestionVersionDto,
): ContentTransferQuestion {
  return {
    answer: {
      acceptedAnswers: [...version.answer.acceptedAnswers],
      explanation: version.answer.explanation,
      numericValue: version.answer.numericValue,
      tolerance: version.answer.tolerance,
    },
    difficulty: version.difficulty,
    hints: [...version.hints],
    misconceptions: version.misconceptions.map((item) => ({
      feedback: item.feedback,
      id: item.id,
      matchTerms: [...item.matchTerms],
    })),
    prompt: version.prompt,
    reviewState: exportReviewState(version.state),
    solutionSteps: [...version.solutionSteps],
    stableId: version.id,
    title: version.title,
    topicId: version.topicId,
  };
}

function exportReviewState(
  state: QuestionVersionDto["state"],
): ContentTransferImportState {
  if (state === "published" || state === "unpublished") return "approved";
  return state;
}

function validationResult(
  rootErrors: string[],
  rows: ContentTransferPreviewRow[],
  document: ContentTransferDocument | undefined,
): ContentTransferValidation {
  const preview: ContentTransferPreview = {
    canApply: false,
    format: CONTENT_TRANSFER_FORMAT,
    rootErrors: [...new Set(rootErrors)],
    rows,
    schemaVersion: CONTENT_TRANSFER_SCHEMA_VERSION,
    storageChecked: false,
    summary: summarizeRows(rows),
  };
  return { document, preview };
}

function summarizeRows(rows: ContentTransferPreviewRow[]) {
  return {
    duplicates: rows.filter((row) => row.status === "duplicate").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    ready: rows.filter((row) => row.status === "ready").length,
    total: rows.length,
  };
}

function strictTextArray(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty: boolean,
  errors: string[],
  short = false,
) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > maximum
  ) {
    errors.push(
      `${label} must contain ${allowEmpty ? "0" : "1"} to ${maximum} items.`,
    );
    return undefined;
  }
  const items = value.map(stringValue);
  if (items.some((item) => !(short ? shortText(item) : longText(item)))) {
    errors.push(`${label} contains an empty or oversized text item.`);
    return undefined;
  }
  return items;
}

function findForbiddenKey(value: unknown, path = "$."): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenKey(value[index], `${path}[${index}].`);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(key)) return `${path}${key}`;
      const found = findForbiddenKey(item, `${path}${key}.`);
      if (found) return found;
    }
  }
  return undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function optionalFiniteNumber(value: unknown) {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shortText(value: string) {
  return value.length > 0 && value.length <= MAX_SHORT_TEXT;
}

function longText(value: string) {
  return value.length > 0 && value.length <= MAX_LONG_TEXT;
}

function isIsoDateTime(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) && Number.isFinite(Date.parse(value))
  );
}

function numericAnswerMatches(
  answer: string,
  value: number,
  tolerance: number,
) {
  const normalized = answer.trim().replaceAll(",", "").replace(/^\$/, "");
  let parsed: number;
  if (/^[-+]?\d+(?:\.\d+)?%$/.test(normalized)) {
    parsed = Number(normalized.slice(0, -1)) / 100;
  } else if (
    /^[-+]?\d+(?:\.\d+)?\s*\/\s*[-+]?\d+(?:\.\d+)?$/.test(normalized)
  ) {
    const [numerator, denominator] = normalized.split("/").map(Number);
    if (!denominator) return false;
    parsed = numerator / denominator;
  } else {
    parsed = Number(normalized);
  }
  return (
    Number.isFinite(parsed) &&
    Math.abs(parsed - value) <= Math.max(tolerance, 1e-9)
  );
}
