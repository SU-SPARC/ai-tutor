import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireAnalyticsAccess } from "@/lib/auth/authorization";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import { isStudentKey } from "@/lib/professor/student-pseudonym";
import { resolveInstructorStudentIdentity } from "@/lib/professor/student-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE = "/api/professor/students/[studentKey]/identity";

type IdentityRouteContext = {
  params: Promise<{ studentKey: string }>;
};

/**
 * The deliberate identity reveal. It is a POST because each reveal is recorded
 * as an audit event, and because a GET would be prefetchable: a professor
 * should ask for an identity, not pass their cursor over a link.
 *
 * Authorization is checked before the student key is even read, so an
 * unauthorized caller learns nothing about which students exist. The response
 * carries the display name and primary email address and nothing else — never
 * the provider subject, the internal user id, or any other profile field.
 */
export async function POST(request: Request, context: IdentityRouteContext) {
  const requestId = pilotRequestId(request);
  const access = await authorizeApi(requireAnalyticsAccess, {
    request,
    requestId,
    route: ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }

  const { studentKey } = await context.params;

  if (!isStudentKey(studentKey)) {
    return studentNotFound();
  }

  try {
    const identity = await resolveInstructorStudentIdentity(
      access.authorization,
      studentKey,
      { requestId },
    );

    if (!identity) {
      return studentNotFound();
    }

    return NextResponse.json(identity, {
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

function studentNotFound() {
  return NextResponse.json(
    { error: "Student was not found." },
    { headers: { "Cache-Control": "private, no-store" }, status: 404 },
  );
}
