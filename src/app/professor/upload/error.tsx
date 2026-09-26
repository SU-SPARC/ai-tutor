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
      title="Uploads"
      breadcrumbs={[
        { label: "Workspace", href: "/professor" },
        { label: "Uploads" },
      ]}
      description="The upload page could not be loaded."
    >
      <section
        role="alert"
        aria-labelledby="upload-error-heading"
        className="flex max-w-prose flex-col items-start gap-3 border-l-2 border-red-500 py-1 pl-4"
      >
        <h2 id="upload-error-heading" className="type-h3 text-ink">
          Uploads could not be loaded
        </h2>
        <p className="type-body text-ink-muted">
          No file was sent. Try loading the page again, or go back to the
          workspace.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/professor">Back to the workspace</Link>
          </Button>
        </div>
      </section>
    </ProfessorPageShell>
  );
}
