"use client"

import {
  Fragment,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type {
  AdminQuestion,
  AdminQuestionDashboard,
  AdminQuestionSection,
  ReviewStatus,
  SourceType,
} from "@/lib/types"

type QuestionFilters = {
  generatedOnly: boolean
  sourceType: "" | SourceType
  status: "" | ReviewStatus
  topicId: string
}

const DEFAULT_FILTERS: QuestionFilters = {
  generatedOnly: false,
  sourceType: "",
  status: "",
  topicId: "",
}

const REVIEW_STATUSES = [
  "approved",
  "needs_review",
  "needs_edit",
  "needs_regeneration",
  "rejected",
] satisfies ReviewStatus[]

const SOURCE_TYPES = [
  "original_demo",
  "professor_provided",
  "generated_original",
  "pattern_derived_original",
] satisfies SourceType[]

const SECTION_LABELS = {
  approved_student_facing: "Approved student-facing questions",
  generated_original: "Generated original questions",
  pattern_derived_original_candidates: "Pattern-derived original candidates",
  professor_provided: "Professor-provided",
} satisfies Record<AdminQuestionSection, string>

const SECTION_ORDER = [
  "professor_provided",
  "pattern_derived_original_candidates",
  "generated_original",
  "approved_student_facing",
] satisfies AdminQuestionSection[]

export function AdminQuestionReviewPanel({
  initialDashboard,
}: {
  initialDashboard: AdminQuestionDashboard
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dashboard, setDashboard] =
    useState<AdminQuestionDashboard>(initialDashboard)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<QuestionFilters>(DEFAULT_FILTERS)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [token, setToken] = useState("")

  const questionsById = useMemo(() => {
    const map = new Map<string, AdminQuestion>()
    for (const question of dashboard?.questions ?? []) {
      map.set(question.id, question)
    }
    return map
  }, [dashboard])

  async function loadQuestions(nextFilters: QuestionFilters) {
    setIsLoading(true)
    setMessage(null)

    try {
      const params = new URLSearchParams()
      if (nextFilters.status) {
        params.set("status", nextFilters.status)
      }
      if (nextFilters.topicId) {
        params.set("topicId", nextFilters.topicId)
      }
      if (nextFilters.sourceType) {
        params.set("sourceType", nextFilters.sourceType)
      }
      if (nextFilters.generatedOnly) {
        params.set("generatedOnly", "true")
      }

      const result = await fetch(`/api/admin/questions?${params.toString()}`)
      const payload = (await result.json()) as {
        dashboard?: AdminQuestionDashboard
        error?: string
      }

      if (!result.ok || !payload.dashboard) {
        setMessage(payload.error ?? "Question review data could not load.")
        return
      }

      setDashboard(payload.dashboard)
      setMessage(
        payload.dashboard.readOnly
          ? payload.dashboard.readOnlyReason ?? "Loaded read-only demo state."
          : `Loaded ${payload.dashboard.questions.length} question record(s).`,
      )
    } catch {
      setMessage("Question review data could not load.")
    } finally {
      setIsLoading(false)
    }
  }

  async function mutateQuestion(
    questionId: string,
    action: "approve" | "mark_needs_review" | "reject" | "request_regeneration",
  ) {
    setActiveId(questionId)
    setMessage(null)

    try {
      if (action === "request_regeneration") {
        const result = await fetch(
          `/api/admin/questions/${encodeURIComponent(questionId)}/regenerate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { "x-professor-token": token } : {}),
            },
            body: JSON.stringify({ keepPattern: true, mode: "deterministic" }),
          },
        )
        const payload = (await result.json()) as {
          error?: string
          regenerated?: AdminQuestion
        }

        if (!result.ok || !payload.regenerated) {
          setMessage(payload.error ?? "Question regeneration failed.")
          return
        }

        setMessage(`Created ${payload.regenerated.title} for review.`)
        await loadQuestions(filters)
        return
      }

      const result = await fetch("/api/admin/questions", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-professor-token": token } : {}),
        },
        body: JSON.stringify({ action, questionId }),
      })
      const payload = (await result.json()) as {
        error?: string
        questions?: AdminQuestion[]
      }

      if (!result.ok || !payload.questions) {
        setMessage(payload.error ?? "Question update failed.")
        return
      }

      setMessage(`Updated ${payload.questions[0]?.title ?? "question"}.`)
      await loadQuestions(filters)
    } catch {
      setMessage("Question update failed.")
    } finally {
      setActiveId(null)
    }
  }

  function setFilter<K extends keyof QuestionFilters>(
    key: K,
    value: QuestionFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  const canMutate = Boolean(token.trim()) && Boolean(dashboard && !dashboard.readOnly)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="pl-9"
            type="password"
            placeholder="Admin secret for mutations"
          />
        </div>
        <Select
          label="Status"
          value={filters.status}
          onChange={(value) => setFilter("status", value as QuestionFilters["status"])}
          options={[
            { label: "Any status", value: "" },
            ...REVIEW_STATUSES.map((status) => ({ label: status, value: status })),
          ]}
        />
        <Select
          label="Topic"
          value={filters.topicId}
          onChange={(value) => setFilter("topicId", value)}
          options={[
            { label: "Any topic", value: "" },
            ...(dashboard?.topics ?? []).map((topic) => ({
              label: topic.title,
              value: topic.id,
            })),
          ]}
        />
        <Select
          label="Source"
          value={filters.sourceType}
          onChange={(value) =>
            setFilter("sourceType", value as QuestionFilters["sourceType"])
          }
          options={[
            { label: "Any source", value: "" },
            ...SOURCE_TYPES.map((sourceType) => ({
              label: sourceType,
              value: sourceType,
            })),
          ]}
        />
        <label className="flex h-10 items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={filters.generatedOnly}
            onChange={(event) =>
              setFilter("generatedOnly", event.target.checked)
            }
          />
          Generated only
        </label>
        <Button
          type="button"
          className="self-end"
          disabled={isLoading}
          onClick={() => loadQuestions(filters)}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Apply
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {dashboard ? <Badge variant="secondary">{dashboard.mode}</Badge> : null}
        {dashboard?.readOnly ? <Badge variant="outline">read-only</Badge> : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={isLoading}
          onClick={() => loadQuestions(filters)}
        >
          <RefreshCw className={isLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          Refresh
        </Button>
      </div>

      {message ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      {dashboard ? (
        <div className="flex flex-col gap-6">
          {SECTION_ORDER.map((section) => (
            <QuestionSection
              key={section}
              activeId={activeId}
              canMutate={canMutate}
              expandedId={expandedId}
              label={SECTION_LABELS[section]}
              onAction={mutateQuestion}
              onToggleExpand={(questionId) =>
                setExpandedId((current) =>
                  current === questionId ? null : questionId,
                )
              }
              questions={dashboard.sections[section]
                .map((questionId) => questionsById.get(questionId))
                .filter((question): question is AdminQuestion => Boolean(question))}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function QuestionSection({
  activeId,
  canMutate,
  expandedId,
  label,
  onAction,
  onToggleExpand,
  questions,
}: {
  activeId: string | null
  canMutate: boolean
  expandedId: string | null
  label: string
  onAction: (
    questionId: string,
    action: "approve" | "mark_needs_review" | "reject" | "request_regeneration",
  ) => void
  onToggleExpand: (questionId: string) => void
  questions: AdminQuestion[]
}) {
  return (
    <section className="border border-border">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">{label}</h2>
        <Badge variant="outline">{questions.length}</Badge>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Trust</TableHead>
            <TableHead>Topic</TableHead>
            <TableHead>Difficulty</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {questions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground">
                No questions in this section.
              </TableCell>
            </TableRow>
          ) : (
            questions.map((question) => (
              <Fragment key={question.id}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      className="flex max-w-xl items-start gap-2 text-left"
                      onClick={() => onToggleExpand(question.id)}
                    >
                      <ChevronDown
                        className={
                          expandedId === question.id
                            ? "mt-0.5 h-4 w-4 rotate-180 text-muted-foreground"
                            : "mt-0.5 h-4 w-4 text-muted-foreground"
                        }
                      />
                      <span>
                        <span className="block font-medium">{question.title}</span>
                        <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
                          {question.prompt}
                        </span>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={question.review.status} />
                  </TableCell>
                  <TableCell>{question.source.sourceType}</TableCell>
                  <TableCell>{question.source.trustLevel}</TableCell>
                  <TableCell>{question.topicTitle ?? question.topicId}</TableCell>
                  <TableCell>{question.difficulty}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <IconButton
                        disabled={!canMutate || activeId === question.id}
                        label={`Approve ${question.title}`}
                        onClick={() => onAction(question.id, "approve")}
                      >
                        <Check className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        disabled={!canMutate || activeId === question.id}
                        label={`Mark ${question.title} needs review`}
                        onClick={() => onAction(question.id, "mark_needs_review")}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        disabled={
                          !canMutate ||
                          activeId === question.id ||
                          !isGeneratedQuestion(question)
                        }
                        label={`Regenerate ${question.title}`}
                        onClick={() =>
                          onAction(question.id, "request_regeneration")
                        }
                      >
                        <RotateCcw className="h-4 w-4" />
                      </IconButton>
                      <IconButton
                        disabled={!canMutate || activeId === question.id}
                        label={`Reject ${question.title}`}
                        variant="destructive"
                        onClick={() => onAction(question.id, "reject")}
                      >
                        <X className="h-4 w-4" />
                      </IconButton>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedId === question.id ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <QuestionDetails question={question} />
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </section>
  )
}

function QuestionDetails({ question }: { question: AdminQuestion }) {
  return (
    <div className="grid gap-5 py-3 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <DetailBlock title="Full question" values={[question.prompt]} />
        <DetailBlock title="Solution steps" values={question.solutionSteps} />
        <DetailBlock title="Hints" values={question.hints} />
        <DetailBlock
          title="Misconceptions"
          values={question.misconceptions.map(
            (misconception) => misconception.feedback,
          )}
        />
      </div>
      <div className="space-y-4">
        <DetailBlock
          title="Source metadata"
          values={[
            `source_type: ${question.source.sourceType}`,
            `trust_level: ${question.source.trustLevel}`,
            `visibility: ${question.source.visibility}`,
            question.patternSource ? `pattern: ${question.patternSource}` : "",
            question.source.patternIds?.length
              ? `pattern_ids: ${question.source.patternIds.join(", ")}`
              : "",
          ]}
        />
        <DetailBlock
          title="Originality note"
          values={[
            question.source.originalityNote ??
              "No originality note is recorded.",
          ]}
        />
        <DetailBlock
          title="Accepted answer"
          values={[
            question.answer.acceptedAnswers.join(", "),
            question.answer.explanation,
          ]}
        />
      </div>
    </div>
  )
}

function Select({
  label,
  onChange,
  options,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
  value: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
  variant = "outline",
}: {
  children: ReactNode
  disabled: boolean
  label: string
  onClick: () => void
  variant?: "destructive" | "outline"
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant={variant}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <Badge
      variant={
        status === "approved"
          ? "success"
          : status === "rejected"
            ? "destructive"
            : "secondary"
      }
    >
      {status}
    </Badge>
  )
}

function DetailBlock({ title, values }: { title: string; values: string[] }) {
  const safeValues = values.filter(Boolean)

  return (
    <div>
      <h3 className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-sm leading-6">
        {safeValues.length > 0 ? (
          safeValues.map((value, index) => (
            <p key={`${title}-${index}`}>{value}</p>
          ))
        ) : (
          <p className="text-muted-foreground">No recorded values.</p>
        )}
      </div>
    </div>
  )
}

function isGeneratedQuestion(question: AdminQuestion) {
  return (
    question.source.sourceType === "generated_original" ||
    question.source.sourceType === "pattern_derived_original"
  )
}
