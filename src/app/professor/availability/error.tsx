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
      title="What students see"
      description="Choose when students can see each topic or question."
    >
      <section
        role="alert"
        aria-labelledby="availability-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="availability-error-heading" className="type-h3 text-ink">
          This page didn&apos;t load
        </h2>
        <p className="type-body text-ink">
          That didn&apos;t work and nothing changed. Try again, or reload the
          page.
        </p>
        <Button
          type="button"
          variant="secondary"
          className="min-h-11"
          onClick={reset}
        >
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </section>
    </ProfessorPageShell>
  );
}
