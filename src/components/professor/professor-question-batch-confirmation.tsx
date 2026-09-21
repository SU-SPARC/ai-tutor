"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  return (
    <section
      aria-label="Confirm batch review operation"
      className="space-y-4 border-2 border-primary/40 bg-muted/20 p-4"
    >
      <div>
        <h2 className="text-lg font-semibold">
          Confirm batch {ACTION_LABELS[action]}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {action === "publish"
            ? `Each selected question is checked against the publication requirements first. The check changes nothing. When you confirm, all ${questions.length} questions are published together, or none of them are.`
            : "This operation contains no approval step. It will apply to every selected version in one transaction, or to none of them."}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Selected topic summary">
        {[...selectedTopics]
          .sort(
            ([leftId], [rightId]) =>
              (topicOrders.get(leftId) ?? Number.MAX_SAFE_INTEGER) -
                (topicOrders.get(rightId) ?? Number.MAX_SAFE_INTEGER) ||
              leftId.localeCompare(rightId),
          )
          .map(([topicId, count]) => (
            <Badge key={topicId} variant="outline">
              {topicTitles.get(topicId) ?? topicId}: {count}
            </Badge>
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
          <div className="space-y-1 text-sm">
            <p>
              Reason:{" "}
              <span className="font-medium">
                {reasonCode
                  ? professorReviewReasonLabel(reasonCode)
                  : "Not selected"}
              </span>
              {action === "request_revision"
                ? ` · Method: ${revisionMethod}`
                : ""}
            </p>
            {note ? <p>Audit note: {note}</p> : null}
          </div>
        </>
      )}

      {message ? (
        <p
          role="status"
          className="flex items-start gap-2 text-sm text-destructive"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {action === "publish" ? (
          <Button
            type="button"
            disabled={busy}
            variant="outline"
            onClick={() => void runPublicationCheck()}
          >
            {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isChecking ? "Checking…" : "Check again"}
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={busy || (action === "publish" && !allReady)}
          variant={action === "reject" ? "destructive" : "default"}
          onClick={() => void confirmBatch()}
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {action === "publish"
            ? `Publish ${questions.length} questions`
            : `Confirm ${ACTION_LABELS[action]} for ${questions.length} questions`}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
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
      className="space-y-3 border border-border bg-background p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Publication check</h3>
        {isChecking ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : null}
        {!isChecking && (readyCount > 0 || blockedCount > 0) ? (
          <>
            <Badge variant="success">{readyCount} Ready</Badge>
            {blockedCount > 0 ? (
              <Badge variant="destructive">{blockedCount} Blocked</Badge>
            ) : null}
          </>
        ) : null}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
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
      <p className="text-xs text-muted-foreground">
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
    <div className="overflow-x-auto border border-border bg-background">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border">
          <tr>
            <th className="p-2">Question</th>
            <th className="p-2">Topic</th>
            <th className="p-2">Version</th>
            <th className="p-2">
              {action === "publish" ? "Publication check" : "Outcome"}
            </th>
          </tr>
        </thead>
        <tbody>
          {questions.map((question) => {
            const version = question.workingVersion;
            const outcome = outcomes.get(version.versionId) ?? {
              status: "unchecked" as const,
            };
            return (
              <tr
                key={question.questionId}
                className="border-b border-border align-top"
              >
                <td className="p-2 font-medium">{version.title}</td>
                <td className="p-2">
                  {topicTitles.get(version.topicId) ?? version.topicId}
                </td>
                <td className="p-2 whitespace-nowrap">
                  v{version.versionNumber} ·{" "}
                  {version.state.replaceAll("_", " ")}
                </td>
                <td className="p-2">
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
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      return <span className="text-muted-foreground">Checking…</span>;
    case "unchecked":
      return (
        <span className="text-muted-foreground">
          {action === "publish" ? "Not checked yet" : "Not applied yet"}
        </span>
      );
    case "ready":
      return (
        <div className="space-y-1">
          <Badge variant="success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Ready to publish
          </Badge>
          <p className="text-muted-foreground">
            {reviewEvidenceText(outcome.reviewEvidence)}
          </p>
        </div>
      );
    case "cancelled":
      return (
        <div className="space-y-1">
          <Badge variant="outline">Not changed</Badge>
          <p className="text-muted-foreground">
            This question passed, but the batch was cancelled because another
            selected question was blocked. Nothing changed.
          </p>
        </div>
      );
    case "blocked": {
      const failure = outcome.failure;
      const guidance = failureGuidance(failure);
      return (
        <div className="space-y-1">
          <Badge variant="destructive">
            {action === "publish" ? "Cannot publish yet" : "Blocked"}
          </Badge>
          {failure.publicationBlockers?.length ? (
            <>
              <p className="text-muted-foreground">
                Publication requirements not met:
              </p>
              <ul className="list-disc pl-5 text-muted-foreground">
                {failure.publicationBlockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-muted-foreground">{failure.message}</p>
          )}
          {guidance ? (
            <p className="text-muted-foreground">{guidance}</p>
          ) : null}
          {onRemove ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
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
  const date = evidence.reviewedAt.slice(0, 10);
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
