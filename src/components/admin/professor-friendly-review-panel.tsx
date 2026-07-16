"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  Check,
  KeyRound,
  Loader2,
  RotateCcw,
  Save,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  professorReviewProgress,
  sortProfessorReviewCandidates,
} from "@/lib/tutor/professor-review-mode"
import type { ReviewCandidate } from "@/lib/types"

type ReviewAction = "approve" | "needs_edit" | "reject" | "request_regeneration"

export function ProfessorFriendlyReviewPanel() {
  const [activeAction, setActiveAction] = useState<ReviewAction | null>(null)
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [reviewedCount, setReviewedCount] = useState(0)
  const [token, setToken] = useState("")

  const current = candidates[0]
  const progress = useMemo(
    () => professorReviewProgress(candidates, reviewedCount),
    [candidates, reviewedCount],
  )

  async function loadQueue() {
    setIsLoading(true)
    setMessage(null)

    try {
      const result = await fetch("/api/professor/review?status=needs_review", {
        headers: token ? { "x-professor-token": token } : undefined,
      })
      const payload = (await result.json()) as {
        candidates?: ReviewCandidate[]
        error?: string
      }

      if (!result.ok || !payload.candidates) {
        setMessage(payload.error ?? "Review queue could not load.")
        return
      }

      const sorted = sortProfessorReviewCandidates(payload.candidates)
      setCandidates(sorted)
      setReviewedCount(0)
      setNote("")
      setMessage(
        sorted.length > 0
          ? `Loaded ${sorted.length} generated review item(s).`
          : "No generated questions need review right now.",
      )
    } catch {
      setMessage("Review queue could not load.")
    } finally {
      setIsLoading(false)
    }
  }

  async function reviewCurrent(action: ReviewAction) {
    if (!current) {
      return
    }

    setActiveAction(action)
    setMessage(null)

    try {
      const result = await fetch("/api/professor/review", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-professor-token": token } : {}),
        },
        body: JSON.stringify({
          action,
          candidateId: current.id,
          notes: note,
          reviewPriority:
            action === "approve"
              ? "priority"
              : current.review.reviewPriority ?? "normal",
        }),
      })
      const payload = (await result.json()) as {
        candidate?: ReviewCandidate
        error?: string
      }

      if (!result.ok || !payload.candidate) {
        setMessage(payload.error ?? "Review action failed.")
        return
      }

      setCandidates((items) => items.slice(1))
      setReviewedCount((count) => count + 1)
      setNote("")
      setMessage(`Marked ${payload.candidate.title} as ${payload.candidate.review.status}.`)
    } catch {
      setMessage("Review action failed.")
    } finally {
      setActiveAction(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="pl-9"
            type="password"
            placeholder="Admin secret"
          />
        </div>
        <Button type="button" disabled={isLoading} onClick={loadQueue}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Load review queue
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary">
          {progress.reviewedCount} reviewed
        </Badge>
        <Badge variant="outline">
          {progress.remainingPriorityItems} priority remaining
        </Badge>
        <Badge variant="outline">
          {progress.totalCount} loaded total
        </Badge>
      </div>

      {message ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      {current ? (
        <article className="space-y-5 border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Badge variant="outline" className="mb-2">
                {current.topic ?? current.topicId}
              </Badge>
              <h2 className="text-xl font-semibold tracking-normal">
                {current.title}
              </h2>
            </div>
            <Badge variant="secondary">{current.difficulty}</Badge>
          </div>

          <ReviewBlock title="Question" values={[current.prompt]} />
          <ReviewBlock
            title="Final answer"
            values={[
              current.answer.acceptedAnswers.join(", "),
              current.answer.explanation,
            ]}
          />
          <ReviewBlock title="Solution steps" values={current.solutionSteps} />
          <ReviewBlock title="Hints" values={current.hints} />
          <ReviewBlock
            title="Misconceptions"
            values={current.misconceptions.map(
              (misconception) => misconception.feedback,
            )}
          />
          <ReviewBlock
            title="Source/originality note"
            values={[
              current.source.originalityNote ??
                "No originality note is recorded.",
            ]}
          />

          <label className="block space-y-2">
            <span className="text-sm font-medium">Short note</span>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-20"
              maxLength={500}
              placeholder="Optional note for edits or regeneration"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <ActionButton
              action="approve"
              activeAction={activeAction}
              icon={<Check className="h-4 w-4" />}
              label="Approve"
              onClick={reviewCurrent}
            />
            <ActionButton
              action="needs_edit"
              activeAction={activeAction}
              icon={<Save className="h-4 w-4" />}
              label="Needs edit"
              onClick={reviewCurrent}
              variant="outline"
            />
            <ActionButton
              action="request_regeneration"
              activeAction={activeAction}
              icon={<RotateCcw className="h-4 w-4" />}
              label="Regenerate"
              onClick={reviewCurrent}
              variant="outline"
            />
            <ActionButton
              action="reject"
              activeAction={activeAction}
              icon={<X className="h-4 w-4" />}
              label="Reject"
              onClick={reviewCurrent}
              variant="destructive"
            />
          </div>
        </article>
      ) : (
        <div className="border border-border p-6 text-sm text-muted-foreground">
          Load the queue to review generated questions one at a time.
        </div>
      )}
    </div>
  )
}

function ReviewBlock({ title, values }: { title: string; values: string[] }) {
  const safeValues = values.filter(Boolean)

  return (
    <section>
      <h3 className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-sm leading-6">
        {safeValues.length > 0 ? (
          safeValues.map((value, index) => (
            <p key={`${title}-${index}`}>{value}</p>
          ))
        ) : (
          <p className="text-muted-foreground">No recorded value.</p>
        )}
      </div>
    </section>
  )
}

function ActionButton({
  action,
  activeAction,
  icon,
  label,
  onClick,
  variant = "default",
}: {
  action: ReviewAction
  activeAction: ReviewAction | null
  icon: ReactNode
  label: string
  onClick: (action: ReviewAction) => void
  variant?: "default" | "destructive" | "outline"
}) {
  return (
    <Button
      type="button"
      disabled={Boolean(activeAction)}
      variant={variant}
      onClick={() => onClick(action)}
    >
      {activeAction === action ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        icon
      )}
      {label}
    </Button>
  )
}
