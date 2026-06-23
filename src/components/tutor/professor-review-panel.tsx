"use client"

import { useState } from "react"
import { Check, KeyRound, Loader2, X } from "lucide-react"

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
import type { ReviewCandidate } from "@/lib/types"

type ProfessorReviewPanelProps = {
  initialCandidates: ReviewCandidate[]
}

export function ProfessorReviewPanel({
  initialCandidates,
}: ProfessorReviewPanelProps) {
  const [candidates, setCandidates] = useState(initialCandidates)
  const [token, setToken] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

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
    setMessage(`Marked ${payload.candidate.title} as ${payload.candidate.status}.`)
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
            placeholder="Professor review token"
          />
        </div>
        <Badge variant="outline" className="h-10 justify-center px-4">
          {candidates.filter((candidate) => candidate.status === "pending").length}{" "}
          pending
        </Badge>
      </div>

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
              </TableCell>
              <TableCell className="text-muted-foreground">
                {candidate.patternSource}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    candidate.status === "approved"
                      ? "success"
                      : candidate.status === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {candidate.status}
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
