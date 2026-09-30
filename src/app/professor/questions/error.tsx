"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the workspace layout, so the rail stays. The error itself is
 * never shown: it can carry internal detail.
 */
export default function ProfessorQuestionsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Question bank"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Question bank" },
      ]}
      description="Your questions didn't load."
    >
      <section
        role="alert"
        aria-labelledby="questions-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="questions-error-heading" className="type-h3 text-ink">
          Your questions didn&apos;t load
        </h2>
        <p className="type-body text-ink">
          Nothing was changed. Try again, or go back to Home.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" className="min-h-11" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="secondary" className="min-h-11">
            <Link href="/professor">Go back to Home</Link>
          </Button>
        </div>
      </section>
    </ProfessorPageShell>
  );
}
