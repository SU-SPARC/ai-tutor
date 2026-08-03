import { NextResponse } from "next/server";

import { isValidDifficulty } from "@/lib/api/question-serialization";
import { updateAdminQuestionDetailStrict } from "@/lib/data/data-store";
import type {
  AdminQuestionDetailAction,
  AdminQuestionDetailUpdate,
} from "@/lib/data/repository";
import { authorizeApiRole } from "@/lib/auth/principal";
import { isValidReviewStatus } from "@/lib/tutor/professor-admin";
import { TRUST_LEVELS, type TrustLevel } from "@/lib/types";

const MAX_BODY_BYTES = 32_768;
const MAX_REVIEW_NOTE_LENGTH = 1_000;
const MAX_TEXT_FIELD_LENGTH = 2_000;
const MAX_HINTS = 12;
const MAX_MISCONCEPTIONS = 12;
const MAX_MATCH_TERMS = 12;

const allowedTopLevelFields = new Set([
  "action",
  "difficulty",
  "hints",
  "misconceptions",
  "reviewerNotes",
  "reviewStatus",
  "topic",
  "topicId",
  "trustLevel",
]);

const allowedMisconceptionFields = new Set(["feedback", "id", "matchTerms"]);

const privateSourceKeys = new Set([
  "acceptedAnswers",
  "answer",
  "answerExplanation",
  "chunk",
  "chunks",
  "correctAnswer",
  "embedding",
  "embeddings",
  "extractedText",
  "explanation",
  "finalAnswer",
  "locator",
  "originalityNote",
  "page",
  "pageNumber",
  "patternId",
  "patternIds",
  "patternSource",
  "privateNotes",
  "privatePhraseHashes",
  "prompt",
  "question",
  "questionText",
  "rawText",
  "solution",
  "solutionSteps",
  "source",
  "sourceId",
  "sourceIds",
  "sourceItemIds",
  "sourceMetadata",
  "sourceNumberSets",
  "sourcePage",
  "sourceStoryFamilies",
  "sourceType",
  "visibility",
]);

const copiedSourceSignal =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number/i;

const actionAliases: Record<string, AdminQuestionDetailAction> = {
  approve: "approve_generated",
  approve_generated: "approve_generated",
  approve_generated_question: "approve_generated",
  reject: "reject_generated",
  reject_generated: "reject_generated",
  reject_generated_question: "reject_generated",
  request_regeneration: "request_regeneration",
  request_regeneration_question: "request_regeneration",
} satisfies Record<string, AdminQuestionDetailAction>;

type ParseResult =
  | { update: AdminQuestionDetailUpdate }
  | { error: string; status: 400 | 413 };

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeApiRole("admin");

  if (!authorization.ok) {
    return authorization.response;
  }

  const { id } = await params;
  const questionId = id?.trim();

  if (!questionId) {
    return NextResponse.json(
      { error: "A question id is required." },
      { status: 400 },
    );
  }

  const parsed = await parseMutation(request);

  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status },
    );
  }

  try {
    const question = await updateAdminQuestionDetailStrict(questionId, {
      ...parsed.update,
      reviewedBy: authorization.principal.displayName,
      reviewedByUserId: authorization.principal.userId,
    });

    if (!question) {
      return NextResponse.json(
        { error: "Question was not found or is not editable." },
        { status: 404 },
      );
    }

    return NextResponse.json({ question });
  } catch {
    return NextResponse.json(
      {
        error:
          "Admin question mutations require a configured database and public-safe question record.",
      },
      { status: 503 },
    );
  }
}

