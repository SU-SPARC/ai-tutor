import { NextResponse } from "next/server";

import { toStudentTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getTutorSession } from "@/lib/data/tutor-session-repository";

type SessionRouteContext = {
  params: Promise<{ sessionId: string }> | { sessionId: string };
};

export async function GET(_request: Request, context: SessionRouteContext) {
  const sessionId = await getSessionId(context);
  const access = await authorizeStudentResourceApi();
  if (!access.ok) {
    return access.response;
  }
  let sessionDto;

  try {
    const session = await getTutorSession(access.authorization, sessionId);
    sessionDto = session ? await toStudentTutorSessionDto(session) : undefined;
  } catch {
    return dataServiceUnavailableResponse();
  }

  if (!sessionDto) {
    return NextResponse.json(
      { error: "Tutor session was not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ session: sessionDto });
}

async function getSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}
