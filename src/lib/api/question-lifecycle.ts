import { NextResponse } from "next/server";

import type { QuestionVersionContentInput } from "@/lib/data/question-lifecycle-repository";
import type {
  Difficulty,
  QuestionCreationMethod,
  QuestionLifecycleAction,
  QuestionRevisionContentInput,
  QuestionVersionState,
  SourceType,
} from "@/lib/types";
import {
  QuestionLifecycleConflictError,
  QuestionLifecycleNotFoundError,
  QuestionLifecycleValidationError,
  QuestionPublicationBlockedError,
} from "@/lib/tutor/question-lifecycle";

export const QUESTION_CREATION_METHODS = [
  "manual",
  "imported",
  "generated",
  "regenerated",
  "rollback_clone",
] as const satisfies readonly QuestionCreationMethod[];

export const QUESTION_LIFECYCLE_ACTIONS = [
  "submit",
  "request_revision",
  "approve",
  "reject",
  "publish",
  "unpublish",
  "rollback",
  "archive",
  "restore",
] as const satisfies readonly QuestionLifecycleAction[];

export const QUESTION_VERSION_STATES = [
  "draft",
  "needs_review",
  "revision_requested",
  "approved",
  "published",
  "unpublished",
  "rejected",
] as const satisfies readonly QuestionVersionState[];

const DIFFICULTIES = [
  "foundational",
  "intermediate",
  "challenge",
] as const satisfies readonly Difficulty[];

const SOURCE_TYPES = [
  "original_demo",
  "professor_provided",
  "generated_original",
  "pattern_derived_original",
] as const satisfies readonly SourceType[];

