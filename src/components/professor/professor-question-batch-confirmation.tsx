"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  QuestionLifecycleBatchAction,
  QuestionLifecycleBatchFailure,
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
  onCancel,
  onCompleted,
  questions,
  reasonCode,
  revisionMethod,
  topics,
}: {
  action: QuestionLifecycleBatchAction;
  disabled: boolean;
  inspections: QuestionVersionInspectionDto[];
  onCancel: () => void;
  onCompleted: (result: QuestionLifecycleBatchResult) => void;
  questions: QuestionLifecycleDto[];
  reasonCode?: string;
  revisionMethod: QuestionRevisionMethod;
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const [failures, setFailures] = useState<QuestionLifecycleBatchFailure[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string>();
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));
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

  async function confirmBatch() {
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
          items: questions.map((question) => ({
            expectedState: question.workingVersion.state,
            questionId: question.questionId,
            versionId: question.workingVersion.versionId,
          })),
          reasonCode: reasonCode?.trim() || undefined,
          revisionMethod:
            action === "request_revision" ? revisionMethod : undefined,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        result?: QuestionLifecycleBatchResult;
      };
      if (!response.ok || !payload.result?.applied) {
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
          This operation contains no approval step. It will apply to every
          selected version in one transaction, or to none of them.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Selected topic summary">
        {[...selectedTopics].map(([topicId, count]) => (
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
                <tr key={question.questionId} className="border-b border-border">
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
        <p className="border border-border bg-background p-3 text-sm">
          Publication is attempted only if every selected version still has a
          valid schema, active topic, approved publication state, and current
          professor inspection. Student visibility changes only after the
          complete transaction commits.
        </p>
      ) : (
        <p className="text-sm">
          Reason: <span className="font-medium">{reasonCode}</span>
          {action === "request_revision"
            ? ` · Method: ${revisionMethod}`
            : ""}
        </p>
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
        <Button
          type="button"
          disabled={disabled || isSubmitting}
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
