"use client";

import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the workspace layout, so the rail stays. The error itself is
 * never shown: it can carry internal detail.
 */
export default function ProfessorContentTransferError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Import & export"
      description="Move question content in and out as validated JSON; an import never publishes anything to students."
    >
      <section
        role="alert"
        aria-labelledby="content-transfer-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="content-transfer-error-heading" className="type-h3 text-ink">
          Import & export could not be loaded
        </h2>
        <p className="type-body text-ink-muted">
          Nothing was imported. Try loading the page again.
        </p>
        <Button type="button" variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </section>
    </ProfessorPageShell>
  );
}
