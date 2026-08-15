import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ThemedSignIn } from "@/components/auth/themed-clerk-form";
import { AuthenticationUnavailable } from "@/components/auth/authentication-unavailable";
import { currentAuthenticatedUser } from "@/lib/auth/authorization";
import {
  postSignInPath,
  safeReturnPath,
  signUpPath,
} from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Sign in | Suffolk Probability Tutor",
};

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { callbackUrl } = await searchParams;
  const returnTo = safeReturnPath(callbackUrl);
  const env = getServerEnv();

  if (!env.CLERK_ENABLED) {
    return <AuthenticationPageShell body={<AuthenticationUnavailable />} />;
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

function AuthenticationPageShell({ body }: { body: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-lg items-center justify-center px-6 py-12">
      {body}
    </main>
  );
}
