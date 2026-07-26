"use client"

import { Fragment, useMemo, useState, type ReactNode } from "react"
import {
  BarChart3,
  Check,
  ChevronDown,
  ClipboardList,
  FileJson,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Star,
  Upload,
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
import { Textarea } from "@/components/ui/textarea"
import type {
  Difficulty,
  ProfessorAnalyticsDashboard,
  ReviewCandidate,
  ReviewPriority,
  ReviewStatus,
} from "@/lib/types"

type ProfessorSection = "analytics" | "review" | "upload"

type ReviewFilters = {
  difficulty: "" | Difficulty
  reviewPriority: "" | ReviewPriority
  status: "" | ReviewStatus
  topicId: string
}

type TopicOption = {
  id: string
  title: string
}

type CandidateEdit = {
  difficulty: Difficulty
  notes: string
  reviewPriority: ReviewPriority
  topicId: string
}

const DEFAULT_FILTERS: ReviewFilters = {
  difficulty: "",
  reviewPriority: "",
  status: "needs_review",
  topicId: "",
}

const DIFFICULTIES = [
  "foundational",
  "intermediate",
  "challenge",
] satisfies Difficulty[]

const REVIEW_STATUSES = [
  "needs_review",
  "needs_edit",
  "needs_regeneration",
] satisfies ReviewStatus[]

export function ProfessorReviewPanel() {
  const [activeSection, setActiveSection] =
    useState<ProfessorSection>("review")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [analytics, setAnalytics] =
    useState<ProfessorAnalyticsDashboard | null>(null)
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([])
  const [edits, setEdits] = useState<Record<string, CandidateEdit>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_FILTERS)
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false)
  const [isReviewLoading, setIsReviewLoading] = useState(false)
  const [isUploadLoading, setIsUploadLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [token, setToken] = useState("")
  const [topics, setTopics] = useState<TopicOption[]>([])
  const [uploadText, setUploadText] = useState("")
  const [uploadPreview, setUploadPreview] = useState<ReviewCandidate[]>([])

  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selectedIds.has(candidate.id)),
    [candidates, selectedIds],
  )
  const selectedAllPriority =
    selectedCandidates.length > 0 &&
    selectedCandidates.every(
      (candidate) => (candidate.review.reviewPriority ?? "normal") === "priority",
    )

  async function loadReviewQueue(nextFilters = filters) {
    setIsReviewLoading(true)
    setMessage(null)

    try {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(nextFilters)) {
        if (value) {
          params.set(key, value)
        }
      }

      const result = await fetch(`/api/professor/review?${params.toString()}`, {
        headers: token ? { "x-professor-token": token } : undefined,
      })
      const payload = (await result.json()) as {
        candidates?: ReviewCandidate[]
        error?: string
        topics?: TopicOption[]
      }

      if (!result.ok || !payload.candidates) {
        setMessage(payload.error ?? "Review queue request failed.")
        return
      }

      setCandidates(payload.candidates)
      setTopics(payload.topics ?? [])
      setSelectedIds(new Set())
      setEdits({})
      setMessage(`Loaded ${payload.candidates.length} review candidate(s).`)
    } catch {
      setMessage("Review queue request failed.")
    } finally {
      setIsReviewLoading(false)
    }
  }

  async function loadAnalytics() {
    setIsAnalyticsLoading(true)
    setMessage(null)

    try {
      const result = await fetch("/api/professor/analytics", {
        headers: token ? { "x-professor-token": token } : undefined,
      })
      const payload = (await result.json()) as {
        analytics?: ProfessorAnalyticsDashboard
        error?: string
      }

      if (!result.ok || !payload.analytics) {
        setMessage(payload.error ?? "Analytics request failed.")
        return
      }

      setAnalytics(payload.analytics)
      setMessage("Analytics refreshed.")
    } catch {
      setMessage("Analytics request failed.")
    } finally {
      setIsAnalyticsLoading(false)
    }
  }

  async function updateCandidates(
    candidateIds: string[],
    update: {
      action?: "approve" | "needs_edit" | "reject" | "request_regeneration"
      difficulty?: Difficulty
      notes?: string
      reviewPriority?: ReviewPriority
      topicId?: string
    },
  ) {
    setActiveId(candidateIds.join(","))
    setMessage(null)

    try {
      const result = await fetch("/api/professor/review", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-professor-token": token } : {}),
        },
        body: JSON.stringify({ candidateIds, ...update }),
      })
      const payload = (await result.json()) as {
        candidates?: ReviewCandidate[]
        error?: string
      }

      if (!result.ok || !payload.candidates) {
        setMessage(payload.error ?? "Review update failed.")
        return
      }

      setMessage(`Updated ${payload.candidates.length} review candidate(s).`)
      await loadReviewQueue()
    } catch {
      setMessage("Review update failed.")
    } finally {
      setActiveId(null)
    }
  }

  async function uploadGeneratedReviewJson() {
    setIsUploadLoading(true)
    setMessage(null)
    setUploadPreview([])

    let parsed: unknown
    try {
      parsed = JSON.parse(uploadText)
    } catch {
      setMessage("Upload JSON could not be parsed.")
      setIsUploadLoading(false)
      return
    }

    try {
      const result = await fetch("/api/professor/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-professor-token": token } : {}),
        },
        body: JSON.stringify({ payload: parsed }),
      })
      const payload = (await result.json()) as {
        candidates?: ReviewCandidate[]
        errors?: string[]
        message?: string
        nonDurable?: boolean
      }

      if (!result.ok || !payload.candidates) {
        setMessage(payload.errors?.join(" ") ?? "Upload failed.")
        return
      }

      setUploadPreview(payload.candidates)
      setMessage(
        `${payload.message ?? "Upload accepted."}${
          payload.nonDurable ? " Demo import is non-durable." : ""
        }`,
      )
      await loadReviewQueue()
    } catch {
      setMessage("Upload failed.")
    } finally {
      setIsUploadLoading(false)
    }
  }

  function editFor(candidate: ReviewCandidate): CandidateEdit {
    return (
      edits[candidate.id] ?? {
        difficulty: candidate.difficulty,
        notes: candidate.review.notes ?? "",
        reviewPriority: candidate.review.reviewPriority ?? "normal",
        topicId: candidate.topicId,
      }
    )
  }

  function updateEdit(candidate: ReviewCandidate, patch: Partial<CandidateEdit>) {
    setEdits((current) => ({
      ...current,
      [candidate.id]: {
        ...editFor(candidate),
        ...patch,
      },
    }))
  }

  function toggleSelected(candidateId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(candidateId)) {
        next.delete(candidateId)
      } else {
        next.add(candidateId)
      }
      return next
    })
  }

  function setFilter<K extends keyof ReviewFilters>(
    key: K,
    value: ReviewFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="pl-9"
            type="password"
            placeholder="Admin secret"
          />
        </div>
        <div className="grid grid-cols-3 gap-2 lg:w-auto">
          <SectionButton
            active={activeSection === "review"}
            icon={<ClipboardList className="h-4 w-4" />}
            label="Review"
            onClick={() => setActiveSection("review")}
          />
          <SectionButton
            active={activeSection === "upload"}
            icon={<FileJson className="h-4 w-4" />}
            label="Upload"
            onClick={() => setActiveSection("upload")}
          />
          <SectionButton
            active={activeSection === "analytics"}
            icon={<BarChart3 className="h-4 w-4" />}
            label="Analytics"
            onClick={() => setActiveSection("analytics")}
          />
        </div>
      </div>

      {message ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      {activeSection === "review" ? (
        <section className="flex flex-col gap-4">
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
            <Select
              label="Status"
              value={filters.status}
              onChange={(value) =>
                setFilter("status", value as ReviewFilters["status"])
              }
              options={[
                { label: "Any status", value: "" },
                ...REVIEW_STATUSES.map((status) => ({
                  label: status,
                  value: status,
                })),
              ]}
            />
            <Select
              label="Topic"
              value={filters.topicId}
              onChange={(value) => setFilter("topicId", value)}
              options={[
                { label: "Any topic", value: "" },
                ...topics.map((topic) => ({
                  label: topic.title,
                  value: topic.id,
                })),
              ]}
            />
            <Select
              label="Difficulty"
              value={filters.difficulty}
              onChange={(value) =>
                setFilter("difficulty", value as ReviewFilters["difficulty"])
              }
              options={[
                { label: "Any difficulty", value: "" },
                ...DIFFICULTIES.map((difficulty) => ({
                  label: difficulty,
                  value: difficulty,
                })),
              ]}
            />
            <Select
              label="Priority"
              value={filters.reviewPriority}
              onChange={(value) =>
                setFilter(
                  "reviewPriority",
                  value as ReviewFilters["reviewPriority"],
                )
              }
              options={[
                { label: "Any priority", value: "" },
                { label: "priority", value: "priority" },
                { label: "normal", value: "normal" },
              ]}
            />
            <Button
              type="button"
              variant="outline"
              disabled={isReviewLoading}
              onClick={() => loadReviewQueue()}
            >
              <RefreshCw
                className={isReviewLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
              />
              Load
            </Button>
            <Button
              type="button"
              disabled={!selectedAllPriority || Boolean(activeId)}
              onClick={() =>
                updateCandidates([...selectedIds], { action: "approve" })
              }
            >
              <Check className="h-4 w-4" />
              Approve selected
            </Button>
          </div>

          <ReviewTable
            activeId={activeId}
            candidates={candidates}
            editFor={editFor}
            expandedId={expandedId}
            onEdit={updateEdit}
            onSaveEdit={(candidate) => {
              const edit = editFor(candidate)
              updateCandidates([candidate.id], {
                difficulty: edit.difficulty,
                notes: edit.notes,
                reviewPriority: edit.reviewPriority,
                topicId: edit.topicId,
              })
            }}
            onSelect={toggleSelected}
            onToggleExpand={(candidateId) =>
              setExpandedId((current) =>
                current === candidateId ? null : candidateId,
              )
            }
            onUpdate={updateCandidates}
            selectedIds={selectedIds}
            topics={topics}
          />
        </section>
      ) : null}

      {activeSection === "upload" ? (
        <section className="flex flex-col gap-4">
          <Textarea
            value={uploadText}
            onChange={(event) => setUploadText(event.target.value)}
            className="min-h-72 font-mono text-xs"
            placeholder='{"questions":[...]}'
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={!uploadText.trim() || isUploadLoading}
              onClick={uploadGeneratedReviewJson}
            >
              {isUploadLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Validate/import
            </Button>
            <Badge variant="outline">generated-review JSON only</Badge>
          </div>
          {uploadPreview.length > 0 ? (
            <div className="border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Imported draft</TableHead>
                    <TableHead>Topic</TableHead>
                    <TableHead>Difficulty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadPreview.map((candidate) => (
                    <TableRow key={candidate.id}>
                      <TableCell>{candidate.title}</TableCell>
                      <TableCell>{candidate.topic ?? candidate.topicId}</TableCell>
                      <TableCell>{candidate.difficulty}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeSection === "analytics" ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isAnalyticsLoading}
              onClick={loadAnalytics}
            >
              <RefreshCw
                className={
                  isAnalyticsLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"
                }
              />
              Refresh
            </Button>
            {analytics ? <Badge variant="secondary">{analytics.mode}</Badge> : null}
          </div>
          {analytics ? <AnalyticsView analytics={analytics} /> : null}
        </section>
      ) : null}
    </div>
  )
}

function ReviewTable({
  activeId,
  candidates,
  editFor,
  expandedId,
  onEdit,
  onSaveEdit,
  onSelect,
  onToggleExpand,
  onUpdate,
  selectedIds,
  topics,
}: {
  activeId: string | null
  candidates: ReviewCandidate[]
  editFor: (candidate: ReviewCandidate) => CandidateEdit
  expandedId: string | null
  onEdit: (candidate: ReviewCandidate, patch: Partial<CandidateEdit>) => void
  onSaveEdit: (candidate: ReviewCandidate) => void
  onSelect: (candidateId: string) => void
  onToggleExpand: (candidateId: string) => void
  onUpdate: (
    candidateIds: string[],
    update: {
      action?: "approve" | "needs_edit" | "reject" | "request_regeneration"
      reviewPriority?: ReviewPriority
    },
  ) => void
  selectedIds: Set<string>
  topics: TopicOption[]
}) {
  return (
    <div className="border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">Select</TableHead>
            <TableHead>Question</TableHead>
            <TableHead>Topic</TableHead>
            <TableHead>Difficulty</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => {
            const edit = editFor(candidate)
            const expanded = expandedId === candidate.id
            const isPriority =
              (candidate.review.reviewPriority ?? "normal") === "priority"

            return (
              <Fragment key={candidate.id}>
                <TableRow key={candidate.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${candidate.title}`}
                      checked={selectedIds.has(candidate.id)}
                      onChange={() => onSelect(candidate.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="flex max-w-xl items-center gap-2 text-left"
                      onClick={() => onToggleExpand(candidate.id)}
                    >
                      <ChevronDown
                        className={
                          expanded
                            ? "h-4 w-4 rotate-180 text-muted-foreground"
                            : "h-4 w-4 text-muted-foreground"
                        }
                      />
                      <span>
                        <span className="block font-medium">{candidate.title}</span>
                        <span className="mt-1 line-clamp-2 block text-sm text-muted-foreground">
                          {candidate.prompt}
                        </span>
                      </span>
                    </button>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">{candidate.source.sourceType}</Badge>
                      <Badge variant="outline">{candidate.source.trustLevel}</Badge>
                      {isPriority ? <Badge>priority</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell>{candidate.topic ?? candidate.topicId}</TableCell>
                  <TableCell>{candidate.difficulty}</TableCell>
                  <TableCell>
                    <StatusBadge status={candidate.review.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        size="icon"
                        variant={isPriority ? "secondary" : "outline"}
                        aria-label={`Mark ${candidate.title} priority`}
                        disabled={activeId === candidate.id}
                        onClick={() =>
                          onUpdate([candidate.id], {
                            reviewPriority: isPriority ? "normal" : "priority",
                          })
                        }
                      >
                        <Star className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        aria-label={`Approve ${candidate.title}`}
                        disabled={!isPriority || activeId === candidate.id}
                        onClick={() =>
                          onUpdate([candidate.id], { action: "approve" })
                        }
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        aria-label={`Request regeneration for ${candidate.title}`}
                        disabled={activeId === candidate.id}
                        onClick={() =>
                          onUpdate([candidate.id], {
                            action: "request_regeneration",
                          })
                        }
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        aria-label={`Reject ${candidate.title}`}
                        disabled={activeId === candidate.id}
                        onClick={() =>
                          onUpdate([candidate.id], { action: "reject" })
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expanded ? (
                  <TableRow key={`${candidate.id}-details`}>
                    <TableCell />
                    <TableCell colSpan={5}>
                      <div className="grid gap-4 py-3 lg:grid-cols-[1.4fr_1fr]">
                        <div className="space-y-4">
                          <ReviewBlock title="Prompt" values={[candidate.prompt]} />
                          <ReviewBlock
                            title="Answer"
                            values={[
                              candidate.answer.acceptedAnswers.join(", "),
                              candidate.answer.explanation,
                            ]}
                          />
                          <ReviewBlock
                            title="Solution steps"
                            values={candidate.solutionSteps}
                          />
                          <ReviewBlock title="Hints" values={candidate.hints} />
                          <ReviewBlock
                            title="Misconceptions"
                            values={candidate.misconceptions.map(
                              (misconception) => misconception.feedback,
                            )}
                          />
                          <ReviewBlock
                            title="Originality"
                            values={[
                              candidate.source.originalityNote ?? "Originality note missing.",
                              candidate.patternSource,
                            ]}
                          />
                        </div>
                        <div className="space-y-3">
                          <Select
                            label="Topic"
                            value={edit.topicId}
                            onChange={(value) =>
                              onEdit(candidate, { topicId: value })
                            }
                            options={[
                              ...topics.map((topic) => ({
                                label: topic.title,
                                value: topic.id,
                              })),
                              ...(topics.some(
                                (topic) => topic.id === candidate.topicId,
                              )
                                ? []
                                : [
                                    {
                                      label: candidate.topic ?? candidate.topicId,
                                      value: candidate.topicId,
                                    },
                                  ]),
                            ]}
                          />
                          <Select
                            label="Difficulty"
                            value={edit.difficulty}
                            onChange={(value) =>
                              onEdit(candidate, {
                                difficulty: value as Difficulty,
                              })
                            }
                            options={DIFFICULTIES.map((difficulty) => ({
                              label: difficulty,
                              value: difficulty,
                            }))}
                          />
                          <Select
                            label="Priority"
                            value={edit.reviewPriority}
                            onChange={(value) =>
                              onEdit(candidate, {
                                reviewPriority: value as ReviewPriority,
                              })
                            }
                            options={[
                              { label: "normal", value: "normal" },
                              { label: "priority", value: "priority" },
                            ]}
                          />
                          <Textarea
                            value={edit.notes}
                            onChange={(event) =>
                              onEdit(candidate, { notes: event.target.value })
                            }
                            className="min-h-24"
                            placeholder="Review note"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => onSaveEdit(candidate)}
                            >
                              <Save className="h-4 w-4" />
                              Save metadata
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() =>
                                onUpdate([candidate.id], {
                                  action: "needs_edit",
                                })
                              }
                            >
                              Needs edit
                            </Button>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function AnalyticsView({
  analytics,
}: {
  analytics: ProfessorAnalyticsDashboard
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Metric label="Backlog" value={String(analytics.review.totalBacklog)} />
        <Metric
          label="Priority"
          value={String(analytics.review.byPriority.priority)}
        />
        <Metric
          label="LLM calls"
          value={String(analytics.instructor.totals.llmCallsUsed)}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <AnalyticsTable
          title="Review status"
          rows={Object.entries(analytics.review.byStatus).map(([label, value]) => ({
            label,
            value,
          }))}
        />
        <AnalyticsTable
          title="Practice topics"
          rows={analytics.practice.topics.map((topic) => ({
            label: topic.topicTitle,
            value: topic.attempts,
          }))}
        />
      </div>
      <div className="border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Question</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Correct</TableHead>
              <TableHead>Hints</TableHead>
              <TableHead>Steps</TableHead>
              <TableHead>LLM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analytics.practice.questions.map((question) => (
              <TableRow key={question.questionId}>
                <TableCell>{question.questionTitle}</TableCell>
                <TableCell>{question.attempts}</TableCell>
                <TableCell>{question.correctAttempts}</TableCell>
                <TableCell>{question.hintsUsed}</TableCell>
                <TableCell>{question.stepsRevealed}</TableCell>
                <TableCell>{question.llmAttempts}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

function SectionButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "outline"}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
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

function ReviewBlock({ title, values }: { title: string; values: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-sm leading-6">
        {values.filter(Boolean).map((value, index) => (
          <p key={`${title}-${index}`}>{value}</p>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-medium">{value}</div>
    </div>
  )
}

function AnalyticsTable({
  rows,
  title,
}: {
  rows: Array<{ label: string; value: number }>
  title: string
}) {
  return (
    <div className="border border-border p-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.length > 0 ? (
          rows.map((row) => (
            <div
              key={`${title}-${row.label}`}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="truncate text-muted-foreground">{row.label}</span>
              <span className="font-mono">{row.value}</span>
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">No data</div>
        )}
      </div>
    </div>
  )
}
