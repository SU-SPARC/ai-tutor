/**
 * Closed-schema validation for a similar-question model output. Pure: it only
 * reads the value it is given. Unknown keys anywhere are errors, exactly like
 * the professor question intake schema.
 */

import {
  SIMILAR_QUESTION_CHANGE_KINDS,
  SIMILAR_QUESTION_LIMITS as LIMITS,
  SIMILAR_QUESTION_SCHEMA_VERSION,
  SUPPORTED_GENERATED_ANSWER_KINDS,
  type SimilarQuestionModelOutputV1,
} from "@/lib/similar-practice/contract";

export type SchemaIssue = {
  code:
    | "not_an_object"
    | "unexpected_key"
    | "missing_key"
    | "schema_version"
    | "invalid_text"
    | "invalid_array"
    | "invalid_enum"
    | "invalid_number"
    | "duplicate_value"
    | "unsupported_answer_kind";
  path: string;
  message: string;
};

export type SchemaResult =
  | { ok: true; output: SimilarQuestionModelOutputV1; issues: [] }
  | { ok: false; issues: SchemaIssue[] };

const DIFFICULTIES = ["foundational", "intermediate", "challenge"] as const;
const PARAMETER_NAME = /^[a-z][a-z0-9_]{0,31}$/i;
const MISCONCEPTION_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

type Record_ = Record<string, unknown>;

export function validateSimilarQuestionModelOutput(
  value: unknown,
): SchemaResult {
  const issues: SchemaIssue[] = [];
  const root = objectWithKeys(
    value,
    "$",
    ["schemaVersion", "sourceAnalysis", "variant", "changes", "selfCheck"],
    [],
    issues,
  );
  if (!root) return { ok: false, issues };

  if (root.schemaVersion !== SIMILAR_QUESTION_SCHEMA_VERSION) {
    issues.push({
      code: "schema_version",
      path: "$.schemaVersion",
      message: `schemaVersion must be ${SIMILAR_QUESTION_SCHEMA_VERSION}.`,
    });
  }

  const analysis = objectWithKeys(
    root.sourceAnalysis,
    "$.sourceAnalysis",
    ["conceptTag", "skill", "sourceComputation", "sourceStepCount"],
    [],
    issues,
  );
  if (analysis) {
    text(analysis.conceptTag, "$.sourceAnalysis.conceptTag", LIMITS.conceptTag, issues);
    text(analysis.skill, "$.sourceAnalysis.skill", LIMITS.skill, issues);
    text(
      analysis.sourceComputation,
      "$.sourceAnalysis.sourceComputation",
      LIMITS.computation,
      issues,
    );
    integer(
      analysis.sourceStepCount,
      "$.sourceAnalysis.sourceStepCount",
      LIMITS.sourceStepCount.min,
      LIMITS.sourceStepCount.max,
      issues,
    );
  }

  const variant = objectWithKeys(
    root.variant,
    "$.variant",
    [
      "courseId",
      "topicId",
      "title",
      "prompt",
      "difficulty",
      "answer",
      "computation",
      "parameters",
      "hints",
      "solutionSteps",
      "misconceptions",
    ],
    [],
    issues,
  );
  if (variant) {
    text(variant.courseId, "$.variant.courseId", LIMITS.identifier, issues);
    text(variant.topicId, "$.variant.topicId", LIMITS.identifier, issues);
    text(variant.title, "$.variant.title", LIMITS.title, issues);
    text(variant.prompt, "$.variant.prompt", LIMITS.prompt, issues);
    enumValue(variant.difficulty, "$.variant.difficulty", DIFFICULTIES, issues);
    text(variant.computation, "$.variant.computation", LIMITS.computation, issues);

    const answer = objectWithKeys(
      variant.answer,
      "$.variant.answer",
      ["acceptedAnswers", "explanation", "spec"],
      [],
      issues,
    );
    if (answer) {
      textArray(
        answer.acceptedAnswers,
        "$.variant.answer.acceptedAnswers",
        LIMITS.acceptedAnswers,
        LIMITS.acceptedAnswer,
        issues,
      );
      text(answer.explanation, "$.variant.answer.explanation", LIMITS.explanation, issues);
      // The spec's own shape is validated by validateAnswerSpec (a gate);
      // here only its kind decides whether V1 can verify it at all.
      if (!isRecord(answer.spec)) {
        issues.push({
          code: "not_an_object",
          path: "$.variant.answer.spec",
          message: "spec must be an object.",
        });
      } else if (
        !(SUPPORTED_GENERATED_ANSWER_KINDS as readonly unknown[]).includes(
          answer.spec.kind,
        )
      ) {
        issues.push({
          code: "unsupported_answer_kind",
          path: "$.variant.answer.spec.kind",
          message: `Generated variants support only ${SUPPORTED_GENERATED_ANSWER_KINDS.join(", ")} answers in V1.`,
        });
      }
    }

    parameters(variant.parameters, "$.variant.parameters", issues);
    textArray(variant.hints, "$.variant.hints", LIMITS.hints, LIMITS.hint, issues);
    textArray(
      variant.solutionSteps,
      "$.variant.solutionSteps",
      LIMITS.solutionSteps,
      LIMITS.solutionStep,
      issues,
    );
    misconceptions(variant.misconceptions, "$.variant.misconceptions", issues);
  }

  const changes = array(
    root.changes,
    "$.changes",
    LIMITS.changes.min,
    LIMITS.changes.max,
    issues,
  );
  if (changes) {
    changes.forEach((change, index) =>
      enumValue(change, `$.changes[${index}]`, SIMILAR_QUESTION_CHANGE_KINDS, issues),
    );
    if (new Set(changes).size !== changes.length) {
      issues.push({
        code: "duplicate_value",
        path: "$.changes",
        message: "changes must not repeat a kind.",
      });
    }
  }

  const selfCheck = objectWithKeys(
    root.selfCheck,
    "$.selfCheck",
    ["claimedAnswer", "confidence"],
    [],
    issues,
  );
  if (selfCheck) {
    text(selfCheck.claimedAnswer, "$.selfCheck.claimedAnswer", LIMITS.claimedAnswer, issues);
    if (
      typeof selfCheck.confidence !== "number" ||
      !Number.isFinite(selfCheck.confidence) ||
      selfCheck.confidence < 0 ||
      selfCheck.confidence > 1
    ) {
      issues.push({
        code: "invalid_number",
        path: "$.selfCheck.confidence",
        message: "confidence must be a number from 0 to 1.",
      });
    }
  }

  return issues.length === 0
    ? { ok: true, output: value as SimilarQuestionModelOutputV1, issues: [] }
    : { ok: false, issues };
}

