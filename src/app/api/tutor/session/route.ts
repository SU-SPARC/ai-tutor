import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { createTutorSession } from "@/lib/data/tutor-session-repository";
import {
  AnonymousPilotUnavailableError,
  resolveStudentOwner,
} from "@/lib/auth/anonymous-session";

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

  try {
    const owner = await resolveStudentOwner({ createAnonymous: true });
    if (!owner) {
      return NextResponse.json(
        { error: "Student identity is required." },
        { status: 401 },
      );
    }
    const session = await createTutorSession({
      owner,
      questionId,
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    if (error instanceof AnonymousPilotUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return dataServiceUnavailableResponse();
  }
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
