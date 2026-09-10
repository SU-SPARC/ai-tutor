import {
  validateAnswerSpec,
  checkTypedAnswer,
  type AnswerSpec,
} from "@/lib/tutor/answer/spec";
import {
  normalizeAnswerText,
  parseAnswerNumber,
} from "@/lib/tutor/answer-checker";
import type { Difficulty, Misconception } from "@/lib/types";
import {
  QUESTION_INTAKE_ANSWER_TYPES,
  QUESTION_INTAKE_QUESTION_TYPES,
  QUESTION_INTAKE_SOURCE_KINDS,
  type QuestionIntakeAnswerType,
  type QuestionIntakeDraft,
  type QuestionIntakeModelDraft,
  type QuestionIntakeSourceKind,
  type QuestionIntakeTopic,
  type QuestionIntakeVerificationCheck,
} from "@/lib/question-intake/types";

const ROOT_FIELDS = new Set([
  "answer",
  "answerType",
  "confidence",
  "difficulty",
  "hints",
  "misconceptions",
  "prompt",
  "questionType",
  "schemaVersion",
  "solutionSteps",
  "title",
  "topicId",
  "unreadableSegments",
  "warnings",
]);
const ANSWER_FIELDS = new Set([
  "spec",
  "acceptedAnswers",
  "explanation",
  "numericValue",
  "tolerance",
]);
const CONFIDENCE_FIELDS = new Set([
  "checker",
  "answer",
  "extraction",
  "overall",
  "topic",
]);
const MISCONCEPTION_FIELDS = new Set(["feedback", "id", "matchTerms"]);
const DIFFICULTIES = new Set<Difficulty>([
  "foundational",
  "intermediate",
  "challenge",
]);
const MAX_SHORT_TEXT = 500;
const MAX_LONG_TEXT = 8_000;

export type QuestionIntakeDraftValidation = {
  draft?: QuestionIntakeModelDraft;
  errors: string[];
};

export function validateQuestionIntakeModelDraft(
  value: unknown,
  topics: QuestionIntakeTopic[],
): QuestionIntakeDraftValidation {
  const errors: string[] = [];
  const root = recordValue(value);
  if (!root) {
    return { errors: ["AI output must be one JSON object."] };
  }
  const unsupported = Object.keys(root).find((key) => !ROOT_FIELDS.has(key));
  if (unsupported) errors.push(`Unsupported AI output field: ${unsupported}.`);
  if (root.schemaVersion !== 1) errors.push("schemaVersion must equal 1.");

  const title = shortText(root.title);
  const prompt = longText(root.prompt);
  const topicId = shortText(root.topicId);
  const questionType = enumValue(
    root.questionType,
    QUESTION_INTAKE_QUESTION_TYPES,
  );
  const answerType = enumValue(root.answerType, QUESTION_INTAKE_ANSWER_TYPES);
  const difficulty = enumValue(root.difficulty, [...DIFFICULTIES]);
  if (!title)
    errors.push("title is required and must be at most 500 characters.");
  if (!prompt)
    errors.push("prompt is required and must be at most 8,000 characters.");
  if (!topicId || !topics.some((topic) => topic.id === topicId)) {
    errors.push("topicId must reference one of the supplied active topics.");
  }
  if (!questionType) errors.push("questionType must be free_response.");
  if (!answerType) errors.push("answerType must be numeric or text.");
  if (!difficulty) {
    errors.push("difficulty must be foundational, intermediate, or challenge.");
  }

  const answer = parseAnswer(root.answer, answerType, errors);
  const hints = textArray(root.hints, "hints", 2, 4, false, errors);
  const solutionSteps = textArray(
    root.solutionSteps,
    "solutionSteps",
    1,
    12,
    false,
    errors,
  );
  const misconceptions = parseMisconceptions(root.misconceptions, errors);
  const confidence = parseConfidence(root.confidence, errors);
  const warnings = textArray(root.warnings, "warnings", 0, 12, true, errors);
  const unreadableSegments = textArray(
    root.unreadableSegments,
    "unreadableSegments",
    0,
    12,
    true,
    errors,
  );

  if (
    errors.length > 0 ||
    !title ||
    !prompt ||
    !topicId ||
    !questionType ||
    !answerType ||
    !difficulty ||
    !answer ||
    !hints ||
    !solutionSteps ||
    !misconceptions ||
    !confidence ||
    !warnings ||
    !unreadableSegments
  ) {
    return { errors: [...new Set(errors)] };
  }

  return {
    draft: {
      answer,
      answerType,
      confidence,
      difficulty,
      hints,
      misconceptions,
      prompt,
      questionType,
      schemaVersion: 1,
      solutionSteps,
      title,
      topicId,
      unreadableSegments,
      warnings,
    },
    errors: [],
  };
}

