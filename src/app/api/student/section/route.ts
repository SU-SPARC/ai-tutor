import { NextResponse } from "next/server";

import {
  dataServiceUnavailableResponse,
  safeApiErrorResponse,
} from "@/lib/api/service-unavailable";
import {
  authorizeApi,
  ownerFromAuthorization,
  requireStudentAccess,
} from "@/lib/auth/authorization";
import {
  CoursesNotFoundError,
  type StudentSectionDto,
} from "@/lib/data/courses-repository";
import {
  getStudentSection,
  joinStudentSection,
  leaveStudentSection,
} from "@/lib/data/data-store";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import {
  parseJoinCode,
  SECTION_CODE_MALFORMED_MESSAGE,
  SECTION_CODE_UNKNOWN_MESSAGE,
} from "@/lib/tutor/section-content";

const STUDENT_SECTION_ROUTE = "/api/student/section";

/**
 * The section this student (a signed-in account or a signed anonymous pilot
 * browser) has joined, or `null`. Course and section names only: no join
 * code, roster, or professor detail crosses this boundary.
 */
export async function GET(request: Request) {
  const requestId = pilotRequestId(request);
  const access = await authorizeApi(
    () => requireStudentAccess({ allowAnonymous: true }),
    { request, requestId, route: STUDENT_SECTION_ROUTE },
  );
  if (!access.ok) {
    return access.response;
  }

  try {
    const section = await getStudentSection(
      ownerFromAuthorization(access.authorization),
    );
    return sectionResponse(section ?? null, requestId);
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: STUDENT_SECTION_ROUTE,
      subsystem: "content",
    });
  }
}

/**
 * Joins the section a code names. The code is read in any case, with or
 * without the hyphen; anything that is not five letters or digits is a 400,
 * a well-formed code that names no active section is a 404. Joining a
 * pilot section is allowed for an anonymous pilot browser too, so the
 * identity is created here when the pilot allows it.
 */
export async function POST(request: Request) {
  const requestId = pilotRequestId(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return malformedSectionRequest(requestId);
  }

  const code =
    body && typeof body === "object" && !Array.isArray(body)
      ? parseJoinCode((body as { code?: unknown }).code)
      : undefined;
  if (!code) {
    return malformedSectionRequest(requestId);
  }

  const access = await authorizeApi(
    () => requireStudentAccess({ allowAnonymous: true, createAnonymous: true }),
    { request, requestId, route: STUDENT_SECTION_ROUTE },
  );
  if (!access.ok) {
    return access.response;
  }

  try {
    const section = await joinStudentSection(
      ownerFromAuthorization(access.authorization),
      code,
    );
    return sectionResponse(section, requestId);
  } catch (cause) {
    if (cause instanceof CoursesNotFoundError) {
      return safeApiErrorResponse({
        code: "SECTION_CODE_UNKNOWN",
        error: SECTION_CODE_UNKNOWN_MESSAGE,
        requestId,
        route: STUDENT_SECTION_ROUTE,
        status: 404,
        subsystem: "content",
      });
    }
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: STUDENT_SECTION_ROUTE,
      subsystem: "content",
    });
  }
}

/** Leaves every section this student is in. Leaving twice is harmless. */
export async function DELETE(request: Request) {
  const requestId = pilotRequestId(request);
  const access = await authorizeApi(
    () => requireStudentAccess({ allowAnonymous: true }),
    { request, requestId, route: STUDENT_SECTION_ROUTE },
  );
  if (!access.ok) {
    return access.response;
  }

  try {
    await leaveStudentSection(ownerFromAuthorization(access.authorization));
    return sectionResponse(null, requestId);
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: STUDENT_SECTION_ROUTE,
      subsystem: "content",
    });
  }
}

function sectionResponse(section: StudentSectionDto | null, requestId: string) {
  return NextResponse.json(
    { section },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}

function malformedSectionRequest(requestId: string) {
  return safeApiErrorResponse({
    code: "MALFORMED_SECTION_CODE",
    error: SECTION_CODE_MALFORMED_MESSAGE,
    event: "malformed_request",
    requestId,
    route: STUDENT_SECTION_ROUTE,
    status: 400,
    subsystem: "content",
  });
}
