"use client";

import { useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, RotateCcw, Save, X } from "lucide-react";

import { ProfessorReviewReasonFields } from "@/components/professor/professor-review-reason-fields";
import {
  professorDifficultyLabel,
  ProfessorTime,
} from "@/components/professor/professor-question-labels";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { MetricTile } from "@/components/ui/metric-tile";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { questionCode, studentDifficultyLabel } from "@/lib/labels";
import { professorReviewQueuePath } from "@/lib/tutor/professor-review-mode";
import { professorReviewReasonRequiresNote } from "@/lib/tutor/professor-review-reasons";
import type {
  Difficulty,
  ProfessorQuestionReviewCandidateDto,
  ProfessorQuestionReviewDashboard,
  QuestionRevisionMethod,
} from "@/lib/types";

type ReviewAction =
  | "approve"
  | "reject"
  | "request_edit"
  | "request_regeneration";

type TopicSummary = ProfessorQuestionReviewDashboard["topics"][number];

/**
 * How the answer is checked, as one header word. The spec is optional on older
 * records, and "short answer" is what an unspecified one behaves like.
 */
function answerTypeLabel(candidate: ProfessorQuestionReviewCandidateDto) {
  switch (candidate.answer.spec?.kind) {
    case "numeric":
      return "numeric";
    case "categorical":
      return "categorical";
    case "number_list":
      return "number list";
    default:
      return "short answer";
  }
}

const DIFFICULTIES = [
  "foundational",
  "intermediate",
  "challenge",
] as const satisfies readonly Difficulty[];

/**
 * The review queue for one syllabus topic: choose a topic, then work through
 * its questions in a split view (the list on the left, the question as a
 * student meets it on the right, with the decision underneath). Questions
 * load only for the chosen topic, and each decision is a server-authorized
 * transition; approving never publishes.
 */
