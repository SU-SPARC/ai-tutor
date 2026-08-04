import "server-only";

import { redirect } from "next/navigation";

import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  requireRole,
} from "@/lib/auth/principal";
import { signInPath } from "@/lib/auth/return-path";

export async function requirePageRole(
  role: "professor" | "admin",
  returnTo = "/",
) {
  try {
    return await requireRole(role);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect(signInPath(returnTo));
    }
    if (error instanceof AuthorizationDeniedError) {
      redirect("/forbidden");
    }
    throw error;
  }
}
