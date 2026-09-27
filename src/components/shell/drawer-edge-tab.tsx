"use client";

import { PanelRightOpen } from "lucide-react";
import type { Ref } from "react";

import { cn } from "@/lib/utils";

/**
 * The right-edge tab that opens the drawer when its column is not on screen.
 * Rendered by `ThreeColumn` when the caller passes `onDrawerToggle`.
 */
export function DrawerEdgeTab({
  label,
  onToggle,
  alwaysVisible,
  id,
  ref,
}: {
  label: string;
  onToggle: () => void;
  /** true: visible at every width (drawer closed); false: only below 1280. */
  alwaysVisible: boolean;
  id?: string;
  /** Lets the caller return focus here when the drawer closes. */
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      onClick={onToggle}
      data-slot="drawer-edge-tab"
      className={cn(
        "fixed top-1/2 right-0 z-30 hidden -translate-y-1/2 items-center gap-2 rounded-l-control bg-sheet py-3 pr-2 pl-3 text-sm font-medium text-ink [writing-mode:vertical-rl]",
        "border border-r-0 border-rule transition-colors duration-fast hover:bg-hover focus-ring",
        alwaysVisible ? "lg:flex" : "lg:flex xl:hidden",
      )}
    >
      <PanelRightOpen aria-hidden="true" className="size-4 rotate-90" />
      {label}
    </button>
  );
}
