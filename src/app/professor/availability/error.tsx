"use client";

import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the workspace layout, so the rail stays. The error itself is
 * never shown: it can carry internal detail.
 */
export default function ProfessorAvailabilityError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Student availability"
      description="Publish, schedule, unpublish or archive what students can reach, topic by topic and question by question."
    >
      <section
        role="alert"
        aria-labelledby="availability-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="availability-error-heading" className="type-h3 text-ink">
          Student availability could not be loaded
        </h2>
        <p className="type-body text-ink-muted">
          Availability settings are temporarily unavailable, and nothing was
          changed. Try loading the page again.
        </p>
        <Button type="button" variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </section>
    </ProfessorPageShell>
  );
}
