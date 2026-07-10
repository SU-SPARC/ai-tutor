"use client"

import { useState } from "react"
import { Check, KeyRound, Loader2, RefreshCw, X } from "lucide-react"

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
import type { ReviewCandidate, UsageDashboard } from "@/lib/types"

type ProfessorReviewPanelProps = {
  initialCandidates: ReviewCandidate[]
}

export function ProfessorReviewPanel({
  initialCandidates,
}: ProfessorReviewPanelProps) {
  const [candidates, setCandidates] = useState(initialCandidates)
  const [token, setToken] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isUsageLoading, setIsUsageLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageDashboard | null>(null)

  async function loadUsage() {
    setIsUsageLoading(true)
    setMessage(null)

    try {
      const result = await fetch("/api/professor/usage", {
        headers: token ? { "x-professor-token": token } : undefined,
      })
      const payload = (await result.json()) as {
        error?: string
        usage?: UsageDashboard
      }

      if (!result.ok || !payload.usage) {
        setMessage(payload.error ?? "Usage dashboard request failed.")
        return
      }

      setUsage(payload.usage)
    } catch {
      setMessage("Usage dashboard request failed.")
    } finally {
      setIsUsageLoading(false)
    }
  }

  async function reviewCandidate(
    candidateId: string,
    action: "approve" | "reject",
  ) {
    setActiveId(candidateId)
    setMessage(null)

    const result = await fetch("/api/professor/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-professor-token": token } : {}),
      },
      body: JSON.stringify({ action, candidateId }),
    })
    const payload = (await result.json()) as {
      candidate?: ReviewCandidate
      error?: string
    }

    if (!result.ok || !payload.candidate) {
      setMessage(payload.error ?? "Review update failed.")
      setActiveId(null)
      return
    }

    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === payload.candidate?.id ? payload.candidate : candidate,
      ),
    )
    setMessage(
      `Marked ${payload.candidate.title} as ${payload.candidate.review.status}.`,
    )
    setActiveId(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row">
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
        <Badge variant="outline" className="h-10 justify-center px-4">
          {
            candidates.filter(
              (candidate) => candidate.review.status === "needs_review",
            ).length
          }{" "}
          needs review
        </Badge>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Refresh usage dashboard"
          title="Refresh usage dashboard"
          disabled={isUsageLoading}
          onClick={loadUsage}
        >
          <RefreshCw
            className={isUsageLoading ? "h-4 w-4 animate-spin" : "h-4 w-4"}
          />
        </Button>
      </div>

      <section className="border-b pb-4" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">LLM usage</h2>
            <p className="text-sm text-muted-foreground">
              {usage
                ? usage.mode === "database"
                  ? "Durable aggregate usage"
                  : "Demo-only usage; resets when this server restarts"
                : "Enter the admin secret, then refresh usage."}
            </p>
          </div>
          {usage ? <Badge variant="secondary">{usage.mode}</Badge> : null}
        </div>

        {usage ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <UsageMetric
                label="Provider calls"
                value={`${usage.today.llmCalls}/${usage.policy.maxDailyLlmCalls}`}
              />
              <UsageMetric
                label="LLM tokens"
                value={String(usage.today.totalTokens)}
              />
              <UsageMetric
                label="Cache hits"
                value={String(usage.today.cacheHits)}
              />
              <UsageMetric
                label="Limit blocks"
                value={String(usage.today.limitBlocks)}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{usage.policy.maxLlmCallsPerSession}/session</span>
              <span>
                {usage.policy.maxLlmCallsPerQuestionPerDay}/problem/day
              </span>
              <span>
                {usage.policy.maxLlmCallsPerStudentPerDay}/student/day
              </span>
              <span>{usage.policy.maxLlmOutputTokens} output tokens</span>
              <span>{usage.policy.maxTutorInputChars} input characters</span>
            </div>
            <div className="mt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Calls</TableHead>
                    <TableHead>Tokens</TableHead>
                    <TableHead>Cache</TableHead>
                    <TableHead>Blocks</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.daily.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell>{day.date}</TableCell>
                      <TableCell>{day.llmCalls}</TableCell>
                      <TableCell>{day.totalTokens}</TableCell>
                      <TableCell>{day.cacheHits}</TableCell>
                      <TableCell>{day.limitBlocks}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </section>

      {message ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Pattern</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((candidate) => (
            <TableRow key={candidate.id}>
              <TableCell>
                <div className="font-medium">{candidate.title}</div>
                <div className="mt-1 max-w-xl text-sm text-muted-foreground">
                  {candidate.prompt}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant="outline">{candidate.source.sourceType}</Badge>
                  <Badge variant="outline">{candidate.source.trustLevel}</Badge>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {candidate.patternSource}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    candidate.review.status === "approved"
                      ? "success"
                      : candidate.review.status === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {candidate.review.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    aria-label={`Approve ${candidate.title}`}
                    disabled={activeId === candidate.id}
                    onClick={() => reviewCandidate(candidate.id, "approve")}
                  >
                    {activeId === candidate.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="destructive"
                    aria-label={`Reject ${candidate.title}`}
                    disabled={activeId === candidate.id}
                    onClick={() => reviewCandidate(candidate.id, "reject")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-lg font-medium">{value}</div>
    </div>
  )
}
