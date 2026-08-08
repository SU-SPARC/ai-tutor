import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  boundedNote,
  enumValue,
  isRecord,
  lifecycleApiErrorResponse,
  positiveInteger,
  QUESTION_LIFECYCLE_ACTIONS,
  QUESTION_VERSION_STATES,
  stringValue,
} from "@/lib/api/question-lifecycle";
import {
  authorizeApi,
  currentAuthenticatedUser,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/principal";
import { transitionQuestionLifecycle } from "@/lib/data/data-store";
import { recordQuestionLifecycleApiAttempt } from "@/lib/data/question-lifecycle-audit";

const MAX_BODY_BYTES = 16_384;
const REVISION_METHODS = ["manual", "regeneration"] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId =
    stringValue(request.headers.get("x-request-id"))?.slice(0, 200) ??
    randomUUID();
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) {
    await recordQuestionLifecycleApiAttempt({
      outcome: "denied",
      principal: await currentAuthenticatedUser(),
      requestId,
    });
    return access.response;
  }
  const { id } = await params;
  const questionId = id?.trim();
  if (!questionId) {
    return auditedFailure(
      NextResponse.json(
        { error: "A question id is required." },
        { status: 400 },
      ),
      {
        errorName: "InvalidQuestionId",
        principal: access.authorization.principal,
        requestId,
      },
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return auditedFailure(
      NextResponse.json(
        { error: "Lifecycle transition requests must be smaller than 16KB." },
        { status: 413 },
      ),
      {
        errorName: "RequestTooLarge",
        principal: access.authorization.principal,
        questionId,
        requestId,
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return auditedFailure(
      NextResponse.json(
        { error: "Request body must be valid JSON." },
        { status: 400 },
      ),
      {
        errorName: "InvalidJson",
        principal: access.authorization.principal,
        questionId,
        requestId,
      },
    );
  }
  if (!isRecord(body)) {
    return auditedFailure(
      NextResponse.json(
        { error: "Request body must be a JSON object." },
        { status: 400 },
      ),
      {
        errorName: "InvalidRequestShape",
        principal: access.authorization.principal,
        questionId,
        requestId,
      },
    );
  }

  const action = enumValue(body.action, QUESTION_LIFECYCLE_ACTIONS);
  const versionId = positiveInteger(body.versionId);
  const expectedState =
    body.expectedState === undefined
      ? undefined
      : enumValue(body.expectedState, QUESTION_VERSION_STATES);
  const revisionMethod = enumValue(body.revisionMethod, REVISION_METHODS);
  if (!action || !versionId || (body.expectedState && !expectedState)) {
    return auditedFailure(
      NextResponse.json(
        {
          error:
            "A supported action, positive versionId, and valid expectedState are required.",
        },
        { status: 400 },
      ),
      {
        action: typeof body.action === "string" ? body.action : undefined,
        errorName: "InvalidTransitionRequest",
        principal: access.authorization.principal,
        questionId,
        requestId,
        versionId,
      },
    );
  }
  if (action === "request_revision" && !revisionMethod) {
    return auditedFailure(
      NextResponse.json(
        {
          error:
            "Request revision requires revisionMethod manual or regeneration.",
        },
        { status: 422 },
      ),
      {
        action,
        errorName: "MissingRevisionMethod",
        principal: access.authorization.principal,
        questionId,
        requestId,
        versionId,
      },
    );
  }

  try {
    const question = await transitionQuestionLifecycle(access.authorization, {
      action,
      expectedState,
      idempotencyKey: (
        stringValue(request.headers.get("idempotency-key")) ??
        stringValue(body.idempotencyKey)
      )?.slice(0, 200),
      note: boundedNote(body.note),
      questionId,
      reasonCode: boundedNote(body.reasonCode, 80),
      requestId,
      revisionMethod,
      versionId,
    });
    return NextResponse.json({ question });
  } catch (error) {
    await recordQuestionLifecycleApiAttempt({
      action,
      errorName: error instanceof Error ? error.name : "LifecycleError",
      outcome: "failure",
      principal: access.authorization.principal,
      questionId,
      requestId,
      versionId,
    });
    return lifecycleApiErrorResponse(error);
  }
}

async function auditedFailure(
  response: NextResponse,
  input: {
    action?: string;
    errorName: string;
    principal: AuthenticatedPrincipal;
    questionId?: string;
    requestId: string;
    versionId?: number;
  },
) {
  await recordQuestionLifecycleApiAttempt({
    ...input,
    outcome: "failure",
  });
  return response;
}
