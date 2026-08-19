import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, BookOpen, FolderOpen } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { getQuestionCounts, getTopics } from "@/lib/data/data-store"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Topics · Suffolk Probability & Statistics Tutor",
  description: "Browse probability and statistics topics and start practicing approved, original questions.",
}

function questionCountLabel(count: number) {
  return count === 1 ? "1 practice question" : `${count} practice questions`
}

export default async function TopicsPage() {
  const [topics, counts] = await Promise.all([getTopics(), getQuestionCounts()])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pb-20 pt-12">
        <header className="flex flex-col gap-5 border-b pb-8 md:flex-row md:items-end md:justify-between">
          <div className="flex max-w-2xl flex-col gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-primary"><BookOpen className="h-4 w-4" aria-hidden="true" />Course map</div>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Choose what to practice</h1>
            <p className="text-base leading-7 text-muted-foreground">Work through the syllabus in manageable pieces. Every question is original and professor-reviewed before it appears here.</p>
          </div>
          <div className="flex gap-6 text-sm"><div><p className="text-2xl font-semibold tabular-nums">{topics.length}</p><p className="text-muted-foreground">topics</p></div><div><p className="text-2xl font-semibold tabular-nums">{counts.total}</p><p className="text-muted-foreground">questions</p></div></div>
        </header>

        {topics.length === 0 ? <Card className="border-dashed"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FolderOpen className="h-4 w-4 text-primary" />No topics yet</CardTitle><CardDescription>Topics will appear here once approved content is available.</CardDescription></CardHeader></Card> : <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{topics.map((topic, index) => { const count = counts.byTopic[topic.id] ?? 0; return <Card key={topic.id} className="group flex h-full flex-col transition-shadow hover:shadow-lg hover:shadow-primary/5"><CardHeader className="flex-1 gap-4"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">{String(index + 1).padStart(2, "0")}</span><CardTitle className="text-lg">{topic.title}</CardTitle></div><Badge variant="outline">{topic.moduleRef}</Badge></div><CardDescription className="leading-6">{topic.description}</CardDescription></CardHeader><CardContent className="text-sm text-muted-foreground">{questionCountLabel(count)}</CardContent><CardFooter><Button asChild variant={count === 0 ? "outline" : "default"} className="w-full"><Link href={count === 0 ? `/topics/${topic.id}` : `/practice?topicId=${topic.id}`}>{count === 0 ? "View topic" : "Start practicing"}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button></CardFooter></Card> })}</div>}
      </section>
    </main>
  )
}
