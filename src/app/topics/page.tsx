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
import type { CourseTopic } from "@/lib/types"

export const dynamic = "force-dynamic"

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
  const countFor = (topicId: string) => counts.byTopic[topicId] ?? 0
  // Real availability decides the grouping: a topic is available as soon as
  // it has at least one published question. The rest of the syllabus stays
  // visible so students can see what is coming.
  const availableTopics = topics.filter((topic) => countFor(topic.id) > 0)
  const upcomingTopics = topics.filter((topic) => countFor(topic.id) === 0)

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
        <div className="flex max-w-2xl flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Topics
          </h1>
          <p className="text-base leading-7 text-muted-foreground">
            Pick a topic to start practicing. Every question is reviewed by your
            professor before it appears here.
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
                Topics will appear here once your professor makes practice
                questions available.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <section
              aria-labelledby="available-topics-heading"
              className="flex flex-col gap-4"
            >
              <div>
                <h2
                  id="available-topics-heading"
                  className="text-xl font-semibold tracking-tight"
                >
                  Available for this pilot
                </h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {availableTopics.length > 0
                    ? "Start with these topics. Each one has practice questions ready now."
                    : "Practice questions are being prepared. Check back soon."}
                </p>
              </div>
              {availableTopics.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {availableTopics.map((topic) => (
                    <AvailableTopicCard
                      key={topic.id}
                      count={countFor(topic.id)}
                      topic={topic}
                    />
                  ))}
                </div>
              ) : null}
            </section>

            {upcomingTopics.length > 0 ? (
              <section
                aria-labelledby="upcoming-topics-heading"
                className="flex flex-col gap-4"
              >
                <div>
                  <h2
                    id="upcoming-topics-heading"
                    className="text-xl font-semibold tracking-tight"
                  >
                    More topics coming soon
                  </h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    The rest of the syllabus opens as its practice questions
                    are reviewed. You can read what each topic covers now.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {upcomingTopics.map((topic) => (
                    <UpcomingTopicCard key={topic.id} topic={topic} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        )}
      </section>
    </main>
  )
}

function AvailableTopicCard({
  count,
  topic,
}: {
  count: number
  topic: CourseTopic
}) {
  return (
    <Card className="flex h-full flex-col">
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
        <Button asChild className="w-full">
          <Link href={`/practice?topicId=${topic.id}`}>
            Start practicing
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function UpcomingTopicCard({ topic }: { topic: CourseTopic }) {
  return (
    <Card className="flex h-full flex-col border-dashed bg-muted/30 shadow-none">
      <CardHeader className="flex-1">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base font-medium text-muted-foreground">
            {topic.title}
          </CardTitle>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge variant="outline">{topic.moduleRef}</Badge>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
        </div>
        <CardDescription className="leading-6">
          {topic.description}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button asChild variant="ghost" size="sm" className="-ml-3">
          <Link href={`/topics/${topic.id}`}>
            About this topic
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
