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
      description="Everyone who has practiced, with what they’ve done so far."
    >
      <section
        role="alert"
        aria-labelledby="students-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="students-error-heading" className="type-h3 text-ink">
          Students didn’t load
        </h2>
        <p className="type-body text-ink">
          This is usually temporary. Try again, or reload the page.
        </p>
        <Button type="button" variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </section>
    </ProfessorPageShell>
  );
}
