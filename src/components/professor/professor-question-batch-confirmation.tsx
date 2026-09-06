"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

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
  QuestionVersionInspectionDto,
} from "@/lib/types";

const ACTION_LABELS: Record<QuestionLifecycleBatchAction, string> = {
  publish: "publish",
  reject: "reject",
  request_revision: "request revision",
};

export function ProfessorQuestionBatchConfirmation({
  action,
  disabled,
  inspections,
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
  inspections: QuestionVersionInspectionDto[];
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
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
  const [preview, setPreview] = useState<QuestionLifecycleBatchPreviewResult>();
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));
  const topicOrders = new Map(topics.map((topic, index) => [topic.id, index]));
  const inspectionTimes = new Map(
    inspections.map((inspection) => [
      inspection.versionId,
      inspection.inspectedAt,
    ]),
  );
  const selectedTopics = questions.reduce<Map<string, number>>(
    (counts, question) => {
      const topicId = question.workingVersion.topicId;
      counts.set(topicId, (counts.get(topicId) ?? 0) + 1);
      return counts;
    },
    new Map(),
  );
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

  function selectedItems() {
    return questions.map((question) => ({
      expectedState: question.workingVersion.state,
      questionId: question.questionId,
      versionId: question.workingVersion.versionId,
    }));
  }

  async function previewPublication() {
    if (questions.length < 2) {
      setMessage("Select at least two questions for batch publication.");
      return;
    }
    setIsPreviewing(true);
    setFailures([]);
    setMessage(undefined);
    try {
      const response = await fetch("/api/professor/questions/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          items: selectedItems(),
          mode: "preview",
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        preview?: QuestionLifecycleBatchPreviewResult;
      };
      if (!response.ok || !payload.preview) {
        setMessage(payload.error ?? "Publication readiness preview failed.");
        return;
      }
      setPreview(payload.preview);
    } catch {
      setMessage("Publication readiness preview could not be completed.");
    } finally {
      setIsPreviewing(false);
    }
  }

  async function confirmBatch() {
    if (
      action !== "publish" &&
      professorReviewReasonRequiresNote(reasonCode) &&
      !note?.trim()
    ) {
      setMessage("Other requires an audit note.");
      return;
    }
    if (
      action === "publish" &&
      (!currentPreview || currentPreview.blockedCount > 0)
    ) {
      setMessage(
        "Preview this exact selection and remove or resolve every blocked question before publishing.",
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
          items: selectedItems(),
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
            "No questions were changed because batch preflight failed.",
        );
        return;
      }
      onCompleted(payload.result);
    } catch {
      setMessage("The batch request could not be completed.");
    } finally {
      setIsSubmitting(false);
    }
  }

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
            ? "Preview every selected version against the live publication gates, then remove or resolve blockers. Publication applies to the entire ready set in one transaction, or to none of them."
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

      <div className="overflow-x-auto border border-border bg-background">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border">
            <tr>
              <th className="p-2">Question</th>
              <th className="p-2">Topic</th>
              <th className="p-2">Version</th>
              <th className="p-2">Inspected</th>
            </tr>
          </thead>
          <tbody>
            {questions.map((question) => {
              const version = question.workingVersion;
              return (
                <tr
                  key={question.questionId}
                  className="border-b border-border"
                >
                  <td className="p-2">{version.title}</td>
                  <td className="p-2">
                    {topicTitles.get(version.topicId) ?? version.topicId}
                  </td>
                  <td className="p-2">
                    v{version.versionNumber} ·{" "}
                    {version.state.replaceAll("_", " ")}
                  </td>
                  <td className="p-2">
                    {inspectionTimes.get(version.versionId) ?? "Missing"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {action === "publish" ? (
        <div className="space-y-3">
          <p className="border border-border bg-background p-3 text-sm">
            Readiness preview does not change data. Final publication repeats
            every exact-version inspection, working-version, provenance, and
            quality check. Student visibility changes only after the complete
            transaction commits.
          </p>
          {currentPreview ? (
            <ProfessorBatchPublicationReadiness
              disabled={disabled || isSubmitting || isPreviewing}
              onRemoveQuestion={(versionId) => {
                setPreview(undefined);
                onRemoveQuestion?.(versionId);
              }}
              preview={currentPreview}
              questions={questions}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Readiness has not been checked for this exact selection.
            </p>
          )}
        </div>
      ) : (
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
      {failures.length > 0 ? (
        <div aria-label="Batch failure report" className="space-y-2">
          <h3 className="font-medium">Nothing changed — failure report</h3>
          <ul className="space-y-2 text-sm">
            {failures.map((failure) => (
              <li
                key={`${failure.questionId}:${failure.versionId}`}
                className="border border-destructive/40 bg-background p-3"
              >
                <span className="font-medium">
                  {failure.title ?? failure.questionId}
                </span>{" "}
                ({failure.code}): {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {action === "publish" ? (
          <Button
            type="button"
            disabled={disabled || isSubmitting || isPreviewing}
            variant={currentPreview ? "outline" : "default"}
            onClick={() => void previewPublication()}
          >
            {isPreviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {currentPreview ? "Preview readiness again" : "Preview readiness"}
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={
            disabled ||
            isSubmitting ||
            isPreviewing ||
            (action === "publish" &&
              (!currentPreview || currentPreview.blockedCount > 0))
          }
          variant={action === "reject" ? "destructive" : "default"}
          onClick={() => void confirmBatch()}
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Confirm {ACTION_LABELS[action]} for {questions.length} questions
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

export function ProfessorBatchPublicationReadiness({
  disabled,
  onRemoveQuestion,
  preview,
  questions,
}: {
  disabled: boolean;
  onRemoveQuestion: (versionId: number) => void;
  preview: QuestionLifecycleBatchPreviewResult;
  questions: QuestionLifecycleDto[];
}) {
  const questionsByVersionId = new Map(
    questions.map((question) => [question.workingVersion.versionId, question]),
  );

  return (
    <section
      aria-label="Batch publication readiness preview"
      className="space-y-3 border border-border bg-background p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Publication readiness</h3>
        <Badge variant="success">{preview.readyCount} Ready</Badge>
        {preview.blockedCount > 0 ? (
          <Badge variant="destructive">{preview.blockedCount} Blocked</Badge>
        ) : null}
      </div>
      <ul className="space-y-2 text-sm">
        {preview.items.map((item) => {
          const question = questionsByVersionId.get(item.versionId);
          return (
            <li
              key={`${item.questionId}:${item.versionId}`}
              className="flex flex-wrap items-start justify-between gap-3 border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {question?.workingVersion.title ??
                      (item.status === "blocked" && item.title) ??
                      item.questionId}
                  </span>
                  <Badge
                    variant={
                      item.status === "ready" ? "success" : "destructive"
                    }
                  >
                    {item.status === "ready" ? "Ready" : "Blocked"}
                  </Badge>
                </div>
                {item.status === "blocked" ? (
                  <div className="mt-1 text-muted-foreground">
                    <p>
                      {item.publicationBlockers?.length
                        ? "Publication requirements not met:"
                        : item.message}
                    </p>
                    {item.publicationBlockers?.length ? (
                      <ul className="mt-1 list-disc pl-5">
                        {item.publicationBlockers.map((blocker) => (
                          <li key={blocker.code}>{blocker.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    Exact version {item.versionId} passed every current gate.
                  </p>
                )}
              </div>
              {item.status === "blocked" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onRemoveQuestion(item.versionId)}
                >
                  Remove from selection
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
