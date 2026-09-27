"use client";

import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the workspace layout, so the rail stays. The error itself is
 * never shown: it can carry query text.
 */
export default function ProfessorAnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Analytics"
      description="Published-practice performance and tutor use across the class, with no student named."
    >
      <section
        role="alert"
        aria-labelledby="analytics-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="analytics-error-heading" className="type-h3 text-ink">
          Course analytics could not be loaded
        </h2>
        <p className="type-body text-ink-muted">
          Recorded practice information is temporarily unavailable. Try loading
          the page again.
        </p>
        <Button type="button" variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </section>
    </ProfessorPageShell>
  );
}
