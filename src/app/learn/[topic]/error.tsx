"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function TopicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <div className="bg-surface-tint">
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <div className="flex flex-col items-start gap-4 rounded-lg bg-sheet p-6 text-sheet-foreground">
          <h1 className="font-display text-[28px] leading-9 font-normal">
            This topic could not be loaded
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Its questions are temporarily unavailable. You can try again or go
            back to the syllabus.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button className="rounded-[6px]" type="button" onClick={reset}>
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
            <Button asChild variant="outline" className="rounded-[6px]">
              <Link href="/learn">Back to Learn</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
