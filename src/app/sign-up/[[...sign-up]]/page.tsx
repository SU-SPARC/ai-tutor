import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ThemedSignUp } from "@/components/auth/themed-clerk-form";
import { AuthenticationUnavailable } from "@/components/auth/authentication-unavailable";
import { Logo } from "@/components/shell/logo";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { currentAuthenticatedUser } from "@/lib/auth/authorization";
import {
  postSignInPath,
  safeReturnPath,
  signInPath,
  joinPath,
} from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Create account",
};

type SignUpPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { callbackUrl } = await searchParams;
  const returnTo = safeReturnPath(callbackUrl);
  const env = getServerEnv();

  if (!env.CLERK_ENABLED) {
    // A demo session is chosen, not registered, so there is nothing to sign up
    // for; keep the requested destination and send the student to the one
    // screen that has the doors on it.
    if (env.GHOST_LOGIN_ENABLED) {
      redirect(joinPath(callbackUrl));
    }

    return (
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex min-h-[calc(100svh-var(--header-h))] w-full items-start justify-center bg-surface px-4 py-10 outline-none sm:items-center sm:px-6 sm:py-16"
      >
        <div className="flex w-full max-w-md justify-center">
          <AuthenticationUnavailable />
        </div>
      </main>
    );
  }

  const principal = await currentAuthenticatedUser();
  if (principal) {
    redirect(returnTo);
  }

  const destination = postSignInPath(returnTo);
  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="flex min-h-[calc(100svh-var(--header-h))] w-full items-start justify-center bg-surface px-4 py-10 outline-none sm:items-center sm:px-6 sm:py-16"
    >
      <div className="flex w-full max-w-md flex-col items-center gap-6">
        {/* Clerk's card carries the h1 (its title changes per step); the
            logo says where you are before the widget loads. */}
        <Logo size="lg" wordmark priority />
        <ThemedSignUp
          path="/sign-up"
          routing="path"
          signInUrl={signInPath(returnTo)}
          forceRedirectUrl={destination}
          signInForceRedirectUrl={destination}
        />
      </div>
    </main>
  );
}
