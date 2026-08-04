import { NextResponse } from "next/server";

import { toTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { authorizeApi, requireStudentAccess } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getApprovedQuestionById } from "@/lib/data/data-store";
import { createTutorSession } from "@/lib/data/tutor-session-repository";

type CreateSessionBody = {
  questionId?: unknown;
};

export async function POST(request: Request) {
  let body: CreateSessionBody;

  try {
    body = (await request.json()) as CreateSessionBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const questionId = requiredString(body.questionId);

  if (!questionId) {
    return NextResponse.json(
      { error: "questionId is required." },
      { status: 400 },
    );
  }

  const access = await authorizeApi(() =>
    requireStudentAccess({ allowAnonymous: true, createAnonymous: true }),
  );
  if (!access.ok) {
    return access.response;
  }

  try {
    const question = await getApprovedQuestionById(questionId);
    if (!question) {
      return NextResponse.json(
        { error: "Question was not found." },
        { status: 404 },
      );
    }

    const session = await createTutorSession(access.authorization, questionId);
    return NextResponse.json(
      { session: toTutorSessionDto(session) },
      { status: 201 },
    );
  } catch {
    return dataServiceUnavailableResponse();
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
