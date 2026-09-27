"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the workspace layout, so the rail stays. The error itself is
 * never shown: it can carry internal detail.
 */
export default function ProfessorQuestionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Question"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Questions", href: "/professor/questions" },
        { label: "Question" },
      ]}
      description="This question could not be loaded."
    >
      <section
        role="alert"
        aria-labelledby="question-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="question-error-heading" className="type-h3 text-ink">
          The question could not be loaded
        </h2>
        <p className="type-body text-ink-muted">
          Nothing was changed. Try loading it again, or find it in the bank.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/professor/questions">Open the question bank</Link>
          </Button>
        </div>
      </section>
    </ProfessorPageShell>
  );
}