function isRecord(value: unknown): value is Record_ {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectWithKeys(
  value: unknown,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: SchemaIssue[],
): Record_ | undefined {
  if (!isRecord(value)) {
    issues.push({ code: "not_an_object", path, message: `${path} must be an object.` });
    return undefined;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        code: "unexpected_key",
        path: `${path}.${key}`,
        message: `Unexpected key ${key}.`,
      });
    }
  }
  for (const key of required) {
    if (!(key in value)) {
      issues.push({
        code: "missing_key",
        path: `${path}.${key}`,
        message: `Missing key ${key}.`,
      });
    }
  }
  return value;
}

function text(
  value: unknown,
  path: string,
  maxLength: number,
  issues: SchemaIssue[],
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    issues.push({
      code: "invalid_text",
      path,
      message: `${path} must be non-empty text of at most ${maxLength} characters.`,
    });
    return false;
  }
  return true;
}

function array(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: SchemaIssue[],
): unknown[] | undefined {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    issues.push({
      code: "invalid_array",
      path,
      message: `${path} must contain ${min} to ${max} items.`,
    });
    return undefined;
  }
  return value;
}

function textArray(
  value: unknown,
  path: string,
  count: { min: number; max: number },
  maxLength: number,
  issues: SchemaIssue[],
) {
  const items = array(value, path, count.min, count.max, issues);
  items?.forEach((item, index) => text(item, `${path}[${index}]`, maxLength, issues));
}

function enumValue(
  value: unknown,
  path: string,
  allowed: readonly string[],
  issues: SchemaIssue[],
) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push({
      code: "invalid_enum",
      path,
      message: `${path} must be one of ${allowed.join(", ")}.`,
    });
  }
}

function integer(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: SchemaIssue[],
) {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    issues.push({
      code: "invalid_number",
      path,
      message: `${path} must be an integer from ${min} to ${max}.`,
    });
  }
}

function parameters(value: unknown, path: string, issues: SchemaIssue[]) {
  if (!isRecord(value)) {
    issues.push({ code: "not_an_object", path, message: `${path} must be an object.` });
    return;
  }
  const entries = Object.entries(value);
  if (
    entries.length < LIMITS.parameters.min ||
    entries.length > LIMITS.parameters.max
  ) {
    issues.push({
      code: "invalid_array",
      path,
      message: `${path} must have ${LIMITS.parameters.min} to ${LIMITS.parameters.max} entries.`,
    });
  }
  for (const [name, number] of entries) {
    if (!PARAMETER_NAME.test(name)) {
      issues.push({
        code: "unexpected_key",
        path: `${path}.${name}`,
        message: "Parameter names are short identifiers.",
      });
    }
    if (typeof number !== "number" || !Number.isFinite(number)) {
      issues.push({
        code: "invalid_number",
        path: `${path}.${name}`,
        message: "Parameter values must be finite numbers.",
      });
    }
  }
}

function misconceptions(value: unknown, path: string, issues: SchemaIssue[]) {
  const items = array(
    value,
    path,
    LIMITS.misconceptions.min,
    LIMITS.misconceptions.max,
    issues,
  );
  if (!items) return;
  const ids = new Set<string>();
  items.forEach((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = objectWithKeys(item, itemPath, ["id", "feedback", "matchTerms"], [], issues);
    if (!record) return;
    if (typeof record.id !== "string" || !MISCONCEPTION_ID.test(record.id) || record.id.length > 80) {
      issues.push({
        code: "invalid_text",
        path: `${itemPath}.id`,
        message: "Misconception ids are lowercase slugs of at most 80 characters.",
      });
    } else if (ids.has(record.id)) {
      issues.push({
        code: "duplicate_value",
        path: `${itemPath}.id`,
        message: "Misconception ids must be unique.",
      });
    } else {
      ids.add(record.id);
    }
    text(record.feedback, `${itemPath}.feedback`, LIMITS.misconceptionFeedback, issues);
    textArray(record.matchTerms, `${itemPath}.matchTerms`, LIMITS.matchTerms, LIMITS.matchTerm, issues);
  });
}
