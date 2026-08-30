import { NextResponse } from "next/server";

import { toTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { authorizeApi, requireStudentAccess } from "@/lib/auth/authorization";
import {
  dataServiceUnavailableResponse,
  safeApiErrorResponse,
} from "@/lib/api/service-unavailable";
import { getApprovedQuestionById } from "@/lib/data/data-store";
import { createTutorSession } from "@/lib/data/tutor-session-repository";
import { isTutorSessionIdempotencyKey } from "@/lib/tutor/session-persistence";
import { pilotRequestId } from "@/lib/observability/pilot-operations";

type CreateSessionBody = {
  idempotencyKey?: unknown;
  questionId?: unknown;
};

const TUTOR_SESSION_ROUTE = "/api/tutor/session";

export async function POST(request: Request) {
  const requestId = pilotRequestId(request);
  let body: CreateSessionBody;

  try {
    body = (await request.json()) as CreateSessionBody;
  } catch {
    return malformedSessionRequest(
      requestId,
      "Request body must be valid JSON.",
    );
  }

  const questionId = requiredString(body.questionId);

  if (!questionId) {
    return malformedSessionRequest(requestId, "questionId is required.");
  }

  const access = await authorizeApi(
    () => requireStudentAccess({ allowAnonymous: true, createAnonymous: true }),
    { request, requestId, route: TUTOR_SESSION_ROUTE },
  );
  if (!access.ok) {
    return access.response;
  }

  try {
    const question = await getApprovedQuestionById(questionId);
    if (!question) {
      return safeApiErrorResponse({
        code: "QUESTION_UNAVAILABLE",
        error: "This question is no longer available for practice.",
        event: "session_unavailable",
        requestId,
        route: TUTOR_SESSION_ROUTE,
        status: 404,
        subsystem: "content",
      });
    }
    if (!isTutorSessionIdempotencyKey(body.idempotencyKey)) {
      return malformedSessionRequest(
        requestId,
        "A 1-128 character idempotencyKey is required.",
      );
    }

    const session = await createTutorSession(
      access.authorization,
      questionId,
      body.idempotencyKey,
    );
    return NextResponse.json(
      { session: toTutorSessionDto(session) },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
        },
        status: 201,
      },
    );
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: TUTOR_SESSION_ROUTE,
    });
  }
}

function malformedSessionRequest(requestId: string, error: string) {
  return safeApiErrorResponse({
    code: "MALFORMED_TUTOR_SESSION_REQUEST",
    error,
    event: "malformed_request",
    requestId,
    route: TUTOR_SESSION_ROUTE,
    status: 400,
    subsystem: "tutor-session",
  });
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
