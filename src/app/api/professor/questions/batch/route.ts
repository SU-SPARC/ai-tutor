import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  boundedNote,
  enumValue,
  isRecord,
  lifecycleApiErrorResponse,
  positiveInteger,
  QUESTION_VERSION_STATES,
  stringValue,
} from "@/lib/api/question-lifecycle";
import {
  authorizeApi,
  currentAuthenticatedUser,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import { batchTransitionQuestionLifecycle } from "@/lib/data/data-store";
import { recordQuestionLifecycleApiAttempt } from "@/lib/data/question-lifecycle-audit";
import type {
  QuestionLifecycleBatchAction,
  QuestionLifecycleBatchItem,
} from "@/lib/types";

const MAX_BODY_BYTES = 32_768;
const MAX_BATCH_ITEMS = 25;
const BATCH_ACTIONS = [
  "request_revision",
  "reject",
  "publish",
] as const satisfies readonly QuestionLifecycleBatchAction[];
const REVISION_METHODS = ["manual", "regeneration"] as const;
const BATCH_FIELDS = new Set([
  "action",
  "idempotencyKey",
  "items",
  "note",
  "reasonCode",
  "revisionMethod",
]);
const ITEM_FIELDS = new Set(["expectedState", "questionId", "versionId"]);

export async function POST(request: Request) {
  const requestId =
    stringValue(request.headers.get("x-request-id"))?.slice(0, 200) ??
    randomUUID();
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) {
    await recordQuestionLifecycleApiAttempt({
      action: "batch_transition",
      outcome: "denied",
      principal: await currentAuthenticatedUser(),
      requestId,
    });
    return access.response;
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Batch review requests must be smaller than 32KB." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (
    !isRecord(body) ||
    Object.keys(body).some((field) => !BATCH_FIELDS.has(field))
  ) {
    return NextResponse.json(
      { error: "Batch review request contains unsupported fields." },
      { status: 400 },
    );
  }

  const action = enumValue(body.action, BATCH_ACTIONS);
  const revisionMethod = enumValue(body.revisionMethod, REVISION_METHODS);
  const idempotencyKey =
    stringValue(request.headers.get("idempotency-key")) ??
    stringValue(body.idempotencyKey);
  const items = parseBatchItems(body.items);
  const reasonCode = boundedNote(body.reasonCode, 80);
  const note = boundedNote(body.note);
  if (
    !action ||
    !idempotencyKey ||
    idempotencyKey.length > 160 ||
    !items
  ) {
    return NextResponse.json(
      {
        error:
          "Batch review requires 2 to 25 distinct items, an idempotency key, and action request_revision, reject, or publish. Batch approval is not supported.",
      },
      { status: 400 },
    );
  }
  if (
    (action === "request_revision" || action === "reject") &&
    !reasonCode
  ) {
    return NextResponse.json(
      { error: `${action} requires a reason code.` },
      { status: 422 },
    );
  }
  if (action === "request_revision" && !revisionMethod) {
    return NextResponse.json(
      {
        error:
          "Batch request revision requires revisionMethod manual or regeneration.",
      },
      { status: 422 },
    );
  }

  try {
    const result = await batchTransitionQuestionLifecycle(
      access.authorization,
      {
        action,
        idempotencyKey,
        items,
        note,
        reasonCode,
        requestId,
        revisionMethod,
      },
    );
    if (!result.applied) {
      await recordQuestionLifecycleApiAttempt({
        action: `batch_${action}`,
        errorName: "BatchPreflightFailed",
        outcome: "failure",
        principal: access.authorization.principal,
        requestId,
      });
      const validationOnly = result.failures.every(
        (failure) => failure.code === "validation_failed",
      );
      return NextResponse.json(
        {
          error:
            "No questions were changed because one or more selected versions failed batch preflight.",
          result,
        },
        { status: validationOnly ? 422 : 409 },
      );
    }
    return NextResponse.json({ result });
  } catch (error) {
    await recordQuestionLifecycleApiAttempt({
      action: `batch_${action}`,
      errorName: error instanceof Error ? error.name : "BatchLifecycleError",
      outcome: "failure",
      principal: access.authorization.principal,
      requestId,
    });
    return lifecycleApiErrorResponse(error);
  }
}

function parseBatchItems(
  value: unknown,
): QuestionLifecycleBatchItem[] | undefined {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > MAX_BATCH_ITEMS
  ) {
    return undefined;
  }
  const items: QuestionLifecycleBatchItem[] = [];
  const questionIds = new Set<string>();
  const versionIds = new Set<number>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some((field) => !ITEM_FIELDS.has(field))
    ) {
      return undefined;
    }
    const questionId = stringValue(candidate.questionId);
    const versionId = positiveInteger(candidate.versionId);
    const expectedState = enumValue(
      candidate.expectedState,
      QUESTION_VERSION_STATES,
    );
    if (
      !questionId ||
      !versionId ||
      !expectedState ||
      questionIds.has(questionId) ||
      versionIds.has(versionId)
    ) {
      return undefined;
    }
    questionIds.add(questionId);
    versionIds.add(versionId);
    items.push({ expectedState, questionId, versionId });
  }
  return items;
}
