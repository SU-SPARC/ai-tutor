"use client";

import { Signpost } from "lucide-react";

import { accountMenuItemClassName } from "@/components/auth/navigation-class-name";
import { useTour } from "@/components/tour/tour-context";
import {
  TOUR_EVENT,
  TOUR_MENU_HELPER,
  TOUR_MENU_LABEL,
} from "@/components/tour/tour-steps";
import { cn } from "@/lib/utils";

/**
 * The account menu's "Onboarding guide" item. It starts the tour for the
 * signed-in role, ignoring the seen flag; the tour itself goes to the home
 * page first when this page has nowhere to begin. Never names a role.
 */
export function StartGuideButton({ className }: { className?: string }) {
  const tour = useTour();

  return (
    <button
      type="button"
      className={cn(accountMenuItemClassName, "min-h-11 py-1.5", className)}
      onClick={() => {
        if (tour) {
          tour.start();
        } else {
          window.dispatchEvent(new Event(TOUR_EVENT));
        }
      }}
    >
      <Signpost aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span>{TOUR_MENU_LABEL}</span>
        <span className="type-small text-ink-muted">{TOUR_MENU_HELPER}</span>
      </span>
    </button>
  );
}
