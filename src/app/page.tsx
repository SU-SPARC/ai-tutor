import Link from "next/link"
import {
  ArrowRight,
  BookOpenCheck,
  ListChecks,
  Lightbulb,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getQuestionCounts, getTopics } from "@/lib/data/data-store"

const FEATURES = [
  {
    icon: BookOpenCheck,
    title: "Course- and book-guided practice",
    description:
      "Private course and textbook material is used only as reference for topics, formulas, learning objectives, and problem patterns. It never appears in the app.",
  },
  {
    icon: Sparkles,
    title: "Original generated questions",
    description:
      "Practice items are original and pattern-derived, then held for professor review before any student sees them. Nothing is copied or paraphrased from the book.",
  },
  {
    icon: ListChecks,
    title: "Step-by-step hints",
    description:
      "Work a problem gradually. Hints and solution steps reveal one at a time so you build the reasoning yourself instead of jumping to the answer.",
  },
  {
    icon: Target,
    title: "Misconception-aware feedback",
    description:
      "When an answer matches a common mistake, the tutor names the misconception and points you back to the right approach.",
  },
  {
    icon: ShieldCheck,
    title: "Controlled AI fallback",
    description:
      "A deterministic rule-based tutor handles most work. An LLM is used only when needed, server-side, and inside strict per-session and daily usage limits.",
  },
  {
    icon: Lightbulb,
    title: "Approved content first",
    description:
      "Professor- and course-approved content is served first, original generated questions second, with retrieval and AI held in reserve.",
  },
]

export default async function HomePage() {
  const [topics, counts] = await Promise.all([getTopics(), getQuestionCounts()])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <div className="flex max-w-3xl flex-col gap-5">
          <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
            Probability &amp; Statistics AI Tutor
          </h1>
          <p className="text-lg leading-7 text-muted-foreground">
            A controlled tutoring system for a college probability and
            statistics course. Practice topics step by step, get graduated
            hints, understand your mistakes, and learn from professor-reviewed,
            original material.
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
            {topics.length} topics · {counts.total} approved practice questions
            available now — no AI call required.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title} className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <feature.icon className="h-4 w-4 text-primary" />
                  {feature.title}
                </CardTitle>
                <CardDescription className="leading-6">
                  {feature.description}
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>This is not just a chatbot</CardTitle>
            <CardDescription>
              The tutor is a layered system, not an open-ended assistant.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm leading-6 text-muted-foreground md:grid-cols-3">
            <p>
              <span className="font-medium text-foreground">Learn:</span> pick a
              topic and work approved, original questions with deterministic
              answer checking.
            </p>
            <p>
              <span className="font-medium text-foreground">Practice:</span>{" "}
              reveal hints and solution steps one at a time and get feedback
              tuned to common misconceptions.
            </p>
            <p>
              <span className="font-medium text-foreground">Safeguards:</span>{" "}
              private course materials stay server-side and unapproved drafts are
              never shown to students.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
