"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  GraduationCap,
  Lightbulb,
  ListChecks,
  Loader2,
  RotateCcw,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ANONYMOUS_STUDENT_HEADER,
  getOrCreateAnonymousStudentId,
} from "@/lib/auth/anonymous-student"
import type { StudentProgressDashboard } from "@/lib/types"

type ProgressPayload = {
  error?: string
  progress?: StudentProgressDashboard
}

const metricDefinitions = [
  {
    icon: BookOpenCheck,
    key: "attemptedQuestions",
    label: "Questions attempted",
  },
  { icon: CheckCircle2, key: "correctAttempts", label: "Correct attempts" },
  { icon: Lightbulb, key: "hintsUsed", label: "Hints used" },
  { icon: ListChecks, key: "stepsRevealed", label: "Steps revealed" },
  { icon: GraduationCap, key: "topicsPracticed", label: "Topics practiced" },
] as const

export function ProgressDashboard() {
  const [progress, setProgress] = useState<StudentProgressDashboard | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  async function loadProgress() {
    setIsLoading(true)
    setError(null)

    try {
      setProgress(await fetchStudentProgress())
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Student progress could not be loaded.",
      )
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let isStale = false

    void fetchStudentProgress()
      .then((nextProgress) => {
        if (!isStale) {
          setProgress(nextProgress)
        }
      })
      .catch((loadError: unknown) => {
        if (!isStale) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Student progress could not be loaded.",
          )
        }
      })
      .finally(() => {
        if (!isStale) {
          setIsLoading(false)
        }
      })

    return () => {
      isStale = true
    }
  }, [])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-3 -ml-3">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-normal">
                Your progress
              </h1>
              {progress ? (
                <Badge variant="secondary">
                  {progress.mode === "database"
                    ? "Database"
                    : "Demo, non-durable"}
                </Badge>
              ) : null}
            </div>
          </div>
          <Button asChild>
            <Link href="/practice">
              <GraduationCap className="h-4 w-4" />
              Practice
            </Link>
          </Button>
        </header>

        {isLoading ? (
          <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading progress
          </div>
        ) : error ? (
          <Card className="border-destructive/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-5 text-sm">
              <span className="text-destructive">{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadProgress}
              >
                <RotateCcw className="h-4 w-4" />
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : progress ? (
          <>
            <section
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
              aria-label="Progress totals"
            >
              {metricDefinitions.map(({ icon: Icon, key, label }) => (
                <Card key={key}>
                  <CardHeader className="gap-3 p-4">
                    <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">
                        {progress.summary[key]}
                      </p>
                      <CardTitle className="mt-1 text-sm font-medium text-muted-foreground">
                        {label}
                      </CardTitle>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </section>

            <section className="border-y py-5">
              <h2 className="text-sm font-medium">Topics practiced</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {progress.topics.length > 0 ? (
                  progress.topics.map((topic) => (
                    <Badge key={topic.id} variant="outline">
                      {topic.title}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">
                    No topics practiced yet.
                  </span>
                )}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Recent sessions</h2>
                <span className="text-xs text-muted-foreground">
                  Most recent 8
                </span>
              </div>
              {progress.recentSessions.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead>Topic</TableHead>
                        <TableHead className="text-right">Attempts</TableHead>
                        <TableHead className="text-right">Correct</TableHead>
                        <TableHead className="text-right">Hints</TableHead>
                        <TableHead className="text-right">Steps</TableHead>
                        <TableHead>Last active</TableHead>
                        <TableHead className="w-12">
                          <span className="sr-only">Open</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {progress.recentSessions.map((session) => (
                        <TableRow
                          key={`${session.questionId}-${session.lastSeenAt}`}
                        >
                          <TableCell className="min-w-52 font-medium">
                            {session.questionTitle}
                          </TableCell>
                          <TableCell className="min-w-40 text-muted-foreground">
                            {session.topicTitle}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {session.attemptCount}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {session.correctAttempts}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {session.hintsUsed}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {session.stepsRevealed}
                          </TableCell>
                          <TableCell className="min-w-32 text-muted-foreground">
                            {formatSessionDate(session.lastSeenAt)}
                          </TableCell>
                          <TableCell>
                            <Button asChild variant="ghost" size="icon">
                              <Link
                                href={`/practice?questionId=${encodeURIComponent(session.questionId)}`}
                                aria-label={`Open ${session.questionTitle}`}
                              >
                                <ArrowRight className="h-4 w-4" />
                              </Link>
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-4 rounded-md border border-dashed p-6">
                  <p className="text-sm text-muted-foreground">
                    No practice activity yet.
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/practice">
                      Start practicing
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              )}
            </section>
          </>
        ) : null}
      </section>
    </main>
  )
}

async function fetchStudentProgress() {
  const anonymousStudentId = getOrCreateAnonymousStudentId()
  const response = await fetch("/api/student/progress", {
    headers: { [ANONYMOUS_STUDENT_HEADER]: anonymousStudentId },
  })
  const payload = (await response.json().catch(() => ({}))) as ProgressPayload

  if (!response.ok || !payload.progress) {
    throw new Error(payload.error ?? "Student progress could not be loaded.")
  }

  return payload.progress
}

function formatSessionDate(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "Unknown"
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date)
}
