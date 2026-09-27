"use client";

import { ChevronDown, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

/**
 * The account disclosure in the header. A disclosure (button +
 * `aria-expanded` + panel) rather than an ARIA menu, because its items are
 * ordinary links and forms. The panel is server-rendered (hidden until
 * opened), so the links exist without JavaScript and in static markup.
 *
 * Closes on Escape (focus returns to the trigger), on a click outside, when
 * focus leaves it, and on navigation.
 */
export function AccountMenu({
  label = "Account",
  detail,
  environmentLabel,
  children,
}: {
  /** Trigger text (hidden on phones, where the trigger is an icon). */
  label?: string;
  /** A line at the top of the panel (who is signed in, which section). */
  detail?: ReactNode;
  /** Non-production indicator ("Local demo"), shown as the panel's last line. */
  environmentLabel?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  // Navigating closes the panel. Tracked during render (not in an effect) so
  // the close happens with the new route's first paint.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        close(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  return (
    <div
      ref={containerRef}
      className="relative"
      data-slot="account-menu"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          close(true);
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (open && next && !containerRef.current?.contains(next)) {
          close(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex h-10 items-center gap-1.5 rounded-control px-2.5 text-base font-medium text-ink transition-colors duration-fast ease-out hover:bg-hover focus-ring",
          open && "bg-hover",
        )}
      >
        <UserRound aria-hidden="true" className="size-5 text-ink-muted" />
        <span className="sr-only sm:not-sr-only">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "hidden size-4 text-ink-muted transition-transform duration-fast sm:block",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full right-0 z-50 mt-2 w-64 rounded-panel border border-rule bg-sheet p-1 text-ink"
      >
        {detail ? (
          <div className="border-b border-rule px-3 pt-2 pb-2.5 type-small text-ink-muted">
            {detail}
          </div>
        ) : null}
        <div className="flex flex-col py-1">{children}</div>
        {environmentLabel ? (
          <p
            className="border-t border-rule px-3 pt-2 pb-1.5 type-caption"
            title={`Non-production environment: ${environmentLabel}`}
          >
            {environmentLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}
