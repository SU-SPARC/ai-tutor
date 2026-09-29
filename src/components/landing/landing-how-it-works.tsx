import { KeyRound, Lightbulb, MessageCircle, type LucideIcon } from "lucide-react";

import { LANDING_COLUMN } from "@/components/landing/landing-headline";
import { cn } from "@/lib/utils";

type Step = {
  icon: LucideIcon;
  title: string;
  body: string;
};

// Verb-first titles, one line each, in the order a student meets them: the
// code from class, the hint ladder, the tutor. The tutor step carries the
// privacy fact that used to be its own statement.
const STEPS: readonly Step[] = [
  {
    icon: KeyRound,
    title: "Enter your section code",
    body: "Your professor gives it out in class. It takes you straight to this week's problems.",
  },
  {
    icon: Lightbulb,
    title: "Try before you're told",
    body: "Hints come one at a time; the worked steps open only after every hint.",
  },
  {
    icon: MessageCircle,
    title: "Ask the tutor",
    body: "It sees the problem and your last answer, not your name.",
  },
];

/**
 * How it works, directly under the live Sheet: three steps joined by one
 * thin rule. From `md` the rule is the brand-gradient hairline running
 * through the icon tiles (the one place on the page the gradient appears
 * outside the header); on phones the steps stack and the rule is a plain
 * vertical hairline down the icon column.
 */
export function LandingHowItWorks() {
  return (
    <section
      aria-labelledby="how-it-works-title"
      className={cn(LANDING_COLUMN, "pb-10 lg:pb-16")}
    >
      <h2 id="how-it-works-title" className="type-h2 mb-6 text-ink">
        How it works
      </h2>
      <div className="relative">
        {/* The one rule: through the centre of the 44px icon tiles. */}
        <div
          aria-hidden="true"
          className="gradient-hairline absolute top-[22px] right-0 left-0 hidden md:block"
        />
        <div
          aria-hidden="true"
          className="absolute top-0 bottom-0 left-[22px] w-px bg-rule md:hidden"
        />
        <ol className="relative grid gap-8 md:grid-cols-3 md:gap-10">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="flex gap-4 md:flex-col md:gap-4"
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full border border-rule bg-sheet text-azure-500"
                >
                  <Icon className="size-5" strokeWidth={1.75} />
                </span>
                <div className="flex max-w-prose flex-col gap-1">
                  <h3 className="type-h3 text-ink">
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.title}
                  </h3>
                  <p className="type-body text-ink-muted">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
