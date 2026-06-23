"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  Lightbulb,
  ListChecks,
  Loader2,
  RotateCcw,
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
import { Textarea } from "@/components/ui/textarea"
import type {
  CourseTopic,
  PracticeQuestion,
  TutorMode,
  TutorResponse,
} from "@/lib/types"
import { cn } from "@/lib/utils"

type PracticeWorkspaceProps = {
  questions: PracticeQuestion[]
  topics: CourseTopic[]
}

const sessionId = `demo-${Math.random().toString(36).slice(2)}`

export function PracticeWorkspace({
  questions,
  topics,
}: PracticeWorkspaceProps) {
  const [selectedTopicId, setSelectedTopicId] = useState(topics[0]?.id ?? "")
  const topicQuestions = useMemo(
    () => questions.filter((question) => question.topicId === selectedTopicId),
    [questions, selectedTopicId],
  )
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    topicQuestions[0]?.id ?? questions[0]?.id ?? "",
  )
  const selectedQuestion =
    questions.find((question) => question.id === selectedQuestionId) ??
    topicQuestions[0] ??
    questions[0]
  const selectedTopic =
    topics.find((topic) => topic.id === selectedQuestion?.topicId) ?? topics[0]
  const [answer, setAnswer] = useState("")
  const [response, setResponse] = useState<TutorResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  function chooseTopic(topicId: string) {
    const nextQuestion = questions.find((question) => question.topicId === topicId)
    setSelectedTopicId(topicId)
    setSelectedQuestionId(nextQuestion?.id ?? "")
    setAnswer("")
    setResponse(null)
  }

  async function requestTutor(mode: TutorMode) {
    if (!selectedQuestion) {
      return
    }

    setIsLoading(true)
    setResponse(null)

    const result = await fetch("/api/tutor/respond", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        answer,
        mode,
        questionId: selectedQuestion.id,
        sessionId,
        topicId: selectedQuestion.topicId,
      }),
    })

    const payload = (await result.json()) as TutorResponse
    setResponse(payload)
    setIsLoading(false)
  }

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <Button asChild variant="ghost" size="sm" className="w-fit px-0">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Topics</CardTitle>
              <CardDescription>Choose the course pattern to practice.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {topics.map((topic) => (
                <Button
                  key={topic.id}
                  type="button"
                  variant={topic.id === selectedTopicId ? "default" : "secondary"}
                  className="h-auto justify-start whitespace-normal py-3 text-left"
                  onClick={() => chooseTopic(topic.id)}
                >
                  {topic.title}
                </Button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Questions</CardTitle>
              <CardDescription>Approved demo items only.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {topicQuestions.map((question) => (
                <Button
                  key={question.id}
                  type="button"
                  variant={
                    question.id === selectedQuestionId ? "outline" : "ghost"
                  }
                  className="h-auto justify-start whitespace-normal py-3 text-left"
                  onClick={() => {
                    setSelectedQuestionId(question.id)
                    setAnswer("")
                    setResponse(null)
                  }}
                >
                  {question.title}
                </Button>
              ))}
            </CardContent>
          </Card>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 border-b pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <Badge variant="secondary" className="mb-3">
                Student practice
              </Badge>
              <h1 className="text-3xl font-semibold tracking-normal">
                Step-by-step tutoring
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Rule-based checks and stored guidance are used before any
                retrieval or LLM fallback.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setAnswer("")
                setResponse(null)
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>

          {selectedQuestion ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{selectedTopic?.title}</Badge>
                    <Badge variant="outline">{selectedQuestion.difficulty}</Badge>
                  </div>
                  <CardTitle>{selectedQuestion.title}</CardTitle>
                  <CardDescription className="text-base leading-7 text-foreground">
                    {selectedQuestion.prompt}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <Textarea
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="Enter your answer. Fractions, decimals, and short explanations are accepted in demo mode."
                    rows={5}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      disabled={isLoading}
                      onClick={() => requestTutor("check")}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Check
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isLoading}
                      onClick={() => requestTutor("hint")}
                    >
                      <Lightbulb className="h-4 w-4" />
                      Hint
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isLoading}
                      onClick={() => requestTutor("solution")}
                    >
                      <ListChecks className="h-4 w-4" />
                      Steps
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {response ? (
                <TutorResponsePanel response={response} />
              ) : (
                <Card className="border-dashed">
                  <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
                    <BookOpenCheck className="h-4 w-4" />
                    Tutor feedback will appear here after you ask for a check,
                    hint, or solution step.
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-sm text-muted-foreground">
                No approved demo questions are available for this topic yet.
              </CardContent>
            </Card>
          )}
        </div>
      </section>
    </main>
  )
}

function TutorResponsePanel({ response }: { response: TutorResponse }) {
  return (
    <Card
      className={cn(
        response.verdict === "correct" && "border-success/70",
        response.verdict === "blocked" && "border-destructive/70",
      )}
    >
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={
              response.verdict === "correct"
                ? "success"
                : response.verdict === "blocked"
                  ? "destructive"
                  : "secondary"
            }
          >
            {response.verdict}
          </Badge>
          <Badge variant="outline">source: {response.source}</Badge>
        </div>
        <CardTitle className="text-lg">{response.message}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm leading-6">
        {response.hints.length > 0 ? (
          <section>
            <h2 className="mb-2 font-medium">Hints</h2>
            <ul className="list-inside list-disc text-muted-foreground">
              {response.hints.map((hint) => (
                <li key={hint}>{hint}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {response.steps.length > 0 ? (
          <section>
            <h2 className="mb-2 font-medium">Solution steps</h2>
            <ol className="list-inside list-decimal text-muted-foreground">
              {response.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ) : null}

        {response.misconceptions.length > 0 ? (
          <section>
            <h2 className="mb-2 font-medium">Likely misconception</h2>
            <ul className="list-inside list-disc text-muted-foreground">
              {response.misconceptions.map((misconception) => (
                <li key={misconception}>{misconception}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {response.retrievedContext.length > 0 ? (
          <section>
            <h2 className="mb-2 font-medium">Retrieved course pattern</h2>
            <ul className="list-inside list-disc text-muted-foreground">
              {response.retrievedContext.map((context) => (
                <li key={context.id}>{context.title}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  )
}
