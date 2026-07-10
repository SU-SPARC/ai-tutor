import type { Metadata } from "next"
import {
  BookLock,
  Layers,
  ShieldCheck,
} from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const metadata: Metadata = {
  title: "About · Suffolk Probability & Statistics Tutor",
  description:
    "How the controlled tutoring system layers approved content, original generated questions, retrieval, and a limited AI fallback.",
}

const CONTENT_ORDER = [
  "Professor- and course-approved content is served first.",
  "Original, pattern-derived generated questions are served second, only after professor review.",
  "Private course and book materials are used solely as private reference for topics, formulas, learning objectives, misconceptions, and abstract problem patterns.",
  "Retrieval over safe, approved content is used when deterministic help is not enough.",
  "A server-side LLM fallback is used only when necessary and within strict usage limits.",
]

const SAFEGUARDS = [
  "Course PDFs, textbooks, and professor notes stay private and server-side; they are never sent to the browser.",
  "Generated questions are marked needs_review and generated_unverified until a professor approves them.",
  "Only approved, public, trusted questions are shown to students.",
  "The app never copies or lightly paraphrases textbook questions, solutions, or examples.",
  "AI usage is capped per session and per day so students cannot make unlimited LLM calls.",
]

export default function AboutPage() {
  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            About this tutor
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            This is a controlled tutoring system for a college probability and
            statistics course — not an open-ended chatbot. It helps students
            practice topics step by step, receive graduated hints, understand
            mistakes, and learn from professor-approved or professor-reviewed
            material.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              How content is prioritized
            </CardTitle>
            <CardDescription>
              The tutor prefers the most trusted source available and only
              escalates when needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
              {CONTENT_ORDER.map((item, index) => (
                <li key={item} className="flex gap-3">
                  <span className="font-mono text-xs text-primary">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Content safety
            </CardTitle>
            <CardDescription>
              Copyright and privacy safeguards are built into the data model.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
              {SAFEGUARDS.map((item) => (
                <li key={item} className="flex gap-3">
                  <BookLock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
