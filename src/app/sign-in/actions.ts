"use server";

import {
  INSTITUTIONAL_PROVIDER_ID,
  LOCAL_TEST_PROVIDER_ID,
  signIn,
} from "@/auth";
import { onboardingPath } from "@/lib/auth/return-path";

export async function signInWithSchoolAccount(returnTo: string) {
  await signIn(INSTITUTIONAL_PROVIDER_ID, {
    redirectTo: onboardingPath(returnTo),
  });
}

export async function signInWithTestAccount(
  returnTo: string,
  formData: FormData,
) {
  formData.set("redirectTo", onboardingPath(returnTo));
  await signIn(LOCAL_TEST_PROVIDER_ID, formData);
}
