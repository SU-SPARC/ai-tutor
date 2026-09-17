import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  enumValue,
  isRecord,
  lifecycleApiErrorResponse,
  positiveInteger,
  stringValue,
} from "@/lib/api/question-lifecycle";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import { setSimilarPracticeLink } from "@/lib/data/question-similarity-repository";

const ACTIONS = ["assign", "remove"] as const;
const MAX_BODY_BYTES = 16_384;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;

  const { id } = await params;
  const similarQuestionId = id?.trim();
  if (!similarQuestionId) {
    return NextResponse.json(
      { error: "A Reserve question id is required." },
      { status: 400 },
    );
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Similarity requests must be smaller than 16KB." },
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

  const action = enumValue(body.action, ACTIONS);
  const originQuestionId = stringValue(body.originQuestionId);
  const originVersionId = positiveInteger(body.originVersionId);
  const expectedSimilarVersionId = positiveInteger(
    body.expectedSimilarVersionId,
  );
  const slot = positiveInteger(body.slot);
  const linkId = positiveInteger(body.linkId);
  if (
    !action ||
    !originQuestionId ||
    !originVersionId ||
    !expectedSimilarVersionId ||
    !slot ||
    slot > 3 ||
    (action === "remove" && !linkId)
  ) {
    return NextResponse.json(
      {
        error:
          "Action, published origin version, Reserve version, and a slot from 1 to 3 are required.",
      },
      { status: 400 },
    );
  }

  try {
    const common = {
      expectedSimilarVersionId,
      originQuestionId,
      originVersionId,
      requestId:
        stringValue(request.headers.get("x-request-id"))?.slice(0, 200) ??
        randomUUID(),
      similarQuestionId,
      slot: slot as 1 | 2 | 3,
    };
    const links = await setSimilarPracticeLink(
      access.authorization,
      action === "remove"
        ? { ...common, action, linkId: linkId! }
        : { ...common, action },
    );
    return NextResponse.json({ links });
  } catch (error) {
    return lifecycleApiErrorResponse(error);
  }
}
