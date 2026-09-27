"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the workspace layout, so the rail stays. It also catches any
 * professor route without an error file of its own, so it names no page. The
 * error itself is never shown: it can carry internal detail.
 */
export default function ProfessorWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Professor workspace"
      description="This page could not be loaded."
    >
      <section
        role="alert"
        aria-labelledby="workspace-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="workspace-error-heading" className="type-h3 text-ink">
          Something went wrong while loading this page
        </h2>
        <p className="type-body text-ink-muted">
          Nothing was changed. Try loading it again, or open another section
          from the rail.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/professor/review">Open the review queue</Link>
          </Button>
        </div>
      </section>
    </ProfessorPageShell>
  );
}
