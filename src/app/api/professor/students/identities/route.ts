import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireAnalyticsAccess } from "@/lib/auth/authorization";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import { resolveInstructorStudentRoster } from "@/lib/professor/student-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE = "/api/professor/students/identities";

/**
 * The roster reveal: every student on the Students page, named at once,
 * grouped by practised topic and ordered by last name within each group. It
 * is a POST for the same reasons as the single reveal — each student's reveal
 * is an audit event, and a GET would be prefetchable — and it takes no input,
 * because the population is the page's own and never the caller's to choose.
 *
 * Authorization comes first, so an unauthorized caller learns nothing, not
 * even how many students there are. The response carries each student's
 * display name and nothing else about them: no username, email address,
 * provider subject, or internal id.
 */
export async function POST(request: Request) {
  const requestId = pilotRequestId(request);
  const access = await authorizeApi(requireAnalyticsAccess, {
    request,
    requestId,
    route: ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }

  try {
    const roster = await resolveInstructorStudentRoster(access.authorization, {
      requestId,
    });

    return NextResponse.json(roster, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: ROUTE,
      subsystem: "tutor-session",
    });
  }
}