export function verifyQuestionIntakeDraft(
  draft: QuestionIntakeModelDraft,
  topics: QuestionIntakeTopic[],
): QuestionIntakeDraft {
  const checks: QuestionIntakeVerificationCheck[] = [];
  if (draft.answer.spec !== undefined) {
    const issues = validateAnswerSpec(
      draft.answer.spec,
      draft.answer.acceptedAnswers,
    );
    checks.push({
      code: "answer_checker_config",
      status: issues.length ? "failed" : "passed",
      message: issues.length
        ? issues.map((issue) => issue.message).join(" ")
        : "The typed checker configuration passed deterministic validation.",
    });
  }
  const answerSchemaValid = answerSchemaIsConsistent(draft);
  checks.push({
    code: "answer_schema",
    message: answerSchemaValid
      ? "The accepted answer agrees with the canonical answer representation."
      : "The accepted answer and numeric value do not agree.",
    status: answerSchemaValid ? "passed" : "failed",
  });

  const solutionConsistent = answerAppearsInSolution(draft);
  checks.push({
    code: "answer_solution_consistency",
    message: solutionConsistent
      ? "The final answer is supported by the explanation or solution steps."
      : "The final answer could not be verified against the explanation and solution steps.",
    status: solutionConsistent ? "passed" : "failed",
  });

  const firstHintRevealsAnswer = hintRevealsAnswer(draft.hints[0], draft);
  checks.push({
    code: "hint_progression",
    message: firstHintRevealsAnswer
      ? "Hint 1 appears to reveal the final answer and must be revised."
      : "Hint 1 gives guidance without directly revealing the final answer.",
    status: firstHintRevealsAnswer ? "failed" : "passed",
  });

  const topicValid = topics.some((topic) => topic.id === draft.topicId);
  checks.push({
    code: "topic_assignment",
    message: topicValid
      ? "The suggested topic is an active course topic."
      : "The suggested topic is not in the active course catalogue.",
    status: topicValid ? "passed" : "failed",
  });

  const warnings = [...draft.warnings];
  if (draft.confidence.topic < 0.75) {
    warnings.push("Suggested topic — please confirm.");
  }
  if (
    draft.confidence.extraction < 0.8 ||
    draft.unreadableSegments.length > 0
  ) {
    warnings.push(
      "Needs professor review: part of the submitted question may be unreadable.",
    );
  }
  if (
    draft.confidence.overall < 0.75 ||
    checks.some((check) => check.status === "failed")
  ) {
    warnings.push(
      "AI could not verify this question confidently. Professor review is required.",
    );
  }

  return {
    ...draft,
    review: {
      checks,
      required: true,
      status: "needs_professor_review",
    },
    warnings: [...new Set(warnings)],
  };
}

export function hasBlockingQuestionIntakeFailure(draft: QuestionIntakeDraft) {
  return draft.review.checks.some((check) => check.status === "failed");
}

export function questionIntakeModelDraftForSave(
  draft: QuestionIntakeDraft,
): QuestionIntakeModelDraft {
  return {
    answer: {
      ...draft.answer,
      acceptedAnswers: [...draft.answer.acceptedAnswers],
    },
    answerType: draft.answerType,
    confidence: { ...draft.confidence },
    difficulty: draft.difficulty,
    hints: [...draft.hints],
    misconceptions: draft.misconceptions.map((item) => ({
      ...item,
      matchTerms: [...item.matchTerms],
    })),
    prompt: draft.prompt,
    questionType: draft.questionType,
    schemaVersion: 1,
    solutionSteps: [...draft.solutionSteps],
    title: draft.title,
    topicId: draft.topicId,
    unreadableSegments: [...draft.unreadableSegments],
    warnings: [...draft.warnings],
  };
}

