"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";

/**
 * Renders inside the workspace layout, so the rail stays. The error itself is
 * never shown: it can carry internal detail.
 */
export default function ProfessorUploadError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <ProfessorPageShell
      title="Upload notes"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "Upload notes" },
      ]}
      description="This page could not be opened."
    >
      <section
        role="alert"
        aria-labelledby="upload-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="upload-error-heading" className="type-h3 text-ink">
          What you can do
        </h2>
        <p className="type-body text-ink">
          No file was sent and nothing was changed. Try again, or choose
          another page from the list on the left.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" className="min-h-11" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="secondary" className="min-h-11">
            <Link href="/professor">Go to Home</Link>
          </Button>
        </div>
      </section>
    </ProfessorPageShell>
  );
}
