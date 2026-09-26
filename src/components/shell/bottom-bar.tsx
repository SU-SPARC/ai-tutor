import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The phone action bar: 56px, fixed to the bottom, safe-area padded, hidden
 * from 1024 up (or never, with `hideFrom={false}`). Up to three slots: `start`
 * (a 44px square Hint button), `center`, `end` (the full-width primary).
 *
 * Pages that use it must leave room at the bottom: add
 * `BOTTOM_BAR_PADDING` to the scrolling container (or render
 * `<BottomBarSpacer />` at the end of the content).
 */
export function BottomBar({
  start,
  center,
  end,
  label,
  hideFrom = "lg",
  className,
}: {
  start?: ReactNode;
  center?: ReactNode;
  end?: ReactNode;
  /** Accessible name (makes it a labelled region), e.g. "Answer actions". */
  label?: string;
  hideFrom?: "lg" | "xl" | false;
  className?: string;
}) {
  return (
    <div
      role={label ? "region" : undefined}
      aria-label={label}
      data-slot="bottom-bar"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-sheet pb-safe",
        hideFrom === "lg" && "lg:hidden",
        hideFrom === "xl" && "xl:hidden",
        className,
      )}
    >
      <div className="mx-auto flex h-(--bottom-bar-h) max-w-3xl items-center gap-3 px-4">
        {start ? <div className="flex shrink-0 items-center gap-2">{start}</div> : null}
        {center ? (
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            {center}
          </div>
        ) : null}
        {end ? (
          <div
            className={cn(
              "flex items-center gap-2",
              center ? "shrink-0" : "min-w-0 flex-1 justify-end [&>*]:flex-1",
            )}
          >
            {end}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Bottom padding that keeps content clear of the BottomBar below 1024. */
export const BOTTOM_BAR_PADDING =
  "pb-[calc(var(--bottom-bar-h)+env(safe-area-inset-bottom)+1rem)] lg:pb-0";

export function BottomBarSpacer({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "h-[calc(var(--bottom-bar-h)+env(safe-area-inset-bottom))] lg:hidden",
        className,
      )}
    />
  );
}
