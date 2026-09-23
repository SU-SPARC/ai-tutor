import Link from "next/link";

import { Button } from "@/components/ui/button";

export type LandingHeadlineProps = {
  signedIn: boolean;
};

// The three sentences of the band. Not features — the rules of the place.
const BAND_SENTENCES = [
  "How it works: Try → Hint → Step → Check",
  "Your professor approves every problem",
  "Guest practice is anonymous; sign in to keep it",
];

/**
 * The words go *below* the product. A visitor has already read a real question
 * and, if they wanted to, checked an answer by the time they reach this line,
 * so the headline names what they just did rather than selling it.
 */
export function LandingHeadline({ signedIn }: LandingHeadlineProps) {
  return (
    <>
      <section className="mx-auto flex w-full max-w-[90rem] flex-col gap-6 px-4 py-12 sm:px-6 lg:py-16">
        <h1 className="max-w-3xl font-display text-[40px] leading-[1.15] font-normal text-balance lg:text-[56px]">
          Practice MATH-255, <em className="italic">one hint at a time</em>.
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          Real course problems, reviewed by your professor. Hints before
          answers, always.
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button asChild variant="cta" size="lg" className="rounded-[6px]">
            <Link href={signedIn ? "/learn" : "/practice"}>
              {signedIn ? "Continue practicing →" : "Start practicing →"}
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            <Link
              href="/practice"
              className="text-primary underline underline-offset-4"
            >
              Continue as guest
            </Link>
            {" · "}
            <Link
              href="/join"
              className="text-primary underline underline-offset-4"
            >
              Join with a code
            </Link>
          </p>
        </div>
      </section>

      <div className="bg-surface-tint">
        <ul className="mx-auto flex w-full max-w-[90rem] flex-col gap-2 px-4 py-4 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-8 sm:px-6">
          {BAND_SENTENCES.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
