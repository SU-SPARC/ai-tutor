import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogIn, ShieldCheck } from "lucide-react";

import {
  signInWithSchoolAccount,
  signInWithTestAccount,
} from "@/app/sign-in/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { authenticationErrorMessage } from "@/lib/auth/authentication-errors";
import { resolveAuthenticatedPrincipal } from "@/lib/auth/principal";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Sign in | Suffolk Probability Tutor",
};

type SignInPageProps = {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const env = getServerEnv();
  const [principal, { callbackUrl, error }] = await Promise.all([
    resolveAuthenticatedPrincipal(),
    searchParams,
  ]);
  const returnTo = safeReturnPath(callbackUrl);

  if (principal) {
    redirect(returnTo);
  }

  const errorMessage = authenticationErrorMessage(error);
  const schoolSignInAction = signInWithSchoolAccount.bind(null, returnTo);
  const testSignInAction = signInWithTestAccount.bind(null, returnTo);

  return (
    <main className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-lg items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader className="space-y-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">
              Sign in to save your progress
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Use your school account to keep your practice history available on
              your approved devices. The tutor does not collect a password.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {errorMessage ? (
            <div
              role="alert"
              tabIndex={-1}
              className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm leading-6 text-destructive"
            >
              <p className="font-medium">We couldn&apos;t sign you in.</p>
              <p className="mt-1">{errorMessage}</p>
            </div>
          ) : null}

          {env.AUTH_OIDC_ENABLED ? (
            <form action={schoolSignInAction}>
              <Button type="submit" className="w-full">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Continue with your school account
              </Button>
            </form>
          ) : null}

          {env.AUTH_TEST_MODE ? (
            <form
              className="space-y-4 rounded-md border border-warning/50 bg-warning/10 p-4"
              action={testSignInAction}
            >
              <fieldset className="space-y-3">
                <legend className="text-sm font-medium">
                  Local test sign-in
                </legend>
                <p className="text-xs leading-5 text-muted-foreground">
                  Available only in local development. These are synthetic
                  accounts and are not school identities.
                </p>
                <label htmlFor="test-identity" className="block text-sm">
                  Test account
                </label>
                <select
                  id="test-identity"
                  name="identity"
                  className="block h-10 w-full rounded-md border bg-background px-3 text-sm"
                  defaultValue="student"
                >
                  <option value="student">Student</option>
                  <option value="professor">Professor</option>
                  <option value="admin">Administrator</option>
                  <option value="disabled">Disabled account</option>
                </select>
              </fieldset>
              <Button type="submit" variant="outline" className="w-full">
                Continue with test account
              </Button>
            </form>
          ) : null}

          {!env.AUTH_ENABLED ? (
            <div
              role="status"
              className="rounded-md border bg-muted/50 p-4 text-sm leading-6 text-muted-foreground"
            >
              <p className="font-medium text-foreground">
                Sign-in is not available here yet.
              </p>
              <p className="mt-1">
                You can continue with anonymous practice when the pilot is
                enabled, but that progress cannot follow you to another device.
              </p>
            </div>
          ) : null}

          <p className="text-center text-sm text-muted-foreground">
            <Link className="underline underline-offset-4" href="/">
              Return home
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
