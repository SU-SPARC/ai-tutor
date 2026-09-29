import { authorizeApi, requireStudent } from "@/lib/auth/authorization";
import {
  dataServiceUnavailableResponse,
  safeApiErrorResponse,
} from "@/lib/api/service-unavailable";
import { recordSketchpadHeartbeat } from "@/lib/data/student-tool-usage-repository";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

const SKETCHPAD_HEARTBEAT_ROUTE = "/api/student/tools/sketchpad/heartbeat";
const MAX_HEARTBEAT_REQUEST_BYTES = 128;
export const SKETCHPAD_HEARTBEAT_OWNER_MAX_PER_MINUTE = 12;
export const SKETCHPAD_HEARTBEAT_IP_MAX_PER_MINUTE = 60;

/**
 * Records one server-bounded active-time bucket for the authenticated student.
 * The request deliberately has no duration or identity field. The external
 * Sketchpad must call this only after its own visibility/focus/idle checks;
 * until that application is instrumented, this endpoint records nothing.
 */
export async function POST(request: Request) {
  const requestId = pilotRequestId(request);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return safeApiErrorResponse({
      code: "SKETCHPAD_HEARTBEAT_ORIGIN_DENIED",
      error: "Sketchpad activity could not be recorded.",
      requestId,
      route: SKETCHPAD_HEARTBEAT_ROUTE,
      status: 403,
      subsystem: "student-tool-usage",
    });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_HEARTBEAT_REQUEST_BYTES) {
    return malformedHeartbeat(requestId);
  }

  const rawBody = await request.text();
  if (
    new TextEncoder().encode(rawBody).byteLength > MAX_HEARTBEAT_REQUEST_BYTES
  ) {
    return malformedHeartbeat(requestId);
  }
  if (rawBody.trim()) {
    try {
      const body = JSON.parse(rawBody) as unknown;
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length > 0
      ) {
        return malformedHeartbeat(requestId);
      }
    } catch {
      return malformedHeartbeat(requestId);
    }
  }

  const access = await authorizeApi(requireStudent, {
    request,
    requestId,
    route: SKETCHPAD_HEARTBEAT_ROUTE,
  });
  if (!access.ok) return access.response;

  if (access.authorization.principal.role !== "student") {
    return safeApiErrorResponse({
      code: "SKETCHPAD_HEARTBEAT_ROLE_DENIED",
      error: "Sketchpad activity could not be recorded.",
      requestId,
      route: SKETCHPAD_HEARTBEAT_ROUTE,
      status: 403,
      subsystem: "student-tool-usage",
    });
  }

  const owner = access.authorization.owner;
  const ownerLimit = checkRateLimit(
    `sketchpad-heartbeat:owner:${owner.kind}:${owner.userId}`,
    { max: SKETCHPAD_HEARTBEAT_OWNER_MAX_PER_MINUTE, windowMs: 60_000 },
  );
  const ipLimit = checkRateLimit(
    `sketchpad-heartbeat:ip:${getClientIp(request)}`,
    { max: SKETCHPAD_HEARTBEAT_IP_MAX_PER_MINUTE, windowMs: 60_000 },
  );
  if (!ownerLimit.allowed || !ipLimit.allowed) {
    return safeApiErrorResponse({
      code: "SKETCHPAD_HEARTBEAT_RATE_LIMITED",
      error: "Too many Sketchpad activity updates. Please try again later.",
      event: "rate_limit_reached",
      requestId,
      retryAfterSeconds:
        ownerLimit.retryAfterSeconds ?? ipLimit.retryAfterSeconds,
      route: SKETCHPAD_HEARTBEAT_ROUTE,
      status: 429,
      subsystem: "student-tool-usage",
    });
  }

  try {
    await recordSketchpadHeartbeat(access.authorization);
    return new Response(null, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
      status: 204,
    });
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: SKETCHPAD_HEARTBEAT_ROUTE,
      subsystem: "student-tool-usage",
    });
  }
}

function malformedHeartbeat(requestId: string) {
  return safeApiErrorResponse({
    code: "MALFORMED_SKETCHPAD_HEARTBEAT",
    error: "Sketchpad heartbeat requests must not include activity data.",
    requestId,
    route: SKETCHPAD_HEARTBEAT_ROUTE,
    status: 400,
    subsystem: "student-tool-usage",
  });
}
