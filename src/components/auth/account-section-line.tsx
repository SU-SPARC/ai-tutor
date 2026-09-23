"use client";

import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";

import { useStudentSection } from "@/components/shell/use-student-section";
import { cn } from "@/lib/utils";

const LINE_CLASSES = "text-sm leading-6";

/**
 * `useStudentSection` remembers which section a student joined but not when —
 * there is no sections API in this demo — so the join date is recorded here,
 * next to the one screen that shows it. It is written on first sight of a code
 * and never again, so the date stays put across visits.
 */
const JOINED_STORAGE_KEY = "ai-tutor-student-section-joined";

type JoinRecord = { code: string; joinedAt: string };

function rememberJoin(code: string): string | null {
  try {
    const raw = window.localStorage.getItem(JOINED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<JoinRecord>;
      if (parsed?.code === code && typeof parsed.joinedAt === "string") {
        return parsed.joinedAt;
      }
    }
    const record: JoinRecord = { code, joinedAt: new Date().toISOString() };
    window.localStorage.setItem(JOINED_STORAGE_KEY, JSON.stringify(record));
    return record.joinedAt;
  } catch {
    // Private browsing and blocked site data both throw. The line then simply
    // drops the date rather than disappearing.
    return null;
  }
}

// A one-value external store rather than state-in-an-effect: the write happens
// when React subscribes (after commit, never during a render), and the server
// snapshot is always null so the first client render matches the markup.
const listeners = new Set<() => void>();
let recordedCode: string | null | undefined;
let joinedSnapshot: string | null = null;

function recordJoin(code: string | null) {
  if (code === recordedCode) {
    return;
  }
  recordedCode = code;
  joinedSnapshot = code ? rememberJoin(code) : null;
  for (const listener of listeners) {
    listener();
  }
}

function formatJoined(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

/**
 * One line on the account page: which section this browser is joined to, or
 * the way in if it is joined to none. Section membership lives in the browser
 * for this demo, so it cannot be rendered on the server — everything above
 * this line can.
 */
export function AccountSectionLine({ className }: { className?: string }) {
  const { section, hydrated } = useStudentSection();
  const code = section?.code ?? null;

  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      recordJoin(code);
      return () => {
        listeners.delete(listener);
      };
    },
    [code],
  );

  const joinedAt = useSyncExternalStore(
    subscribe,
    () => joinedSnapshot,
    () => null,
  );

  if (!hydrated) {
    // The value is only known in the browser; a placeholder of the same height
    // keeps the panel from jumping when it arrives.
    return (
      <p aria-hidden className={cn(LINE_CLASSES, "opacity-0", className)}>
        &nbsp;
      </p>
    );
  }

  if (!section) {
    return (
      <p className={cn(LINE_CLASSES, "text-muted-foreground", className)}>
        No section joined ·{" "}
        <Link
          href="/join"
          className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Join with a code
        </Link>
      </p>
    );
  }

  const joined = joinedAt ? formatJoined(joinedAt) : null;

  return (
    <p className={cn(LINE_CLASSES, className)}>
      <span className="font-mono">{section.label}</span>
      {joined ? (
        <span className="text-muted-foreground"> · joined {joined}</span>
      ) : null}
    </p>
  );
}
