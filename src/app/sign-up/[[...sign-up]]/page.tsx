import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { redirect } from "next/navigation";

import { AuthenticationUnavailable } from "@/components/auth/authentication-unavailable";
import { currentAuthenticatedUser } from "@/lib/auth/authorization";
import {
  postSignInPath,
  safeReturnPath,
  signInPath,
} from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Create account | Suffolk Probability Tutor",
};

type SignUpPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { callbackUrl } = await searchParams;
  const returnTo = safeReturnPath(callbackUrl);
  const env = getServerEnv();

  if (!env.CLERK_ENABLED) {
    return (
      <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-lg items-center justify-center px-6 py-12">
        <AuthenticationUnavailable />
      </main>
    );
  }

  const principal = await currentAuthenticatedUser();
  if (principal) {
    redirect(returnTo);
  }

  const destination = postSignInPath(returnTo);
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-lg items-center justify-center px-6 py-12">
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl={signInPath(returnTo)}
        forceRedirectUrl={destination}
        signInForceRedirectUrl={destination}
      />
    </main>
  );
}
