"use client";

import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Covers the list and each student's record. Renders inside the workspace
 * layout, so the rail stays; the error itself is never shown.
 */
export default function ProfessorStudentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Students"
      description="Everyone who has signed in to the tutor, with the practice they have recorded."
    >
      <section
        role="alert"
        aria-labelledby="students-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="students-error-heading" className="type-h3 text-ink">
          Student records could not be loaded
        </h2>
        <p className="type-body text-ink-muted">
          Recorded practice is temporarily unavailable. Try loading the page
          again.
        </p>
        <Button type="button" variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </section>
    </ProfessorPageShell>
  );
}
