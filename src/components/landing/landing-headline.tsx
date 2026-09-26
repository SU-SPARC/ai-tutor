import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type LandingHeadlineProps = {
  signedIn: boolean;
};

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
 * The first thing on the page, in DOM order and on screen: what this is, one
 * sentence on how it behaves, and two ways in. The live sheet follows right
 * underneath, so the claim can be checked one scroll later.
 *
 * Signed out: the course door (`/join`) is the one mint action, the
 * professor door (`/join#professor`) the secondary, and guest practice the
 * quiet text link. Signed in: one way back to the syllabus.
 */
export function LandingHeadline({ signedIn }: LandingHeadlineProps) {
  return (
    <section
      aria-labelledby="landing-title"
      className={cn(LANDING_COLUMN, "pt-10 pb-8 sm:pt-14 lg:pt-20 lg:pb-12")}
    >
      <div className="flex max-w-3xl flex-col gap-5">
        <h1 id="landing-title" className="type-display text-ink">
          Practice MATH-255, one hint at a time
        </h1>
        <p className="type-reading text-ink-muted">
          Real course problems, reviewed by your professor. Hints before
          answers, always.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          {signedIn ? (
            <Button
              asChild
              variant="cta"
              size="lg"
              className="w-full sm:w-auto"
            >
              <Link href="/learn">Continue practicing →</Link>
            </Button>
          ) : (
            <>
              <Button
                asChild
                variant="cta"
                size="lg"
                className="w-full sm:w-auto"
              >
                <Link href="/join">Join your course</Link>
              </Button>
              <Button
                asChild
                variant="secondary"
                size="lg"
                className="w-full sm:w-auto"
              >
                <Link href="/join#professor">I’m a professor</Link>
              </Button>
              <Button
                asChild
                variant="link"
                className="min-h-11 self-center sm:self-auto"
              >
                <Link href="/practice">Continue as guest</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// Three plain statements, in the order a visitor asks them: what does the
// tutor see, what is kept, and who decides what the problems are. The lead
// is the rule; the second line is the fact behind it.
const STATEMENTS = [
  {
    lead: "What the tutor sees",
    detail:
      "The tutor sees this problem, the hints you have opened and your last answer. Not your name.",
  },
  {
    lead: "Guest practice is anonymous; sign in to keep it",
    detail:
      "Guest progress lives in this browser until you sign in and import it.",
  },
  {
    lead: "Your professor approves every problem",
    detail:
      "A question reaches students only after a MATH-255 professor has reviewed and published it.",
  },
] as const;

export function LandingStatements() {
  return (
    <div className={LANDING_COLUMN}>
      <ul className="grid gap-6 border-t border-rule py-8 md:grid-cols-3 md:gap-8 lg:py-12">
        {STATEMENTS.map((statement) => (
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
export function LandingFooter() {
  return (
    <footer className="bg-surface">
      <div className={LANDING_COLUMN}>
        <div className="flex flex-col gap-2 border-t border-rule py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="type-small text-ink-muted">
            Suffolk University · MATH-255 · Practice is stored under a hashed
            key, never your name.
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
