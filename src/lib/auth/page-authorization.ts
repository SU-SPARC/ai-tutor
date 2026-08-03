import "server-only";

import { redirect } from "next/navigation";

import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  requireRole,
} from "@/lib/auth/principal";

export async function requirePageRole(role: "professor" | "admin") {
  try {
    return await requireRole(role);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }
    if (error instanceof AuthorizationDeniedError) {
      redirect("/forbidden");
    }
    throw error;
  }
}
