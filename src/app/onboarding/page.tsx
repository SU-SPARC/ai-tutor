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
  title: "Before you start",
};
export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams: Promise<{ returnTo?: string; review?: string }>;
};

/**
 * Onboarding in one breath: "Before you start", one paragraph on what is kept
 * and who sees it, the guest-practice choice only when there is guest practice
 * in this browser, and one mint [Got it, start practicing]. The full notice
 * (four points, pilot limits, the account it is tied to) sits under "Read the
 * full notice". In review mode (from the account page) the notice is open and
 * the decision is replaced by the way back.
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
        className="sheet-shadow mx-auto flex w-full max-w-2xl flex-col gap-6 rounded-panel bg-sheet p-6 text-sheet-foreground sm:p-10"
      >
        <header className="flex flex-col gap-3">
          {isReview ? <p className="type-label">Your account</p> : null}
          <h1 id="notice-title" className="type-h1 text-ink">
            {isReview ? "Tutor and data notice" : "Before you start"}
          </h1>
          <p className="type-reading max-w-prose text-ink">
            We save your attempts, hints and answers so you can pick up where
            you left off. Your professor sees you as a code (like Student
            8F2A); your name is shown only if they open your record, and that
            is logged. AI help is optional and can be wrong.
          </p>
        </header>

        {isReview ? null : (
          <AnonymousImportPanel
            continueAction={continueAction}
            hasSignedBrowserIdentity={Boolean(anonymousId)}
            legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
          />
        )}

        <details open={isReview} className="border-t border-rule pt-4">
          <summary className="type-body-strong inline-flex min-h-11 cursor-pointer items-center rounded-xs text-azure-500 hover:text-azure-700 focus-ring">
            Read the full notice
          </summary>
          <div className="mt-4 flex flex-col gap-8">
            <p className="type-body max-w-prose text-ink-muted">
              This tutor helps you practice probability and statistics with
              hints, feedback, and step-by-step explanations. It supports your
              learning; it does not replace your professor, course materials,
              grading, or academic guidance.
            </p>

            <section
              aria-label="Notice summary"
              className="grid gap-x-10 gap-y-6 sm:grid-cols-2"
            >
              <NoticeItem title="Learning support">
                Work through available practice questions and use feedback to
                check your reasoning. The tutor does not submit work or assign
                grades. It records your practice activity; your professor, not
                the tutor, decides any course credit.
              </NoticeItem>
              <NoticeItem title="Activity that is saved">
                Your account profile and practice activity are stored: questions
                practiced, a short answer preview, results, hints and steps
                used, timestamps, and limited usage counts. Your professor sees
                you as a code (like Student 8F2A); your name is shown only if
                they open your record, and that is logged.
              </NoticeItem>
              <NoticeItem title="Optional AI help">
                Hints, feedback, and worked solutions come from
                professor-reviewed course content. If you choose{" "}
                <span className="font-medium">Ask AI for help</span> when it is
                offered, the current question, your answer or message, limited
                progress context, and selected course material may be sent to
                an AI service. AI usage and responses may also be recorded.
              </NoticeItem>
              <NoticeItem title="Check explanations">
                Explanations can be incomplete or wrong. Compare them with your
                course materials and ask your professor when something does not
                look right. Use the <span className="font-medium">Report</span>{" "}
                button on any question to flag a problem.
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
                This pilot covers only the topics and questions currently
                available. Features, saved progress, and AI access may be
                limited or temporarily unavailable. To report an error, tell
                your professor which question you were using and what looked
                wrong. For technical or privacy help, use the support contact
                provided with your course or pilot.
              </p>
              <p className="type-body max-w-prose text-ink-muted">
                You can read this notice again any time from{" "}
                <span className="font-medium text-ink">
                  Your account → Read the data notice
                </span>
                .
              </p>
            </section>

            <div className="flex flex-col gap-4 border-t border-rule pt-6">
              {isDemoSession ? (
                <dl className="grid gap-4">
                  <div className="flex flex-col gap-1">
                    <dt className="type-small text-ink-muted">You</dt>
                    <dd className="type-body text-ink">Guest (demo)</dd>
                  </div>
                </dl>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <dt className="type-small text-ink-muted">Name</dt>
                    <dd className="type-body break-words text-ink">
                      {user.displayName}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="type-small text-ink-muted">Email</dt>
                    <dd className="type-body break-all text-ink">
                      {user.email}
                    </dd>
                  </div>
                </dl>
              )}
              <p className="type-small max-w-prose text-ink-muted">
                {isDemoSession
                  ? "This demo has no password or account behind it. The tutor does not receive or store your password."
                  : "Your name and email come from your Suffolk sign-in. The tutor does not receive or store your password."}
              </p>
            </div>
          </div>
        </details>

        {isReview ? (
          <div className="border-t border-rule pt-6">
            <Button asChild>
              <Link href={returnTo}>Back to your account</Link>
            </Button>
          </div>
        ) : null}
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
