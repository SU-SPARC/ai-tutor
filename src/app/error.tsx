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
      title="This page didn't load"
      description="Something went wrong loading this page. Try again; your saved answers are safe."
      actions={
        <>
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/learn">Back to Learn</Link>
          </Button>
        </>
      }
    />
  )
}
