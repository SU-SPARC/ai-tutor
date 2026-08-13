import { NextResponse } from "next/server";

import {
  boundedNote,
  enumValue,
  isRecord,
  lifecycleApiErrorResponse,
  parseQuestionRevisionContent,
  parseQuestionVersionContent,
  positiveInteger,
  QUESTION_CREATION_METHODS,
  safeGenerationMetadata,
} from "@/lib/api/question-lifecycle";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import {
  createQuestionLifecycleRevision,
  createQuestionLifecycleVersion,
} from "@/lib/data/data-store";

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

  if (body.revision !== undefined) {
    return createProfessorRevision({
      authorization: access.authorization,
      body,
      questionId,
    });
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

async function createProfessorRevision({
  authorization,
  body,
  questionId,
}: {
  authorization: Awaited<ReturnType<typeof requireProfessorReview>>;
  body: Record<string, unknown>;
  questionId: string;
}) {
  const unsupportedField = Object.keys(body).find(
    (field) =>
      field !== "baseVersionId" &&
      field !== "comment" &&
      field !== "expectedWorkingVersionId" &&
      field !== "revision",
  );
  if (unsupportedField) {
    return NextResponse.json(
      { error: `Unsupported professor revision field: ${unsupportedField}.` },
      { status: 422 },
    );
  }

  const baseVersionId = positiveInteger(body.baseVersionId);
  const expectedWorkingVersionId = positiveInteger(
    body.expectedWorkingVersionId,
  );
  const parsedRevision = parseQuestionRevisionContent(body.revision);
  if (!baseVersionId || !expectedWorkingVersionId) {
    return NextResponse.json(
      {
        error:
          "Professor revision requires a base version and expected working version.",
      },
      { status: 422 },
    );
  }
  if ("error" in parsedRevision) {
    return NextResponse.json({ error: parsedRevision.error }, { status: 422 });
  }

  try {
    const question = await createQuestionLifecycleRevision(authorization, {
      baseVersionId,
      comment: boundedNote(body.comment),
      expectedWorkingVersionId,
      questionId,
      revision: parsedRevision.revision,
    });
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
