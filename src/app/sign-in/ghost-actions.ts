"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  GHOST_SESSION_COOKIE,
  parseGhostRole,
  type GhostRole,
} from "@/lib/auth/ghost-session";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

const GHOST_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Starts a demo session. The role is bound by the server component that
 * renders the form rather than submitted, and the environment is re-checked
 * here so a stale form can never mint a session in an environment that has
 * real authentication.
 */
export async function signInAsGhost(role: GhostRole, formData: FormData) {
  const env = getServerEnv();
  if (env.CLERK_ENABLED || !env.GHOST_LOGIN_ENABLED) {
    redirect("/sign-in");
  }

  const ghostRole = parseGhostRole(role);
  if (!ghostRole) {
    redirect("/sign-in");
  }

  const callbackUrl = formData.get("callbackUrl");
  const returnTo = safeReturnPath(
    typeof callbackUrl === "string" ? callbackUrl : undefined,
    ghostRole === "professor" ? "/professor" : "/learn",
  );

  const cookieStore = await cookies();
  cookieStore.set(GHOST_SESSION_COOKIE, ghostRole, {
    httpOnly: true,
    maxAge: GHOST_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    // Local demos are served over http, where a Secure cookie would be dropped.
    secure: env.APP_URL.startsWith("https://"),
  });

  redirect(returnTo);
}

export async function signOutGhost() {
  const cookieStore = await cookies();
  cookieStore.delete(GHOST_SESSION_COOKIE);
  redirect("/");
}
