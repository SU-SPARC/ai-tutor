"use client";

/**
 * The tutor below 1280, where `ThreeColumn` has no third column.
 *
 * - Below 1024: a 44px handle ("Tutor · 2 new") docked above the action strip
 *   opens the tutor as a bottom sheet (45% of the screen, so the question
 *   stays in view above it; 85% expanded).
 * - 1024–1279: the right-edge tab opens the same tutor as a right panel.
 *
 * Both are one Radix dialog: focus moves in and is restored, Escape and the
 * scrim close it, and the page behind is inert (the workspace also sets the
 * `inert` attribute on it). Motion comes from the dialog and stops under
 * `prefers-reduced-motion`.
 */

import { ChevronDown, ChevronUp, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";

import { TUTOR_PRIVACY_NOTE } from "@/components/tutor/tutor-drawer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** "Tutor · 2 new" — the count is tutor messages since it was last opened. */
export function mobileTutorHandleLabel(newCount: number) {
  return newCount > 0 ? `Tutor · ${newCount} new` : "Tutor";
}

export type PracticeMobileSheetProps = {
  children: ReactNode;
  /** The action strip is on screen, so the handle sits above it. */
  docked: boolean;
  newCount: number;
  onOpenChange: (open: boolean) => void;
  onToggleHeight: () => void;
  open: boolean;
  side: "bottom" | "right";
  tall: boolean;
};

export function PracticeMobileSheet({
  children,
  docked,
  newCount,
  onOpenChange,
  onToggleHeight,
  open,
  side,
  tall,
}: PracticeMobileSheetProps) {
  const isBottom = side === "bottom";

  return (
    <>
      <div
        data-slot="practice-mobile-sheet"
        data-state={!open ? "closed" : tall ? "tall" : "half"}
        className={cn(
          "fixed inset-x-0 z-30 lg:hidden",
          docked
            ? "bottom-[calc(var(--bottom-bar-h)+env(safe-area-inset-bottom))]"
            : "bottom-0 pb-safe",
        )}
      >
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          data-tour="practice-tutor"
          onClick={() => onOpenChange(true)}
          className="relative flex h-11 w-full items-center gap-2 rounded-t-panel border-t border-rule bg-surface-tint px-4 text-ink transition-colors duration-fast hover:bg-hover focus-ring -outline-offset-2"
        >
          <span
            aria-hidden="true"
            className="absolute top-1 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-rule"
          />
          <MessageCircle aria-hidden="true" className="size-5 shrink-0" />
          <span className="type-body-strong truncate">
            {mobileTutorHandleLabel(newCount)}
          </span>
          <ChevronUp aria-hidden="true" className="ml-auto size-5 shrink-0" />
        </button>
      </div>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          side={side}
          className={cn(isBottom && (tall ? "h-[85svh]" : "h-[45svh]"))}
        >
          <DialogHeader className={cn("gap-1 pb-3", isBottom && "pt-3 pr-24")}>
            <DialogTitle className="type-h3">Tutor</DialogTitle>
            <DialogDescription className="type-caption">
              {TUTOR_PRIVACY_NOTE}
            </DialogDescription>
          </DialogHeader>
          {isBottom ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-3 right-14 text-ink-muted"
              aria-label={
                tall ? "Shrink the tutor sheet" : "Expand the tutor sheet"
              }
              onClick={onToggleHeight}
            >
              {tall ? (
                <ChevronDown aria-hidden="true" />
              ) : (
                <ChevronUp aria-hidden="true" />
              )}
            </Button>
          ) : null}
          <DialogBody className="flex flex-col overflow-hidden px-4 pb-4 sm:px-6">
            {children}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
