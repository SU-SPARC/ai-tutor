import { NextResponse } from "next/server";

import { toStudentTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getTutorSession } from "@/lib/data/tutor-session-repository";

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string };
};

export async function POST(_request: Request, context: SessionRouteContext) {
  const sessionId = await getSessionId(context);
  const access = await authorizeStudentResourceApi();
  if (!access.ok) {
    return access.response;
  }
  try {
    const currentSession = await getTutorSession(
      access.authorization,
      sessionId,
    );
    if (!currentSession || !(await toStudentTutorSessionDto(currentSession))) {
      return sessionNotFoundResponse();
    }
  } catch {
    return dataServiceUnavailableResponse();
  }

  return NextResponse.json(
    {
      error:
        "This split tutor event endpoint is retired. Submit an idempotent event to /api/tutor/respond.",
    },
    { status: 410 },
  );
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
