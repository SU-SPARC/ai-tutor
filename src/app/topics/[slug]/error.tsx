"use client"

import Link from "next/link"
import { useEffect } from "react"
import { TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function TopicDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-destructive" />
              Could not load this topic
            </CardTitle>
            <CardDescription>
              Something went wrong while loading these questions. You can try
              again or head back to the topic list.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="outline">
              <Link href="/topics">Back to topics</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
