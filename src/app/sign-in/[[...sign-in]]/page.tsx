import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ThemedSignIn } from "@/components/auth/themed-clerk-form";
import { AuthenticationUnavailable } from "@/components/auth/authentication-unavailable";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { currentAuthenticatedUser } from "@/lib/auth/authorization";
import {
  postSignInPath,
  safeReturnPath,
  signUpPath,
  joinPath,
} from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Sign in",
};

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl } = await searchParams;
  const returnTo = safeReturnPath(callbackUrl);
  const env = getServerEnv();

  if (!env.CLERK_ENABLED) {
    if (!env.GHOST_LOGIN_ENABLED) {
      return <AuthenticationPageShell body={<AuthenticationUnavailable />} />;
    }

    // Demo environments have one way in, and it is `/join`: the doors, the
    // section code, and the data notice are one screen there. The raw
    // callbackUrl travels unvalidated on purpose — `/join` normalises it with
    // a student-appropriate fallback, the same way the ghost action does.
    redirect(joinPath(callbackUrl));
  }

  const principal = await currentAuthenticatedUser();
  if (principal) {
    redirect(returnTo);
  }

  const destination = postSignInPath(returnTo);
  return (
    <AuthenticationPageShell
      body={
        <ThemedSignIn
          path="/sign-in"
          routing="path"
          signUpUrl={signUpPath(returnTo)}
          forceRedirectUrl={destination}
          signUpForceRedirectUrl={destination}
        />
      }
    />
  );
}

/**
 * One centred sheet on the desk: Clerk's own card (themed from the live
 * tokens) or the "not configured" panel. The page owns the only <main>.
 */
function AuthenticationPageShell({ body }: { body: React.ReactNode }) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="flex min-h-[calc(100svh-var(--header-h))] w-full items-start justify-center bg-surface px-4 py-10 outline-none sm:items-center sm:px-6 sm:py-16"
    >
      <div className="flex w-full max-w-md justify-center">{body}</div>
    </main>
  );
}
