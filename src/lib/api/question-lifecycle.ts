import { NextResponse } from "next/server";

import type { QuestionVersionContentInput } from "@/lib/data/question-lifecycle-repository";
import type {
  Difficulty,
  QuestionCreationMethod,
  QuestionLifecycleAction,
  QuestionVersionState,
  SourceType,
} from "@/lib/types";
import {
  QuestionLifecycleConflictError,
  QuestionLifecycleNotFoundError,
  QuestionLifecycleValidationError,
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

export function lifecycleApiErrorResponse(error: unknown) {
  if (error instanceof QuestionLifecycleNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof QuestionLifecycleValidationError) {
    return NextResponse.json({ error: error.message }, { status: 422 });
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
