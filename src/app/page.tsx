import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { getQuestionCounts, getTopics } from "@/lib/data/data-store"

export default async function HomePage() {
  const [topics, counts] = await Promise.all([getTopics(), getQuestionCounts()])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-20">
        <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
          Probability &amp; Statistics AI Tutor
        </h1>
        <p className="text-lg leading-7 text-muted-foreground">
          Practice probability and statistics problems step by step, with hints
          and instant feedback.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/topics">
              Browse topics
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/practice">Start practicing</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {topics.length} topics · {counts.total} practice questions ready now.
        </p>
      </section>
    </main>
  )
}
