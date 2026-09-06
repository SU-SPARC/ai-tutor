import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  boundedNote,
  enumValue,
  isRecord,
  lifecycleApiErrorResponse,
  positiveInteger,
  stringValue,
} from "@/lib/api/question-lifecycle";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import { setQuestionReserveDisposition } from "@/lib/data/data-store";
import {
  isQuestionReserveReasonCode,
  questionReserveReasonRequiresNote,
} from "@/lib/tutor/professor-question-reserve";

const RESERVE_ACTIONS = ["reserve", "release"] as const;
const MAX_BODY_BYTES = 16_384;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;

  const { id } = await params;
  const questionId = id?.trim();
  if (!questionId) {
    return NextResponse.json(
      { error: "A question id is required." },
      { status: 400 },
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Reserve requests must be smaller than 16KB." },
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
  if (!isRecord(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  const action = enumValue(body.action, RESERVE_ACTIONS);
  const expectedWorkingVersionId = positiveInteger(
    body.expectedWorkingVersionId,
  );
  const reasonCode = isQuestionReserveReasonCode(body.reasonCode)
    ? body.reasonCode
    : undefined;
  const note = boundedNote(body.note);

  if (!action || !expectedWorkingVersionId) {
    return NextResponse.json(
      {
        error:
          "A reserve or release action and positive expected working version are required.",
      },
      { status: 400 },
    );
  }
  if (action === "reserve" && !reasonCode) {
    return NextResponse.json(
      { error: "Select a supported Save for later reason." },
      { status: 422 },
    );
  }
  if (
    action === "reserve" &&
    reasonCode &&
    questionReserveReasonRequiresNote(reasonCode) &&
    !note
  ) {
    return NextResponse.json(
      { error: "Other requires an audit note." },
      { status: 422 },
    );
  }
  if (action === "release" && body.reasonCode !== undefined) {
    return NextResponse.json(
      { error: "Removing Save for later does not accept a reason code." },
      { status: 422 },
    );
  }

  try {
    const question = await setQuestionReserveDisposition(access.authorization, {
      action,
      expectedWorkingVersionId,
      idempotencyKey: (
        stringValue(request.headers.get("idempotency-key")) ??
        stringValue(body.idempotencyKey)
      )?.slice(0, 200),
      note,
      questionId,
      reasonCode,
      requestId:
        stringValue(request.headers.get("x-request-id"))?.slice(0, 200) ??
        randomUUID(),
    });
    return NextResponse.json({ question });
  } catch (error) {
    return lifecycleApiErrorResponse(error);
  }
}
