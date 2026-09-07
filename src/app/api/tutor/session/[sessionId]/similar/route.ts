import { NextResponse } from "next/server";

import { normalizeSummary } from "@/lib/api/question-serialization";
import {
  dataServiceUnavailableResponse,
  safeApiErrorResponse,
  tutorSessionUnavailableResponse,
} from "@/lib/api/service-unavailable";
import { authorizeStudentResourceApi } from "@/lib/auth/authorization";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import { startSimilarReservePractice } from "@/lib/tutor/similar-reserve-practice";

type SimilarQuestionRouteContext = {
  params: Promise<{ sessionId: string }>;
};

const SIMILAR_QUESTION_ROUTE = "/api/tutor/session/[sessionId]/similar";

export async function POST(
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
    const result = await startSimilarReservePractice(
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
      {
        practice:
          result.outcome === "match"
            ? {
                question: normalizeSummary(result.candidate.question),
                sessionId: result.sessionId,
              }
            : null,
      },
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
