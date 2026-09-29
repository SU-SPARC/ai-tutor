"use client";

import { useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";

const STORAGE_KEY = "probstat:professor-home-how-it-works-hidden";

const listeners = new Set<() => void>();

// Keeps "Hide this" working for the current visit when storage is blocked.
let hiddenForThisVisit = false;

function readHidden() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function hide() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Storage can be blocked (private windows); the strip still hides for
    // this visit through `hiddenForThisVisit`.
  }
  hiddenForThisVisit = true;
  listeners.forEach((listener) => listener());
}

const STEPS = [
  "The tutor drafts questions from your notes.",
  "You approve them.",
  "You choose when students see them.",
] as const;

/**
 * Three numbered sentences that explain the whole workflow on Home. A
 * professor can hide it with "Hide this"; the choice is remembered in this
 * browser.
 */
export function ProfessorHowItWorks() {
  const hidden = useSyncExternalStore(
    subscribe,
    () => hiddenForThisVisit || readHidden(),
    () => false,
  );

  if (hidden) {
    return null;
  }

  return (
    <section
      aria-labelledby="overview-how-heading"
      className="flex flex-col gap-3 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="overview-how-heading" className="type-h3 text-ink">
          How it works
        </h2>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11 text-azure-700 underline underline-offset-4"
          onClick={hide}
        >
          Hide this
        </Button>
      </div>
      <ol className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-baseline gap-2 type-body text-ink">
            <span className="type-body-strong text-ink">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
