export const DEFAULT_STUDENT_RETURN_PATH = "/dashboard";

const LOCAL_ORIGIN = "https://student-flow.invalid";
const UNSAFE_CHARACTERS = /[\\\u0000-\u001f\u007f]/;
const NON_RETURNABLE_PATHS = ["/sign-in", "/onboarding", "/api"];

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
    )
  ) {
    return fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
