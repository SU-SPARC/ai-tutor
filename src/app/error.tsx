"use client"

import { TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default function ApplicationError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-16">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TriangleAlert
                aria-hidden="true"
                className="h-5 w-5 text-destructive"
              />
              Service temporarily unavailable
            </CardTitle>
            <CardDescription>
              Tutor data could not be loaded safely. Please try again shortly.
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
