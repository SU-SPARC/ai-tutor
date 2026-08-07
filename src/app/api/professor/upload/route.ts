import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { toProfessorReviewCandidateDto } from "@/lib/api/professor-dtos";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import { importReviewCandidates } from "@/lib/data/data-store";
import { validateGeneratedReviewUpload } from "@/lib/tutor/professor-tools";

const MAX_UPLOAD_BYTES = 256_000;

export async function POST(request: Request) {
  const access = await authorizeApi(requireProfessorReview);

  if (!access.ok) {
    return access.response;
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Generated review uploads must be smaller than 256KB." },
      { status: 413 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Upload body must be valid JSON." },
      { status: 400 },
    );
  }

  const payload = unwrapPayload(body);
  const validation = validateGeneratedReviewUpload(payload);

  if (validation.errors.length > 0) {
    return NextResponse.json(
      { errors: validation.errors, imported: false },
      { status: 400 },
    );
  }

  try {
    const result = await importReviewCandidates(
      access.authorization,
      validation.candidates,
    );

    return NextResponse.json({
      candidates: result.candidates.map(toProfessorReviewCandidateDto),
      count: result.candidates.length,
      imported: result.imported,
      message: result.message,
      mode: result.mode,
      nonDurable: result.nonDurable,
    });
  } catch {
    return dataServiceUnavailableResponse();
  }
}

function unwrapPayload(body: unknown) {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    "payload" in body
  ) {
    return (body as { payload: unknown }).payload;
  }

  return body;
}
