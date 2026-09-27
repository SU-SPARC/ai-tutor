"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { QUESTION_FEEDBACK_CATEGORY_LABELS } from "@/components/tutor/question-feedback-form";
import { canonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
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

/** Open waits on a person; resolved is a settled, approved outcome. */
const STATUS_TONES: Record<QuestionFeedbackStatus, StatusTone> = {
  dismissed: "neutral",
  open: "review",
  resolved: "approved",
  triaged: "draft",
};

const TOPIC_TITLES = new Map(
  canonicalSyllabusTopics.map((topic) => [topic.id, topic.title]),
);

// UTC so the server render and the browser agree on the text.
const RECEIVED = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

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
  const filtered = categoryFilter !== "all" || statusFilter !== "all";

  function replaceReport(updated: ProfessorQuestionFeedbackReport) {
    setDashboard((current) => {
      const reports = current.reports.map((report) =>
        report.id === updated.id ? updated : report,
      );
      return { ...current, counts: countsFor(reports), reports };
    });
  }

  return (
    <section
      aria-labelledby="feedback-reports-heading"
      className="flex flex-col gap-5"
    >
      <h2 id="feedback-reports-heading" className="sr-only">
        Reports
      </h2>
      <p className="type-small max-w-prose text-ink-muted">
        Each report is tied to the exact tutor session and question version.
        Changing its status or adding resolution notes never alters published
        content; content changes stay in the question lifecycle.
      </p>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field label="Status" className="sm:w-48">
            <NativeSelect
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
            </NativeSelect>
          </Field>
          <Field label="Category" className="sm:w-64">
            <NativeSelect
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
            </NativeSelect>
          </Field>
        </div>
        <dl
          aria-label="Reports by status"
          className="flex flex-wrap gap-x-5 gap-y-1 type-small"
        >
          {QUESTION_FEEDBACK_STATUSES.map((status) => (
            <div key={status} className="flex items-baseline gap-2">
              <dt className="text-ink-muted">{STATUS_LABELS[status]}</dt>
              <dd className="font-mono tabular text-ink">
                {dashboard.counts[status]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {visibleReports.length > 0 ? (
        <ol className="flex flex-col divide-y divide-rule rounded-panel bg-sheet">
          {visibleReports.map((report) => (
            <li key={report.id}>
              <FeedbackReviewItem report={report} onUpdated={replaceReport} />
            </li>
          ))}
        </ol>
      ) : filtered ? (
        <EmptyState
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter("all");
                setCategoryFilter("all");
              }}
            >
              Show all reports
            </Button>
          }
        >
          No student reports match these filters.
        </EmptyState>
      ) : (
        <EmptyState>
          No student reports yet; a report sent from a practice question appears
          here.
        </EmptyState>
      )}
    </section>
  );
}

function FeedbackReviewItem({
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
  const headingId = `feedback-report-${report.id}`;
  const topicTitle = report.topicId
    ? (TOPIC_TITLES.get(report.topicId) ?? report.topicId)
    : undefined;

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
      setMessage("Status and resolution notes saved.");
    } catch {
      setMessage("The report could not be updated. Try again.");
    } finally {
      setActive(false);
    }
  }

  return (
    <article
      aria-labelledby={headingId}
      className="grid gap-5 p-4 sm:p-5 xl:grid-cols-5 xl:gap-8"
    >
      <div className="flex min-w-0 flex-col gap-3 xl:col-span-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 id={headingId} className="type-h3 min-w-0 text-ink">
              {report.questionTitle}
            </h3>
            <StatusChip
              tone={STATUS_TONES[report.status]}
              label={STATUS_LABELS[report.status]}
            />
          </div>
          <p className="type-caption">
            {topicTitle ? `${topicTitle} · ` : ""}
            Question version{" "}
            <span className="font-mono tabular">
              {report.questionVersionNumber}
            </span>{" "}
            · Tutor session linked
          </p>
        </div>
        <p className="type-small font-medium text-ink">
          {QUESTION_FEEDBACK_CATEGORY_LABELS[report.category]}
        </p>
        <blockquote className="type-body max-w-prose rounded-control bg-surface-tint px-3 py-2 break-words whitespace-pre-wrap text-ink">
          {report.message}
        </blockquote>
        <p className="type-caption">
          Received{" "}
          <time dateTime={report.createdAt}>
            {formatReceived(report.createdAt)}
          </time>
          {report.assignedToDisplayName
            ? ` · Assigned to ${report.assignedToDisplayName}`
            : ""}
        </p>
      </div>

      <div className="flex flex-col gap-4 xl:col-span-2">
        <Field label="Review status">
          <NativeSelect
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
          </NativeSelect>
        </Field>
        <Field
          label="Resolution notes"
          optional={!terminal}
          description={
            terminal ? "Required to resolve or dismiss a report." : undefined
          }
        >
          <Textarea
            maxLength={1_000}
            rows={3}
            value={resolutionNotes}
            disabled={active}
            placeholder="What you decided or will follow up…"
            onChange={(event) => {
              setResolutionNotes(event.target.value);
              setMessage(undefined);
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            loading={active}
            disabled={terminal && !resolutionNotes.trim()}
            onClick={() => void save()}
          >
            <Check aria-hidden="true" />
            Save review
          </Button>
          <p role="status" className="type-small text-ink-muted">
            {message}
          </p>
        </div>
      </div>
    </article>
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

function formatReceived(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "at an unknown time"
    : `${RECEIVED.format(date)} UTC`;
}
