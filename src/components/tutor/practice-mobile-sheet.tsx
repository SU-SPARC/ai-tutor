"use client";

/**
 * The phone form of the tutor drawer: a bottom sheet with three positions —
 * a 56px handle, a 45% half sheet, and a 90% full sheet. It is a CSS
 * `translate-y` on a fixed panel, so there is nothing to measure and nothing
 * to drag-lock; `prefers-reduced-motion` turns the 200ms slide into a toggle.
 *
 * It replaces the drawer below xl, where `ThreeColumn` has no third column.
 */

import { ChevronDown, ChevronUp, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "💬 Tutor · 2 new" — the count is tutor messages since it was last opened. */
export function mobileTutorHandleLabel(newCount: number) {
  return newCount > 0 ? `Tutor · ${newCount} new` : "Tutor";
}

export type PracticeMobileSheetProps = {
  children: ReactNode;
  newCount: number;
  onToggleHeight: () => void;
  onToggleOpen: () => void;
  open: boolean;
  tall: boolean;
};

export function PracticeMobileSheet({
  children,
  newCount,
  onToggleHeight,
  onToggleOpen,
  open,
  tall,
}: PracticeMobileSheetProps) {
  // 90svh tall; showing half of it is the 45% snap, showing 56px is the handle.
  const offset = !open ? "calc(100% - 56px)" : tall ? "0%" : "50%";

  return (
    <div
      data-slot="practice-mobile-sheet"
      data-state={!open ? "closed" : tall ? "tall" : "half"}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-[90svh] xl:hidden"
    >
      <div
        className="pointer-events-auto flex h-full flex-col rounded-t-lg border-t border-border bg-sheet text-sheet-foreground shadow-md transition-transform duration-200 ease-out motion-reduce:transition-none"
        style={{ transform: `translateY(${offset})` }}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 px-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggleOpen}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 py-2 text-left text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{mobileTutorHandleLabel(newCount)}</span>
          </button>
          {open ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={
                tall ? "Shrink the tutor sheet" : "Expand the tutor sheet"
              }
              onClick={onToggleHeight}
            >
              {tall ? (
                <ChevronDown className="size-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="size-4" aria-hidden="true" />
              )}
            </Button>
          ) : null}
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 pb-4",
            open ? undefined : "invisible",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
