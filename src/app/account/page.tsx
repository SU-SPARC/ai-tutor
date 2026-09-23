import type { Metadata } from "next";
import Link from "next/link";

import { AccountSectionLine } from "@/components/auth/account-section-line";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { Button } from "@/components/ui/button";
import { readAnonymousCookieSubject } from "@/lib/auth/anonymous-session";
import {
  hasPermission,
  requirePageAccess,
  requireStudent,
  toCurrentUserDto,
} from "@/lib/auth/authorization";
import { isGhostUserId } from "@/lib/auth/ghost-session";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Account | Suffolk Probability Tutor",
};
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const authorization = await requirePageAccess(requireStudent, "/account");
  const user = toCurrentUserDto(authorization.principal);
  const isProfessor = hasPermission(authorization.principal, "professor");
  // A demo principal has no Clerk record behind it, so the page must not
  // promise password resets that nothing can perform.
  const isDemoSession = isGhostUserId(authorization.principal.userId);

  const env = getServerEnv();
  const anonymousId = await readAnonymousCookieSubject();

  return (
    <div className="min-h-svh bg-surface-tint">
      <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-6 rounded-lg bg-sheet p-6 sm:p-8">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-normal">Your account</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {isDemoSession
                ? "Demo session — no real account. Nothing here is stored outside this browser and this machine."
                : "These are the only profile details copied from your Clerk account."}
            </p>
          </div>

          <dl className="grid gap-4 rounded-lg bg-surface-tint p-4 text-sm sm:grid-cols-2">
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

          <AccountSectionLine />

          {isDemoSession ? null : (
            <p className="text-sm leading-6 text-muted-foreground">
              Password reset and email verification are handled by Clerk.
              Contact application support for account-status or role issues.
            </p>
          )}

          <AnonymousImportPanel
            hasSignedBrowserIdentity={Boolean(anonymousId)}
            legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
          />

          <div className="flex flex-wrap gap-3 pt-2">
            <Button asChild variant="cta">
              <Link href="/learn">View your progress</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/onboarding?review=1&returnTo=%2Faccount">
                Tutor and data notice
              </Link>
            </Button>
            {isProfessor ? (
              <>
                <Button asChild variant="outline">
                  <Link href="/learn">View as student</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/professor">Professor workspace</Link>
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