export function ProfessorFriendlyReviewPanel({
  initialDashboard,
  initialTopicId,
}: {
  initialDashboard: ProfessorQuestionReviewDashboard;
  /**
   * A topic the server already loaded candidates for (from `?topic=`), so a
   * link into the queue opens on its first question instead of an empty form.
   */
  initialTopicId?: string;
}) {
  const preloadedTopicId =
    initialTopicId && initialDashboard.selectedTopicId === initialTopicId
      ? initialTopicId
      : "";
  const [activeAction, setActiveAction] = useState<ReviewAction | null>(null);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedTopicId, setLoadedTopicId] = useState<string | null>(
    preloadedTopicId || null,
  );
  // The list keeps the order the queue loaded in; choosing a question only
  // moves it to the front of `candidates`, which is what the preview shows.
  const [listOrder, setListOrder] = useState<string[]>(() =>
    initialDashboard.candidates.map((candidate) => candidate.questionId),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [reviewedCount, setReviewedCount] = useState(0);
  const [selectedTopicId, setSelectedTopicId] = useState(preloadedTopicId);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(
    initialDashboard.candidates[0]?.difficulty ?? "foundational",
  );
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const listHeadingId = useId();
  const previewHeadingId = useId();
  const decisionHeadingId = useId();
  const topicsHeadingId = useId();

  const current = dashboard.candidates[0];
  const selectedTopic = useMemo(
    () => dashboard.topics.find((topic) => topic.topicId === selectedTopicId),
    [dashboard.topics, selectedTopicId],
  );
  const orderedCandidates = useMemo(() => {
    const position = new Map(listOrder.map((id, index) => [id, index]));
    return [...dashboard.candidates].sort(
      (left, right) =>
        (position.get(left.questionId) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(right.questionId) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [dashboard.candidates, listOrder]);
  const counts = selectedTopic ?? totalsFor(dashboard.topics);

  function adoptDashboard(nextDashboard: ProfessorQuestionReviewDashboard) {
    setDashboard(nextDashboard);
    setListOrder(
      nextDashboard.candidates.map((candidate) => candidate.questionId),
    );
    setSelectedDifficulty(
      nextDashboard.candidates[0]?.difficulty ?? "foundational",
    );
  }

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

  async function loadQueue(topicId = selectedTopicId) {
    if (!topicId) return;
    setIsLoading(true);
    setMessage(null);

    try {
      const nextDashboard = await requestTopicDashboard(topicId);
      adoptDashboard(nextDashboard);
      setLoadedTopicId(topicId);
      setReviewedCount(0);
      setNote("");
      setReasonCode("");
      const topic = nextDashboard.topics.find(
        (item) => item.topicId === topicId,
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
    if (action !== "approve" && !reasonCode) {
      setMessage("Choose a reason before requesting revision or rejection.");
      return;
    }
    if (
      action !== "approve" &&
      professorReviewReasonRequiresNote(reasonCode) &&
      !note.trim()
    ) {
      setMessage("Other requires an audit note.");
      return;
    }

    const transition = transitionForAction(action);
    const approvedDifficulty = selectedDifficulty;
    const difficultyChanged =
      action === "approve" && approvedDifficulty !== current.difficulty;
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
            reasonCode: action === "approve" ? undefined : reasonCode,
            revisionMethod: transition.revisionMethod,
            versionId: current.versionId,
            ...(action === "approve" ? { difficulty: approvedDifficulty } : {}),
          }),
        },
      );
      const payload = (await result.json()) as {
        error?: string;
        question?: {
          workingVersion: { versionNumber: number };
        };
      };
      if (!result.ok) {
        throw new Error(payload.error ?? "Review action failed.");
      }

      setReviewedCount((count) => count + 1);
      setNote("");
      setReasonCode("");
      try {
        const nextDashboard = await requestTopicDashboard(loadedTopicId);
        adoptDashboard(nextDashboard);
        toast({
          title: difficultyChanged
            ? `${current.title} was revised to ${professorDifficultyLabel(approvedDifficulty).toLowerCase()} as working version ${payload.question?.workingVersion.versionNumber ?? "new"} and approved (not published).`
            : `${current.title} was ${transition.successLabel}.`,
          tone: "success",
        });
        // The next question replaces this one in place; bring its title into
        // view (and focus) so it is read from the top.
        if (nextDashboard.candidates.length > 0) {
          requestAnimationFrame(() => previewHeadingRef.current?.focus());
        }
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
    setReasonCode("");
    setSelectedDifficulty("foundational");
    setReviewedCount(0);
  }

  function focusCandidate(questionId: string) {
    const next = dashboard.candidates.find(
      (candidate) => candidate.questionId === questionId,
    );
    if (!next || next === current) return;
    setDashboard((currentDashboard) => ({
      ...currentDashboard,
      candidates: [
        next,
        ...currentDashboard.candidates.filter(
          (candidate) => candidate.questionId !== questionId,
        ),
      ],
    }));
    setSelectedDifficulty(next.difficulty);
    setNote("");
    setReasonCode("");
    setMessage(null);
  }

  const busy = dashboard.readOnly || Boolean(activeAction);

  return (
    <div className="flex flex-col gap-6">
      {dashboard.readOnly ? (
        <p className="type-small max-w-prose border-l-2 border-input pl-4 text-ink-muted">
          {dashboard.readOnlyReason ?? "This review queue is read-only."}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Syllabus topic" className="min-w-0 sm:max-w-md sm:flex-1">
          <NativeSelect
            value={selectedTopicId}
            disabled={isLoading}
            onChange={(event) => selectTopic(event.target.value)}
          >
            <option value="">Choose a topic</option>
            {dashboard.topics.map((topic) => (
              <option key={topic.topicId} value={topic.topicId}>
                {topic.title} — {topic.needsReview} need review
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button
          type="button"
          disabled={!selectedTopicId || isLoading}
          onClick={() => void loadQueue()}
        >
          {isLoading ? "Loading…" : "Load review queue"}
        </Button>
      </div>

      <section aria-label={`Review counts for ${counts.title}`}>
        <p className="mb-2 type-label">{counts.title}</p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricTile
            label="Needs review"
            value={counts.needsReview}
            delta="Waiting on a decision"
          />
          <MetricTile
            label="Approved"
            value={counts.approved}
            delta={
              <Link
                href="/professor/questions?view=approved"
                className="text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
              >
                Publish from the bank
              </Link>
            }
          />
          <MetricTile
            label="Rejected / revision"
            value={counts.rejectedOrRevisionRequested}
            delta={
              <Link
                href="/professor/questions?view=revision_requested"
                className="text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
              >
                See revisions
              </Link>
            }
          />
          <MetricTile
            label="Remaining"
            value={counts.remaining}
            delta="Drafts and revisions in progress"
          />
        </div>
      </section>

      <div role="status" aria-live="polite">
        {message ? (
          <p className="type-small max-w-prose border-l-2 border-azure-500 py-1 pl-4 text-ink">
            {message}
          </p>
        ) : null}
      </div>

      {current ? (
        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          <section
            aria-labelledby={listHeadingId}
            className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-span-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id={listHeadingId} className="type-h3 text-ink">
                Waiting on review
              </h2>
              <p className="type-caption tabular">
                {dashboard.candidates.length} left
                {reviewedCount > 0 ? ` · ${reviewedCount} decided` : ""}
              </p>
            </div>
            <ol className="flex flex-col overflow-y-auto rounded-panel bg-sheet lg:max-h-[calc(100svh-var(--header-h)-8rem)]">
              {orderedCandidates.map((candidate) => {
                const isCurrent = candidate === current;
                return (
                  <li
                    key={candidate.questionId}
                    className="border-b border-rule last:border-b-0"
                  >
                    <button
                      type="button"
                      aria-current={isCurrent ? "true" : undefined}
                      disabled={Boolean(activeAction)}
                      onClick={() => focusCandidate(candidate.questionId)}
                      className="flex w-full flex-col gap-1.5 border-l-2 border-transparent px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-tint focus-ring aria-[current=true]:border-azure-500 aria-[current=true]:bg-azure-100 disabled:cursor-not-allowed"
                    >
                      <span className="type-caption">
                        <span className="font-mono">
                          {questionCode(candidate.questionId)}
                        </span>
                        {" · "}
                        {professorDifficultyLabel(candidate.difficulty)}
                      </span>
                      <span className="type-body-strong text-ink">
                        {candidate.title}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <StatusChip label="Needs review" tone="review" />
                        {candidate.review.reviewPriority === "priority" ? (
                          <StatusChip
                            icon={false}
                            label="Priority"
                            tone="neutral"
                          />
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <article
            aria-labelledby={previewHeadingId}
            className="flex min-w-0 flex-col gap-6 lg:col-span-3"
          >
            <header className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <StatusChip
                  icon={false}
                  label={`Working version ${current.versionNumber}`}
                  tone="neutral"
                />
                {current.publishedVersionId ? (
                  <StatusChip
                    label="Published version remains live"
                    tone="published"
                  />
                ) : null}
              </div>
              <h2
                id={previewHeadingId}
                ref={previewHeadingRef}
                tabIndex={-1}
                className="type-h2 scroll-mt-[calc(var(--header-h)+1rem)] text-ink focus-ring"
              >
                {current.title}
              </h2>
              <p className="type-caption">
                Created by {current.createdBy.displayName} ·{" "}
                <ProfessorTime value={current.createdAt} />
              </p>
            </header>

            {/* The candidate as a student would meet it, with the whole hint
                and step ladder already down and the accepted answer in the
                field: what is being approved is the page, not a list of
                fields. */}
            <QuestionSheet
              answer={{
                value: current.answer.acceptedAnswers.join(", "),
                onChange: () => {},
                onCheck: () => {},
                disabled: true,
                helper:
                  "Students see an empty field; this is the accepted answer",
              }}
              header={{
                topicLabel: selectedTopic?.title ?? "",
                questionCode: questionCode(current.questionId),
                answerType: answerTypeLabel(current),
                difficultyLabel: studentDifficultyLabel(selectedDifficulty),
              }}
              headingLevel={3}
              hints={{ total: current.hints.length, revealed: current.hints }}
              prompt={current.prompt}
              steps={{ revealed: current.solutionSteps }}
            />

            <div className="flex flex-col gap-5">
              <ReviewBlock
                title="Answer explanation"
                values={[current.answer.explanation]}
              />
              <ReviewBlock
                title="Misconceptions"
                values={current.misconceptions.map((item) => item.feedback)}
              />
              <ReviewBlock
                title="Source and originality"
                values={[
                  current.source.originalityNote ??
                    "No public-safe originality note is recorded.",
                ]}
              />
            </div>

            <section
              aria-labelledby={decisionHeadingId}
              className="flex flex-col gap-5 rounded-panel bg-surface-tint p-4 sm:p-5"
            >
              <h3 id={decisionHeadingId} className="type-h3 text-ink">
                Your decision
              </h3>
              <Field
                label="Difficulty"
                description="AI or an import may suggest a difficulty; you have final authority. Changing it creates a new immutable manual revision before approval. Approval still does not publish the question."
                className="max-w-md"
              >
                <NativeSelect
                  disabled={busy}
                  value={selectedDifficulty}
                  onChange={(event) =>
                    setSelectedDifficulty(event.target.value as Difficulty)
                  }
                >
                  {DIFFICULTIES.map((difficulty) => (
                    <option key={difficulty} value={difficulty}>
                      {professorDifficultyLabel(difficulty)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <ProfessorReviewReasonFields
                disabled={busy}
                note={note}
                onNoteChange={setNote}
                onReasonCodeChange={setReasonCode}
                reasonCode={reasonCode}
              />
              <p className="-mt-2 type-caption">
                Approve needs no reason. Request edit, Request regeneration and
                Reject do.
              </p>

              <div className="flex flex-wrap gap-2">
                {current.allowedActions.includes("approve") ? (
                  <Button
                    type="button"
                    disabled={busy}
                    loading={activeAction === "approve"}
                    onClick={() => void reviewCurrent("approve")}
                  >
                    <Check aria-hidden="true" />
                    Approve
                  </Button>
                ) : null}
                {current.allowedActions.includes("request_revision") ? (
                  <>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      loading={activeAction === "request_edit"}
                      onClick={() => void reviewCurrent("request_edit")}
                    >
                      <Save aria-hidden="true" />
                      Request edit
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      loading={activeAction === "request_regeneration"}
                      onClick={() => void reviewCurrent("request_regeneration")}
                    >
                      <RotateCcw aria-hidden="true" />
                      Request regeneration
                    </Button>
                  </>
                ) : null}
                {current.allowedActions.includes("reject") ? (
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={busy}
                    loading={activeAction === "reject"}
                    onClick={() => void reviewCurrent("reject")}
                  >
                    <X aria-hidden="true" />
                    Reject
                  </Button>
                ) : null}
              </div>
            </section>
          </article>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <ReviewQueueEmptyState
            loaded={loadedTopicId === selectedTopicId && Boolean(loadedTopicId)}
            selectedTopic={selectedTopic}
          />
          <section
            aria-labelledby={topicsHeadingId}
            className="flex flex-col gap-3"
          >
            <h2 id={topicsHeadingId} className="type-h3 text-ink">
              Topics in syllabus order
            </h2>
            <div className="rounded-panel bg-sheet">
              <Table>
                <TableCaption className="sr-only">
                  Review counts for every syllabus topic. Choose a topic to
                  load its queue.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead numeric>Needs review</TableHead>
                    <TableHead numeric>Approved</TableHead>
                    <TableHead numeric>Rejected / revision</TableHead>
                    <TableHead numeric>Remaining</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.topics.map((topic) => (
                    <TableRow
                      key={topic.topicId}
                      data-state={
                        selectedTopicId === topic.topicId
                          ? "selected"
                          : undefined
                      }
                    >
                      <TableCell className="min-w-56">
                        <button
                          type="button"
                          disabled={isLoading}
                          aria-label={`Review ${topic.title}`}
                          className="rounded-control text-left text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring disabled:text-ink-muted"
                          onClick={() => {
                            selectTopic(topic.topicId);
                            void loadQueue(topic.topicId);
                          }}
                        >
                          {topic.title}
                        </button>
                      </TableCell>
                      <TableCell numeric>{topic.needsReview}</TableCell>
                      <TableCell numeric>{topic.approved}</TableCell>
                      <TableCell numeric>
                        {topic.rejectedOrRevisionRequested}
                      </TableCell>
                      <TableCell numeric>{topic.remaining}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function totalsFor(topics: TopicSummary[]) {
  return topics.reduce(
    (sum, topic) => ({
      approved: sum.approved + topic.approved,
      needsReview: sum.needsReview + topic.needsReview,
      rejectedOrRevisionRequested:
        sum.rejectedOrRevisionRequested + topic.rejectedOrRevisionRequested,
      remaining: sum.remaining + topic.remaining,
      title: sum.title,
    }),
    {
      approved: 0,
      needsReview: 0,
      rejectedOrRevisionRequested: 0,
      remaining: 0,
      title: "All topics",
    },
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
  revisionMethod?: QuestionRevisionMethod;
  successLabel: string;
} {
  if (action === "approve") {
    return { action: "approve", successLabel: "approved (not published)" };
  }
  if (action === "reject") {
    return {
      action: "reject",
      successLabel: "rejected",
    };
  }
  return {
    action: "request_revision",
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
  selectedTopic?: TopicSummary;
}) {
  const text = professorReviewEmptyStateText({ loaded, selectedTopic });

  return (
    <EmptyState className="rounded-panel bg-sheet px-5">{text}</EmptyState>
  );
}

export function professorReviewEmptyStateText({
  loaded,
  selectedTopic,
}: {
  loaded: boolean;
  selectedTopic?: TopicSummary;
}) {
  let text = "Select one syllabus topic, then load its review queue.";
  if (selectedTopic && !loaded) {
    text = `Load ${selectedTopic.title} to view only that topic's review candidates.`;
  } else if (selectedTopic && selectedTopic.total === 0) {
    text = `${selectedTopic.title} has no question records yet.`;
  } else if (selectedTopic && selectedTopic.remaining === 0) {
    text = `Review complete for ${selectedTopic.title}. Nothing remains in its working queue.`;
  } else if (selectedTopic && loaded) {
    text = `No versions currently need review for ${selectedTopic.title}. ${selectedTopic.remaining} draft or revision ${selectedTopic.remaining === 1 ? "item remains" : "items remain"}.`;
  }
  return text;
}

function ReviewBlock({ title, values }: { title: string; values: string[] }) {
  const safeValues = values.filter(Boolean);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="type-h3 text-ink">{title}</h3>
      {safeValues.length > 1 ? (
        <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5 type-body text-ink">
          {safeValues.map((value, index) => (
            <li key={`${title}-${index}`}>{value}</li>
          ))}
        </ul>
      ) : safeValues.length === 1 ? (
        <p className="type-body max-w-prose text-ink">{safeValues[0]}</p>
      ) : (
        <p className="type-small text-ink-muted">Nothing recorded.</p>
      )}
    </section>
  );
}
