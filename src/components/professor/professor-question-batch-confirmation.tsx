"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import {
  formatProfessorDate,
  plainActionError,
} from "@/components/professor/professor-question-labels";
import { ProfessorReviewReasonFields } from "@/components/professor/professor-review-reason-fields";
import { Button } from "@/components/ui/button";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { professorReviewReasonRequiresNote } from "@/lib/tutor/professor-review-reasons";
import type {
  QuestionLifecycleBatchAction,
  QuestionLifecycleBatchFailure,
  QuestionLifecycleBatchPreviewResult,
  QuestionLifecycleBatchResult,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionRevisionMethod,
  QuestionVersionReviewEvidence,
} from "@/lib/types";

/** The reason each action starts on, so most professors never change it. */
export const DEFAULT_BATCH_REASONS: Record<
  Exclude<QuestionLifecycleBatchAction, "publish">,
  string
> = {
  reject: "duplicate_repetition",
  request_revision: "poor_wording",
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Show 3 questions to students": the button always restates the action. */
export function batchConfirmLabel(
  action: QuestionLifecycleBatchAction,
  count: number,
) {
  switch (action) {
    case "publish":
      return `Show ${plural(count, "question")} to students`;
    case "reject":
      return `Reject ${plural(count, "question")}`;
    case "request_revision":
      return `Send ${plural(count, "question")} back for changes`;
  }
}

/**
 * What the professor sees for one selected question. `cancelled` means the
 * question itself passed, but nothing changed because another selected
 * question had a problem.
 */
export type BatchQuestionOutcome =
  | { status: "checking" }
  | { status: "unchecked" }
  | { reviewEvidence?: QuestionVersionReviewEvidence; status: "ready" }
  | { failure: QuestionLifecycleBatchFailure; status: "blocked" }
  | { status: "cancelled" };

export function ProfessorQuestionBatchConfirmation({
  action,
  disabled,
  inDialog = false,
  note: initialNote,
  onCancel,
  onCompleted,
  onRemoveQuestion,
  questions,
  reasonCode: initialReasonCode,
  revisionMethod = "manual",
  topics,
}: {
  action: QuestionLifecycleBatchAction;
  disabled: boolean;
  /**
   * Render as the body of a `DialogContent` (title, scrolling body, footer).
   * Without it the confirmation is a plain section, which is how it renders
   * outside a dialog and in tests.
   */
  inDialog?: boolean;
  /** The note to start with; the professor can change it here. */
  note?: string;
  onCancel: () => void;
  onCompleted: (result: QuestionLifecycleBatchResult) => void;
  onRemoveQuestion?: (versionId: number) => void;
  questions: QuestionLifecycleDto[];
  /** The reason to start with; defaults to the most common one. */
  reasonCode?: string;
  revisionMethod?: QuestionRevisionMethod;
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const [failures, setFailures] = useState<QuestionLifecycleBatchFailure[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>();
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
  const [note, setNote] = useState(initialNote ?? "");
  const [noteError, setNoteError] = useState<string>();
  const [reasonCode, setReasonCode] = useState(
    initialReasonCode ??
      (action === "publish" ? "" : DEFAULT_BATCH_REASONS[action]),
  );
  const [preview, setPreview] = useState<QuestionLifecycleBatchPreviewResult>();
  const autoCheckedSelection = useRef<string>(undefined);
  const headingId = useId();
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));
  const topicOrders = new Map(topics.map((topic, index) => [topic.id, index]));
  const selectedTopics = questions.reduce<Map<string, number>>(
    (counts, question) => {
      const topicId = question.workingVersion.topicId;
      counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
      return counts;
    },
    new Map(),
  );
  const selectionKey = questions
    .map(
      (question) =>
        `${question.questionId}:${question.workingVersion.versionId}:${question.workingVersion.state}`,
    )
    .sort()
    .join("|");
  const previewMatchesSelection =
    preview?.items.length === questions.length &&
    questions.every((question) =>
      preview.items.some(
        (item) =>
          item.questionId === question.questionId &&
          item.versionId === question.workingVersion.versionId &&
          item.expectedState === question.workingVersion.state,
      ),
    );
  const currentPreview = previewMatchesSelection ? preview : undefined;
  const outcomes = questionOutcomes({
    failures,
    isChecking,
    preview: currentPreview,
    questions,
  });
  const readyCount = [...outcomes.values()].filter(
    (outcome) => outcome.status === "ready",
  ).length;
  const blockedCount = [...outcomes.values()].filter(
    (outcome) => outcome.status === "blocked",
  ).length;
  const allReady = questions.length > 0 && readyCount === questions.length;

  const runPublicationCheck = useCallback(async () => {
    if (questions.length < 2) {
      setMessage(
        "Tick at least 2 questions to show them together. For one question, use the button on its row.",
      );
      return;
    }
    setIsChecking(true);
    setFailures([]);
    setMessage(undefined);
    try {
      const response = await fetch("/api/professor/questions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          items: batchItems(questions),
          mode: "preview",
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        preview?: QuestionLifecycleBatchPreviewResult;
      };
      if (!response.ok || !payload.preview) {
        setMessage(plainActionError(response.status));
        return;
      }
      setPreview(payload.preview);
    } catch {
      setMessage(plainActionError());
    } finally {
      setIsChecking(false);
    }
  }, [questions]);

  // Showing needs the check, so it runs as soon as the selection is known,
  // and again whenever the selection changes. There is no separate button.
  useEffect(() => {
    if (action !== "publish" || questions.length < 2) return;
    if (autoCheckedSelection.current === selectionKey) return;
    autoCheckedSelection.current = selectionKey;
    void runPublicationCheck();
  }, [action, questions.length, runPublicationCheck, selectionKey]);

  async function confirmBatch() {
    if (
      action !== "publish" &&
      professorReviewReasonRequiresNote(reasonCode) &&
      !note.trim()
    ) {
      setNoteError(
        "Please explain in a few words why you chose Something else.",
      );
      return;
    }
    setNoteError(undefined);
    if (action === "publish" && !allReady) {
      setMessage(
        blockedCount > 0
          ? `${blockedCount} of ${questions.length} questions aren't ready yet. Fix them or remove them from this list first.`
          : "Please wait: we are still checking the questions.",
      );
      return;
    }
    const requestIdempotencyKey = idempotencyKey ?? crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(requestIdempotencyKey);
    setIsSubmitting(true);
    setFailures([]);
    setMessage(undefined);
    try {
      const response = await fetch("/api/professor/questions/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": requestIdempotencyKey,
        },
        body: JSON.stringify({
          action,
          items: batchItems(questions),
          note: note.trim() || undefined,
          reasonCode:
            action === "publish" ? undefined : reasonCode.trim() || undefined,
          revisionMethod:
            action === "request_revision" ? revisionMethod : undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: QuestionLifecycleBatchResult;
      };
      if (!response.ok || !payload.result?.applied) {
        if (action === "publish") setPreview(undefined);
        setFailures(payload.result?.failures ?? []);
        setMessage(
          payload.result?.failures?.length
            ? "Nothing changed. The questions with a problem are marked below."
            : plainActionError(response.status),
        );
        return;
      }
      onCompleted(payload.result);
    } catch {
      setMessage(plainActionError());
    } finally {
      setIsSubmitting(false);
    }
  }

  const busy = disabled || isSubmitting || isChecking;
  const count = questions.length;
  const title =
    action === "publish"
      ? `Show ${plural(count, "question")} to students?`
      : action === "reject"
        ? `Reject ${plural(count, "question")}?`
        : `Send ${plural(count, "question")} back for changes?`;
  const description =
    action === "publish"
      ? "We check each question first. If any has a problem, nothing changes."
      : action === "reject"
        ? "Students won't see these questions. If any can't be rejected, nothing changes."
        : "Each question goes back to being written. If any can't be sent back, nothing changes.";

  const body = (
    <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Topics in this list"
      >
        {[...selectedTopics]
          .sort(
            ([leftId], [rightId]) =>
              (topicOrders.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
                (topicOrders.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
              leftId.localeCompare(rightId),
          )
          .map(([topicId, topicCount]) => (
            <StatusChip
              key={topicId}
              icon={false}
              label={`${topicTitles.get(topicId) ?? topicId}: ${topicCount}`}
              tone="neutral"
            />
          ))}
      </div>

      {action === "publish" ? (
        <ProfessorBatchPublicationCheck
          disabled={busy}
          isChecking={isChecking}
          onRemoveQuestion={(versionId) => {
            setPreview(undefined);
            setFailures([]);
            onRemoveQuestion?.(versionId);
          }}
          outcomes={outcomes}
          questions={questions}
          topics={topics}
        />
      ) : (
        <>
          <ProfessorBatchQuestionOutcomes
            action={action}
            disabled={busy}
            onRemoveQuestion={
              onRemoveQuestion
                ? (versionId) => {
                    setFailures([]);
                    onRemoveQuestion(versionId);
                  }
                : undefined
            }
            outcomes={outcomes}
            questions={questions}
            topics={topics}
          />
          <ProfessorReviewReasonFields
            disabled={busy}
            includeLifecycleReasons
            note={note}
            noteError={noteError}
            onNoteChange={(next) => {
              setNote(next);
              setNoteError(undefined);
            }}
            onReasonCodeChange={setReasonCode}
            reasonCode={reasonCode}
          />
        </>
      )}

      <div role="status" aria-live="polite">
        {message ? (
          <p className="flex items-start gap-2 type-body text-red-700">
            <AlertTriangle
              aria-hidden="true"
              className="mt-1 size-4 shrink-0"
            />
            {message}
          </p>
        ) : null}
      </div>
    </>
  );

  const buttons = (
    <>
      <Button
        type="button"
        variant="secondary"
        className="h-11"
        disabled={isSubmitting}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        type="button"
        className="h-11"
        loading={isSubmitting}
        variant={
          action === "reject"
            ? "destructive"
            : action === "publish"
              ? "cta"
              : "primary"
        }
        onClick={() => void confirmBatch()}
        disabled={
          busy ||
          (action === "publish" && !allReady) ||
          (action !== "publish" && !reasonCode)
        }
      >
        {batchConfirmLabel(action, count)}
      </Button>
    </>
  );

  if (inDialog) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">{body}</DialogBody>
        <DialogFooter>{buttons}</DialogFooter>
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={headingId} className="type-h2 text-ink">
          {title}
        </h2>
        <p className="type-body max-w-prose text-ink">{description}</p>
      </div>
      {body}
      <div className="flex flex-wrap justify-end gap-3">{buttons}</div>
    </section>
  );
}

/**
 * The check before showing questions to students: every selected question
 * with its result, a summary line, and a way to drop the ones not ready.
 */
export function ProfessorBatchPublicationCheck({
  disabled,
  isChecking,
  onRemoveQuestion,
  outcomes,
  questions,
  topics,
}: {
  disabled: boolean;
  isChecking: boolean;
  onRemoveQuestion: (versionId: number) => void;
  outcomes: Map<number, BatchQuestionOutcome>;
  questions: QuestionLifecycleDto[];
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const readyCount = [...outcomes.values()].filter(
    (outcome) => outcome.status === "ready",
  ).length;
  const blockedCount = [...outcomes.values()].filter(
    (outcome) => outcome.status === "blocked",
  ).length;
  const cancelledCount = [...outcomes.values()].filter(
    (outcome) => outcome.status === "cancelled",
  ).length;
  const total = questions.length;
  let summary: string;
  if (isChecking) {
    summary = `Checking ${plural(total, "question")}…`;
  } else if (cancelledCount > 0) {
    summary = `Nothing changed. ${blockedCount} of ${total} questions had a problem, so the other ${cancelledCount} ${cancelledCount === 1 ? "was" : "were"} left as ${cancelledCount === 1 ? "it was" : "they were"}.`;
  } else if (readyCount === total) {
    summary = `All ${plural(total, "question")} ${total === 1 ? "is" : "are"} ready to show to students.`;
  } else if (blockedCount > 0) {
    summary = `${readyCount} of ${total} questions are ready. ${blockedCount} ${blockedCount === 1 ? "isn't" : "aren't"} ready yet: fix or remove ${blockedCount === 1 ? "it" : "them"} first.`;
  } else {
    summary = "We haven't checked these questions yet.";
  }

  return (
    <section
      aria-label="Check before showing to students"
      className="flex flex-col gap-3 rounded-panel bg-surface-tint p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="type-h3 text-ink">Check before showing to students</h3>
        {!isChecking && (readyCount > 0 || blockedCount > 0) ? (
          <>
            <StatusChip label={`${readyCount} ready`} tone="approved" />
            {blockedCount > 0 ? (
              <StatusChip label={`${blockedCount} not ready`} tone="wrong" />
            ) : null}
          </>
        ) : null}
      </div>
      <p role="status" className="type-body max-w-prose text-ink">
        {summary}
      </p>
      <ProfessorBatchQuestionOutcomes
        action="publish"
        disabled={disabled}
        onRemoveQuestion={onRemoveQuestion}
        outcomes={outcomes}
        questions={questions}
        topics={topics}
      />
      <p className="type-body max-w-prose text-ink">
        Nothing changes for students until every question passes.
      </p>
    </section>
  );
}

function ProfessorBatchQuestionOutcomes({
  action,
  disabled,
  onRemoveQuestion,
  outcomes,
  questions,
  topics,
}: {
  action: QuestionLifecycleBatchAction;
  disabled: boolean;
  onRemoveQuestion?: (versionId: number) => void;
  outcomes: Map<number, BatchQuestionOutcome>;
  questions: QuestionLifecycleDto[];
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));
  return (
    <div className="rounded-panel bg-sheet">
      <Table>
        <TableCaption className="sr-only">
          Result for each question in this list
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Topic</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {questions.map((question) => {
            const version = question.workingVersion;
            const outcome = outcomes.get(version.versionId) ?? {
              status: "unchecked" as const,
            };
            return (
              <TableRow key={question.questionId} className="align-top">
                <TableCell className="min-w-40 type-body font-medium">
                  {version.title}
                </TableCell>
                <TableCell className="min-w-32 type-body">
                  {topicTitles.get(version.topicId) ?? version.topicId}
                </TableCell>
                <TableCell className="min-w-56 type-body">
                  <BatchQuestionOutcomeCell
                    action={action}
                    disabled={disabled}
                    onRemove={
                      onRemoveQuestion
                        ? () => onRemoveQuestion(version.versionId)
                        : undefined
                    }
                    outcome={outcome}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function BatchQuestionOutcomeCell({
  action,
  disabled,
  onRemove,
  outcome,
}: {
  action: QuestionLifecycleBatchAction;
  disabled: boolean;
  onRemove?: () => void;
  outcome: BatchQuestionOutcome;
}) {
  switch (outcome.status) {
    case "checking":
      return <span className="text-ink">Checking…</span>;
    case "unchecked":
      return (
        <span className="text-ink">
          {action === "publish" ? "Not checked yet" : "Not changed yet"}
        </span>
      );
    case "ready":
      return (
        <div className="flex flex-col gap-1">
          <StatusChip label="Ready to show" tone="approved" />
          <p className="text-ink">
            {reviewEvidenceText(outcome.reviewEvidence)}
          </p>
        </div>
      );
    case "cancelled":
      return (
        <div className="flex flex-col gap-1">
          <StatusChip icon={false} label="Not changed" tone="neutral" />
          <p className="text-ink">
            This one was fine, but nothing changed because another question had
            a problem.
          </p>
        </div>
      );
    case "blocked": {
      const failure = outcome.failure;
      const guidance = failureGuidance(failure);
      return (
        <div className="flex flex-col gap-1.5">
          <StatusChip
            label={action === "publish" ? "Not ready yet" : "Can't change"}
            tone="wrong"
          />
          {failure.publicationBlockers?.length ? (
            <>
              <p className="text-ink">Needs fixing:</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-ink">
                {failure.publicationBlockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            </>
          ) : failure.code === "not_inspected" ? (
            <p className="text-ink">
              You haven&apos;t approved or checked this version yourself.
            </p>
          ) : (
            <p className="text-ink">{failure.message}</p>
          )}
          {guidance ? <p className="text-ink">{guidance}</p> : null}
          {onRemove ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 w-fit"
              disabled={disabled}
              onClick={onRemove}
            >
              Remove from this list
            </Button>
          ) : null}
        </div>
      );
    }
  }
}

function questionOutcomes({
  failures,
  isChecking,
  preview,
  questions,
}: {
  failures: QuestionLifecycleBatchFailure[];
  isChecking: boolean;
  preview?: QuestionLifecycleBatchPreviewResult;
  questions: QuestionLifecycleDto[];
}) {
  const outcomes = new Map<number, BatchQuestionOutcome>();
  for (const question of questions) {
    const versionId = question.workingVersion.versionId;
    if (isChecking) {
      outcomes.set(versionId, { status: "checking" });
      continue;
    }
    const failure = failures.find(
      (candidate) =>
        candidate.versionId === versionId &&
        candidate.questionId === question.questionId,
    );
    if (failure) {
      outcomes.set(versionId, { failure, status: "blocked" });
      continue;
    }
    if (failures.length > 0) {
      outcomes.set(versionId, { status: "cancelled" });
      continue;
    }
    const item = preview?.items.find(
      (candidate) =>
        candidate.versionId === versionId &&
        candidate.questionId === question.questionId,
    );
    if (!item) {
      outcomes.set(versionId, { status: "unchecked" });
    } else if (item.status === "ready") {
      outcomes.set(versionId, {
        reviewEvidence: item.reviewEvidence,
        status: "ready",
      });
    } else {
      outcomes.set(versionId, { failure: item, status: "blocked" });
    }
  }
  return outcomes;
}

function batchItems(questions: QuestionLifecycleDto[]) {
  return questions.map((question) => ({
    expectedState: question.workingVersion.state,
    questionId: question.questionId,
    versionId: question.workingVersion.versionId,
  }));
}

function reviewEvidenceText(evidence?: QuestionVersionReviewEvidence) {
  if (!evidence) return "Ready to show to students.";
  const date = formatProfessorDate(evidence.reviewedAt);
  return evidence.kind === "approval"
    ? `You approved this version on ${date}.`
    : `You checked this version on ${date}.`;
}

function failureGuidance(failure: QuestionLifecycleBatchFailure) {
  switch (failure.code) {
    case "stale_state":
      return failure.actualState === "published"
        ? "Students can already see it. Remove it from this list; nothing more is needed."
        : "Reload the page to see where it stands now, then tick it again if it still applies.";
    case "stale_version":
      return "Someone saved a newer version. Reload the page, then tick it again if it still applies.";
    case "validation_failed":
      return "Open this question and fix the items listed, then approve it again.";
    case "invalid_state":
      return "Only approved or hidden questions can be shown to students.";
    case "not_inspected":
      return "Open this question and choose Mark as checked, or approve it yourself.";
    default:
      return undefined;
  }
}
