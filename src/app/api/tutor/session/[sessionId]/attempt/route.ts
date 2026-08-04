import { NextResponse } from "next/server";

import { toStudentTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import {
  getTutorSession,
  recordTutorSessionAttempt,
} from "@/lib/data/tutor-session-repository";

type AttemptBody = {
  answer?: unknown;
  answerPreview?: unknown;
};

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string };
};

export async function POST(request: Request, context: SessionRouteContext) {
  const sessionId = await getSessionId(context);
  const access = await authorizeStudentResourceApi();
  if (!access.ok) {
    return access.response;
  }
  let body: AttemptBody;

  try {
    body = (await request.json()) as AttemptBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  let sessionDto;

  try {
    const currentSession = await getTutorSession(
      access.authorization,
      sessionId,
    );
    if (!currentSession || !(await toStudentTutorSessionDto(currentSession))) {
      return sessionNotFoundResponse();
    }

    const session = await recordTutorSessionAttempt(access.authorization, {
      answerPreview:
        optionalString(body.answerPreview) ?? optionalString(body.answer),
      sessionId,
    });
    sessionDto = session ? await toStudentTutorSessionDto(session) : undefined;
  } catch {
    return dataServiceUnavailableResponse();
  }

  if (!sessionDto) {
    return sessionNotFoundResponse();
  }

  return NextResponse.json({ session: sessionDto });
}

function sessionNotFoundResponse() {
  return NextResponse.json(
    { error: "Tutor session was not found." },
    { status: 404 },
  );
}

async function getSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
