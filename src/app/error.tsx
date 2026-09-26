"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { StatusPage } from "@/components/ui/status-page"

export default function ApplicationError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <StatusPage
      title="This page could not load"
      description="Tutor data could not be loaded safely. Try again in a moment; your saved practice is not affected."
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/learn">Go to Learn</Link>
          </Button>
        </>
      }
    />
  )
}
