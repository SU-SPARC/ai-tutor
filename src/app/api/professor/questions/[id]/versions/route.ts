import { NextResponse } from "next/server";

import {
  boundedNote,
  enumValue,
  isRecord,
  lifecycleApiErrorResponse,
  parseQuestionVersionContent,
  positiveInteger,
  QUESTION_CREATION_METHODS,
  safeGenerationMetadata,
} from "@/lib/api/question-lifecycle";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import { createQuestionLifecycleVersion } from "@/lib/data/data-store";

const MAX_BODY_BYTES = 65_536;

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
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Question version requests must be smaller than 64KB." },
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

  const baseVersionId = positiveInteger(body.baseVersionId);
  const expectedWorkingVersionId = positiveInteger(
    body.expectedWorkingVersionId,
  );
  const creationMethod = enumValue(
    body.creationMethod,
    QUESTION_CREATION_METHODS,
  );
  const content = parseQuestionVersionContent(body.content, questionId);
  if (
    !baseVersionId ||
    !expectedWorkingVersionId ||
    !creationMethod ||
    !content
  ) {
    return NextResponse.json(
      {
        error:
          "A base version, expected working version, creation method, and complete public-safe content are required.",
      },
      { status: 422 },
    );
  }

  try {
    const question = await createQuestionLifecycleVersion(
      access.authorization,
      {
        baseVersionId,
        content,
        creationMethod,
        expectedWorkingVersionId,
        generationMetadata: safeGenerationMetadata(body.generationMetadata),
        questionId,
        submit: body.submit === true,
        supersedeReason: boundedNote(body.supersedeReason),
      },
    );
    return question
      ? NextResponse.json({ question }, { status: 201 })
      : NextResponse.json(
          { error: "Question was not found." },
          { status: 404 },
        );
  } catch (error) {
    return lifecycleApiErrorResponse(error);
  }
}