const REVISION_FIELDS = new Set([
  "answer",
  "difficulty",
  "hints",
  "misconceptions",
  "prompt",
  "solutionSteps",
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
const PRIVATE_SOURCE_SIGNAL =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number/i;

export function lifecycleApiErrorResponse(error: unknown) {
  if (error instanceof QuestionLifecycleNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof QuestionLifecycleValidationError) {
    return NextResponse.json(
      {
        error: error.message,
        reasons:
          error instanceof QuestionPublicationBlockedError
            ? error.reasons
            : undefined,
      },
      { status: 422 },
    );
  }
  if (error instanceof QuestionLifecycleConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: "Question lifecycle storage is unavailable." },
    { status: 503 },
  );
}

export function parseQuestionVersionContent(
  value: unknown,
  expectedQuestionId?: string,
): QuestionVersionContentInput | undefined {
  const input = recordValue(value);
  const answer = recordValue(input?.answer);
  const source = recordValue(input?.source);
  const id = stringValue(input?.id);
  const topicId = stringValue(input?.topicId);
  const title = stringValue(input?.title);
  const prompt = stringValue(input?.prompt);
  const explanation = stringValue(answer?.explanation);
  const difficulty = enumValue(input?.difficulty, DIFFICULTIES);
  const sourceType = enumValue(source?.sourceType, SOURCE_TYPES);
  const acceptedAnswers = stringArray(answer?.acceptedAnswers);
  const hints = stringArray(input?.hints);
  const solutionSteps = stringArray(input?.solutionSteps);

  if (
    !input ||
    !id ||
    (expectedQuestionId && id !== expectedQuestionId) ||
    !topicId ||
    !title ||
    !prompt ||
    !explanation ||
    !difficulty ||
    !sourceType ||
    acceptedAnswers.length === 0 ||
    source?.visibility !== "public"
  ) {
    return undefined;
  }

  const misconceptions = Array.isArray(input.misconceptions)
    ? input.misconceptions.flatMap((value) => {
        const item = recordValue(value);
        const misconceptionId = stringValue(item?.id);
        const feedback = stringValue(item?.feedback);
        if (!misconceptionId || !feedback) {
          return [];
        }
        return [
          {
            feedback,
            id: misconceptionId,
            matchTerms: stringArray(item?.matchTerms),
          },
        ];
      })
    : [];

  return {
    answer: {
      acceptedAnswers,
      explanation,
      numericValue: finiteNumber(answer?.numericValue),
      tolerance: finiteNumber(answer?.tolerance),
    },
    difficulty,
    hints,
    id,
    misconceptions,
    prompt,
    solutionSteps,
    source: {
      originalityNote: stringValue(source.originalityNote),
      patternIds: stringArray(source.patternIds),
      sourceType,
      trustLevel:
        sourceType === "generated_original" ||
        sourceType === "pattern_derived_original"
          ? "generated_unverified"
          : "public_original",
      visibility: "public",
    },
    title,
    topicId,
  };
}

export function parseQuestionRevisionContent(
  value: unknown,
): { revision: QuestionRevisionContentInput } | { error: string } {
  const input = recordValue(value);
  if (!input) return { error: "revision must be a JSON object." };
  const unsupportedField = Object.keys(input).find(
    (field) => !REVISION_FIELDS.has(field),
  );
  if (unsupportedField) {
    return {
      error: `Unsupported revision field: ${unsupportedField}. Source and provenance fields are server-controlled.`,
    };
  }

  const answer = recordValue(input.answer);
  if (!answer) return { error: "revision.answer must be a JSON object." };
  const unsupportedAnswerField = Object.keys(answer).find(
    (field) => !ANSWER_FIELDS.has(field),
  );
  if (unsupportedAnswerField) {
    return { error: `Unsupported answer field: ${unsupportedAnswerField}.` };
  }

  const title = stringValue(input.title);
  const topicId = stringValue(input.topicId);
  const prompt = stringValue(input.prompt);
  const explanation = stringValue(answer.explanation);
  const difficulty = enumValue(input.difficulty, DIFFICULTIES);
  const acceptedAnswers = strictStringArray(answer.acceptedAnswers, false);
  const hints = strictStringArray(input.hints, true);
  const solutionSteps = strictStringArray(input.solutionSteps, false);
  if (
    !title ||
    !topicId ||
    !prompt ||
    !explanation ||
    !difficulty ||
    !acceptedAnswers ||
    !hints ||
    !solutionSteps
  ) {
    return {
      error:
        "Revision requires a title, syllabus topic, wording, difficulty, final answer, explanation, and at least one solution step.",
    };
  }

  const numericValue = optionalFiniteNumber(answer.numericValue);
  const tolerance = optionalFiniteNumber(answer.tolerance);
  if (numericValue === null || tolerance === null) {
    return { error: "Numeric answer and tolerance must be finite numbers." };
  }
  if (
    tolerance !== undefined &&
    (numericValue === undefined || tolerance < 0)
  ) {
    return {
      error:
        "Answer tolerance requires a numeric answer and cannot be negative.",
    };
  }
  if (
    numericValue !== undefined &&
    !acceptedAnswers.some((candidate) =>
      numericAnswerMatches(candidate, numericValue, tolerance ?? 1e-9),
    )
  ) {
    return {
      error:
        "At least one accepted answer must match the numeric answer within tolerance.",
    };
  }

  if (!Array.isArray(input.misconceptions)) {
    return { error: "misconceptions must be an array." };
  }
  const misconceptions = input.misconceptions.flatMap((value) => {
    const item = recordValue(value);
    if (
      !item ||
      Object.keys(item).some((key) => !MISCONCEPTION_FIELDS.has(key))
    ) {
      return [];
    }
    const id = stringValue(item.id);
    const feedback = stringValue(item.feedback);
    const matchTerms = strictStringArray(item.matchTerms, true);
    return id && feedback && matchTerms ? [{ feedback, id, matchTerms }] : [];
  });
  if (misconceptions.length !== input.misconceptions.length) {
    return {
      error:
        "Each misconception requires an id, feedback note, and string matchTerms array.",
    };
  }
  if (
    new Set(misconceptions.map((item) => item.id)).size !==
    misconceptions.length
  ) {
    return { error: "Misconception identifiers must be unique." };
  }
  if (
    acceptedAnswers.length > 20 ||
    hints.length > 12 ||
    solutionSteps.length > 20 ||
    misconceptions.length > 12
  ) {
    return {
      error:
        "Revision exceeds the supported answer, hint, step, or misconception limits.",
    };
  }
  const longText = [
    prompt,
    explanation,
    ...hints,
    ...solutionSteps,
    ...misconceptions.map((item) => item.feedback),
  ];
  const shortText = [
    title,
    topicId,
    ...acceptedAnswers,
    ...misconceptions.flatMap((item) => [item.id, ...item.matchTerms]),
  ];
  if (
    longText.some((text) => text.length > 8_000) ||
    shortText.some((text) => text.length > 500)
  ) {
    return { error: "Revision contains an oversized content field." };
  }

  const searchable = [
    title,
    prompt,
    explanation,
    ...acceptedAnswers,
    ...hints,
    ...solutionSteps,
    ...misconceptions.flatMap((item) => [item.feedback, ...item.matchTerms]),
  ].join(" ");
  if (PRIVATE_SOURCE_SIGNAL.test(searchable)) {
    return {
      error:
        "Revision contains private-source wording that cannot be stored in question content.",
    };
  }

  return {
    revision: {
      answer: {
        acceptedAnswers,
        explanation,
        numericValue,
        tolerance,
      },
      difficulty,
      hints,
      misconceptions,
      prompt,
      solutionSteps,
      title,
      topicId,
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function boundedNote(value: unknown, maxLength = 1000) {
  const note = stringValue(value);
  return note?.slice(0, maxLength);
}

export function safeGenerationMetadata(value: unknown) {
  const input = recordValue(value);
  if (!input) return undefined;
  const metadata: Record<string, boolean | number | string> = {};
  for (const key of ["configId", "generatorId", "jobId", "seed"] as const) {
    const candidate = input[key];
    if (
      typeof candidate === "boolean" ||
      (typeof candidate === "number" && Number.isFinite(candidate)) ||
      (typeof candidate === "string" &&
        candidate.trim() &&
        candidate.length <= 200)
    ) {
      metadata[key] =
        typeof candidate === "string" ? candidate.trim() : candidate;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

export function enumValue<T extends string>(
  value: unknown,
  values: readonly T[],
) {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalFiniteNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strictStringArray(value: unknown, allowEmpty: boolean) {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(stringValue);
  if (values.some((item) => !item)) return undefined;
  const strings = values as string[];
  return strings.length > 0 || allowEmpty ? strings : undefined;
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

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const text = stringValue(item);
        return text ? [text] : [];
      })
    : [];
}

function recordValue(value: unknown) {
  return isRecord(value) ? value : undefined;
}
