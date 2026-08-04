import { NextResponse } from "next/server";

import { regenerateAdminQuestionStrict } from "@/lib/data/data-store";
import { authorizeApi, requireAdministrator } from "@/lib/auth/authorization";

const MAX_BODY_BYTES = 4_096;

type ParseResult =
  | { keepPattern: boolean }
  | { error: string; status: 400 | 413 };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await authorizeApi(requireAdministrator);

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
      keepPattern: parsed.keepPattern,
      mode: "deterministic",
      questionId,
    });

    if (!result) {
      return NextResponse.json(
        { error: "Generated question was not found or is not regeneratable." },
        { status: 404 },
      );
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        error:
          "Question regeneration requires a configured database and public-safe generated question record.",
      },
      { status: 503 },
    );
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
    (field) => field !== "keepPattern" && field !== "mode",
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

  return { keepPattern: body.keepPattern ?? true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
