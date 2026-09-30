import Link from "next/link";

import { SectionCodeForm } from "@/components/auth/section-code-form";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type LandingHeadlineProps = {
  signedIn: boolean;
  /**
   * Demo environments: a section code takes the ghost student door, exactly
   * as it does on `/join`.
   */
  ghostLoginEnabled?: boolean;
  /** One `type-small` line of context under [Continue practicing →]. */
  continueNote?: string;
  /** How the course is named in the headline ("MATH-255", "Calculus I"). */
  courseLabel?: string;
};

/** The course the landing page was written for. */
export const DEFAULT_LANDING_COURSE_LABEL = "MATH-255";

/**
 * The hero's section-code door. The locked Sheet's [Join to answer] scrolls
 * here and puts the cursor in the code field.
 */
export const LANDING_SECTION_CODE_ID = "landing-section-code";

/** Every inline text link on the landing page. */
export const LANDING_TEXT_LINK =
  "rounded-xs font-medium text-azure-500 underline underline-offset-4 transition-colors duration-fast hover:text-azure-700 focus-ring";

/**
 * The page's column: the same 90rem width and gutters as the app shell, so
 * the words, the live sheet and the footer share one left edge.
 */
export const LANDING_COLUMN =
  "mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-8";

/**
 * The first thing on the page: what this is, one sentence on how it
 * behaves, and one obvious next step.
 *
 * Signed out, the door is the section code a student was given in class,
 * typed right here (`SectionCodeForm`, the same form and the same door as
 * `/join`); its [Join] is the page's one mint action. Under it, a student
 * without a code can sign in or take the guest door on `/join`, and
 * professors get a quiet text link. Signed in: one way back to the syllabus.
 */
export function LandingHeadline({
  signedIn,
  ghostLoginEnabled = false,
  continueNote,
  courseLabel = DEFAULT_LANDING_COURSE_LABEL,
}: LandingHeadlineProps) {
  return (
    <section
      aria-labelledby="landing-title"
      className={cn(LANDING_COLUMN, "pt-10 pb-10 sm:pt-14 lg:pt-20 lg:pb-14")}
    >
      <div className="flex max-w-3xl flex-col gap-5">
        <h1 id="landing-title" className="type-display text-ink">
          Practice {courseLabel}, one hint at a time
        </h1>
        <p className="type-reading text-ink-muted">
          Real problems from your course, checked instantly. Stuck? Open a
          hint, not the answer.
        </p>

        {signedIn ? (
          <div className="mt-3 flex flex-col gap-2">
            <Button
              asChild
              variant="cta"
              size="lg"
              className="w-full sm:w-fit"
            >
              <Link href="/learn">Continue practicing →</Link>
            </Button>
            {continueNote ? (
              <p className="type-small text-ink-muted">{continueNote}</p>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 flex w-full max-w-md flex-col gap-3">
            <div id={LANDING_SECTION_CODE_ID} className="scroll-mt-24">
              <SectionCodeForm
                label="Section code from your professor"
                ghostLoginEnabled={ghostLoginEnabled}
              />
            </div>
            <div className="type-body flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-muted">
              <p className="min-h-11 content-center">
                No code?{" "}
                <Link
                  href="/sign-in?callbackUrl=%2Flearn"
                  className={LANDING_TEXT_LINK}
                >
                  Sign in
                </Link>
                , or{" "}
                <Link href="/join" className={LANDING_TEXT_LINK}>
                  continue as a guest
                </Link>
                .
              </p>
              <Link
                href="/join#professor"
                className={cn(
                  LANDING_TEXT_LINK,
                  "inline-flex min-h-11 items-center",
                )}
              >
                I’m a professor
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// Two plain statements: what is kept, and who decides what the problems are.
// The lead is the rule; the second line is the fact behind it. What the
// tutor sees is step 3 of "How it works", so it is not repeated here.
const statementsFor = (courseLabel: string) =>
  [
    {
      lead: "Guest practice is anonymous; sign in to keep it",
      detail:
        "Guest progress lives in this browser until you sign in and import it.",
    },
    {
      lead: "Your professor approves every problem",
      detail: `A question reaches students only after a ${courseLabel} professor has reviewed and published it.`,
    },
  ] as const;

export function LandingStatements({
  courseLabel = DEFAULT_LANDING_COURSE_LABEL,
}: {
  courseLabel?: string;
}) {
  return (
    <div className={LANDING_COLUMN}>
      <ul className="grid gap-6 border-t border-rule py-8 md:grid-cols-2 md:gap-8 lg:py-12">
        {statementsFor(courseLabel).map((statement) => (
          <li key={statement.lead} className="flex max-w-prose flex-col gap-1">
            <p className="type-body-strong text-ink">{statement.lead}</p>
            <p className="type-body text-ink-muted">{statement.detail}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One line: whose course this is, the privacy fact, and the professor's way
 * in. Rendered outside `<main>` so it is the page's contentinfo landmark.
 */
export function LandingFooter({
  courseLabel = DEFAULT_LANDING_COURSE_LABEL,
}: {
  courseLabel?: string;
}) {
  return (
    <footer className="bg-surface">
      <div className={LANDING_COLUMN}>
        <div className="flex flex-col gap-2 border-t border-rule py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="type-small text-ink-muted">
            Suffolk University · {courseLabel} · Your professor sees you as a
            code, not your name, unless they open your record.
          </p>
          <Link
            href="/join#professor"
            className={cn(
              LANDING_TEXT_LINK,
              "type-small inline-flex min-h-11 items-center self-start sm:self-auto",
            )}
          >
            Professor sign-in
          </Link>
        </div>
      </div>
    </footer>
  );
}
