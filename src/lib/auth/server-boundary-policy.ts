export const SERVER_BOUNDARY_ACCESS = [
  "public",
  "public-auth-protocol",
  "public-sanitized-health",
  "student-or-anonymous",
  "student-authenticated",
  "owned-student-resource",
  "professor",
  "professor-review",
  "professor-analytics",
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
  page("/dashboard", "src/app/dashboard/page.tsx", "student-authenticated", [
    "requireStudent",
    "getStudentProgress",
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
  page("/professor", "src/app/professor/page.tsx", "professor-review", [
    "requireProfessorReview",
    "getContentAvailabilityDashboard",
    "getProfessorQuestionReviewDashboard",
    "getQuestionLifecycleDashboard",
  ]),
  page(
    "/professor/analytics",
    "src/app/professor/analytics/page.tsx",
    "professor-analytics",
    ["requireAnalyticsAccess"],
  ),
  page(
    "/professor/availability",
    "src/app/professor/availability/page.tsx",
    "professor-review",
    ["requireProfessorReview", "getContentAvailabilityDashboard"],
  ),
  page(
    "/professor/content-transfer",
    "src/app/professor/content-transfer/page.tsx",
    "professor-review",
    ["requireProfessorReview"],
  ),
  page(
    "/professor/questions",
    "src/app/professor/questions/page.tsx",
    "professor-review",
    ["requireProfessorReview", "getQuestionLifecycleDashboard"],
  ),
  page(
    "/professor/review",
    "src/app/professor/review/page.tsx",
    "professor-review",
    ["requireProfessorReview"],
  ),
  page("/professor/upload", "src/app/professor/upload/page.tsx", "professor", [
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
  layout("/professor", "src/app/professor/layout.tsx", "professor", [
    "requireProfessor",
  ]),

  action(
    "acknowledgeStudentOnboardingAction",
    "src/app/onboarding/actions.ts",
    "student-authenticated",
    ["requireStudent", "acknowledgeStudentOnboarding"],
  ),

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
    "/api/professor/questions",
    "src/app/api/professor/questions/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "PATCH",
    "/api/professor/questions",
    "src/app/api/professor/questions/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "POST",
    "/api/professor/questions",
    "src/app/api/professor/questions/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "GET",
    "/api/professor/questions/[id]",
    "src/app/api/professor/questions/[id]/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "PATCH",
    "/api/professor/questions/[id]",
    "src/app/api/professor/questions/[id]/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "POST",
    "/api/professor/questions/[id]/transitions",
    "src/app/api/professor/questions/[id]/transitions/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "POST",
    "/api/professor/questions/[id]/versions",
    "src/app/api/professor/questions/[id]/versions/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "POST",
    "/api/professor/questions/[id]/regenerate",
    "src/app/api/professor/questions/[id]/regenerate/route.ts",
    "professor-review",
    ["requireProfessorReview"],
  ),
  route(
    "POST",
    "/api/professor/questions/batch",
    "src/app/api/professor/questions/batch/route.ts",
    "professor-review",
    ["requireProfessorReview", "batchTransitionQuestionLifecycle"],
  ),
  route(
    "POST",
    "/api/professor/questions/inspections",
    "src/app/api/professor/questions/inspections/route.ts",
    "professor-review",
    ["requireProfessorReview", "recordQuestionVersionInspection"],
  ),
  route(
    "POST",
    "/api/professor/content-preview",
    "src/app/api/professor/content-preview/route.ts",
    "professor",
    ["requireProfessor"],
  ),
  route(
    "GET",
    "/api/professor/content-transfer",
    "src/app/api/professor/content-transfer/route.ts",
    "professor-review",
    ["requireProfessorReview", "buildQuestionContentExport"],
  ),
  route(
    "POST",
    "/api/professor/content-transfer",
    "src/app/api/professor/content-transfer/route.ts",
    "professor-review",
    ["requireProfessorReview", "validateContentTransferDocument"],
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
    "/api/professor/availability",
    "src/app/api/professor/availability/route.ts",
    "professor-review",
    ["requireProfessorReview", "getContentAvailabilityDashboard"],
  ),
  route(
    "PATCH",
    "/api/professor/availability",
    "src/app/api/professor/availability/route.ts",
    "professor-review",
    ["requireProfessorReview", "updateContentAvailability"],
  ),
  route(
    "GET",
    "/api/professor/analytics",
    "src/app/api/professor/analytics/route.ts",
    "professor-analytics",
    ["requireAnalyticsAccess", "toProfessorAnalyticsDto"],
  ),
  route(
    "GET",
    "/api/professor/review",
    "src/app/api/professor/review/route.ts",
    "professor-review",
    ["requireProfessorReview", "toProfessorReviewCandidateDto"],
  ),
  route(
    "PATCH",
    "/api/professor/review",
    "src/app/api/professor/review/route.ts",
    "professor-review",
    ["requireProfessorReview", "updateReviewCandidates"],
  ),
  route(
    "POST",
    "/api/professor/review",
    "src/app/api/professor/review/route.ts",
    "professor-review",
    ["requireProfessorReview", "updateReviewCandidates"],
  ),
  route(
    "POST",
    "/api/professor/upload",
    "src/app/api/professor/upload/route.ts",
    "professor-review",
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
    "professor",
    ["requireProfessor"],
  ),
  route(
    "GET",
    "/api/student/progress",
    "src/app/api/student/progress/route.ts",
    "student-authenticated",
    ["requireStudent", "getStudentProgress"],
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

function action(
  name: string,
  file: string,
  access: ServerBoundaryAccess,
  enforcementMarkers: readonly string[],
): ServerBoundaryPolicy {
  return {
    access,
    boundary: `ACTION ${name}`,
    dataPolicy: dataPolicyFor(access),
    enforcementMarkers,
    file,
    kind: "server-action",
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
    case "professor":
    case "professor-review":
      return "Professor-safe course data; private internals and student identity omitted.";
    case "professor-analytics":
      return "Aggregate course analytics only; no student-level export.";
  }
}
