"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Loader2, RotateCcw, Save, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { professorReviewQueuePath } from "@/lib/tutor/professor-review-mode";
import type {
  ProfessorQuestionReviewDashboard,
  QuestionRevisionMethod,
} from "@/lib/types";

type ReviewAction =
  | "approve"
  | "reject"
  | "request_edit"
  | "request_regeneration";

export function ProfessorFriendlyReviewPanel({
  initialDashboard,
}: {
  initialDashboard: ProfessorQuestionReviewDashboard;
}) {
  const [activeAction, setActiveAction] = useState<ReviewAction | null>(null);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedTopicId, setLoadedTopicId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reviewedCount, setReviewedCount] = useState(0);
  const [selectedTopicId, setSelectedTopicId] = useState("");

  const current = dashboard.candidates[0];
  const selectedTopic = useMemo(
    () => dashboard.topics.find((topic) => topic.topicId === selectedTopicId),
    [dashboard.topics, selectedTopicId],
  );

  async function requestTopicDashboard(topicId: string) {
    const result = await fetch(professorReviewQueuePath(topicId));
    const payload = (await result.json()) as {
      dashboard?: ProfessorQuestionReviewDashboard;
      error?: string;
    };
    if (!result.ok || !payload.dashboard) {
      throw new Error(payload.error ?? "Review queue could not load.");
    }
    return payload.dashboard;
  }

  async function loadQueue() {
    if (!selectedTopicId) return;
    setIsLoading(true);
    setMessage(null);

    try {
      const nextDashboard = await requestTopicDashboard(selectedTopicId);
      setDashboard(nextDashboard);
      setLoadedTopicId(selectedTopicId);
      setReviewedCount(0);
      setNote("");
      const topic = nextDashboard.topics.find(
        (item) => item.topicId === selectedTopicId,
      );
      setMessage(
        nextDashboard.candidates.length > 0
          ? `Loaded ${nextDashboard.candidates.length} review candidate(s) for ${topic?.title ?? "this topic"}.`
          : topic?.total === 0
            ? "This topic has no question records yet."
            : "No versions need a review decision for this topic right now.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Review queue could not load.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  async function reviewCurrent(action: ReviewAction) {
    if (!current || !loadedTopicId) return;
    if (action !== "approve" && !note.trim()) {
      setMessage("Add a short reason before requesting revision or rejection.");
      return;
    }

    const transition = transitionForAction(action);
    setActiveAction(action);
    setMessage(null);

    try {
      const result = await fetch(
        `/api/professor/questions/${encodeURIComponent(current.questionId)}/transitions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": globalThis.crypto.randomUUID(),
          },
          body: JSON.stringify({
            action: transition.action,
            expectedState: current.state,
            note: note.trim() || undefined,
            reasonCode: transition.reasonCode,
            revisionMethod: transition.revisionMethod,
            versionId: current.versionId,
          }),
        },
      );
      const payload = (await result.json()) as { error?: string };
      if (!result.ok) {
        throw new Error(payload.error ?? "Review action failed.");
      }

      setReviewedCount((count) => count + 1);
      setNote("");
      try {
        const nextDashboard = await requestTopicDashboard(loadedTopicId);
        setDashboard(nextDashboard);
        setMessage(`${current.title} was ${transition.successLabel}.`);
      } catch {
        setDashboard((currentDashboard) =>
          advanceDashboardAfterDecision(
            currentDashboard,
            loadedTopicId,
            transition.action,
          ),
        );
        setLoadedTopicId(null);
        setMessage(
          `${current.title} was ${transition.successLabel}. Counts could not refresh; reload this topic before the next decision.`,
        );
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Review action failed.",
      );
    } finally {
      setActiveAction(null);
    }
  }

  function selectTopic(topicId: string) {
    setSelectedTopicId(topicId);
    setLoadedTopicId(null);
    setDashboard((currentDashboard) => ({
      ...currentDashboard,
      candidates: [],
      selectedTopicId: undefined,
    }));
    setMessage(null);
    setNote("");
    setReviewedCount(0);
  }

  return (
    <div className="flex flex-col gap-5">
      {dashboard.readOnly ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {dashboard.readOnlyReason ?? "This review queue is read-only."}
        </div>
      ) : null}

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
            {dashboard.topics.map((topic) => (
              <option key={topic.topicId} value={topic.topicId}>
                {topic.title} — {topic.needsReview} need review
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

      <div
        aria-label="Syllabus topic review counts"
        className="overflow-x-auto border border-border"
      >
        <div className="grid min-w-3xl grid-cols-[minmax(18rem,1fr)_repeat(4,8rem)] bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
          <span>Topic</span>
          <span>Needs review</span>
          <span>Approved</span>
          <span>Rejected / revision</span>
          <span>Remaining</span>
        </div>
        {dashboard.topics.map((topic) => (
          <button
            key={topic.topicId}
            type="button"
            aria-pressed={selectedTopicId === topic.topicId}
            disabled={isLoading}
            className="grid w-full min-w-3xl grid-cols-[minmax(18rem,1fr)_repeat(4,8rem)] border-t border-border px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
            onClick={() => selectTopic(topic.topicId)}
          >
            <span>{topic.title}</span>
            <span className="tabular-nums">{topic.needsReview}</span>
            <span className="tabular-nums">{topic.approved}</span>
            <span className="tabular-nums">
              {topic.rejectedOrRevisionRequested}
            </span>
            <span className="tabular-nums">{topic.remaining}</span>
          </button>
        ))}
      </div>

      {selectedTopic ? (
        <div className="space-y-2">
          <section
            aria-label={`${selectedTopic.title} review progress`}
            className="grid grid-cols-2 gap-2 lg:grid-cols-4"
          >
            <ProgressCount
              label="Needs review"
              value={selectedTopic.needsReview}
            />
            <ProgressCount label="Approved" value={selectedTopic.approved} />
            <ProgressCount
              label="Rejected / revision requested"
              value={selectedTopic.rejectedOrRevisionRequested}
            />
            <ProgressCount label="Remaining" value={selectedTopic.remaining} />
          </section>
          <p className="text-xs text-muted-foreground">
            Remaining includes drafts awaiting submission or review and versions
            awaiting revision. Approval does not publish a version.
          </p>
        </div>
      ) : null}

      {message ? (
        <div
          role="status"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          {message}
        </div>
      ) : null}

      {current ? (
        <article className="space-y-5 border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {selectedTopic?.title ?? current.topicId}
                </Badge>
                <Badge variant="outline">
                  Working version {current.versionNumber}
                </Badge>
                {current.publishedVersionId ? (
                  <Badge variant="secondary">
                    Published version remains live
                  </Badge>
                ) : null}
                {current.review.reviewPriority === "priority" ? (
                  <Badge>priority</Badge>
                ) : null}
              </div>
              <h2 className="text-xl font-semibold tracking-normal">
                {current.title}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Created by {current.createdBy.displayName}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {reviewedCount + 1} of{" "}
                {reviewedCount + dashboard.candidates.length}
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
            values={current.misconceptions.map((item) => item.feedback)}
          />
          <ReviewBlock
            title="Source/originality note"
            values={[
              current.source.originalityNote ??
                "No public-safe originality note is recorded.",
            ]}
          />

          <label className="block space-y-2">
            <span className="text-sm font-medium">Decision note</span>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="min-h-20"
              maxLength={500}
              placeholder="Required for revision or rejection"
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {current.allowedActions.includes("approve") ? (
              <ActionButton
                action="approve"
                activeAction={activeAction}
                disabled={dashboard.readOnly}
                icon={<Check className="h-4 w-4" />}
                label="Approve"
                onClick={reviewCurrent}
              />
            ) : null}
            {current.allowedActions.includes("request_revision") ? (
              <>
                <ActionButton
                  action="request_edit"
                  activeAction={activeAction}
                  disabled={dashboard.readOnly}
                  icon={<Save className="h-4 w-4" />}
                  label="Request edit"
                  onClick={reviewCurrent}
                  variant="outline"
                />
                <ActionButton
                  action="request_regeneration"
                  activeAction={activeAction}
                  disabled={dashboard.readOnly}
                  icon={<RotateCcw className="h-4 w-4" />}
                  label="Request regeneration"
                  onClick={reviewCurrent}
                  variant="outline"
                />
              </>
            ) : null}
            {current.allowedActions.includes("reject") ? (
              <ActionButton
                action="reject"
                activeAction={activeAction}
                disabled={dashboard.readOnly}
                icon={<X className="h-4 w-4" />}
                label="Reject"
                onClick={reviewCurrent}
                variant="destructive"
              />
            ) : null}
          </div>
        </article>
      ) : (
        <ReviewQueueEmptyState
          loaded={loadedTopicId === selectedTopicId && Boolean(loadedTopicId)}
          selectedTopic={selectedTopic}
        />
      )}
    </div>
  );
}

function advanceDashboardAfterDecision(
  dashboard: ProfessorQuestionReviewDashboard,
  topicId: string,
  action: "approve" | "reject" | "request_revision",
): ProfessorQuestionReviewDashboard {
  return {
    ...dashboard,
    candidates: [],
    topics: dashboard.topics.map((topic) =>
      topic.topicId === topicId
        ? {
            ...topic,
            approved: topic.approved + (action === "approve" ? 1 : 0),
            needsReview: Math.max(0, topic.needsReview - 1),
            rejectedOrRevisionRequested:
              topic.rejectedOrRevisionRequested +
              (action === "approve" ? 0 : 1),
            remaining:
              action === "request_revision"
                ? topic.remaining
                : Math.max(0, topic.remaining - 1),
          }
        : topic,
    ),
  };
}

function transitionForAction(action: ReviewAction): {
  action: "approve" | "reject" | "request_revision";
  reasonCode?: string;
  revisionMethod?: QuestionRevisionMethod;
  successLabel: string;
} {
  if (action === "approve") {
    return { action: "approve", successLabel: "approved (not published)" };
  }
  if (action === "reject") {
    return {
      action: "reject",
      reasonCode: "professor_rejected",
      successLabel: "rejected",
    };
  }
  return {
    action: "request_revision",
    reasonCode:
      action === "request_regeneration"
        ? "regeneration_requested"
        : "manual_revision_requested",
    revisionMethod:
      action === "request_regeneration" ? "regeneration" : "manual",
    successLabel:
      action === "request_regeneration"
        ? "sent for regeneration"
        : "sent for revision",
  };
}

function ReviewQueueEmptyState({
  loaded,
  selectedTopic,
}: {
  loaded: boolean;
  selectedTopic?: ProfessorQuestionReviewDashboard["topics"][number];
}) {
  const text = professorReviewEmptyStateText({ loaded, selectedTopic });

  return (
    <div className="border border-border p-6 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

export function professorReviewEmptyStateText({
  loaded,
  selectedTopic,
}: {
  loaded: boolean;
  selectedTopic?: ProfessorQuestionReviewDashboard["topics"][number];
}) {
  let text = "Select one syllabus topic, then load its review queue.";
  if (selectedTopic && !loaded) {
    text = `Load ${selectedTopic.title} to view only that topic's review candidates.`;
  } else if (selectedTopic && selectedTopic.total === 0) {
    text = `${selectedTopic.title} has no question records yet.`;
  } else if (selectedTopic && selectedTopic.remaining === 0) {
    text = `Review complete for ${selectedTopic.title}. Nothing remains in its working queue.`;
  } else if (selectedTopic && loaded) {
    text = `No versions currently need review for ${selectedTopic.title}. ${selectedTopic.remaining} draft or revision item(s) remain.`;
  }
  return text;
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
  disabled,
  icon,
  label,
  onClick,
  variant = "default",
}: {
  action: ReviewAction;
  activeAction: ReviewAction | null;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: (action: ReviewAction) => void;
  variant?: "default" | "destructive" | "outline";
}) {
  return (
    <Button
      type="button"
      disabled={disabled || Boolean(activeAction)}
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
