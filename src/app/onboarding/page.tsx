import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { acknowledgeStudentOnboardingAction } from "@/app/onboarding/actions";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { MAIN_CONTENT_ID } from "@/components/shell/skip-link";
import { Button } from "@/components/ui/button";
import { readAnonymousCookieSubject } from "@/lib/auth/anonymous-session";
import {
  requirePageAccess,
  requireStudent,
  toCurrentUserDto,
} from "@/lib/auth/authorization";
import { isGhostUserId } from "@/lib/auth/ghost-session";
import { safeReturnPath } from "@/lib/auth/return-path";
import { hasAcknowledgedStudentOnboarding } from "@/lib/data/student-onboarding-repository";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Tutor and data notice",
};
export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams: Promise<{ returnTo?: string; review?: string }>;
};

/**
 * The notice as one document on the desk: what the tutor is, four short
 * sections on what it does and keeps, the pilot's limits, the account it is
 * tied to, then the one decision (acknowledge, and optionally import browser
 * practice). In review mode the decision is replaced by the way back.
 */
export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const { returnTo: requestedReturnPath, review } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnPath);
  const authorization = await requirePageAccess(requireStudent, returnTo);
  const user = toCurrentUserDto(authorization.principal);
  const isDemoSession = isGhostUserId(authorization.principal.userId);
  const env = getServerEnv();
  const [anonymousId, hasAcknowledged] = await Promise.all([
    readAnonymousCookieSubject(),
    hasAcknowledgedStudentOnboarding(authorization.principal.userId),
  ]);
  const isReview = review === "1" && hasAcknowledged;

  if (hasAcknowledged && !isReview) {
    redirect(returnTo);
  }

  const continueAction = acknowledgeStudentOnboardingAction.bind(
    null,
    returnTo,
  );

  return (
    <main
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      className="min-h-[calc(100svh-var(--header-h))] bg-surface px-4 py-10 outline-none sm:px-6 sm:py-16"
    >
      <article
        aria-labelledby="notice-title"
        className="sheet-shadow mx-auto flex w-full max-w-3xl flex-col gap-8 rounded-panel bg-sheet p-6 text-sheet-foreground sm:p-10"
      >
        <header className="flex flex-col gap-3">
          <p className="type-label">
            {isReview ? "Student information" : "Before you begin"}
          </p>
          <h1 id="notice-title" className="type-h1 text-ink">
            Tutor and data notice
          </h1>
          <p className="type-reading text-ink-muted">
            This tutor helps you practice probability and statistics with hints,
            feedback, and step-by-step explanations. It supports your learning;
            it does not replace your professor, course materials, grading, or
            academic guidance.
          </p>
        </header>

        <section
          aria-label="Notice summary"
          className="grid gap-x-10 gap-y-6 border-t border-rule pt-6 sm:grid-cols-2"
        >
          <NoticeItem title="Learning support">
            Work through available practice questions and use feedback to check
            your reasoning. The tutor does not submit work or assign grades. It
            records your practice activity; your instructor, not the tutor,
            determines any course credit.
          </NoticeItem>
          <NoticeItem title="Activity that is saved">
            Your account profile and practice activity are stored: questions
            practiced, a short answer preview, results, hints and steps used,
            timestamps, and limited usage counts.
          </NoticeItem>
          <NoticeItem title="Optional AI help">
            Hints, feedback, and worked solutions come from professor-reviewed
            course content. If you choose{" "}
            <span className="font-medium">Ask AI for help</span> when it is
            offered, the current question, your answer or message, limited
            progress context, and selected course material may be sent to an AI
            service. AI usage and responses may also be recorded.
          </NoticeItem>
          <NoticeItem title="Check explanations">
            Explanations can be incomplete or wrong. Compare them with your
            course materials and ask your professor when something does not look
            right. Use the <span className="font-medium">Report</span> button on
            any question to flag a problem.
          </NoticeItem>
        </section>

        <section
          aria-labelledby="pilot-help-heading"
          className="flex flex-col gap-2 border-t border-rule pt-6"
        >
          <h2 id="pilot-help-heading" className="type-h3 text-ink">
            Pilot limits, errors, and support
          </h2>
          <p className="type-body max-w-prose text-ink">
            This pilot covers only the topics and questions currently available.
            Features, saved progress, and AI access may be limited or
            temporarily unavailable. To report an error, tell your professor
            which question you were using and what looked wrong. For technical
            or privacy help, use the support contact provided with your course
            or pilot.
          </p>
          <p className="type-body max-w-prose text-ink-muted">
            You can review this privacy and support information later from{" "}
            <span className="font-medium text-ink">
              Account → Tutor and data notice
            </span>
            .
          </p>
        </section>

        <div className="flex flex-col gap-4 border-t border-rule pt-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="type-small text-ink-muted">Account</dt>
              <dd className="type-body break-words text-ink">
                {user.displayName}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="type-small text-ink-muted">Verified email</dt>
              <dd className="type-body break-all text-ink">{user.email}</dd>
            </div>
          </dl>
          <p className="type-small max-w-prose text-ink-muted">
            {isDemoSession
              ? "This demo session has no password or account service behind it. The tutor does not receive or store your password."
              : "Sign-in, passwords, and email verification are handled by the account service (Clerk). The tutor does not receive or store your password."}
          </p>
        </div>

        {isReview ? (
          <div className="border-t border-rule pt-6">
            <Button asChild>
              <Link href={returnTo}>Back to your account</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 border-t border-rule pt-6">
            <p className="type-body max-w-prose text-ink">
              Continuing stores only the date and time that you acknowledged
              this notice. It does not store separate responses to these points.
            </p>
            <AnonymousImportPanel
              continueAction={continueAction}
              hasSignedBrowserIdentity={Boolean(anonymousId)}
              legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
            />
          </div>
        )}
      </article>
    </main>
  );
}

/**
 * One of the four notice points. No icon: the title carries it, and the
 * notice reads as a document rather than a feature grid.
 */
function NoticeItem({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="type-h3 text-ink">{title}</h2>
      <p className="type-body max-w-prose text-ink">{children}</p>
    </div>
  );
}
