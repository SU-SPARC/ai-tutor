"use client"

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

export default function TopicsError({
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
              Could not load topics
            </CardTitle>
            <CardDescription>
              Something went wrong while loading the topic list. Please try
              again.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={reset}>Try again</Button>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
