import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { ContinueCard as ContinueCardModel } from "@/components/learn/learn-model";

/**
 * Zone 1, and the only card on the page: one thing to do next, with the
 * alternative sitting quietly beside it. No progress ring, no streak, no
 * second call to action — the whole point of the card is that it is a single
 * decision.
 */
export function ContinueCard({ card }: { card: ContinueCardModel }) {
  if (card.kind === "empty") {
    return (
      <div className="rounded-lg bg-sheet p-6 text-sheet-foreground">
        <p className="text-sm text-muted-foreground">{card.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg bg-sheet p-6 text-sheet-foreground">
      <div className="flex flex-col gap-1">
        {card.eyebrow ? (
          <p className="font-mono text-xs text-muted-foreground">
            {card.eyebrow}
          </p>
        ) : null}
        {card.kind === "start" && card.message ? (
          <p className="text-sm font-medium">{card.message}</p>
        ) : null}
        {card.questionTitle ? (
          <h3 className="font-display text-xl leading-8 font-normal">
            {card.questionTitle}
          </h3>
        ) : null}
        {card.detail ? (
          <p className="font-mono text-xs text-muted-foreground">
            {card.detail}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {card.primary ? (
          <Button asChild variant="cta" className="h-11 rounded-[6px]">
            <Link href={card.primary.href}>{card.primary.label}</Link>
          </Button>
        ) : null}
        {card.secondary ? (
          <Button asChild variant="ghost" className="h-11 rounded-[6px]">
            <Link href={card.secondary.href}>{card.secondary.label}</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
