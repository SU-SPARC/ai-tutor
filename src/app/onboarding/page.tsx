import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  BookOpenCheck,
  CircleAlert,
  Database,
  LifeBuoy,
  Sparkles,
} from "lucide-react";

import { acknowledgeStudentOnboardingAction } from "@/app/onboarding/actions";
import { AnonymousImportPanel } from "@/components/auth/anonymous-import-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { readAnonymousCookieSubject } from "@/lib/auth/anonymous-session";
import {
  requirePageAccess,
  requireStudent,
  toCurrentUserDto,
} from "@/lib/auth/authorization";
import { safeReturnPath } from "@/lib/auth/return-path";
import { hasAcknowledgedStudentOnboarding } from "@/lib/data/student-onboarding-repository";
import { getServerEnv } from "@/lib/env/server";

export const metadata: Metadata = {
  title: "Tutor and data notice | Suffolk Probability Tutor",
};
export const dynamic = "force-dynamic";

type OnboardingPageProps = {
  searchParams: Promise<{ returnTo?: string; review?: string }>;
};

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const { returnTo: requestedReturnPath, review } = await searchParams;
  const returnTo = safeReturnPath(requestedReturnPath);
  const authorization = await requirePageAccess(requireStudent, returnTo);
  const user = toCurrentUserDto(authorization.principal);
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
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Card>
        <CardHeader>
          <p className="text-sm font-medium text-primary">
            {isReview ? "Student information" : "Before you begin"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Tutor and data notice</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            This tutor helps you practice probability and statistics with hints,
            feedback, and step-by-step explanations. It supports your learning;
            it does not replace your professor, course materials, grading, or
            academic guidance.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <section
            className="grid gap-4 sm:grid-cols-2"
            aria-label="Notice summary"
          >
            <NoticeItem icon={BookOpenCheck} title="Learning support">
              Work through available practice questions and use feedback to
              check your reasoning. The tutor does not submit work or assign
              grades.
            </NoticeItem>
            <NoticeItem icon={Database} title="Activity that is saved">
              Your account profile and practice activity are stored: questions
              practiced, a short answer preview, results, hints and steps used,
              timestamps, and limited usage counts.
            </NoticeItem>
            <NoticeItem icon={Sparkles} title="Optional AI fallback">
              If you choose <span className="font-medium">Ask AI for help</span>
              , the current question, your answer or message, limited progress
              context, and selected grounding material may be sent to the
              configured AI provider. AI usage and cached responses may also be
              recorded.
            </NoticeItem>
            <NoticeItem icon={CircleAlert} title="Check explanations">
              Generated explanations can be incomplete or wrong. Compare them
              with course materials and ask your professor when something does
              not look right.
            </NoticeItem>
          </section>

          <section
            aria-labelledby="pilot-help-heading"
            className="rounded-md border bg-muted/30 p-4 text-sm"
          >
            <div className="flex gap-3">
              <LifeBuoy
                className="mt-0.5 h-5 w-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div>
                <h2 id="pilot-help-heading" className="font-semibold">
                  Pilot limits, errors, and support
                </h2>
                <p className="mt-2 leading-6 text-muted-foreground">
                  This pilot covers only the topics and questions currently
                  available. Features, saved progress, and AI access may be
                  limited or temporarily unavailable. To report an error, tell
                  your professor which question you were using and what looked
                  wrong. For technical or privacy help, use the support contact
                  provided with your course or pilot.
                </p>
                <p className="mt-2 leading-6 text-muted-foreground">
                  You can review this privacy and support information later from
                  <span className="font-medium text-foreground">
                    {" "}
                    Account → Tutor and data notice
                  </span>
                  .
                </p>
              </div>
            </div>
          </section>

          <dl className="grid gap-4 rounded-md border p-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-muted-foreground">Account</dt>
              <dd className="mt-1 break-words">{user.displayName}</dd>
            </div>
            <div>
              <dt className="font-medium text-muted-foreground">
                Verified email
              </dt>
              <dd className="mt-1 break-all">{user.email}</dd>
            </div>
          </dl>
          <p className="text-xs leading-5 text-muted-foreground">
            Clerk manages your password and email verification. The tutor does
            not receive or store your password or password hash.
          </p>

          {isReview ? (
            <div className="border-t pt-6">
              <Button asChild>
                <Link href={returnTo}>Back to your account</Link>
              </Button>
            </div>
          ) : (
            <>
              <p className="rounded-md border border-primary/30 bg-primary/5 p-4 text-sm leading-6">
                Continuing stores only the date and time that you acknowledged
                this notice. It does not store separate responses to these
                points.
              </p>
              <AnonymousImportPanel
                continueAction={continueAction}
                hasSignedBrowserIdentity={Boolean(anonymousId)}
                legacyBridgeEnabled={env.LEGACY_ANONYMOUS_MIGRATION_ENABLED}
              />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function NoticeItem({
  children,
  icon: Icon,
  title,
}: {
  children: React.ReactNode;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <article className="rounded-md border p-4">
      <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
      <h2 className="mt-3 font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </article>
  );
}
