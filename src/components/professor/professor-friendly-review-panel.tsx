"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, RotateCcw, Save, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ProfessorReviewCandidateDto } from "@/lib/api/professor-dtos";
import {
  advanceProfessorTopicReviewProgress,
  professorReviewQueuePath,
  sortProfessorReviewCandidates,
} from "@/lib/tutor/professor-review-mode";
import type { ProfessorTopicReviewProgress } from "@/lib/types";

type ReviewAction =
  | "approve"
  | "needs_edit"
  | "reject"
  | "request_regeneration";

export type ProfessorReviewTopicOption = {
  id: string;
  title: string;
};

export function ProfessorFriendlyReviewPanel({
  topics,
}: {
  topics: ProfessorReviewTopicOption[];
}) {
  const [activeAction, setActiveAction] = useState<ReviewAction | null>(null);
  const [candidates, setCandidates] = useState<ProfessorReviewCandidateDto[]>(
    [],
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loadedTopicId, setLoadedTopicId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reviewedCount, setReviewedCount] = useState(0);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [topicProgress, setTopicProgress] =
    useState<ProfessorTopicReviewProgress | null>(null);

  const current = candidates[0];
  const loadedTopic = useMemo(
    () => topics.find((topic) => topic.id === loadedTopicId),
    [loadedTopicId, topics],
  );

  async function loadQueue() {
    if (!selectedTopicId) {
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const result = await fetch(professorReviewQueuePath(selectedTopicId));
      const payload = (await result.json()) as {
        candidates?: ProfessorReviewCandidateDto[];
        error?: string;
        topicProgress?: ProfessorTopicReviewProgress;
      };

      if (!result.ok || !payload.candidates || !payload.topicProgress) {
        setMessage(payload.error ?? "Review queue could not load.");
        return;
      }

      const sorted = sortProfessorReviewCandidates(payload.candidates);
      setCandidates(sorted);
      setLoadedTopicId(selectedTopicId);
      setReviewedCount(0);
      setNote("");
      setTopicProgress(payload.topicProgress);
      setMessage(
        sorted.length > 0
          ? `Loaded ${sorted.length} generated review item(s) for this topic.`
          : "No generated questions need review for this topic right now.",
      );
    } catch {
      setMessage("Review queue could not load.");
    } finally {
      setIsLoading(false);
    }
  }

  async function reviewCurrent(action: ReviewAction) {
    if (!current) {
      return;
    }

    setActiveAction(action);
    setMessage(null);

    try {
      const result = await fetch("/api/professor/review", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          candidateId: current.id,
          notes: note,
          reviewPriority:
            action === "approve"
              ? "priority"
              : (current.review.reviewPriority ?? "normal"),
        }),
      });
      const payload = (await result.json()) as {
        candidate?: ProfessorReviewCandidateDto;
        error?: string;
      };

      if (!result.ok || !payload.candidate) {
        setMessage(payload.error ?? "Review action failed.");
        return;
      }

      const reviewedCandidate = payload.candidate;
      setCandidates((items) => items.slice(1));
      setReviewedCount((count) => count + 1);
      setNote("");
      setTopicProgress((progress) =>
        progress
          ? advanceProfessorTopicReviewProgress(
              progress,
              reviewedCandidate.review.status,
            )
          : progress,
      );
      setMessage(
        `Marked ${reviewedCandidate.title} as ${reviewedCandidate.review.status}.`,
      );
    } catch {
      setMessage("Review action failed.");
    } finally {
      setActiveAction(null);
    }
  }

  function selectTopic(topicId: string) {
    setSelectedTopicId(topicId);
    setLoadedTopicId(null);
    setCandidates([]);
    setMessage(null);
    setNote("");
    setReviewedCount(0);
    setTopicProgress(null);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Syllabus topic
          <select
            value={selectedTopicId}
            disabled={isLoading}
            onChange={(event) => selectTopic(event.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <option value="">Choose a topic</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={!selectedTopicId || isLoading}
          onClick={loadQueue}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Load review queue
        </Button>
      </div>

      {topicProgress ? (
        <div className="space-y-2">
          <section
            aria-label={`${loadedTopic?.title ?? "Selected topic"} review progress`}
            className="grid grid-cols-2 gap-2 sm:grid-cols-5"
          >
            <ProgressCount
              label="Total drafts"
              value={topicProgress.totalDrafts}
            />
            <ProgressCount
              label="Needs review"
              value={topicProgress.needsReview}
            />
            <ProgressCount label="Approved" value={topicProgress.approved} />
            <ProgressCount label="Rejected" value={topicProgress.rejected} />
            <ProgressCount label="Remaining" value={topicProgress.remaining} />
          </section>
          <p className="text-xs text-muted-foreground">
            Remaining includes drafts awaiting review, edits, or regeneration.
          </p>
        </div>
      ) : null}

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
                {loadedTopic?.title ?? current.topic ?? current.topicId}
              </Badge>
              <h2 className="text-xl font-semibold tracking-normal">
                {current.title}
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {reviewedCount + 1} of {reviewedCount + candidates.length}
              </Badge>
              <Badge variant="secondary">{current.difficulty}</Badge>
            </div>
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
          {loadedTopicId
            ? `No needs-review drafts remain for ${loadedTopic?.title ?? "this topic"}.`
            : "Select one syllabus topic, then load its review queue."}
        </div>
      )}
    </div>
  );
}

function ProgressCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function ReviewBlock({ title, values }: { title: string; values: string[] }) {
  const safeValues = values.filter(Boolean);

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
  );
}

function ActionButton({
  action,
  activeAction,
  icon,
  label,
  onClick,
  variant = "default",
}: {
  action: ReviewAction;
  activeAction: ReviewAction | null;
  icon: ReactNode;
  label: string;
  onClick: (action: ReviewAction) => void;
  variant?: "default" | "destructive" | "outline";
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
  );
}
