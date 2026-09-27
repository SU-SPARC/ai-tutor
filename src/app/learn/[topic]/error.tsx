"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

export default function TopicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;

  return (
    <StatusPage
      title="This topic could not be loaded"
      description="Its questions are temporarily unavailable. Try again, or go back to the syllabus and choose another topic."
      actions={
        <>
          <Button type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/learn">Back to Learn</Link>
          </Button>
        </>
      }
    />
  );
}
