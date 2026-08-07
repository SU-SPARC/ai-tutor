export const SERVER_BOUNDARY_ACCESS = [
  "public",
  "public-auth-protocol",
  "public-sanitized-health",
  "student-or-anonymous",
  "student-authenticated",
  "owned-student-resource",
  "professor-or-admin",
  "professor-review-or-admin",
  "professor-analytics-or-admin",
  "administrator",
] as const;

export type ServerBoundaryAccess = (typeof SERVER_BOUNDARY_ACCESS)[number];

export type ServerBoundaryPolicy = {
  access: ServerBoundaryAccess;
  boundary: string;
  dataPolicy: string;
  enforcementMarkers: readonly string[];
  file: string;
  kind: "layout" | "page" | "route-handler" | "server-action";
};

/**
 * Authoritative inventory for every App Router page, layout, route-handler
 * method, and exported Server Action. Tests compare this matrix with the
 * filesystem and verify that each declared enforcement marker remains at its
 * server boundary.
 */
export const SERVER_BOUNDARY_PERMISSION_MATRIX = [
  page("/", "src/app/page.tsx", "public", ["getQuestionCounts"]),
  page("/account", "src/app/account/page.tsx", "student-authenticated", [
    "requireStudent",
  ]),
  page(
    "/admin/analytics",
    "src/app/admin/analytics/page.tsx",
    "professor-analytics-or-admin",
    ["requireAnalyticsAccess"],
  ),
  page(
    "/admin/questions",
    "src/app/admin/questions/page.tsx",
    "administrator",
    ["requireAdministrator", "getAdminQuestionDashboard"],
  ),
  page(
    "/admin/review",
    "src/app/admin/review/page.tsx",
    "professor-review-or-admin",
    ["requireProfessorReview"],
  ),
  page("/admin/upload", "src/app/admin/upload/page.tsx", "administrator", [
    "requireAdministrator",
  ]),
  page("/dashboard", "src/app/dashboard/page.tsx", "student-or-anonymous", [
    "ProgressDashboard",
  ]),
  page("/forbidden", "src/app/forbidden/page.tsx", "public", []),
  page("/onboarding", "src/app/onboarding/page.tsx", "student-authenticated", [
    "requireStudent",
  ]),
  page("/practice", "src/app/practice/page.tsx", "public", [
    "getApprovedQuestions",
  ]),
  page(
    "/practice/[questionId]",
    "src/app/practice/[questionId]/page.tsx",
    "public",
    ["getApprovedQuestionById"],
  ),
  page("/professor", "src/app/professor/page.tsx", "professor-or-admin", [
    "requireProfessor",
  ]),
  page(
    "/sign-in/[[...sign-in]]",
    "src/app/sign-in/[[...sign-in]]/page.tsx",
    "public-auth-protocol",
    ["safeReturnPath", "SignIn"],
  ),
  page(
    "/sign-up/[[...sign-up]]",
    "src/app/sign-up/[[...sign-up]]/page.tsx",
    "public-auth-protocol",
    ["safeReturnPath", "SignUp"],
  ),
  page("/topics", "src/app/topics/page.tsx", "public", ["getQuestionCounts"]),
  page("/topics/[slug]", "src/app/topics/[slug]/page.tsx", "public", [
    "listQuestionsByTopic",
  ]),

  layout("/", "src/app/layout.tsx", "public", []),
  layout("/admin", "src/app/admin/layout.tsx", "professor-or-admin", [
    "requireProfessor",
  ]),
  layout("/professor", "src/app/professor/layout.tsx", "professor-or-admin", [
    "requireProfessor",
  ]),

  route(
    "POST",
    "/api/account/claim-anonymous",
    "src/app/api/account/claim-anonymous/route.ts",
    "student-authenticated",
    ["requireStudent"],
  ),
  route(
    "POST",
    "/api/account/discard-anonymous",
    "src/app/api/account/discard-anonymous/route.ts",
    "student-authenticated",
    ["requireStudent"],
  ),
  route(
    "GET",
    "/api/admin/questions",
    "src/app/api/admin/questions/route.ts",
    "administrator",
    ["requireAdministrator"],
  ),
  route(
    "PATCH",
    "/api/admin/questions",
    "src/app/api/admin/questions/route.ts",
    "administrator",
    ["requireAdministrator"],
  ),
  route(
    "PATCH",
    "/api/admin/questions/[id]",
    "src/app/api/admin/questions/[id]/route.ts",
    "administrator",
    ["requireAdministrator"],
  ),
  route(
    "POST",
    "/api/admin/questions/[id]/regenerate",
    "src/app/api/admin/questions/[id]/regenerate/route.ts",
    "administrator",
    ["requireAdministrator"],
  ),
  route(
    "POST",
    "/api/admin/upload",
    "src/app/api/admin/upload/route.ts",
    "administrator",
    ["requireAdministrator"],
  ),
  route(
    "GET",
    "/api/health/database",
    "src/app/api/health/database/route.ts",
    "public-sanitized-health",
    ["NO_STORE_HEADERS", "checkPostgresHealth"],
  ),
  route(
    "POST",
    "/api/identity/legacy-anonymous",
    "src/app/api/identity/legacy-anonymous/route.ts",
    "student-authenticated",
    ["requireStudent"],
  ),
  route(
    "GET",
    "/api/professor/analytics",
    "src/app/api/professor/analytics/route.ts",
    "professor-analytics-or-admin",
    ["requireAnalyticsAccess", "toProfessorAnalyticsDto"],
  ),
  route(
    "GET",
    "/api/professor/review",
    "src/app/api/professor/review/route.ts",
    "professor-review-or-admin",
    ["requireProfessorReview", "toProfessorReviewCandidateDto"],
  ),
  route(
    "PATCH",
    "/api/professor/review",
    "src/app/api/professor/review/route.ts",
    "professor-review-or-admin",
    ["requireProfessorReview", "updateReviewCandidates"],
  ),
  route(
    "POST",
    "/api/professor/review",
    "src/app/api/professor/review/route.ts",
    "professor-review-or-admin",
    ["requireProfessorReview", "updateReviewCandidates"],
  ),
  route(
    "POST",
    "/api/professor/upload",
    "src/app/api/professor/upload/route.ts",
    "professor-review-or-admin",
    ["requireProfessorReview"],
  ),
  route("GET", "/api/questions", "src/app/api/questions/route.ts", "public", [
    "isPublishedContent",
  ]),
  route(
    "GET",
    "/api/questions/[id]",
    "src/app/api/questions/[id]/route.ts",
    "public",
    ["isPublishedContent"],
  ),
  route(
    "POST",
    "/api/retrieval/search",
    "src/app/api/retrieval/search/route.ts",
    "professor-or-admin",
    ["requireProfessor", "Administrator role is required"],
  ),
  route(
    "GET",
    "/api/student/progress",
    "src/app/api/student/progress/route.ts",
    "student-or-anonymous",
    ["requireStudentAccess", "getStudentProgress"],
  ),
  route(
    "POST",
    "/api/tutor/respond",
    "src/app/api/tutor/respond/route.ts",
    "owned-student-resource",
    [
      "authorizeStudentResourceApi",
      "getApprovedQuestionById",
      "toTutorResponseDto",
    ],
  ),
  route(
    "POST",
    "/api/tutor/session",
    "src/app/api/tutor/session/route.ts",
    "student-or-anonymous",
    ["requireStudentAccess", "getApprovedQuestionById"],
  ),
  route(
    "GET",
    "/api/tutor/session/[sessionId]",
    "src/app/api/tutor/session/[sessionId]/route.ts",
    "owned-student-resource",
    ["authorizeStudentResourceApi", "toStudentTutorSessionDto"],
  ),
  route(
    "POST",
    "/api/tutor/session/[sessionId]/attempt",
    "src/app/api/tutor/session/[sessionId]/attempt/route.ts",
    "owned-student-resource",
    ["authorizeStudentResourceApi", "toStudentTutorSessionDto"],
  ),
  route(
    "POST",
    "/api/tutor/session/[sessionId]/hint",
    "src/app/api/tutor/session/[sessionId]/hint/route.ts",
    "owned-student-resource",
    ["authorizeStudentResourceApi", "toStudentTutorSessionDto"],
  ),
  route(
    "POST",
    "/api/tutor/session/[sessionId]/step",
    "src/app/api/tutor/session/[sessionId]/step/route.ts",
    "owned-student-resource",
    ["authorizeStudentResourceApi", "toStudentTutorSessionDto"],
  ),
] as const satisfies readonly ServerBoundaryPolicy[];

