"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  BookOpenCheck,
  ChartNoAxesColumn,
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  ListChecks,
  Loader2,
  RotateCcw,
  Sparkles,
} from "lucide-react"

import { MathText } from "@/components/math/math-renderer"
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
import {
  anonymousTutorSessionStorageKey,
  getOrCreateAnonymousStudentId,
} from "@/lib/auth/anonymous-student"
import type {
  CourseTopic,
  PracticeQuestion,
  TutorMode,
  TutorResponse,
  TutorSessionRecord,
} from "@/lib/types"
import { cn } from "@/lib/utils"

type PracticeWorkspaceProps = {
  initialQuestionId?: string
  maxTutorInputChars: number
  questions: PracticeQuestion[]
  topics: CourseTopic[]
}

type TutorTranscriptItem = {
  content?: string
  id: string
  mode: TutorMode | "ai"
  response?: TutorResponse
  role: "student" | "tutor"
}

type TutorSessionPayload = {
  error?: string
  session?: TutorSessionRecord
}

export function PracticeWorkspace({
  initialQuestionId,
  maxTutorInputChars,
  questions,
  topics,
}: PracticeWorkspaceProps) {
  const initialQuestion = questions.find(
    (question) => question.id === initialQuestionId,
  )
  const initialTopicId = initialQuestion?.topicId ?? topics[0]?.id ?? ""
  const [selectedTopicId, setSelectedTopicId] = useState(initialTopicId)
  const topicQuestions = useMemo(
    () => questions.filter((question) => question.topicId === selectedTopicId),
    [questions, selectedTopicId],
  )
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    initialQuestion?.id ??
      questions.find((question) => question.topicId === initialTopicId)?.id ??
      questions[0]?.id ??
      "",
  )
  const selectedQuestion =
    questions.find((question) => question.id === selectedQuestionId) ??
    topicQuestions[0] ??
    questions[0]
  const selectedTopic =
    topics.find((topic) => topic.id === selectedQuestion?.topicId) ?? topics[0]
  const [answer, setAnswer] = useState("")
  const [activeMode, setActiveMode] = useState<TutorMode | "ai" | null>(null)
  const [isSessionLoading, setIsSessionLoading] = useState(false)
  const [latestResponse, setLatestResponse] = useState<TutorResponse | null>(
    null,
  )
  const [session, setSession] = useState<TutorSessionRecord | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TutorTranscriptItem[]>([])
  const selectedQuestionIdForSession = selectedQuestion?.id
  const isTutorBusy = activeMode !== null || isSessionLoading
  const attemptsMade = session?.attempts.length ?? 0
  const hintsUsed = Math.max(
    session?.revealedHints ?? 0,
    latestResponse?.progress?.hintsRevealed ?? 0,
  )
  const stepsRevealed = Math.max(
    session?.revealedSteps ?? 0,
    latestResponse?.progress?.stepsRevealed ?? 0,
  )
  const limitedAiInputTooLong = answer.trim().length > maxTutorInputChars
  const aiExplanationsRemaining =
    latestResponse?.usage.llmFallbacksRemaining ??
    session?.llmFallbacksRemaining

  useEffect(() => {
    let isStale = false

    async function loadSession() {
      setAnswer("")
      setLatestResponse(null)
      setSession(null)
      setSessionError(null)
      setTranscript([])

      if (!selectedQuestionIdForSession) {
        setIsSessionLoading(false)
        return
      }

      setIsSessionLoading(true)

      try {
        const nextSession = await createOrResumeTutorSession(
          selectedQuestionIdForSession,
        )

        if (!isStale) {
          setSession(nextSession)
        }
      } catch (error) {
        if (!isStale) {
          setSessionError(errorMessageFor(error))
        }
      } finally {
        if (!isStale) {
          setIsSessionLoading(false)
        }
      }
    }

    void loadSession()

    return () => {
      isStale = true
    }
  }, [selectedQuestionIdForSession])

  function chooseTopic(topicId: string) {
    const nextQuestion = questions.find(
      (question) => question.topicId === topicId,
    )
    setSelectedTopicId(topicId)
    setSelectedQuestionId(nextQuestion?.id ?? "")
    setAnswer("")
    setLatestResponse(null)
    setTranscript([])
  }

  async function requestTutor(mode: TutorMode) {
    if (!selectedQuestion || !session || activeMode) {
      return
    }

    setActiveMode(mode)
    setSessionError(null)
    setTranscript((items) => [
      ...items,
      {
        content: studentMessageFor(mode, answer),
        id: createClientId("student-message"),
        mode,
        role: "student",
      },
    ])

    try {
      let nextSession = session

      if (mode === "check") {
        nextSession = await postTutorSessionEvent(session.id, "attempt", {
          answer,
        })
      } else if (mode === "hint") {
        nextSession = await postTutorSessionEvent(session.id, "hint")
      } else {
        nextSession = await postTutorSessionEvent(session.id, "step")
      }

      setSession(nextSession)

      const tutorResponse = await requestTutorResponse({
        answer,
        mode,
        questionId: selectedQuestion.id,
        sessionId: nextSession.id,
        topicId: selectedQuestion.topicId,
      })

      setLatestResponse(tutorResponse)
      setTranscript((items) => [
        ...items,
        {
          id: createClientId("tutor-message"),
          mode,
          response: tutorResponse,
          role: "tutor",
        },
      ])
    } catch (error) {
      setSessionError(errorMessageFor(error))
    } finally {
      setActiveMode(null)
    }
  }

  async function requestLimitedAiHelp() {
    if (
      !selectedQuestion ||
      !session ||
      activeMode ||
      !answer.trim() ||
      limitedAiInputTooLong
    ) {
      return
    }

    setActiveMode("ai")
    setSessionError(null)
    setTranscript((items) => [
      ...items,
      {
        content: "Requested limited AI guidance after course help.",
        id: createClientId("student-message"),
        mode: "ai",
        role: "student",
      },
    ])

    try {
      const tutorResponse = await requestTutorResponse({
        allowLlmFallback: true,
        answer,
        mode: "check",
        questionId: selectedQuestion.id,
        sessionId: session.id,
        topicId: selectedQuestion.topicId,
      })
      setLatestResponse(tutorResponse)
      setTranscript((items) => [
        ...items,
        {
          id: createClientId("tutor-message"),
          mode: "ai",
          response: tutorResponse,
          role: "tutor",
        },
      ])
    } catch (error) {
      setSessionError(errorMessageFor(error))
    } finally {
      setActiveMode(null)
    }
  }

  async function restartTutorSession() {
    if (!selectedQuestion) {
      return
    }

    setIsSessionLoading(true)
    setSessionError(null)

    try {
      const anonymousStudentId = getOrCreateAnonymousStudentId()
      const nextSession = await createTutorSession(
        selectedQuestion.id,
        anonymousStudentId,
      )
      window.localStorage.setItem(
        anonymousTutorSessionStorageKey(
          anonymousStudentId,
          selectedQuestion.id,
        ),
        nextSession.id,
      )
      setAnswer("")
      setLatestResponse(null)
      setSession(nextSession)
      setTranscript([])
    } catch (error) {
      setSessionError(errorMessageFor(error))
    } finally {
      setIsSessionLoading(false)
    }
  }

  return (
    <main className="min-h-svh bg-background">
      <section className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost" size="sm" className="px-0">
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/dashboard">
                <ChartNoAxesColumn className="h-4 w-4" />
                Progress
              </Link>
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Topics</CardTitle>
              <CardDescription>
                Choose the course pattern to practice.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {topics.map((topic) => (
                <Button
                  key={topic.id}
                  type="button"
                  variant={
                    topic.id === selectedTopicId ? "default" : "secondary"
                  }
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
                    setLatestResponse(null)
                    setTranscript([])
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
              disabled={isTutorBusy || !selectedQuestion}
              onClick={() => {
                void restartTutorSession()
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </Button>
          </div>

          {sessionError ? (
            <Card className="border-destructive/60">
              <CardContent className="py-4 text-sm text-destructive">
                {sessionError}
              </CardContent>
            </Card>
          ) : null}

          {selectedQuestion ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{selectedTopic?.title}</Badge>
                    <Badge variant="outline">
                      {selectedQuestion.difficulty}
                    </Badge>
                    <Badge variant="secondary">
                      {isSessionLoading
                        ? "Session loading"
                        : session
                          ? "Session active"
                          : "Session unavailable"}
                    </Badge>
                  </div>
                  <CardTitle>{selectedQuestion.title}</CardTitle>
                  <CardDescription className="text-base leading-7 text-foreground">
                    <MathText>{selectedQuestion.prompt}</MathText>
                  </CardDescription>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Badge variant="outline">Attempts {attemptsMade}</Badge>
                    <Badge variant="outline">Hints used {hintsUsed}</Badge>
                    <Badge variant="outline">
                      Steps revealed {stepsRevealed}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <Textarea
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder="Enter your answer. Fractions, decimals, and short explanations are accepted in demo mode."
                    rows={5}
                    aria-describedby="answer-character-count"
                  />
                  <div
                    id="answer-character-count"
                    className={cn(
                      "text-right text-xs text-muted-foreground",
                      limitedAiInputTooLong && "text-destructive",
                    )}
                  >
                    {limitedAiInputTooLong
                      ? `${answer.trim().length - maxTutorInputChars} characters over the limited AI guidance maximum`
                      : `${maxTutorInputChars - answer.trim().length} limited AI characters remaining`}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      disabled={isTutorBusy || !session}
                      onClick={() => requestTutor("check")}
                    >
                      {activeMode === "check" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Submit
                    </Button>
                    {latestResponse?.usage.llmFallbackEligible ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          isTutorBusy ||
                          !session ||
                          !answer.trim() ||
                          limitedAiInputTooLong
                        }
                        onClick={requestLimitedAiHelp}
                      >
                        {activeMode === "ai" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        Limited AI Guidance
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={isTutorBusy || !session}
                      onClick={() => requestTutor("hint")}
                    >
                      {activeMode === "hint" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Lightbulb className="h-4 w-4" />
                      )}
                      Get Hint
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isTutorBusy || !session}
                      onClick={() => requestTutor("solution")}
                    >
                      {activeMode === "solution" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ListChecks className="h-4 w-4" />
                      )}
                      Next Step
                    </Button>
                  </div>
                  {aiExplanationsRemaining !== undefined ? (
                    <div
                      className={cn(
                        "flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground",
                        aiExplanationsRemaining === 0 && "text-destructive",
                      )}
                      aria-live="polite"
                    >
                      <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        AI explanations left for this problem:{" "}
                        <strong className="font-semibold text-foreground">
                          {aiExplanationsRemaining}
                        </strong>
                      </span>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              {transcript.length > 0 ? (
                <section className="flex flex-col gap-3" aria-live="polite">
                  {transcript.map((item) =>
                    item.role === "student" ? (
                      <StudentMessagePanel key={item.id} item={item} />
                    ) : item.response ? (
                      <TutorResponsePanel
                        key={item.id}
                        response={item.response}
                      />
                    ) : null,
                  )}
                </section>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
                    <BookOpenCheck className="h-4 w-4" />
                    Tutor feedback will appear here after you submit an answer,
                    ask for a hint, or reveal a step.
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

function StudentMessagePanel({ item }: { item: TutorTranscriptItem }) {
  return (
    <Card className="ml-auto w-full border-primary/20 bg-primary/5 md:max-w-[80%]">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">student</Badge>
          <Badge variant="secondary">{modeLabel(item.mode)}</Badge>
        </div>
      </CardHeader>
      <CardContent className="whitespace-pre-wrap text-sm leading-6">
        {item.content}
      </CardContent>
    </Card>
  )
}

function TutorResponsePanel({ response }: { response: TutorResponse }) {
  const usageStatus = responseUsageStatusText(response)
  const limitGuidance = aiLimitGuidanceText(
    response.usage.limitReason,
    response.usage.llmFallbacksRemaining,
  )
  const UsageIcon =
    response.source === "llm" || response.source === "cache"
      ? Sparkles
      : BookOpenCheck

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
          {usageStatus ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <UsageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {usageStatus}
            </span>
          ) : null}
        </div>
        <CardTitle className="text-lg">
          <MathText>{response.message}</MathText>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm leading-6">
        {limitGuidance ? (
          <div className="flex gap-2 rounded-md border border-border bg-muted/50 p-3 text-muted-foreground">
            <CircleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-foreground"
              aria-hidden="true"
            />
            <p>{limitGuidance}</p>
          </div>
        ) : null}

        {response.hints.length > 0 ? (
          <section>
            <h2 className="mb-2 font-medium">Hints</h2>
            <ul className="list-inside list-disc text-muted-foreground">
              {response.hints.map((hint) => (
                <li key={hint}>
                  <MathText>{hint}</MathText>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {response.steps.length > 0 ? (
          <section>
            <h2 className="mb-2 font-medium">Solution steps</h2>
            <ol className="list-inside list-decimal text-muted-foreground">
              {response.steps.map((step) => (
                <li key={step}>
                  <MathText>{step}</MathText>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {response.misconceptions.length > 0 ? (
          <section className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <h2 className="mb-2 font-medium text-destructive">
              Misconception to check
            </h2>
            <ul className="list-inside list-disc text-muted-foreground">
              {response.misconceptions.map((misconception, index) => (
                <li key={`${misconception}-${index}`}>{misconception}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {shouldShowRetrievedContext(response) ? (
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

async function createOrResumeTutorSession(questionId: string) {
  const anonymousStudentId = getOrCreateAnonymousStudentId()
  const storedSessionId = window.localStorage.getItem(
    anonymousTutorSessionStorageKey(anonymousStudentId, questionId),
  )

  if (storedSessionId) {
    try {
      const session = await fetchTutorSession(storedSessionId)

      if (
        session.questionId === questionId &&
        session.anonymousStudentId === anonymousStudentId
      ) {
        return session
      }
    } catch {
      window.localStorage.removeItem(
        anonymousTutorSessionStorageKey(anonymousStudentId, questionId),
      )
    }
  }

  const session = await createTutorSession(questionId, anonymousStudentId)
  window.localStorage.setItem(
    anonymousTutorSessionStorageKey(anonymousStudentId, questionId),
    session.id,
  )
  return session
}

async function createTutorSession(
  questionId: string,
  anonymousStudentId: string,
) {
  const result = await fetch("/api/tutor/session", {
    body: JSON.stringify({
      anonymousStudentId,
      questionId,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })

  return readTutorSessionPayload(result)
}

async function fetchTutorSession(sessionId: string) {
  const result = await fetch(`/api/tutor/session/${sessionId}`)
  return readTutorSessionPayload(result)
}

async function postTutorSessionEvent(
  sessionId: string,
  event: "attempt" | "hint" | "step",
  body?: Record<string, unknown>,
) {
  const result = await fetch(`/api/tutor/session/${sessionId}/${event}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: body
      ? {
          "Content-Type": "application/json",
        }
      : undefined,
    method: "POST",
  })

  return readTutorSessionPayload(result)
}

async function requestTutorResponse(input: {
  allowLlmFallback?: boolean
  answer: string
  mode: TutorMode
  questionId: string
  sessionId: string
  topicId: string
}) {
  const result = await fetch("/api/tutor/respond", {
    body: JSON.stringify(input),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
  const payload = (await result
    .json()
    .catch(() => ({}))) as Partial<TutorResponse> & {
    error?: string
  }

  if (!result.ok || !payload.verdict) {
    throw new Error(payload.error ?? "Tutor response request failed.")
  }

  return payload as TutorResponse
}

async function readTutorSessionPayload(result: Response) {
  const payload = (await result.json().catch(() => ({}))) as TutorSessionPayload

  if (!result.ok || !payload.session) {
    throw new Error(payload.error ?? "Tutor session request failed.")
  }

  return payload.session
}

function studentMessageFor(mode: TutorMode, answer: string) {
  if (mode === "check") {
    return answer.trim() || "Submitted a blank answer."
  }

  if (mode === "hint") {
    return "Requested a hint."
  }

  return "Requested the next step."
}

function modeLabel(mode: TutorMode | "ai") {
  if (mode === "check") {
    return "answer"
  }

  if (mode === "hint") {
    return "hint"
  }

  if (mode === "solution") {
    return "step"
  }

  return "limited AI"
}

export function responseUsageStatusText(
  response: Pick<TutorResponse, "responseLabel" | "source">,
) {
  if (
    response.source === "llm" ||
    response.source === "cache" ||
    response.responseLabel === "general_ai_help"
  ) {
    return "Using AI fallback"
  }

  if (response.responseLabel === "generated_approved_content") {
    return "Using approved generated content"
  }

  if (response.responseLabel === "private_reference_grounded_explanation") {
    return "Using private reference grounded explanation"
  }

  if (response.responseLabel === "approved_course_content") {
    return "Using saved course content"
  }

  return undefined
}

export function aiLimitGuidanceText(
  reason: TutorResponse["usage"]["limitReason"],
  remaining: number,
) {
  if (reason === "input_too_long") {
    return "Ask a shorter question for AI help. Hints and steps still work, and you can continue with your saved solution steps."
  }

  if (reason && reason !== "llm_not_eligible") {
    return "AI help is temporarily unavailable. Hints and steps still work, and you can continue with your saved solution steps."
  }

  if (remaining === 0) {
    return "You have used the AI explanations for this problem. Hints and steps still work, and you can continue with your saved solution steps."
  }

  return undefined
}

export function shouldShowRetrievedContext(
  response: Pick<TutorResponse, "responseLabel" | "retrievedContext">,
) {
  return (
    response.retrievedContext.length > 0 &&
    response.responseLabel !== "private_reference_grounded_explanation"
  )
}

function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

function errorMessageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The tutor session could not be updated."
}
