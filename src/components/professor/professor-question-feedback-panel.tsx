"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  MessageSquareWarning,
  ShieldCheck,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { nativeSelectClassName } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_FEEDBACK_CATEGORY_LABELS } from "@/components/tutor/question-feedback-form";
import {
  QUESTION_FEEDBACK_CATEGORIES,
  QUESTION_FEEDBACK_STATUSES,
  type ProfessorQuestionFeedbackDashboard,
  type ProfessorQuestionFeedbackReport,
  type QuestionFeedbackCategory,
  type QuestionFeedbackStatus,
} from "@/lib/types";

const STATUS_LABELS: Record<QuestionFeedbackStatus, string> = {
  dismissed: "Dismissed",
  open: "Open",
  resolved: "Resolved",
  triaged: "Triaged",
};

export function ProfessorQuestionFeedbackPanel({
  initialDashboard,
}: {
  initialDashboard: ProfessorQuestionFeedbackDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [categoryFilter, setCategoryFilter] = useState<
    QuestionFeedbackCategory | "all"
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    QuestionFeedbackStatus | "all"
  >("all");
  const visibleReports = useMemo(
    () =>
      dashboard.reports.filter(
        (report) =>
          (categoryFilter === "all" || report.category === categoryFilter) &&
          (statusFilter === "all" || report.status === statusFilter),
      ),
    [categoryFilter, dashboard.reports, statusFilter],
  );

  function replaceReport(updated: ProfessorQuestionFeedbackReport) {
    setDashboard((current) => {
      const reports = current.reports.map((report) =>
        report.id === updated.id ? updated : report,
      );
      return { ...current, counts: countsFor(reports), reports };
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {QUESTION_FEEDBACK_STATUSES.map((status) => (
          <Card key={status}>
            <CardContent className="flex items-center justify-between py-4">
              <span className="text-sm text-muted-foreground">
                {STATUS_LABELS[status]}
              </span>
              <span className="text-2xl font-semibold">
                {dashboard.counts[status]}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Alert variant="info">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        <AlertDescription>
          Reports are tied to the exact tutor session and immutable question
          version. Changing a report status or adding resolution notes never
          alters published content; content changes stay in the separate
          question lifecycle.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-48 space-y-1 text-xs text-muted-foreground">
          Status
          <select
            className={nativeSelectClassName}
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(
                event.target.value as QuestionFeedbackStatus | "all",
              )
            }
          >
            <option value="all">All statuses</option>
            {QUESTION_FEEDBACK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-64 space-y-1 text-xs text-muted-foreground">
          Category
          <select
            className={nativeSelectClassName}
            value={categoryFilter}
            onChange={(event) =>
              setCategoryFilter(
                event.target.value as QuestionFeedbackCategory | "all",
              )
            }
          >
            <option value="all">All categories</option>
            {QUESTION_FEEDBACK_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {QUESTION_FEEDBACK_CATEGORY_LABELS[category]}
              </option>
            ))}
          </select>
        </label>
        <Badge variant="outline">{dashboard.mode}</Badge>
      </div>

      {visibleReports.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {visibleReports.map((report) => (
            <FeedbackReviewCard
              key={report.id}
              report={report}
              onUpdated={replaceReport}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <MessageSquareWarning
            className="mx-auto h-6 w-6 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-3 font-medium">No matching student reports</p>
          <p className="mt-1 text-sm text-muted-foreground">
            New reports will appear here without changing question content.
          </p>
        </div>
      )}
    </div>
  );
}

function FeedbackReviewCard({
  onUpdated,
  report,
}: {
  onUpdated: (report: ProfessorQuestionFeedbackReport) => void;
  report: ProfessorQuestionFeedbackReport;
}) {
  const [status, setStatus] = useState(report.status);
  const [resolutionNotes, setResolutionNotes] = useState(
    report.resolutionNotes ?? "",
  );
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState<string>();
  const terminal = status === "resolved" || status === "dismissed";

  async function save() {
    setActive(true);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/professor/feedback/${encodeURIComponent(report.id)}`,
        {
          body: JSON.stringify({
            resolutionNotes: resolutionNotes.trim() || undefined,
            status,
          }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        report?: ProfessorQuestionFeedbackReport;
      };
      if (!response.ok || !payload.report) {
        setMessage(payload.error ?? "The report could not be updated.");
        return;
      }
      onUpdated(payload.report);
      setResolutionNotes(payload.report.resolutionNotes ?? "");
      setMessage("Feedback status and resolution notes saved.");
    } catch {
      setMessage("The report could not be updated.");
    } finally {
      setActive(false);
    }
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs text-muted-foreground">
              {report.topicId ? `${report.topicId} · ` : ""}
              Question version {report.questionVersionNumber}
            </p>
            <CardTitle className="mt-1 text-base">
              {report.questionTitle}
            </CardTitle>
          </div>
          <Badge
            variant={
              report.status === "resolved"
                ? "success"
                : report.status === "open"
                  ? "warning"
                  : "outline"
            }
          >
            {STATUS_LABELS[report.status]}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            {QUESTION_FEEDBACK_CATEGORY_LABELS[report.category]}
          </Badge>
          <Badge variant="outline">Tutor session linked</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-3 text-sm leading-6 whitespace-pre-wrap">
          {report.message}
        </div>
        <p className="text-xs text-muted-foreground">
          Received{" "}
          <time dateTime={report.createdAt}>{formatUtc(report.createdAt)}</time>
          {report.assignedToDisplayName
            ? ` · Assigned to ${report.assignedToDisplayName}`
            : ""}
        </p>

        <label className="block space-y-1 text-xs text-muted-foreground">
          Review status
          <select
            className={nativeSelectClassName}
            value={status}
            disabled={active}
            onChange={(event) => {
              setStatus(event.target.value as QuestionFeedbackStatus);
              setMessage(undefined);
            }}
          >
            {QUESTION_FEEDBACK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs text-muted-foreground">
          Resolution notes {terminal ? "(required)" : "(optional)"}
          <Textarea
            maxLength={1_000}
            rows={3}
            value={resolutionNotes}
            disabled={active}
            placeholder="Record the review decision or follow-up."
            onChange={(event) => {
              setResolutionNotes(event.target.value);
              setMessage(undefined);
            }}
          />
        </label>
        {message ? (
          <p className="text-sm text-muted-foreground" role="status">
            {message}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={active || (terminal && !resolutionNotes.trim())}
          onClick={() => void save()}
        >
          {active ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          )}
          Save review
        </Button>
      </CardContent>
    </Card>
  );
}

function countsFor(reports: ProfessorQuestionFeedbackReport[]) {
  const counts: Record<QuestionFeedbackStatus, number> = {
    dismissed: 0,
    open: 0,
    resolved: 0,
    triaged: 0,
  };
  for (const report of reports) counts[report.status] += 1;
  return counts;
}

function formatUtc(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
