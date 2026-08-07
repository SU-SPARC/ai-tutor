import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { readAnonymousCookieSubject } from "@/lib/auth/anonymous-session";
import {
  requirePageAccess,
  requireStudent,
  toCurrentUserDto,
} from "@/lib/auth/authorization";
import { safeReturnPath } from "@/lib/auth/return-path";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Your account | Suffolk Probability Tutor",
};
export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams: Promise<{ returnTo?: string }>;
};

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const { returnTo: requestedReturnPath } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnPath);
  const authorization = await requirePageAccess(requireStudent, returnTo);
  const user = toCurrentUserDto(authorization.principal);

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
              Your student profile was created or matched using your verified
              Clerk account. Review the minimal details below, then choose
              whether to bring in practice saved in this browser.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 rounded-md border bg-muted/30 p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 break-words">{user.displayName}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">
                Verified email
              </dt>
              <dd className="mt-1 break-all">{user.email}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Clerk manages your password and email verification. The tutor never
            receives or stores your password or password hash.
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
