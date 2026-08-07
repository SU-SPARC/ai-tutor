import type { Metadata } from "next";
import Link from "next/link";

import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { readAnonymousCookieSubject } from "@/lib/auth/anonymous-session";
import {
  requirePageAccess,
  requireStudent,
  toCurrentUserDto,
} from "@/lib/auth/authorization";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Account | Suffolk Probability Tutor",
};
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const authorization = await requirePageAccess(requireStudent, "/account");
  const user = toCurrentUserDto(authorization.principal);

  const env = getServerEnv();
  const anonymousId = await readAnonymousCookieSubject();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Card>
        <CardHeader>
          <h1 className="text-3xl font-semibold">Your account</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            These are the only profile details copied from your Clerk account.
          </p>
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
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Password reset and email verification are handled by Clerk. Contact
            application support for account-status or role issues.
          </p>

          <AnonymousImportPanel
            hasSignedBrowserIdentity={Boolean(anonymousId)}
            legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
          />

          <div className="mt-8 border-t pt-6">
            <Button asChild>
              <Link href="/dashboard">View your progress</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
