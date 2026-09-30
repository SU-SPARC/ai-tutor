import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireAnalyticsAccess } from "@/lib/auth/authorization";
import { isCourseIdShape } from "@/lib/course-catalog";
import { getPilotAnalyticsExport } from "@/lib/data/data-store";
import { pilotRequestId } from "@/lib/observability/pilot-operations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE = "/api/professor/analytics/export";

export async function GET(request: Request) {
  const requestId = pilotRequestId(request);
  const access = await authorizeApi(requireAnalyticsAccess, {
    request,
    requestId,
    route: ROUTE,
  });
  if (!access.ok) {
    return access.response;
  }

  // `?course=<id>` exports one course; without it, every course.
  const requestedCourse = new URL(request.url).searchParams.get("course");
  if (requestedCourse !== null && !isCourseIdShape(requestedCourse)) {
    return Response.json({ error: "Unknown course." }, { status: 400 });
  }

  try {
    const document = await getPilotAnalyticsExport(
      access.authorization,
      requestedCourse ? { courseId: requestedCourse } : undefined,
    );
    const exportDate = document.generatedAt.slice(0, 10);
    return new Response(JSON.stringify(document, null, 2), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="pilot-analytics-${exportDate}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
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
