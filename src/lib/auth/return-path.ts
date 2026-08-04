export const DEFAULT_STUDENT_RETURN_PATH = "/dashboard";

const LOCAL_ORIGIN = "https://student-flow.invalid";
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;
const NON_RETURNABLE_PATHS = ["/sign-in", "/onboarding", "/api"];
const AUTH_CREDENTIAL_PARAMETER_KEYS = new Set([
  "accesstoken",
  "assertion",
  "authtoken",
  "authorization",
  "bearer",
  "credential",
  "csrftoken",
  "idtoken",
  "oauthtoken",
  "refreshtoken",
  "sessiontoken",
  "token",
]);

export function safeReturnPath(
  value: string | null | undefined,
  fallback = DEFAULT_STUDENT_RETURN_PATH,
) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    UNSAFE_CHARACTERS.test(value)
  ) {
    return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, LOCAL_ORIGIN);
  } catch {
    return fallback;
  }

  if (
    parsed.origin !== LOCAL_ORIGIN ||
    NON_RETURNABLE_PATHS.some(
      (path) =>
        parsed.pathname === path || parsed.pathname.startsWith(`${path}/`),
    ) ||
    containsAuthenticationCredential(parsed.searchParams) ||
    containsAuthenticationCredential(new URLSearchParams(parsed.hash.slice(1)))
  ) {
    return fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function containsAuthenticationCredential(parameters: URLSearchParams) {
  return [...parameters.keys()].some((key) =>
    AUTH_CREDENTIAL_PARAMETER_KEYS.has(
      key.toLowerCase().replaceAll(/[-_.]/g, ""),
    ),
  );
}

export function signInPath(returnTo?: string | null) {
  const search = new URLSearchParams({
    callbackUrl: safeReturnPath(returnTo),
  });
  return `/sign-in?${search.toString()}`;
}

export function onboardingPath(returnTo?: string | null) {
  const search = new URLSearchParams({
    returnTo: safeReturnPath(returnTo),
  });
  return `/onboarding?${search.toString()}`;
}

export function isInstructorReturnPath(value?: string | null) {
  const pathname = new URL(safeReturnPath(value), LOCAL_ORIGIN).pathname;
  return (
    pathname === "/professor" ||
    pathname.startsWith("/professor/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

export function postSignInPath(returnTo?: string | null) {
  const safePath = safeReturnPath(returnTo);
  return isInstructorReturnPath(safePath) ? safePath : onboardingPath(safePath);
}