async function parseMutation(request: Request): Promise<ParseResult> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > MAX_BODY_BYTES) {
    return {
      error: "Admin question mutation requests must be smaller than 32KB.",
      status: 413,
    };
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { error: "Request body must be valid JSON.", status: 400 };
  }

  if (!isRecord(body)) {
    return { error: "Request body must be a JSON object.", status: 400 };
  }

  const unsupportedField = Object.keys(body).find(
    (field) => !allowedTopLevelFields.has(field),
  );

  if (unsupportedField) {
    return {
      error: `Unsupported admin question update field: ${unsupportedField}.`,
      status: 400,
    };
  }

  if (containsPrivateSourceSignal(body)) {
    return {
      error:
        "Request contains private-source fields or copied-source wording that cannot be written to public records.",
      status: 400,
    };
  }

  const update: AdminQuestionDetailUpdate = {};

  if (body.action !== undefined) {
    if (typeof body.action !== "string" || !actionAliases[body.action]) {
      return {
        error: "A supported generated-question action is required.",
        status: 400,
      };
    }

    update.action = actionAliases[body.action];
  }

  if (body.reviewStatus !== undefined) {
    if (
      typeof body.reviewStatus !== "string" ||
      !isValidReviewStatus(body.reviewStatus)
    ) {
      return {
        error: "reviewStatus must be a supported review status.",
        status: 400,
      };
    }

    update.reviewStatus = body.reviewStatus;
  }

  if (body.trustLevel !== undefined) {
    if (
      typeof body.trustLevel !== "string" ||
      !isValidTrustLevel(body.trustLevel)
    ) {
      return {
        error: "trustLevel must be a supported trust level.",
        status: 400,
      };
    }

    if (body.trustLevel === "private_reference") {
      return {
        error:
          "private_reference trust cannot be written through admin question mutations.",
        status: 400,
      };
    }

    update.trustLevel = body.trustLevel;
  }

  const topicResult = parseTopicId(body);
  if ("error" in topicResult) {
    return topicResult;
  }
  if (topicResult.topicId !== undefined) {
    update.topicId = topicResult.topicId;
  }

  if (body.difficulty !== undefined) {
    if (
      typeof body.difficulty !== "string" ||
      !isValidDifficulty(body.difficulty)
    ) {
      return {
        error: "difficulty must be foundational, intermediate, or challenge.",
        status: 400,
      };
    }

    update.difficulty = body.difficulty;
  }

  if (body.hints !== undefined) {
    const hints = parseStringArray(body.hints, "hints", MAX_HINTS);
    if ("error" in hints) {
      return hints;
    }

    update.hints = hints.value;
  }

  if (body.misconceptions !== undefined) {
    const misconceptions = parseMisconceptions(body.misconceptions);
    if ("error" in misconceptions) {
      return misconceptions;
    }

    update.misconceptions = misconceptions.value;
  }

  if (body.reviewerNotes !== undefined) {
    if (body.reviewerNotes !== null && typeof body.reviewerNotes !== "string") {
      return { error: "reviewerNotes must be a string or null.", status: 400 };
    }

    const reviewerNotes = body.reviewerNotes?.trim() ?? "";
    if (reviewerNotes.length > MAX_REVIEW_NOTE_LENGTH) {
      return { error: "reviewerNotes is too long.", status: 400 };
    }

    update.reviewerNotes = reviewerNotes;
  }

  if (Object.keys(update).length === 0) {
    return {
      error: "At least one supported update field or action is required.",
      status: 400,
    };
  }

  return { update };
}

function parseTopicId(
  body: Record<string, unknown>,
): { topicId?: string } | { error: string; status: 400 } {
  const topicId =
    typeof body.topicId === "string" ? body.topicId.trim() : undefined;
  const topic = typeof body.topic === "string" ? body.topic.trim() : undefined;

  if (body.topicId !== undefined && typeof body.topicId !== "string") {
    return { error: "topicId must be a string.", status: 400 };
  }

  if (body.topic !== undefined && typeof body.topic !== "string") {
    return { error: "topic must be a string topic id.", status: 400 };
  }

  if (topicId && topic && topicId !== topic) {
    return {
      error: "topic and topicId must refer to the same topic id.",
      status: 400,
    };
  }

  const nextTopicId = topicId ?? topic;

  if (nextTopicId !== undefined && nextTopicId.length === 0) {
    return { error: "topic must not be empty.", status: 400 };
  }

  return { topicId: nextTopicId };
}

