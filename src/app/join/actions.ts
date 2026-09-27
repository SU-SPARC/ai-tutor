"use server";

import { redirect } from "next/navigation";

import { signInAsGhost } from "@/app/sign-in/ghost-actions";
import { getServerEnv } from "@/lib/env/server";

/**
 * The join screen's guest door. The role is bound here, on the server, and
 * never submitted: the form carries only the destination, so a crafted post
 * cannot ask for the professor demo.
 *
 * `signInAsGhost` re-checks the environment and normalises the return path, so
 * this stays a thin, auditable wrapper — the environment check below is a
 * second gate that keeps a stale form from reaching the cookie writer at all.
 */
export async function joinAsGuestStudent(formData: FormData) {
  const env = getServerEnv();
  if (env.CLERK_ENABLED || !env.GHOST_LOGIN_ENABLED) {
    redirect("/join");
  }

  const requested = formData.get("callbackUrl");
  const forwarded = new FormData();
  // A guest with no destination in mind belongs on the syllabus, not on the
  // page they were bounced from.
  forwarded.set(
    "callbackUrl",
    typeof requested === "string" && requested.length > 0
      ? requested
      : "/learn",
  );

  return signInAsGhost("student", forwarded);
}

/**
 * The footer link. Same guard, the other role — this is how the pilot's single
 * professor reaches the workspace in a demo environment with no accounts.
 */
export async function joinAsDemoProfessor(formData: FormData) {
  const env = getServerEnv();
  if (env.CLERK_ENABLED || !env.GHOST_LOGIN_ENABLED) {
    redirect("/join");
  }

  return signInAsGhost("professor", formData);
}
