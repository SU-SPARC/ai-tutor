"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ChartNoAxesColumn,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Lightbulb,
  Loader2,
  RotateCcw,
  Send,
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
  initialTopicId?: string
  questions: PracticeQuestion[]
  topics: CourseTopic[]
}

type ChatMessage = {
  id: string
  note?: string
  role: "student" | "tutor"
  stepLabel?: string
  text: string
  tone?: "correct" | "incorrect" | "neutral"
}

type TutorSessionPayload = {
  error?: string
  session?: TutorSessionRecord
}

export function PracticeWorkspace({
  initialQuestionId,
  initialTopicId,
  questions,
  topics,
}: PracticeWorkspaceProps) {
  const initialQuestion = questions.find(
    (question) => question.id === initialQuestionId,
  )
  // A specific question wins; otherwise enter topic-first (from ?topicId);
  // otherwise fall back to the first topic.
  const resolvedTopicId =
    initialQuestion?.topicId ??
    (initialTopicId && topics.some((topic) => topic.id === initialTopicId)
      ? initialTopicId
      : topics[0]?.id) ??
    ""
  const [selectedTopicId, setSelectedTopicId] = useState(resolvedTopicId)
  // Which topics are expanded in the sidebar (VS Code-style tree — each topic
  // expands/collapses independently, decoupled from what's loaded in the chat).
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(
    () => new Set(resolvedTopicId ? [resolvedTopicId] : []),
  )
  const topicQuestions = useMemo(
    () => questions.filter((question) => question.topicId === selectedTopicId),
    [questions, selectedTopicId],
  )
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    initialQuestion?.id ??
      questions.find((question) => question.topicId === resolvedTopicId)?.id ??
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [hintCount, setHintCount] = useState(0)
  const [hintViewIndex, setHintViewIndex] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const selectedQuestionIdForSession = selectedQuestion?.id
  const isTutorBusy = activeMode !== null || isSessionLoading
  const canSend =
    Boolean(session) && !isTutorBusy && answer.trim().length > 0
  const hintsExhausted = Boolean(
    selectedQuestion && hintCount >= selectedQuestion.hints.length,
  )

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages])

  useEffect(() => {
    let isStale = false

    async function loadSession() {
      setAnswer("")
      setLatestResponse(null)
      setSession(null)
      setSessionError(null)
      setMessages([])
      setHintCount(0)
      setHintViewIndex(0)

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

  function resetChat() {
    setMessages([])
    setHintCount(0)
    setHintViewIndex(0)
  }

  function pushMessage(message: Omit<ChatMessage, "id">) {
    setMessages((items) => [
      ...items,
      { ...message, id: createClientId(message.role) },
    ])
  }

  function toggleTopic(topicId: string) {
    setExpandedTopicIds((previous) => {
      const next = new Set(previous)
      if (next.has(topicId)) {
        next.delete(topicId)
      } else {
        next.add(topicId)
      }
      return next
    })
  }

  function selectQuestion(questionId: string, topicId: string) {
    setSelectedTopicId(topicId)
    setExpandedTopicIds((previous) => new Set(previous).add(topicId))
    setSelectedQuestionId(questionId)
    setAnswer("")
    setLatestResponse(null)
    resetChat()
  }

  async function sendAnswer() {
    const trimmed = answer.trim()

    if (!selectedQuestion || !session || activeMode || !trimmed) {
      return
    }

    setActiveMode("check")
    setSessionError(null)
    pushMessage({ role: "student", text: trimmed })
    setAnswer("")

    try {
      const nextSession = await postTutorSessionEvent(session.id, "attempt", {
        answer: trimmed,
      })
      setSession(nextSession)

      const tutorResponse = await requestTutorResponse({
        answer: trimmed,
        mode: "check",
        questionId: selectedQuestion.id,
        sessionId: nextSession.id,
        topicId: selectedQuestion.topicId,
      })

      setLatestResponse(tutorResponse)
      pushMessage({
        note: tutorResponse.misconceptions[0],
        role: "tutor",
        text: tutorResponse.message,
        tone: tutorResponse.verdict === "correct" ? "correct" : "incorrect",
      })
    } catch (error) {
      setSessionError(errorMessageFor(error))
    } finally {
      setActiveMode(null)
    }
  }

  function getHint() {
    if (!selectedQuestion || !session || hintsExhausted) {
      return
    }

    // Reveal exactly one more hint from the local list. Driving the display
    // off a local counter (rather than the engine's cumulative response)
    // guarantees one hint per click, even after wrong answers advance the
    // engine's own hint index.
    const next = hintCount + 1
    setHintCount(next)
    setHintViewIndex(next - 1)
    setSessionError(null)

    // Sync the server session counter and engine hint state in the background
    // (for analytics + LLM-fallback eligibility); the hint is already shown.
    const sessionId = session.id
    const questionId = selectedQuestion.id
    const topicId = selectedQuestion.topicId
    const submittedAnswer = answer
    void postTutorSessionEvent(sessionId, "hint")
      .then((updatedSession) => {
        setSession(updatedSession)
        return requestTutorResponse({
          answer: submittedAnswer,
          mode: "hint",
          questionId,
          sessionId,
          topicId,
        })
      })
      .then((response) => {
        setLatestResponse(response)
      })
      .catch(() => {
        // Background sync only — the revealed hint is unaffected.
      })
  }

  async function showAnswer() {
    if (!selectedQuestion || !session || activeMode || !hintsExhausted) {
      return
    }

    setActiveMode("full_solution")
    setSessionError(null)

    try {
      const nextSession = await postTutorSessionEvent(session.id, "step")
      setSession(nextSession)

      const tutorResponse = await requestTutorResponse({
        answer,
        mode: "full_solution",
        questionId: selectedQuestion.id,
        sessionId: nextSession.id,
        topicId: selectedQuestion.topicId,
      })

      setLatestResponse(tutorResponse)

      const total = tutorResponse.steps.length
      setMessages((items) => [
        ...items,
        ...tutorResponse.steps.map((step, index) => ({
          id: createClientId("tutor"),
          role: "tutor" as const,
          stepLabel: `Step ${index + 1} of ${total}`,
          text: step,
          tone: "neutral" as const,
        })),
        {
          id: createClientId("tutor"),
          role: "tutor" as const,
          stepLabel: "Full solution",
          text: tutorResponse.message,
          tone: "neutral" as const,
        },
      ])
    } catch (error) {
      setSessionError(errorMessageFor(error))
    } finally {
      setActiveMode(null)
    }
  }

  async function requestLimitedAiHelp() {
    const trimmed = answer.trim() || "I'm stuck and not sure how to proceed."

    if (!selectedQuestion || !session || activeMode) {
      return
    }

    setActiveMode("ai")
    setSessionError(null)
    pushMessage({ role: "student", text: "Asked for AI help." })

    try {
      const tutorResponse = await requestTutorResponse({
        allowLlmFallback: true,
        answer: trimmed,
        mode: "check",
        questionId: selectedQuestion.id,
        sessionId: session.id,
        topicId: selectedQuestion.topicId,
      })

      setLatestResponse(tutorResponse)
      pushMessage({
        note: tutorResponse.misconceptions[0],
        role: "tutor",
        text:
          tutorResponse.source === "retrieval" && tutorResponse.hints[0]
            ? `${tutorResponse.message} ${tutorResponse.hints[0]}`
            : tutorResponse.message,
        tone: tutorResponse.verdict === "correct" ? "correct" : "incorrect",
      })
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
      resetChat()
    } catch (error) {
      setSessionError(errorMessageFor(error))
    } finally {
      setIsSessionLoading(false)
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void sendAnswer()
    }
  }

  return (
    <main className="min-h-svh bg-background lg:h-[calc(100svh-3.5rem)] lg:min-h-0 lg:overflow-hidden">
      <section className="mx-auto grid w-full max-w-[90rem] gap-6 px-6 py-8 lg:h-full lg:grid-cols-[280px_minmax(0,1fr)] lg:overflow-hidden lg:py-6">
        <aside className="flex flex-col gap-4 lg:h-[calc(100svh-6.5rem)] lg:min-h-0">
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

          <Card className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <CardHeader>
              <CardTitle className="text-base">Topics</CardTitle>
              <CardDescription>Pick a topic, then a problem.</CardDescription>
            </CardHeader>
            <CardContent className="p-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
              <div className="flex max-h-[45vh] flex-col gap-1 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
                {topics.map((topic) => {
                  const isOpen = expandedTopicIds.has(topic.id)
                  const problems = isOpen
                    ? questions.filter(
                        (question) => question.topicId === topic.id,
                      )
                    : []
                  return (
                    <div key={topic.id}>
                      <Button
                        type="button"
                        variant={isOpen ? "secondary" : "ghost"}
                        className="h-auto w-full justify-start gap-2 whitespace-normal py-2.5 text-left"
                        aria-expanded={isOpen}
                        onClick={() => toggleTopic(topic.id)}
                      >
                        {isOpen ? (
                          <ChevronDown
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        ) : (
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 flex-1">{topic.title}</span>
                      </Button>
                      {isOpen ? (
                        <div className="mt-1 ml-4 flex flex-col gap-1 border-l pl-2">
                          {problems.length > 0 ? (
                            problems.map((problem) => (
                              <Button
                                key={problem.id}
                                type="button"
                                size="sm"
                                variant={
                                  problem.id === selectedQuestionId
                                    ? "default"
                                    : "ghost"
                                }
                                className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                                disabled={isTutorBusy}
                                onClick={() => selectQuestion(problem.id, topic.id)}
                              >
                                {problem.title}
                              </Button>
                            ))
                          ) : (
                            <p className="px-2 py-1 text-xs text-muted-foreground">
                              No problems yet.
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </aside>

        <div className="flex min-w-0 flex-col h-[75svh] lg:h-[calc(100svh-6.5rem)]">
          {selectedQuestion ? (
            <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
              <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge>{selectedTopic?.title}</Badge>
                    <Badge variant="outline">
                      {selectedQuestion.difficulty}
                    </Badge>
                  </div>
                  <h1 className="text-base font-semibold leading-6">
                    {selectedQuestion.title}
                  </h1>
                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                    <MathText>{selectedQuestion.prompt}</MathText>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Reset"
                  aria-label="Reset conversation"
                  disabled={isTutorBusy}
                  onClick={() => {
                    void restartTutorSession()
                  }}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              <div
                className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4"
                aria-live="polite"
              >
                {messages.length === 0 ? (
                  <p className="m-auto max-w-xs text-center text-sm text-muted-foreground">
                    Type your answer below to begin.
                  </p>
                ) : (
                  messages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {hintCount > 0 ? (
                <div className="border-t px-5 py-3">
                  <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    <Lightbulb
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Hint {hintViewIndex + 1} of {hintCount}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label="Previous hint"
                            disabled={hintViewIndex === 0}
                            onClick={() =>
                              setHintViewIndex((index) => Math.max(0, index - 1))
                            }
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            aria-label="Next hint"
                            disabled={hintViewIndex >= hintCount - 1}
                            onClick={() =>
                              setHintViewIndex((index) =>
                                Math.min(hintCount - 1, index + 1),
                              )
                            }
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="leading-6">
                        <MathText>
                          {selectedQuestion.hints[hintViewIndex] ?? ""}
                        </MathText>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {sessionError ? (
                <div className="border-t px-5 py-2 text-sm text-destructive">
                  {sessionError}
                </div>
              ) : null}

              <div className="border-t px-5 py-4">
                <div className="flex items-end gap-2">
                  <Textarea
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Type your answer…"
                    rows={2}
                    className="min-h-0 resize-none"
                  />
                  <Button
                    type="button"
                    disabled={!canSend}
                    onClick={() => {
                      void sendAnswer()
                    }}
                  >
                    {activeMode === "check" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isTutorBusy || !session || hintsExhausted}
                    onClick={getHint}
                  >
                    <Lightbulb className="h-4 w-4" />
                    Hint
                  </Button>
                  {hintsExhausted ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isTutorBusy || !session}
                      onClick={() => {
                        void showAnswer()
                      }}
                    >
                      {activeMode === "full_solution" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                      Show answer
                    </Button>
                  ) : null}
                  {latestResponse?.usage.llmFallbackEligible ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isTutorBusy || !session}
                      onClick={() => {
                        void requestLimitedAiHelp()
                      }}
                    >
                      {activeMode === "ai" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      I&apos;m stuck
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
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

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "student") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap">
        {message.text}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border bg-muted/40 px-4 py-2.5 text-sm",
        message.tone === "correct" && "border-success/50 bg-success/5",
        message.tone === "incorrect" && "border-destructive/40",
      )}
    >
      {message.stepLabel ? (
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {message.stepLabel}
        </div>
      ) : null}
      {message.tone === "correct" ? (
        <div className="mb-1 inline-flex items-center gap-1 font-medium text-success">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Correct
        </div>
      ) : null}
      <div className="leading-6">
        <MathText>{message.text}</MathText>
      </div>
      {message.note ? (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs leading-5 text-muted-foreground">
          <MathText>{message.note}</MathText>
        </div>
      ) : null}
    </div>
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
