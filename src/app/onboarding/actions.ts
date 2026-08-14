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
      error:
        "Your acknowledgement could not be saved. Please try again before continuing.",
    };
  }

  // Continuing without importing keeps the two choices separate: the notice
  // acknowledgement is saved, while browser practice is not linked.
  await clearAnonymousSession();
  redirect(returnTo);
}
