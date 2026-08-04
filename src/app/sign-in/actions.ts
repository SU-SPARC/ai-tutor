"use server";

import {
  INSTITUTIONAL_PROVIDER_ID,
  LOCAL_TEST_PROVIDER_ID,
  signIn,
} from "@/auth";
import { postSignInPath } from "@/lib/auth/return-path";

export async function signInWithSchoolAccount(returnTo: string) {
  await signIn(INSTITUTIONAL_PROVIDER_ID, {
    redirectTo: postSignInPath(returnTo),
  });
}

export async function signInWithTestAccount(
  returnTo: string,
  formData: FormData,
) {
  formData.set("redirectTo", postSignInPath(returnTo));
  await signIn(LOCAL_TEST_PROVIDER_ID, formData);
}
