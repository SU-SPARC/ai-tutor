import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignOutButton } from "@clerk/nextjs";
import { Mail } from "lucide-react";

import { signOutGhost } from "@/app/sign-in/ghost-actions";
import { AccountSectionLine } from "@/components/auth/account-section-line";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { CopyEmailButton } from "@/components/auth/copy-email-button";
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
  title: "Your account",
};
export const dynamic = "force-dynamic";

const TEXT_LINK =
  "rounded-xs font-medium text-azure-500 underline underline-offset-4 transition-colors duration-fast hover:text-azure-700 focus-ring";

/**
 * One sheet on the desk: who you are, which section this browser has joined
 * (with "Change section"), what the professor sees, guest practice waiting to
 * be brought over, and the way back to work. A demo guest sees one row,
 * "You: Guest (demo)", and no email. A professor's way back is the workspace,
 * with "View as student" beside it; a student's is Learn.
 */
export default async function AccountPage() {
  const authorization = await requirePageAccess(requireStudent, "/account");
  const user = toCurrentUserDto(authorization.principal);
  const isProfessor = hasPermission(authorization.principal, "professor");
  // A demo principal has no account behind it, so the page must not show a
  // made-up email or promise password changes that nothing can perform.
  const isDemoSession = isGhostUserId(authorization.principal.userId);
  const isDemoGuest = isDemoSession && !isProfessor;

  const env = getServerEnv();
  // The feedback contact is deployment configuration (FEEDBACK_EMAIL), so the
  // row appears only where an address has been configured.
  const feedbackEmail = env.FEEDBACK_EMAIL;
  const feedbackContactName = env.FEEDBACK_CONTACT_NAME ?? "your professor";
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
          <p className="type-body max-w-prose text-ink">
            Who you are, your section, and your saved practice.
          </p>
          <p className="type-body max-w-prose text-ink-muted">
            {isDemoGuest
              ? "You're practicing as a guest in a demo. There is no account to manage."
              : isDemoSession
                ? "This is a demo sign-in. There is no account to manage."
                : "Your name and email come from your Suffolk sign-in."}
          </p>
        </header>

        <dl className="divide-y divide-rule border-y border-rule">
          {isDemoSession ? (
            <AccountRow label="You">
              {isDemoGuest ? "Guest (demo)" : `${user.displayName} (demo)`}
            </AccountRow>
          ) : (
            <>
              <AccountRow label="Name">{user.displayName}</AccountRow>
              <AccountRow label="Email">
                <span className="break-all">{user.email}</span>
              </AccountRow>
            </>
          )}
          <AccountRow label="Section">
            <AccountSectionLine />
          </AccountRow>
          <AccountRow label="What your professor sees">
            Your professor sees you as a code (like Student 8F2A); your name is
            shown only if they open your record, and that is logged.
          </AccountRow>
          {feedbackEmail && !isProfessor ? (
            <AccountRow label="Feedback">
              <span className="flex flex-col gap-1">
                <span>Send all feedback to {feedbackContactName}.</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <a
                    href={`mailto:${feedbackEmail}?subject=${encodeURIComponent("ProbStat Tutor feedback")}`}
                    rel="noreferrer"
                    className={`${TEXT_LINK} inline-flex min-h-11 items-center gap-1.5 break-all`}
                  >
                    <Mail aria-hidden="true" className="size-4 shrink-0" />
                    <span id="feedback-email-address">{feedbackEmail}</span>
                  </a>
                  <CopyEmailButton
                    email={feedbackEmail}
                    selectTargetId="feedback-email-address"
                  />
                </span>
                <span className="type-small text-ink-muted">
                  Ideas, problems, or something that didn&apos;t make sense —
                  all of it helps.
                </span>
              </span>
            </AccountRow>
          ) : null}
        </dl>

        {isDemoSession ? null : (
          <p className="type-small max-w-prose text-ink-muted">
            To change your password or email, use your Suffolk account.
            Something wrong? Ask your professor.
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
                <Link href="/learn">Back to Learn</Link>
              </Button>
            )}
            {isDemoSession ? (
              // A demo sign-in has no Clerk provider above it, so signing out
              // clears the demo cookie itself (as the header menu does).
              <form action={signOutGhost}>
                <Button type="submit" variant="outline">
                  Sign out
                </Button>
              </form>
            ) : (
              <SignOutButton redirectUrl="/">
                <Button type="button" variant="outline">
                  Sign out
                </Button>
              </SignOutButton>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 self-start sm:self-auto">
            {/* The tour provider starts the guide when it sees ?guide=1. */}
            <span className="flex flex-col gap-1">
              <Button asChild variant="secondary">
                <Link
                  href={isProfessor ? "/professor?guide=1" : "/learn?guide=1"}
                  aria-describedby="onboarding-guide-helper"
                >
                  Onboarding guide
                </Link>
              </Button>
              <span
                id="onboarding-guide-helper"
                className="type-small text-ink-muted"
              >
                Tooltips that show you around
              </span>
            </span>
            <Link
              href="/onboarding?review=1&returnTo=%2Faccount"
              className={`${TEXT_LINK} inline-flex min-h-11 items-center`}
            >
              Read the data notice
            </Link>
          </div>
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
