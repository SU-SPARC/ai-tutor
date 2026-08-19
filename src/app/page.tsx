import Link from "next/link"
import { ArrowRight, BarChart3, CheckCircle2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { getQuestionCounts, getTopics } from "@/lib/data/data-store"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const [topics, counts] = await Promise.all([getTopics(), getQuestionCounts()])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 pb-20 pt-16 md:pt-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex max-w-2xl flex-col gap-6">
            <div className="flex w-fit items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
              A smarter way to study statistics
            </div>
            <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight text-balance md:text-7xl">
              Build confidence, one problem at a time.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">
              Get step-by-step support for probability and statistics problems, with helpful hints when you need them and feedback that keeps you moving.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="cta" size="lg">
                <Link href="/practice">
                  Start practicing
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/topics">Explore the syllabus</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Designed for focused practice, not shortcuts.
            </p>
          </div>

          <Card className="overflow-hidden border-primary/15 bg-card shadow-xl shadow-primary/5">
            <CardContent className="flex flex-col gap-6 p-6 md:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Your study space</p>
                  <h2 className="mt-1 text-2xl font-semibold">Practice with purpose</h2>
                </div>
                <div className="rounded-lg bg-primary/10 p-3 text-primary">
                  <BarChart3 className="h-6 w-6" aria-hidden="true" />
                </div>
              </div>
              <div className="rounded-lg bg-muted/60 p-5">
                <p className="text-sm font-medium">What you can expect</p>
                <ul className="mt-4 flex flex-col gap-3 text-sm text-muted-foreground">
                  <li className="flex gap-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />Clear explanations, not just answers</li>
                  <li className="flex gap-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />Hints that meet you at your level</li>
                  <li className="flex gap-3"><CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />Progress you can return to anytime</li>
                </ul>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t pt-5">
                <div><p className="text-3xl font-semibold tabular-nums">{topics.length}</p><p className="text-sm text-muted-foreground">course topics</p></div>
                <div><p className="text-3xl font-semibold tabular-nums">{counts.total}</p><p className="text-sm text-muted-foreground">practice questions</p></div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 border-t pt-8 sm:grid-cols-3">
          {[
            ["Learn the method", "Work through the reasoning behind each solution."],
            ["Use hints wisely", "Get a nudge without losing the chance to think."],
            ["Track your growth", "See what is clicking and where to practice next."],
          ].map(([title, description]) => (
            <div key={title} className="flex flex-col gap-2">
              <h2 className="font-semibold">{title}</h2>
              <p className="text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
