import { NextResponse } from "next/server";

import { toStudentTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import {
  dataServiceUnavailableResponse,
  tutorSessionUnavailableResponse,
} from "@/lib/api/service-unavailable";
import { getTutorSession } from "@/lib/data/tutor-session-repository";
import { pilotRequestId } from "@/lib/observability/pilot-operations";

type SessionRouteContext = {
  params: Promise<{ sessionId: string }>;
};

const TUTOR_SESSION_DETAIL_ROUTE = "/api/tutor/session/[sessionId]";

export async function GET(request: Request, context: SessionRouteContext) {
  const requestId = pilotRequestId(request);
  const sessionId = await getSessionId(context);
  const access = await authorizeStudentResourceApi({
    request,
    requestId,
    route: TUTOR_SESSION_DETAIL_ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }
  let sessionDto;

  try {
    const session = await getTutorSession(access.authorization, sessionId);
    sessionDto = session ? await toStudentTutorSessionDto(session) : undefined;
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: TUTOR_SESSION_DETAIL_ROUTE,
    });
  }

  if (!sessionDto) {
    return tutorSessionUnavailableResponse({
      requestId,
      route: TUTOR_SESSION_DETAIL_ROUTE,
    });
  }

  return NextResponse.json(
    { session: sessionDto },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

async function getSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}
