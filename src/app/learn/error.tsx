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
      description="That didn’t work and nothing changed. Try again, or reload the page."
      actions={
        <Button type="button" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      }
    />
  );
}
