"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export default function LearnError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <StatusPage
      title="Your progress could not be loaded"
      description="Your saved practice is temporarily unavailable. Nothing you have done has changed. Try loading it again in a moment."
      actions={
        <Button type="button" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      }
    />
  );
}
