import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ArrowRight, Inbox } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { MathText } from "@/components/math/math-renderer"
import { listQuestionsByTopic, getTopics } from "@/lib/data/data-store"
import {
  difficultyBadgeVariant,
  difficultyLabel,
  sourceLabel,
} from "@/lib/labels"

type TopicPageProps = {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({
  params,
}: TopicPageProps): Promise<Metadata> {
  const { slug } = await params
  const topic = (await getTopics()).find((item) => item.id === slug)
  if (!topic) {
    return { title: "Topic not found" }
  }
  return {
    title: `${topic.title} · Suffolk Probability & Statistics Tutor`,
    description: topic.description,
  }
}

export default async function TopicDetailPage({ params }: TopicPageProps) {
  const { slug } = await params
  const topics = await getTopics()
  const topic = topics.find((item) => item.id === slug)

  if (!topic) {
    notFound()
  }

  const questions = await listQuestionsByTopic(slug)

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12">
        <div className="flex flex-col gap-3">
          <Button asChild variant="ghost" size="sm" className="w-fit px-0">
            <Link href="/topics">
              <ArrowLeft className="h-4 w-4" />
              All topics
            </Link>
          </Button>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            {topic.title}
          </h1>
          <p className="max-w-2xl text-base leading-7 text-muted-foreground">
            {topic.description}
          </p>
          <p className="text-sm text-muted-foreground">
            {questions.length === 0
              ? "No approved questions yet."
              : `${questions.length} approved question${questions.length === 1 ? "" : "s"}.`}
          </p>
        </div>

        {questions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Inbox className="h-4 w-4 text-primary" />
                Nothing to practice here yet
              </CardTitle>
              <CardDescription>
                This topic has no professor-approved questions available right
                now. Check back soon or explore another topic.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline">
                <Link href="/topics">Browse other topics</Link>
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {questions.map((question) => (
              <Card key={question.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={difficultyBadgeVariant(question.difficulty)}>
                      {difficultyLabel(question.difficulty)}
                    </Badge>
                    <Badge variant="outline">{sourceLabel(question.source)}</Badge>
                    <Badge variant="outline">{topic.title}</Badge>
                  </div>
                  <CardTitle className="mt-2 text-lg">{question.title}</CardTitle>
                  <CardDescription className="line-clamp-3 leading-6">
                    <MathText>{question.prompt}</MathText>
                  </CardDescription>
                </CardHeader>
                <CardFooter className="mt-auto">
                  <Button asChild>
                    <Link href={`/practice/${question.id}`}>
                      Start practice
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
