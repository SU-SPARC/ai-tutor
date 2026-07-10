import Link from "next/link"
import {
  ArrowRight,
  BookOpenCheck,
  ChartNoAxesColumn,
  GraduationCap,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  getApprovedQuestions,
  getReviewQueue,
  getTopics,
} from "@/lib/data/data-store"

export default async function HomePage() {
  const [topics, questions, reviewQueue] = await Promise.all([
    getTopics(),
    getApprovedQuestions(),
    getReviewQueue(),
  ])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <div className="flex flex-col gap-5 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-3">
              Demo mode uses seeded public sample content
            </Badge>
            <h1 className="text-3xl font-semibold tracking-normal md:text-4xl">
              Suffolk AI Probability and Statistics Tutor
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              A server-centered tutor shell that serves approved course patterns
              first, retrieves trusted examples second, and only falls back to
              an LLM when policy and quota allow it.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/practice">
                <GraduationCap className="h-4 w-4" />
                Practice
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">
                <ChartNoAxesColumn className="h-4 w-4" />
                Progress
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/professor">
                <ShieldCheck className="h-4 w-4" />
                Professor review
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpenCheck className="h-4 w-4 text-primary" />
                Structured base
              </CardTitle>
              <CardDescription>
                {topics.length} topics and {questions.length} approved demo
                questions are available without any LLM call.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Review queue
              </CardTitle>
              <CardDescription>
                {reviewQueue.length} generated draft questions are staged for
                lightweight professor approval.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Token controls
              </CardTitle>
              <CardDescription>
                Input caps, session limits, retrieval-first behavior, and
                server-only fallback calls are wired into the API layer.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recommended build path</CardTitle>
            <CardDescription>
              The first implementation keeps the app useful in demo mode while
              leaving private textbook ingestion and durable storage for the
              next step.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground md:grid-cols-3">
            <p>
              Students can work through approved probability/statistics
              questions with deterministic checks, hints, steps, and
              misconception feedback.
            </p>
            <p>
              Professors can inspect generated drafts and approve or reject them
              through a token-protected route once an environment token is set.
            </p>
            <p>
              The content model separates approved student material from draft
              generated material, matching the future database boundary.
            </p>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button asChild variant="ghost">
            <Link href="/practice">
              Start a demo session
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  )
}
