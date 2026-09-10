import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { currentAuthenticatedUser } from "@/lib/auth/authorization"
import { getQuestionCounts, getTopics } from "@/lib/data/data-store"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const [topics, counts, isSignedIn] = await Promise.all([
    getTopics(),
    getQuestionCounts(),
    currentAuthenticatedUser()
      .then((principal) => Boolean(principal))
      // Header decoration must not make the public landing page unavailable
      // when identity storage is temporarily unreachable.
      .catch(() => false),
  ])
  const topicsWithQuestions = topics.filter(
    (topic) => (counts.byTopic[topic.id] ?? 0) > 0,
  ).length

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-16 sm:py-20">
        <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
          Probability &amp;{" "}
          <span className="brand-gradient-text">Statistics</span> AI Tutor
        </h1>
        <p className="text-lg leading-7 text-muted-foreground">
          Practice probability and statistics problems step by step, with hints
          and instant feedback that follow your course.
        </p>
        <div className="flex flex-wrap gap-3">
          {/* The accent green marks the single highest-intent action. */}
          <Button asChild variant="cta" size="lg">
            <Link href={isSignedIn ? "/dashboard" : "/practice"}>
              {isSignedIn ? "Continue practicing" : "Start practicing"}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/topics">Browse topics</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {counts.total} practice question{counts.total === 1 ? "" : "s"} across{" "}
          {topicsWithQuestions} topic{topicsWithQuestions === 1 ? "" : "s"}{" "}
          ready now.
        </p>
      </section>
    </main>
  )
}
