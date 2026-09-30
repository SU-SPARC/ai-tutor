"use client";

/**
 * The on-screen math keypad under the answer field. Our own keys, styled
 * with the design system; MathLive's virtual keyboard is never shown.
 *
 * Three groups, as in the product owner's reference: templates on the left
 * (fraction, power, square, root, π, e, parentheses, %, n!, n choose k), the
 * calculator block in the middle (7 8 9 / 4 5 6 / 1 2 3 / 0 . with
 * ÷ × − + beside it), and editing on the right (← → ⌫ Clear and the mint
 * Check). Every key is a real button with a spoken name; a pointer press
 * never takes focus from the field, and the arrow keys move between keys
 * (one tab stop for the whole pad).
 *
 * Layouts: `inline` opens under the field on desktop (the "Keypad" toggle);
 * `docked` is fixed to the bottom of the screen on phones and tablets while
 * the field is focused (see `MathKeypadDock`).
 */

import { ArrowLeft, ArrowRight, Delete } from "lucide-react";
import {
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type KeypadTemplate =
  | "fraction"
  | "power"
  | "square"
  | "sqrt"
  | "pi"
  | "e"
  | "open"
  | "close"
  | "percent"
  | "factorial"
  | "binom";

export type KeypadDigit =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | ".";

export type KeypadOperator = "plus" | "minus" | "times" | "divide";

export type KeypadEdit = "left" | "right" | "delete" | "clear";

export type KeypadAction =
  | KeypadTemplate
  | KeypadDigit
  | KeypadOperator
  | KeypadEdit
  | "check";

type KeySpec = {
  action: KeypadAction;
  label: string;
  glyph: ReactNode;
  /** Extra grid placement for this layout (col/row spans). */
  className?: string;
  tone?: "template" | "digit" | "operator" | "edit" | "check";
};

/** An empty template slot, like MathLive's placeholder. */
function Slot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-[0.7em] rounded-[2px] border-[1.5px] border-current opacity-80",
        className,
      )}
    />
  );
}

const GLYPHS: Record<KeypadTemplate, ReactNode> = {
  fraction: (
    <span className="inline-flex flex-col items-center gap-[2px] leading-none">
      <Slot />
      <span className="h-[1.5px] w-[1.1em] bg-current" />
      <Slot />
    </span>
  ),
  power: (
    <span className="inline-flex items-start leading-none">
      <Slot className="mt-[0.35em]" />
      <Slot className="ml-[1px] size-[0.5em]" />
    </span>
  ),
  square: (
    <span className="inline-flex items-start leading-none">
      <Slot className="mt-[0.35em]" />
      <span className="ml-[1px] text-[0.7em]">2</span>
    </span>
  ),
  sqrt: (
    <span className="inline-flex items-center leading-none">
      <span className="font-display">√</span>
      <Slot className="-ml-[1px] border-t-2" />
    </span>
  ),
  pi: <span className="font-display italic">π</span>,
  e: <span className="font-display italic">e</span>,
  open: "(",
  close: ")",
  percent: "%",
  factorial: (
    <span>
      <span className="font-display italic">n</span>!
    </span>
  ),
  binom: (
    <span className="inline-flex items-center leading-none">
      <span className="text-[1.35em] font-light">(</span>
      <span className="inline-flex flex-col items-center text-[0.7em] leading-[1.05]">
        <span className="font-display italic">n</span>
        <span className="font-display italic">k</span>
      </span>
      <span className="text-[1.35em] font-light">)</span>
    </span>
  ),
};

const TEMPLATE_KEYS: KeySpec[] = (
  [
    { action: "fraction", label: "fraction", glyph: GLYPHS.fraction },
    { action: "power", label: "to the power of", glyph: GLYPHS.power },
    { action: "square", label: "squared", glyph: GLYPHS.square },
    { action: "sqrt", label: "square root", glyph: GLYPHS.sqrt },
    { action: "open", label: "open parenthesis", glyph: GLYPHS.open },
    { action: "close", label: "close parenthesis", glyph: GLYPHS.close },
    { action: "pi", label: "pi", glyph: GLYPHS.pi },
    { action: "e", label: "e, Euler's number", glyph: GLYPHS.e },
    { action: "percent", label: "percent", glyph: GLYPHS.percent },
    { action: "factorial", label: "factorial", glyph: GLYPHS.factorial },
    { action: "binom", label: "n choose k", glyph: GLYPHS.binom },
  ] satisfies Omit<KeySpec, "tone">[]
).map((key) => ({ ...key, tone: "template" as const }));

const digit = (value: KeypadDigit, className?: string): KeySpec => ({
  action: value,
  label: value === "." ? "decimal point" : value,
  glyph: value,
  tone: "digit",
  className,
});

const operator = (
  action: KeypadOperator,
  glyph: string,
  label: string,
): KeySpec => ({ action, glyph, label, tone: "operator" });

