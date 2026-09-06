import { NextResponse } from "next/server";

import {
  dataServiceUnavailableResponse,
  safeApiErrorResponse,
  tutorSessionUnavailableResponse,
} from "@/lib/api/service-unavailable";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import { findSimilarPublishedQuestion } from "@/lib/tutor/similar-published-question";

type SimilarQuestionRouteContext = {
  params: Promise<{ sessionId: string }>;
};

const SIMILAR_QUESTION_ROUTE = "/api/tutor/session/[sessionId]/similar";

export async function GET(
  request: Request,
  context: SimilarQuestionRouteContext,
) {
  const requestId = pilotRequestId(request);
  const { sessionId } = await context.params;
  const access = await authorizeStudentResourceApi({
    request,
    requestId,
    route: SIMILAR_QUESTION_ROUTE,
  });
  if (!access.ok) return access.response;

  try {
    const result = await findSimilarPublishedQuestion(
      access.authorization,
      sessionId,
    );
    if (result.outcome === "session_unavailable") {
      return tutorSessionUnavailableResponse({
        requestId,
        route: SIMILAR_QUESTION_ROUTE,
      });
    }
    if (result.outcome === "not_completed") {
      return safeApiErrorResponse({
        code: "TUTOR_SESSION_NOT_COMPLETE",
        error: "Complete this question before requesting a similar problem.",
        requestId,
        route: SIMILAR_QUESTION_ROUTE,
        status: 409,
        subsystem: "tutor-session",
      });
    }
    return NextResponse.json(
      { question: result.outcome === "match" ? result.question : null },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: SIMILAR_QUESTION_ROUTE,
    });
  }
}
