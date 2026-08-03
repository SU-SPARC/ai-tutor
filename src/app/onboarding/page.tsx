import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { readAnonymousCookieSubject } from "@/lib/auth/anonymous-session";
import { resolveAuthenticatedPrincipal } from "@/lib/auth/principal";
import { safeReturnPath, signInPath } from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Your account | Suffolk Probability Tutor",
};

type OnboardingPageProps = {
  searchParams: Promise<{ returnTo?: string }>;
};

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const { returnTo: requestedReturnPath } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnPath);
  const principal = await resolveAuthenticatedPrincipal();

  if (!principal) {
    redirect(signInPath(returnTo));
  }

  const env = getServerEnv();
  const anonymousId = await readAnonymousCookieSubject();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">Your account is ready</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Your student profile was created or matched using your school
              account. Review the minimal details below, then choose whether to
              bring in practice saved in this browser.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 rounded-md border bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 break-words">{principal.displayName}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">
                School email
              </dt>
              <dd className="mt-1 break-all">{principal.email}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            The tutor does not ask for a password, profile photo, phone number,
            course enrollment, or directory access.
          </p>

          <AnonymousImportPanel
            continueTo={returnTo}
            hasSignedBrowserIdentity={Boolean(anonymousId)}
            legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
          />
        </CardContent>
      </Card>
    </main>
  );
}
