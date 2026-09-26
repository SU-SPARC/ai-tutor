"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

import {
  formatProfessorDate,
  questionStateLabel,
  REVISION_METHOD_LABELS,
} from "@/components/professor/professor-question-labels";
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
import {
  professorReviewReasonLabel,
  professorReviewReasonRequiresNote,
} from "@/lib/tutor/professor-review-reasons";
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

const ACTION_LABELS: Record<QuestionLifecycleBatchAction, string> = {
  publish: "publish",
  reject: "reject",
  request_revision: "request revision",
};

/**
 * What the professor sees for one selected question. `cancelled` means the
 * question itself passed, but the batch changed nothing because another
 * selected question was blocked.
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
  note,
  onCancel,
  onCompleted,
  onRemoveQuestion,
  questions,
  reasonCode,
  revisionMethod,
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
  note?: string;
  onCancel: () => void;
  onCompleted: (result: QuestionLifecycleBatchResult) => void;
  onRemoveQuestion?: (versionId: number) => void;
  questions: QuestionLifecycleDto[];
  reasonCode?: string;
  revisionMethod: QuestionRevisionMethod;
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const [failures, setFailures] = useState<QuestionLifecycleBatchFailure[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>();
  const [isChecking, setIsChecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
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
      setMessage("Select at least two questions to publish together.");
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
        setMessage(
          payload.error ??
            "The publication check could not run. Nothing was changed.",
        );
        return;
      }
      setPreview(payload.preview);
    } catch {
      setMessage("The publication check could not run. Nothing was changed.");
    } finally {
      setIsChecking(false);
    }
  }, [questions]);

  // Publishing needs the check, so run it as soon as the selection is known
  // instead of waiting for a separate click. Re-run when the selection changes.
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
      !note?.trim()
    ) {
      setMessage("Other requires an audit note.");
      return;
    }
    if (action === "publish" && !allReady) {
      setMessage(
        blockedCount > 0
          ? `${blockedCount} of ${questions.length} selected questions cannot be published yet. Fix or remove them, then publish.`
          : "Wait for the publication check to finish before publishing.",
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
          note: note?.trim() || undefined,
          reasonCode:
            action === "publish" ? undefined : reasonCode?.trim() || undefined,
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
          payload.error ??
            `Nothing was changed. The batch ${ACTION_LABELS[action]} did not go through.`,
        );
        return;
      }
      onCompleted(payload.result);
    } catch {
      setMessage(
        `Nothing was changed. The batch ${ACTION_LABELS[action]} request could not be completed.`,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const busy = disabled || isSubmitting || isChecking;
  const title = `Confirm batch ${ACTION_LABELS[action]}`;
  const description =
    action === "publish"
      ? `Each selected question is checked against the publication requirements first. The check changes nothing. When you confirm, all ${questions.length} questions are published together, or none of them are.`
      : "This operation contains no approval step. It will apply to every selected version in one transaction, or to none of them.";

  const body = (
    <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Selected topic summary"
      >
        {[...selectedTopics]
          .sort(
            ([leftId], [rightId]) =>
              (topicOrders.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
                (topicOrders.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
              leftId.localeCompare(rightId),
          )
          .map(([topicId, count]) => (
            <StatusChip
              key={topicId}
              icon={false}
              label={`${topicTitles.get(topicId) ?? topicId}: ${count}`}
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
          <div className="flex flex-col gap-1 type-small text-ink">
            <p>
              Reason:{" "}
              <span className="font-medium">
                {reasonCode
                  ? professorReviewReasonLabel(reasonCode)
                  : "Not selected"}
              </span>
              {action === "request_revision"
                ? ` · Method: ${REVISION_METHOD_LABELS[revisionMethod]}`
                : ""}
            </p>
            {note ? <p>Audit note: {note}</p> : null}
          </div>
        </>
      )}

      <div role="status" aria-live="polite">
        {message ? (
          <p className="flex items-start gap-2 type-small text-red-700">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
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
        variant="ghost"
        disabled={isSubmitting}
        onClick={onCancel}
      >
        Cancel
      </Button>
      {action === "publish" ? (
        <Button
          type="button"
          disabled={busy}
          variant="outline"
          onClick={() => void runPublicationCheck()}
        >
          {isChecking ? "Checking…" : "Check again"}
        </Button>
      ) : null}
      <Button
        type="button"
        loading={isSubmitting}
        variant={action === "reject" ? "destructive" : "primary"}
        onClick={() => void confirmBatch()}
        disabled={busy || (action === "publish" && !allReady)}
      >
        {action === "publish"
          ? `Publish ${questions.length} questions`
          : `Confirm ${ACTION_LABELS[action]} for ${questions.length} questions`}
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
        <p className="type-body max-w-prose text-ink-muted">{description}</p>
      </div>
      {body}
      <div className="flex flex-wrap justify-end gap-3">{buttons}</div>
    </section>
  );
}

/**
 * The per-question publication check: every selected question with its
 * current outcome, a summary line, and a way to drop blocked questions.
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
    summary = `Checking ${total} questions against the publication requirements…`;
  } else if (cancelledCount > 0) {
    summary = `Nothing was published. ${blockedCount} of ${total} questions did not pass the publication check, so the other ${cancelledCount} were left unchanged.`;
  } else if (readyCount === total) {
    summary = `All ${total} questions can be published.`;
  } else if (blockedCount > 0) {
    summary = `${readyCount} of ${total} questions can be published. ${blockedCount} ${blockedCount === 1 ? "is" : "are"} blocked: fix or remove ${blockedCount === 1 ? "it" : "them"}, then publish.`;
  } else {
    summary = "The publication check has not run for this selection yet.";
  }

  return (
    <section
      aria-label="Publication check"
      className="flex flex-col gap-3 rounded-panel bg-surface-tint p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="type-h3 text-ink">Publication check</h3>
        {!isChecking && (readyCount > 0 || blockedCount > 0) ? (
          <>
            <StatusChip label={`${readyCount} Ready`} tone="approved" />
            {blockedCount > 0 ? (
              <StatusChip label={`${blockedCount} Blocked`} tone="wrong" />
            ) : null}
          </>
        ) : null}
      </div>
      <p role="status" className="type-small max-w-prose text-ink">
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
      <p className="type-caption max-w-prose">
        Publishing repeats every check on the server before anything changes.
        Students see a question only after the whole batch commits.
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
          {action === "publish"
            ? "Publication check for each selected question"
            : "Outcome for each selected question"}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Question</TableHead>
            <TableHead>Topic</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>
              {action === "publish" ? "Publication check" : "Outcome"}
            </TableHead>
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
                <TableCell className="min-w-40 font-medium">
                  {version.title}
                </TableCell>
                <TableCell className="min-w-32">
                  {topicTitles.get(version.topicId) ?? version.topicId}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="font-mono">v{version.versionNumber}</span>{" "}
                  · {questionStateLabel(version.state)}
                </TableCell>
                <TableCell className="min-w-56">
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
      return <span className="text-ink-muted">Checking…</span>;
    case "unchecked":
      return (
        <span className="text-ink-muted">
          {action === "publish" ? "Not checked yet" : "Not applied yet"}
        </span>
      );
    case "ready":
      return (
        <div className="flex flex-col gap-1">
          <StatusChip label="Ready to publish" tone="approved" />
          <p className="text-ink-muted">
            {reviewEvidenceText(outcome.reviewEvidence)}
          </p>
        </div>
      );
    case "cancelled":
      return (
        <div className="flex flex-col gap-1">
          <StatusChip icon={false} label="Not changed" tone="neutral" />
          <p className="text-ink-muted">
            This question passed, but the batch was cancelled because another
            selected question was blocked. Nothing changed.
          </p>
        </div>
      );
    case "blocked": {
      const failure = outcome.failure;
      const guidance = failureGuidance(failure);
      return (
        <div className="flex flex-col gap-1.5">
          <StatusChip
            label={action === "publish" ? "Cannot publish yet" : "Blocked"}
            tone="wrong"
          />
          {failure.publicationBlockers?.length ? (
            <>
              <p className="text-ink">Publication requirements not met:</p>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-ink">
                {failure.publicationBlockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-ink">{failure.message}</p>
          )}
          {guidance ? <p className="text-ink-muted">{guidance}</p> : null}
          {onRemove ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              disabled={disabled}
              onClick={onRemove}
            >
              Remove from selection
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
  if (!evidence) return "This exact version passed every publication check.";
  const date = formatProfessorDate(evidence.reviewedAt);
  return evidence.kind === "approval"
    ? `You approved this exact version on ${date}. It passed every publication check.`
    : `You inspected this exact version on ${date}. It passed every publication check.`;
}

function failureGuidance(failure: QuestionLifecycleBatchFailure) {
  switch (failure.code) {
    case "stale_state":
      return failure.actualState === "published"
        ? "Remove it from the selection; nothing more is needed for it."
        : "Refresh the page to load its current state, then select it again if it still applies.";
    case "stale_version":
      return "Refresh the page to load the current working version, then select it again if it still applies.";
    case "validation_failed":
      return "Resolve each requirement, then check again. A provenance correction or content revision creates a new version that must be approved before it can be published.";
    case "invalid_state":
      return "Only an approved (or previously unpublished) working version can be published.";
    default:
      return undefined;
  }
}