export function isQuestionIntakeSourceKind(
  value: unknown,
): value is QuestionIntakeSourceKind {
  return (
    typeof value === "string" &&
    (QUESTION_INTAKE_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

export function originalityNoteForQuestionIntake(
  sourceKind: QuestionIntakeSourceKind,
) {
  switch (sourceKind) {
    case "professor_authored":
      return "Professor identified the submitted question as professor authored. AI-generated tutoring fields require professor review.";
    case "professor_provided_course_material":
      return "Professor provided the question from course material. Source rights and AI-generated tutoring fields require professor review.";
    case "licensed_approved_course_material":
      return "Professor identified the question as licensed or approved course material. AI-generated tutoring fields require professor review.";
    case "unknown_needs_review":
      return "Professor marked the submitted question source as unknown and requiring review. AI-generated tutoring fields require professor review.";
  }
}

function parseAnswer(
  value: unknown,
  answerType: QuestionIntakeAnswerType | undefined,
  errors: string[],
) {
  const answer = recordValue(value);
  if (!answer) {
    errors.push("answer must be an object.");
    return undefined;
  }
  const unsupported = Object.keys(answer).find(
    (key) => !ANSWER_FIELDS.has(key),
  );
  if (unsupported) errors.push(`Unsupported answer field: ${unsupported}.`);
  const acceptedAnswers = textArray(
    answer.acceptedAnswers,
    "answer.acceptedAnswers",
    1,
    8,
    true,
    errors,
  );
  const explanation = longText(answer.explanation);
  if (!explanation) {
    errors.push(
      "answer.explanation is required and must be at most 8,000 characters.",
    );
  }
  if (answer.spec !== undefined)
    errors.push(
      ...validateAnswerSpec(answer.spec, acceptedAnswers ?? []).map(
        (issue) => issue.message,
      ),
    );
  const suppliedNumericValue = optionalFiniteNumber(answer.numericValue);
  const numericValue =
    answer.spec === undefined &&
    answerType === "numeric" &&
    suppliedNumericValue === undefined &&
    acceptedAnswers
      ? firstParsedAnswerNumber(acceptedAnswers)
      : suppliedNumericValue;
  const tolerance = optionalFiniteNumber(answer.tolerance);
  if (numericValue === null || tolerance === null) {
    errors.push("numericValue and tolerance must be finite when present.");
  }
  if (
    answer.spec === undefined &&
    answerType === "numeric" &&
    numericValue === undefined
  ) {
    errors.push("numeric answers require numericValue.");
  }
  if (answerType === "text" && numericValue !== undefined) {
    errors.push("text answers must not set numericValue.");
  }
  if (
    tolerance !== undefined &&
    tolerance !== null &&
    (numericValue === undefined || numericValue === null || tolerance < 0)
  ) {
    errors.push("tolerance requires numericValue and cannot be negative.");
  }
  return acceptedAnswers &&
    explanation &&
    numericValue !== null &&
    tolerance !== null
    ? {
        acceptedAnswers,
        explanation,
        numericValue,
        tolerance,
        ...(answer.spec !== undefined
          ? { spec: answer.spec as AnswerSpec }
          : {}),
      }
    : undefined;
}

function parseConfidence(value: unknown, errors: string[]) {
  const confidence = recordValue(value);
  if (!confidence) {
    errors.push("confidence must be an object.");
    return undefined;
  }
  const unsupported = Object.keys(confidence).find(
    (key) => !CONFIDENCE_FIELDS.has(key),
  );
  if (unsupported) errors.push(`Unsupported confidence field: ${unsupported}.`);
  const result = {
    ...(confidence.checker !== undefined
      ? { checker: confidenceNumber(confidence.checker) }
      : {}),
    answer: confidenceNumber(confidence.answer),
    extraction: confidenceNumber(confidence.extraction),
    overall: confidenceNumber(confidence.overall),
    topic: confidenceNumber(confidence.topic),
  };
  if (Object.values(result).some((item) => item === undefined)) {
    errors.push("All confidence values must be numbers from 0 to 1.");
    return undefined;
  }
  return result as QuestionIntakeModelDraft["confidence"];
}

function parseMisconceptions(value: unknown, errors: string[]) {
  if (!Array.isArray(value) || value.length > 8) {
    errors.push("misconceptions must contain 0 to 8 items.");
    return undefined;
  }
  const ids = new Set<string>();
  const result: Misconception[] = [];
  value.forEach((candidate, index) => {
    const item = recordValue(candidate);
    if (!item) {
      errors.push(`misconceptions[${index}] must be an object.`);
      return;
    }
    const unsupported = Object.keys(item).find(
      (key) => !MISCONCEPTION_FIELDS.has(key),
    );
    if (unsupported) {
      errors.push(
        `Unsupported misconceptions[${index}] field: ${unsupported}.`,
      );
    }
    const id = shortText(item.id);
    const feedback = longText(item.feedback);
    const matchTerms = textArray(
      item.matchTerms,
      `misconceptions[${index}].matchTerms`,
      0,
      12,
      true,
      errors,
    );
    if (!id || !feedback || !matchTerms) {
      errors.push(
        `misconceptions[${index}] requires id, feedback, and matchTerms.`,
      );
      return;
    }
    if (ids.has(id)) {
      errors.push(`Misconception ID ${id} is duplicated.`);
      return;
    }
    ids.add(id);
    result.push({ feedback, id, matchTerms });
  });
  return result;
}

function answerSchemaIsConsistent(draft: QuestionIntakeModelDraft) {
  if (draft.answer.spec !== undefined)
    return (
      validateAnswerSpec(draft.answer.spec, draft.answer.acceptedAnswers)
        .length === 0
    );
  if (draft.answerType === "text") {
    return draft.answer.numericValue === undefined;
  }
  const numericValue = draft.answer.numericValue;
  if (numericValue === undefined || !Number.isFinite(numericValue))
    return false;
  const tolerance = draft.answer.tolerance ?? 1e-9;
  return draft.answer.acceptedAnswers.some((candidate) => {
    const parsed = parseAnswerNumber(candidate);
    return (
      parsed !== undefined &&
      Math.abs(parsed - numericValue) <= Math.max(tolerance, 1e-9)
    );
  });
}

function answerAppearsInSolution(draft: QuestionIntakeModelDraft) {
  const solution = [draft.answer.explanation, ...draft.solutionSteps].join(" ");
  if (draft.answer.spec?.kind === "numeric") {
    const spec = draft.answer.spec;
    return numericLiteralsInText(solution).some(
      (candidate) =>
        checkTypedAnswer(candidate, {
          ...spec,
          formPolicy: "note",
          unit: spec.unit ? { ...spec.unit, required: false } : undefined,
        }).isCorrect,
    );
  }
  if (draft.answer.spec !== undefined || draft.answerType === "text") {
    const normalizedSolution = normalizeAnswerText(solution);
    return draft.answer.acceptedAnswers.some((answer) => {
      const normalized = normalizeAnswerText(answer);
      return normalized.length >= 2 && normalizedSolution.includes(normalized);
    });
  }
  const expected = draft.answer.numericValue;
  if (expected === undefined) return false;
  const tolerance = draft.answer.tolerance ?? 1e-9;
  return numericValuesInText(solution).some(
    (candidate) => Math.abs(candidate - expected) <= Math.max(tolerance, 1e-9),
  );
}

function hintRevealsAnswer(
  hint: string | undefined,
  draft: QuestionIntakeModelDraft,
) {
  if (!hint) return true;
  if (/\b(?:final\s+)?answer\s+is\b/i.test(hint)) return true;
  const normalizedHint = normalizeAnswerText(hint);
  return draft.answer.acceptedAnswers.some((answer) => {
    const normalized = normalizeAnswerText(answer);
    return normalized.length >= 3 && normalizedHint.includes(normalized);
  });
}

function numericLiteralsInText(value: string) {
  return (
    value.match(
      /\\(?:dfrac|frac|tfrac)\{[-+]?\d+(?:\.\d+)?\}\{[-+]?\d+(?:\.\d+)?\}|[-+]?\d+(?:\.\d+)?\s*\/\s*[-+]?\d+(?:\.\d+)?|[-+]?(?:\d+(?:\.\d+)?|\.\d+)%?/gu,
    ) ?? []
  );
}

function numericValuesInText(value: string) {
  return numericLiteralsInText(value).flatMap((candidate) => {
    const parsed = parseAnswerNumber(candidate);
    return parsed === undefined ? [] : [parsed];
  });
}

function textArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
  short: boolean,
  errors: string[],
) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    errors.push(`${label} must contain ${minimum} to ${maximum} items.`);
    return undefined;
  }
  const items = value.map((item) => (short ? shortText(item) : longText(item)));
  if (items.some((item) => !item)) {
    errors.push(`${label} contains an empty or oversized item.`);
    return undefined;
  }
  return items as string[];
}

function enumValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] | undefined {
  return typeof value === "string" && values.includes(value)
    ? (value as Values[number])
    : undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function shortText(value: unknown) {
  return typeof value === "string" &&
    value.trim() &&
    value.trim().length <= MAX_SHORT_TEXT
    ? value.trim()
    : undefined;
}

function longText(value: unknown) {
  return typeof value === "string" &&
    value.trim() &&
    value.trim().length <= MAX_LONG_TEXT
    ? value.trim()
    : undefined;
}

function optionalFiniteNumber(value: unknown) {
  if (value === undefined) return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstParsedAnswerNumber(values: string[]) {
  for (const value of values) {
    const parsed = parseAnswerNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function confidenceNumber(value: unknown) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined;
}
