import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  lifecycleApiErrorResponse,
  stringValue,
} from "@/lib/api/question-lifecycle";
import { regenerateAdminQuestionStrict } from "@/lib/data/data-store";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";

const MAX_BODY_BYTES = 4_096;

type ParseResult =
  | { keepPattern: boolean; supersedeReason?: string }
  | { error: string; status: 400 | 413 };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await authorizeApi(requireProfessorReview);

  if (!access.ok) {
    return access.response;
  }

  const { id } = await params;
  const questionId = id?.trim();

  if (!questionId) {
    return NextResponse.json(
      { error: "A question id is required." },
      { status: 400 },
    );
  }

  const parsed = await parseRegenerationRequest(request);

  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status },
    );
  }

  try {
    const result = await regenerateAdminQuestionStrict(access.authorization, {
      idempotencyKey: stringValue(
        request.headers.get("idempotency-key"),
      )?.slice(0, 200),
      keepPattern: parsed.keepPattern,
      mode: "deterministic",
      questionId,
      requestId:
        stringValue(request.headers.get("x-request-id"))?.slice(0, 200) ??
        randomUUID(),
      supersedeReason: parsed.supersedeReason,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Generated question was not found or is not regeneratable." },
        { status: 404 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return lifecycleApiErrorResponse(error);
  }
}

async function parseRegenerationRequest(
  request: Request,
): Promise<ParseResult> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > MAX_BODY_BYTES) {
    return {
      error: "Regeneration requests must be smaller than 4KB.",
      status: 413,
    };
  }

  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return { keepPattern: true };
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody);
  } catch {
    return { error: "Request body must be valid JSON.", status: 400 };
  }

  if (!isRecord(body)) {
    return { error: "Request body must be a JSON object.", status: 400 };
  }

  const unsupportedField = Object.keys(body).find(
    (field) =>
      field !== "keepPattern" &&
      field !== "mode" &&
      field !== "supersedeReason",
  );

  if (unsupportedField) {
    return {
      error: `Unsupported regeneration field: ${unsupportedField}.`,
      status: 400,
    };
  }

  if (body.mode !== undefined && body.mode !== "deterministic") {
    return {
      error: "Only deterministic regeneration is enabled for this endpoint.",
      status: 400,
    };
  }

  if (body.keepPattern !== undefined && typeof body.keepPattern !== "boolean") {
    return { error: "keepPattern must be true or false.", status: 400 };
  }

  if (
    body.supersedeReason !== undefined &&
    (typeof body.supersedeReason !== "string" ||
      !body.supersedeReason.trim() ||
      body.supersedeReason.length > 1_000)
  ) {
    return {
      error:
        "supersedeReason must be a non-empty string of at most 1000 characters.",
      status: 400,
    };
  }

  return {
    keepPattern: body.keepPattern ?? true,
    supersedeReason:
      typeof body.supersedeReason === "string"
        ? body.supersedeReason.trim()
        : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