function page(
  path: string,
  file: string,
  access: ServerBoundaryAccess,
  enforcementMarkers: readonly string[],
): ServerBoundaryPolicy {
  return {
    access,
    boundary: `PAGE ${path}`,
    dataPolicy: dataPolicyFor(access),
    enforcementMarkers,
    file,
    kind: "page",
  };
}

function layout(
  path: string,
  file: string,
  access: ServerBoundaryAccess,
  enforcementMarkers: readonly string[],
): ServerBoundaryPolicy {
  return {
    access,
    boundary: `LAYOUT ${path}`,
    dataPolicy: dataPolicyFor(access),
    enforcementMarkers,
    file,
    kind: "layout",
  };
}

function route(
  method: string,
  path: string,
  file: string,
  access: ServerBoundaryAccess,
  enforcementMarkers: readonly string[],
): ServerBoundaryPolicy {
  return {
    access,
    boundary: `${method} ${path}`,
    dataPolicy: dataPolicyFor(access),
    enforcementMarkers,
    file,
    kind: "route-handler",
  };
}

function dataPolicyFor(access: ServerBoundaryAccess) {
  switch (access) {
    case "public":
      return "Approved public content only; no drafts or private retrieval content.";
    case "public-auth-protocol":
      return "Clerk-managed authentication UI only; no application data authorization.";
    case "public-sanitized-health":
      return "Coarse status only; no credentials, host details, or records.";
    case "student-or-anonymous":
      return "Current signed user or signed anonymous browser identity only.";
    case "student-authenticated":
      return "Current active application account only.";
    case "owned-student-resource":
      return "Session ID plus server-resolved owner; ownership failures are 404.";
    case "professor-or-admin":
    case "professor-review-or-admin":
      return "Professor-safe course data; private internals and student identity omitted.";
    case "professor-analytics-or-admin":
      return "Aggregate course analytics only; no student-level export.";
    case "administrator":
      return "Administrative public-safe records and mutations; private source bodies excluded.";
  }
}
