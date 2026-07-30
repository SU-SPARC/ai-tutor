import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, FolderOpen } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getQuestionCounts, getTopics } from "@/lib/data/data-store"

export const metadata: Metadata = {
  title: "Topics · Suffolk Probability & Statistics Tutor",
  description:
    "Browse probability and statistics topics and start practicing approved, original questions.",
}

function questionCountLabel(count: number) {
  if (count === 1) {
    return "1 practice question"
  }
  return `${count} practice questions`
}

export default async function TopicsPage() {
  const [topics, counts] = await Promise.all([getTopics(), getQuestionCounts()])

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12">
        <div className="flex max-w-2xl flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Topics
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Pick a topic to see its approved practice questions. Every question
            is original and professor-reviewed before it appears here.
          </p>
        </div>

        {topics.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FolderOpen className="h-4 w-4 text-primary" />
                No topics yet
              </CardTitle>
              <CardDescription>
                Topics will appear here once approved content is available.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {topics.map((topic) => {
              const count = counts.byTopic[topic.id] ?? 0
              return (
                <Card key={topic.id} className="flex h-full flex-col">
                  <CardHeader className="flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-lg">{topic.title}</CardTitle>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <Badge variant="outline">{topic.moduleRef}</Badge>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                    </div>
                    <CardDescription className="leading-6">
                      {topic.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {questionCountLabel(count)}
                  </CardContent>
                  <CardFooter>
                    <Button
                      asChild
                      variant={count === 0 ? "outline" : "default"}
                      className="w-full"
                    >
                      <Link
                        href={
                          count === 0
                            ? `/topics/${topic.id}`
                            : `/practice?topicId=${topic.id}`
                        }
                      >
                        {count === 0 ? "View topic" : "Start"}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