const DIVIDE = operator("divide", "÷", "divided by");
const TIMES = operator("times", "×", "times");
const MINUS = operator("minus", "−", "minus");
const PLUS = operator("plus", "+", "plus");

const LEFT: KeySpec = {
  action: "left",
  label: "move left",
  glyph: <ArrowLeft aria-hidden="true" className="size-5" />,
  tone: "edit",
};
const RIGHT: KeySpec = {
  action: "right",
  label: "move right",
  glyph: <ArrowRight aria-hidden="true" className="size-5" />,
  tone: "edit",
};
const DELETE: KeySpec = {
  action: "delete",
  label: "delete",
  glyph: <Delete aria-hidden="true" className="size-5" />,
  tone: "edit",
};
const CLEAR: KeySpec = {
  action: "clear",
  label: "clear answer",
  glyph: <span className="text-sm font-medium">Clear</span>,
  tone: "edit",
};

const CHECK_KEY = (className?: string): KeySpec => ({
  action: "check",
  label: "Check answer",
  glyph: <span className="font-medium">Check</span>,
  tone: "check",
  className,
});

type Group = { label: string; className: string; keys: KeySpec[] };

/** Desktop: three blocks side by side (templates · calculator · editing). */
function inlineGroups(showCheck: boolean): Group[] {
  return [
    {
      label: "Templates",
      className: "grid grid-cols-4 content-start gap-1.5",
      keys: TEMPLATE_KEYS,
    },
    {
      label: "Numbers",
      className: "grid grid-cols-4 content-start gap-1.5",
      keys: [
        digit("7"),
        digit("8"),
        digit("9"),
        DIVIDE,
        digit("4"),
        digit("5"),
        digit("6"),
        TIMES,
        digit("1"),
        digit("2"),
        digit("3"),
        MINUS,
        digit("0", "col-span-2"),
        digit("."),
        PLUS,
      ],
    },
    {
      label: "Editing",
      className: "grid grid-cols-2 grid-rows-4 content-start gap-1.5",
      keys: showCheck
        ? [LEFT, RIGHT, DELETE, CLEAR, CHECK_KEY("col-span-2 row-span-2")]
        : [LEFT, RIGHT, DELETE, CLEAR],
    },
  ];
}

/**
 * Phones: templates in two rows of six (Clear fills the last slot), then the
 * calculator with the editing column on its right and a wide Check.
 */
function dockedGroups(showCheck: boolean): Group[] {
  return [
    {
      label: "Templates",
      className: "grid grid-cols-6 gap-1.5",
      keys: [...TEMPLATE_KEYS, CLEAR],
    },
    {
      label: "Numbers and editing",
      className: "grid grid-cols-5 gap-1.5",
      keys: [
        digit("7"),
        digit("8"),
        digit("9"),
        DIVIDE,
        DELETE,
        digit("4"),
        digit("5"),
        digit("6"),
        TIMES,
        LEFT,
        digit("1"),
        digit("2"),
        digit("3"),
        MINUS,
        RIGHT,
        // Without its own Check (the page's action strip carries it), 0
        // takes the spare cell.
        digit("0", showCheck ? undefined : "col-span-3"),
        digit("."),
        PLUS,
        ...(showCheck ? [CHECK_KEY("col-span-2")] : []),
      ],
    },
  ];
}

const TONES: Record<NonNullable<KeySpec["tone"]>, string> = {
  template: "bg-sheet text-ink text-lg",
  digit: "bg-sheet text-ink font-mono text-lg tabular",
  operator: "bg-sheet text-azure-700 font-mono text-xl",
  edit: "bg-surface text-ink",
  check:
    "border-transparent bg-mint text-mint-foreground hover:bg-mint-hover active:bg-mint-hover",
};

export type MathKeypadProps = {
  layout: "inline" | "docked";
  onAction: (action: KeypadAction) => void;
  /** Check is disabled while a check runs or the answer is locked. */
  checkDisabled?: boolean;
  /** Highlight a key the question asks for (a required percentage). */
  emphasize?: "percent";
  /**
   * Render the pad's own mint Check key (default true). Pass false when the
   * page already shows a Check answer button (the practice action strip), so
   * there is only ever one Check on screen.
   */
  showCheck?: boolean;
  id?: string;
  className?: string;
};

