"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function LearnError({
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
            Your progress could not be loaded
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Your saved practice is temporarily unavailable. Nothing you have
            done has changed. Try loading it again.
          </p>
          <Button className="rounded-[6px]" type="button" onClick={reset}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </main>
    </div>
  );
}
