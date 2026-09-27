import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AccountSectionLine } from "@/components/auth/account-section-line";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
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
  title: "Account",
};
export const dynamic = "force-dynamic";

const TEXT_LINK =
  "rounded-xs font-medium text-azure-500 underline underline-offset-4 transition-colors duration-fast hover:text-azure-700 focus-ring";

/**
 * One sheet on the desk: who is signed in, which section this browser has
 * joined, browser practice waiting to be imported, and the way back to work.
 * A professor's way back is the workspace, with "View as student" beside it;
 * a student's is the syllabus.
 */
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
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <section
        aria-labelledby="account-title"
        className="sheet-shadow mx-auto flex w-full max-w-2xl flex-col gap-8 rounded-panel bg-sheet p-6 text-sheet-foreground sm:p-8"
      >
        <header className="flex flex-col gap-2">
          <h1 id="account-title" className="type-h1 text-ink">
            Your account
          </h1>
          <p className="type-body max-w-prose text-ink-muted">
            {isDemoSession
              ? "Demo session: no real account. Nothing here is stored outside this browser and this machine."
              : "These are the only profile details copied from your Clerk account."}
          </p>
        </header>

        <dl className="divide-y divide-rule border-y border-rule">
          <AccountRow label="Name">{user.displayName}</AccountRow>
          <AccountRow label="Verified email">
            <span className="break-all">{user.email}</span>
          </AccountRow>
          <AccountRow label="Section">
            <AccountSectionLine />
          </AccountRow>
        </dl>

        {isDemoSession ? null : (
          <p className="type-small max-w-prose text-ink-muted">
            Password reset and email verification are handled by Clerk. Contact
            application support for account-status or role issues.
          </p>
        )}

        <AnonymousImportPanel
          hasSignedBrowserIdentity={Boolean(anonymousId)}
          legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
        />

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-3">
            {isProfessor ? (
              <>
                <Button asChild>
                  <Link href="/professor">Professor workspace</Link>
                </Button>
                <Button asChild variant="secondary">
                  <Link href="/learn">View as student</Link>
                </Button>
              </>
            ) : (
              <Button asChild>
                <Link href="/learn">View your progress</Link>
              </Button>
            )}
          </div>
          <Link
            href="/onboarding?review=1&returnTo=%2Faccount"
            className={`${TEXT_LINK} inline-flex min-h-11 items-center self-start sm:self-auto`}
          >
            Tutor and data notice
          </Link>
        </div>
      </section>
    </main>
  );
}

function AccountRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-3 sm:gap-6">
      <dt className="type-small pt-0.5 text-ink-muted">{label}</dt>
      <dd className="type-body min-w-0 break-words text-ink sm:col-span-2">
        {children}
      </dd>
    </div>
  );
}
