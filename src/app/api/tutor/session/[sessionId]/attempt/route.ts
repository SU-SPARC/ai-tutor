import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { recordTutorSessionAttempt } from "@/lib/data/tutor-session-repository";
import { resolveStudentOwner } from "@/lib/auth/anonymous-session";

type AttemptBody = {
  answer?: unknown;
  answerPreview?: unknown;
};

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string };
};

export async function POST(request: Request, context: SessionRouteContext) {
  const sessionId = await getSessionId(context);
  let body: AttemptBody;

  try {
    body = (await request.json()) as AttemptBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  let session;

  try {
    const owner = await resolveStudentOwner();
    if (!owner) {
      return NextResponse.json(
        { error: "Tutor session was not found." },
        { status: 404 },
      );
    }
    session = await recordTutorSessionAttempt({
      answerPreview:
        optionalString(body.answerPreview) ?? optionalString(body.answer),
      owner,
      sessionId,
    });
  } catch {
    return dataServiceUnavailableResponse();
  }

  if (!session) {
    return NextResponse.json(
      { error: "Tutor session was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ session });
}

async function getSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
