import { NextResponse } from "next/server";

import { authorizeApi, requireStudent } from "@/lib/auth/authorization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { getStudentProgress } from "@/lib/data/student-progress";
import { pilotRequestId } from "@/lib/observability/pilot-operations";

const STUDENT_PROGRESS_ROUTE = "/api/student/progress";

export async function GET(request?: Request) {
  const requestId = pilotRequestId(request);
  const access = await authorizeApi(requireStudent, {
    request,
    requestId,
    route: STUDENT_PROGRESS_ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }

  try {
    const progress = await getStudentProgress(access.authorization);
    return NextResponse.json(
      { progress },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: STUDENT_PROGRESS_ROUTE,
      subsystem: "tutor-session",
    });
  }
}
