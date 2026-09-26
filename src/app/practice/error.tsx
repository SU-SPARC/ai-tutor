"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusPage } from "@/components/ui/status-page";

/**
 * When /practice cannot render: say what failed and offer the way back.
 * Saved progress lives on the server, so trying again is safe.
 */
export default function PracticeError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPage
      title="This question could not load"
      description="The practice page hit a problem while loading. Your saved progress is not affected; try again, or pick a topic to continue from."
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="secondary">
            <Link href="/learn">Browse topics</Link>
          </Button>
        </>
      }
    />
  );
}
