import { NextResponse } from "next/server";

import { toStudentTutorSessionDto } from "@/lib/api/tutor-session-dto";
import {
  authorizeStudentResourceApi,
  ownerFromAuthorization,
} from "@/lib/auth/authorization";
import {
  dataServiceUnavailableResponse,
  tutorSessionUnavailableResponse,
} from "@/lib/api/service-unavailable";
import { getTutorSession } from "@/lib/data/tutor-session-repository";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import { readSectionDelivery } from "@/lib/tutor/section-access";

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
    // A course section that turned hints off for this question withholds
    // hint text here too (the engine may have revealed one after a wrong
    // answer). Similar-problem practice is never section-restricted.
    const delivery =
      session && session.practiceContext !== "reserve_practice"
        ? await readSectionDelivery(
            ownerFromAuthorization(access.authorization),
            session.questionId,
          )
        : undefined;
    sessionDto = session
      ? await toStudentTutorSessionDto(session, {
          hintsEnabled: delivery?.hintsEnabled,
        })
      : undefined;
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