function parseStringArray(
  value: unknown,
  fieldName: string,
  maxItems: number,
): { value: string[] } | { error: string; status: 400 } {
  if (!Array.isArray(value)) {
    return { error: `${fieldName} must be an array of strings.`, status: 400 };
  }

  if (value.length > maxItems) {
    return { error: `${fieldName} includes too many items.`, status: 400 };
  }

  const strings: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      return { error: `${fieldName} must contain only strings.`, status: 400 };
    }

    const trimmed = item.trim();
    if (!trimmed) {
      return {
        error: `${fieldName} cannot contain empty strings.`,
        status: 400,
      };
    }

    if (trimmed.length > MAX_TEXT_FIELD_LENGTH) {
      return {
        error: `${fieldName} contains an item that is too long.`,
        status: 400,
      };
    }

    strings.push(trimmed);
  }

  return { value: strings };
}

function parseMisconceptions(
  value: unknown,
):
  | { value: NonNullable<AdminQuestionDetailUpdate["misconceptions"]> }
  | { error: string; status: 400 } {
  if (!Array.isArray(value)) {
    return { error: "misconceptions must be an array.", status: 400 };
  }

  if (value.length > MAX_MISCONCEPTIONS) {
    return { error: "misconceptions includes too many items.", status: 400 };
  }

  const ids = new Set<string>();
  const misconceptions: NonNullable<
    AdminQuestionDetailUpdate["misconceptions"]
  > = [];

  for (const item of value) {
    if (!isRecord(item)) {
      return { error: "Each misconception must be an object.", status: 400 };
    }

    const unsupportedField = Object.keys(item).find(
      (field) => !allowedMisconceptionFields.has(field),
    );
    if (unsupportedField) {
      return {
        error: `Unsupported misconception field: ${unsupportedField}.`,
        status: 400,
      };
    }

    if (typeof item.id !== "string" || !item.id.trim()) {
      return { error: "Each misconception needs a non-empty id.", status: 400 };
    }

    if (typeof item.feedback !== "string" || !item.feedback.trim()) {
      return {
        error: "Each misconception needs non-empty feedback.",
        status: 400,
      };
    }

    const id = item.id.trim();
    const feedback = item.feedback.trim();

    if (ids.has(id)) {
      return { error: "Misconception ids must be unique.", status: 400 };
    }

    if (id.length > 100 || feedback.length > MAX_TEXT_FIELD_LENGTH) {
      return {
        error: "Misconception id or feedback is too long.",
        status: 400,
      };
    }

    const matchTerms =
      item.matchTerms === undefined
        ? { value: [] }
        : parseStringArray(
            item.matchTerms,
            "misconception matchTerms",
            MAX_MATCH_TERMS,
          );

    if ("error" in matchTerms) {
      return matchTerms;
    }

    ids.add(id);
    misconceptions.push({
      feedback,
      id,
      matchTerms: matchTerms.value,
    });
  }

  return { value: misconceptions };
}

function containsPrivateSourceSignal(value: unknown) {
  let unsafe = false;

  walkUnknown(value, (key, item) => {
    if (key && privateSourceKeys.has(key)) {
      unsafe = true;
    }

    if (typeof item === "string" && copiedSourceSignal.test(item)) {
      unsafe = true;
    }
  });

  return unsafe;
}

function walkUnknown(
  value: unknown,
  visit: (key: string | undefined, value: unknown) => void,
  key?: string,
) {
  visit(key, value);

  if (Array.isArray(value)) {
    value.forEach((item) => walkUnknown(item, visit));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    walkUnknown(childValue, visit, childKey);
  }
}

function isValidTrustLevel(value: string): value is TrustLevel {
  return (TRUST_LEVELS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
