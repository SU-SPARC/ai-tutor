import "server-only";

import { requirePageAccess, requireStudent } from "@/lib/auth/authorization";
import type { ServerEnv } from "@/lib/env/server";

/**
 * Practice pages are public while the anonymous pilot is enabled: the tutor
 * session API creates the anonymous identity on first use. When the pilot is
 * disabled, an unauthenticated visitor would otherwise reach a question screen
 * whose session request is rejected, so send them to sign-in first with a
 * return path back to the same question.
 */
export async function requirePracticePageAccess(
  env: Pick<ServerEnv, "ANONYMOUS_PILOT_ENABLED">,
  returnTo: string,
) {
  if (env.ANONYMOUS_PILOT_ENABLED) {
    return undefined;
  }
  return requirePageAccess(requireStudent, returnTo);
}
