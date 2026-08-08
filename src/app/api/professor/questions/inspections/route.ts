import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
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
import { recordQuestionVersionInspection } from "@/lib/data/data-store";
import { recordQuestionLifecycleApiAttempt } from "@/lib/data/question-lifecycle-audit";

const MAX_BODY_BYTES = 8_192;
const INSPECTION_FIELDS = new Set([
  "expectedState",
  "questionId",
  "versionId",
]);

export async function POST(request: Request) {
  const requestId =
    stringValue(request.headers.get("x-request-id"))?.slice(0, 200) ??
    randomUUID();
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) {
    await recordQuestionLifecycleApiAttempt({
      action: "inspect",
      outcome: "denied",
      principal: await currentAuthenticatedUser(),
      requestId,
    });
    return access.response;
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Inspection requests must be smaller than 8KB." },
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
    Object.keys(body).some((field) => !INSPECTION_FIELDS.has(field))
  ) {
    return NextResponse.json(
      { error: "Inspection requests contain unsupported fields." },
      { status: 400 },
    );
  }

  const questionId = stringValue(body.questionId);
  const versionId = positiveInteger(body.versionId);
  const expectedState = enumValue(body.expectedState, QUESTION_VERSION_STATES);
  if (!questionId || !versionId || !expectedState) {
    return NextResponse.json(
      {
        error:
          "Inspection requires a questionId, positive versionId, and expectedState.",
      },
      { status: 400 },
    );
  }

  try {
    const inspection = await recordQuestionVersionInspection(
      access.authorization,
      { expectedState, questionId, versionId },
    );
    return NextResponse.json({ inspection });
  } catch (error) {
    await recordQuestionLifecycleApiAttempt({
      action: "inspect",
      errorName: error instanceof Error ? error.name : "InspectionError",
      outcome: "failure",
      principal: access.authorization.principal,
      questionId,
      requestId,
      versionId,
    });
    return lifecycleApiErrorResponse(error);
  }
}
