"use server";

import { redirect } from "next/navigation";

import { clearAnonymousSession } from "@/lib/auth/anonymous-session";
import { requirePageAccess, requireStudent } from "@/lib/auth/authorization";
import { safeReturnPath } from "@/lib/auth/return-path";
import { acknowledgeStudentOnboarding } from "@/lib/data/student-onboarding-repository";

export type StudentOnboardingActionState = {
  error?: string;
};

export async function acknowledgeStudentOnboardingAction(
  requestedReturnPath: string,
  _previousState: StudentOnboardingActionState,
): Promise<StudentOnboardingActionState> {
  void _previousState;
  const returnTo = safeReturnPath(requestedReturnPath);
  const authorization = await requirePageAccess(requireStudent, returnTo);

  try {
    await acknowledgeStudentOnboarding(authorization.principal.userId);
  } catch {
    return {
      error: "That didn't work and nothing changed. Try again, or reload the page.",
    };
  }

  // Continuing without bringing guest practice over starts the account fresh:
  // the acknowledgement is saved and the guest cookie is cleared, so the
  // practice saved in this browser is no longer reachable. The notice says so
  // beside the button ("If you start fresh, …").
  await clearAnonymousSession();
  redirect(returnTo);
}