export function MathKeypad({
  layout,
  onAction,
  checkDisabled = false,
  emphasize,
  showCheck = true,
  id,
  className,
}: MathKeypadProps) {
  const groups =
    layout === "inline" ? inlineGroups(showCheck) : dockedGroups(showCheck);
  const keys = groups.flatMap((group) => group.keys);
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const current = refs.current.findIndex((button) => button === event.target);
    if (current < 0) return;
    const last = keys.length - 1;
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? Math.min(last, current + 1)
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? Math.max(0, current - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  const offsets = groups.map((_, groupIndex) =>
    groups
      .slice(0, groupIndex)
      .reduce((total, group) => total + group.keys.length, 0),
  );

  return (
    <div
      id={id}
      role="group"
      aria-label="Math keys"
      data-slot="math-keypad"
      data-layout={layout}
      onKeyDown={moveFocus}
      className={cn(
        "select-none",
        layout === "inline"
          ? "flex flex-wrap items-start gap-4 rounded-panel bg-surface-tint p-3"
          : "flex flex-col gap-1.5",
        className,
      )}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.label}
          role="group"
          aria-label={group.label}
          className={group.className}
        >
          {group.keys.map((key, keyIndex) => {
            const position = offsets[groupIndex] + keyIndex;
            const emphasized = emphasize === key.action;
            const disabled = key.action === "check" && checkDisabled;
            return (
              <button
                key={`${group.label}-${key.action}`}
                ref={(element) => {
                  refs.current[position] = element;
                }}
                type="button"
                // One tab stop for the pad; arrow keys move between keys.
                tabIndex={position === active ? 0 : -1}
                aria-label={
                  emphasized
                    ? `${key.label} (this question asks for a percentage)`
                    : key.label
                }
                disabled={disabled}
                data-key={key.action}
                // Keep focus (and the caret) in the answer field.
                onPointerDown={(event) => event.preventDefault()}
                onMouseDown={(event) => event.preventDefault()}
                onFocus={() => setActive(position)}
                onClick={() => onAction(key.action)}
                className={cn(
                  "relative inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-control border border-rule px-2",
                  "transition-[background-color,border-color,transform] duration-fast ease-out",
                  "hover:border-ink-muted hover:bg-hover active:scale-97 focus-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                  layout === "inline" ? "h-11" : "h-11 min-w-0",
                  TONES[key.tone ?? "digit"],
                  emphasized &&
                    "border-2 border-azure-500 bg-azure-100 font-semibold text-azure-700",
                  key.className,
                )}
              >
                {key.glyph}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export type MathKeypadDockProps = {
  /** The "Reads as …" line, repeated above the keys (decorative copy). */
  preview?: ReactNode;
  onHide: () => void;
  /** Sit above a page's bottom bar (`--bottombar-h`) instead of the edge. */
  children: ReactNode;
  dockRef?: (element: HTMLDivElement | null) => void;
};

/**
 * The phone and tablet dock: fixed to the bottom of the screen (above the
 * practice action bar through `--bottombar-h`), safe-area padded, with a thin
 * bar holding the live preview and "Hide keypad". Rendered into `<body>` so
 * no transformed ancestor can trap the fixed position.
 */
export function MathKeypadDock({
  preview,
  onHide,
  children,
  dockRef,
}: MathKeypadDockProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={dockRef}
      data-slot="math-keypad-dock"
      className="math-keypad-dock fixed inset-x-0 z-50 border-t border-rule bg-surface-tint animate-in fade-in-0 slide-in-from-bottom-2 duration-fast"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 pt-2 pb-2">
        <div className="flex min-h-9 items-center gap-3">
          <div
            aria-hidden="true"
            className="type-small min-w-0 flex-1 truncate text-ink-muted"
          >
            {preview}
          </div>
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onHide}
            className="-mr-2 inline-flex min-h-11 shrink-0 items-center rounded-control px-2 text-sm font-medium text-azure-500 hover:text-azure-700 focus-ring"
          >
            Hide keypad
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Where the keypad lives: inline under the field (desktop with a mouse) or
// docked to the bottom of the screen (touch, or narrower than 1024px).
// ---------------------------------------------------------------------------

const DOCKED_QUERY = "(pointer: coarse), (max-width: 1023.98px)";

function subscribeDocked(onChange: () => void) {
  const query = window.matchMedia(DOCKED_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** "inline" on the server and on desktop; "docked" on phones and tablets. */
export function useKeypadLayout(): "inline" | "docked" {
  return useSyncExternalStore(
    subscribeDocked,
    () => (window.matchMedia(DOCKED_QUERY).matches ? "docked" : "inline"),
    () => "inline",
  );
}

const OPEN_KEY = "probstat.math-keypad.open";
const OPEN_EVENT = "probstat:math-keypad-open";

/** The toggle for this page view when storage is unavailable. */
let fallbackOpen = false;

function readOpen(): boolean {
  try {
    const stored = window.localStorage.getItem(OPEN_KEY);
    return stored === null ? fallbackOpen : stored === "true";
  } catch {
    return fallbackOpen;
  }
}

function subscribeOpen(onChange: () => void) {
  window.addEventListener(OPEN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(OPEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The desktop keypad toggle, collapsed by default and remembered in this
 * browser. Storage failures (private mode, blocked site data) just forget.
 */
export function useKeypadOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const setOpen = (next: boolean) => {
    try {
      window.localStorage.setItem(OPEN_KEY, String(next));
    } catch {
      // Not remembered; the toggle still works for this page view.
    }
    fallbackOpen = next;
    window.dispatchEvent(new Event(OPEN_EVENT));
  };
  return [open, setOpen];
}
