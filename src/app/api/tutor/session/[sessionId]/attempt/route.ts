import { toStudentTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import {
  dataServiceUnavailableResponse,
  safeApiErrorResponse,
  tutorSessionUnavailableResponse,
} from "@/lib/api/service-unavailable";
import { getTutorSession } from "@/lib/data/tutor-session-repository";
import { pilotRequestId } from "@/lib/observability/pilot-operations";

type SessionRouteContext = {
  params: Promise<{ sessionId: string }>;
};

const RETIRED_ATTEMPT_ROUTE = "/api/tutor/session/[sessionId]/attempt";

export async function POST(request: Request, context: SessionRouteContext) {
  const requestId = pilotRequestId(request);
  const sessionId = await getSessionId(context);
  const access = await authorizeStudentResourceApi({
    request,
    requestId,
    route: RETIRED_ATTEMPT_ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }
  try {
    const currentSession = await getTutorSession(
      access.authorization,
      sessionId,
    );
    if (!currentSession || !(await toStudentTutorSessionDto(currentSession))) {
      return tutorSessionUnavailableResponse({
        requestId,
        route: RETIRED_ATTEMPT_ROUTE,
      });
    }
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: RETIRED_ATTEMPT_ROUTE,
    });
  }

  return safeApiErrorResponse({
    code: "TUTOR_ENDPOINT_RETIRED",
    error:
      "This split tutor event endpoint is retired. Submit an idempotent event to /api/tutor/respond.",
    requestId,
    route: RETIRED_ATTEMPT_ROUTE,
    status: 410,
    subsystem: "tutor-session",
  });
}

async function getSessionId(context: SessionRouteContext) {
  const params = await context.params;
  return params.sessionId;
}
