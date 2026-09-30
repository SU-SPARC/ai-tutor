"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
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

const GENERIC_ERROR =
  "That didn't work and nothing changed. Try again, or reload the page.";

/** Professor words; the internal codes stay open / triaged / resolved / dismissed. */
const STATUS_LABELS: Record<QuestionFeedbackStatus, string> = {
  dismissed: "No change needed",
  open: "New",
  resolved: "Fixed",
  triaged: "Looking into it",
};

/** New waits on a person; Fixed is a settled, approved outcome. */
const STATUS_TONES: Record<QuestionFeedbackStatus, StatusTone> = {
  dismissed: "neutral",
  open: "review",
  resolved: "approved",
  triaged: "draft",
};

/** What the toast says after each status change. */
const STATUS_TOASTS: Record<QuestionFeedbackStatus, string> = {
  dismissed: "Report marked as no change needed.",
  open: "Report moved back to New.",
  resolved: "Report marked as fixed.",
  triaged: "Report marked as looking into it.",
};

const TOPIC_TITLES = new Map(
  canonicalSyllabusTopics.map((topic) => [topic.id, topic.title]),
);

type StatusFilter = QuestionFeedbackStatus | "all";

export function ProfessorQuestionFeedbackPanel({
  initialDashboard,
  initialStatusFilter = "open",
}: {
  initialDashboard: ProfessorQuestionFeedbackDashboard;
  /** Which reports show first. New by default. */
  initialStatusFilter?: StatusFilter;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [categoryFilter, setCategoryFilter] = useState<
    QuestionFeedbackCategory | "all"
  >("all");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>(initialStatusFilter);
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

  if (dashboard.reports.length === 0) {
    return (
      <EmptyState>
        No reports yet. When a student flags a question, it appears here.
      </EmptyState>
    );
  }

  return (
    <section
      aria-labelledby="feedback-reports-heading"
      className="flex flex-col gap-5"
    >
      <h2 id="feedback-reports-heading" className="sr-only">
        Reports
      </h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Show" className="sm:w-64">
          <NativeSelect
            value={statusFilter}
            className="min-h-11"
            onChange={(event) =>
              setStatusFilter(event.target.value as StatusFilter)
            }
          >
            {QUESTION_FEEDBACK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]} ({dashboard.counts[status]})
              </option>
            ))}
            <option value="all">All reports ({dashboard.reports.length})</option>
          </NativeSelect>
        </Field>
        <Field label="Kind of problem" className="sm:w-64">
          <NativeSelect
            value={categoryFilter}
            className="min-h-11"
            onChange={(event) =>
              setCategoryFilter(
                event.target.value as QuestionFeedbackCategory | "all",
              )
            }
          >
            <option value="all">All kinds</option>
            {QUESTION_FEEDBACK_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {QUESTION_FEEDBACK_CATEGORY_LABELS[category]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {visibleReports.length > 0 ? (
        <ol className="flex flex-col divide-y divide-rule rounded-panel bg-sheet">
          {visibleReports.map((report) => (
            <li key={report.id}>
              <FeedbackReviewItem report={report} onUpdated={replaceReport} />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          action={
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setStatusFilter("all");
                setCategoryFilter("all");
              }}
            >
              Show all reports
            </Button>
          }
        >
          {statusFilter === "open" && categoryFilter === "all"
            ? "No new reports. You're all caught up."
            : "No reports match these choices."}
        </EmptyState>
      )}
    </section>
  );
}

async function sendReview(
  reportId: string,
  status: QuestionFeedbackStatus,
  resolutionNotes?: string,
) {
  let response: Response;
  try {
    response = await fetch(
      `/api/professor/feedback/${encodeURIComponent(reportId)}`,
      {
        body: JSON.stringify({ resolutionNotes, status }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      },
    );
  } catch {
    return undefined;
  }
  const payload = (await response.json().catch(() => ({}))) as {
    report?: ProfessorQuestionFeedbackReport;
  };
  return response.ok ? payload.report : undefined;
}

function FeedbackReviewItem({
  onUpdated,
  report,
}: {
  onUpdated: (report: ProfessorQuestionFeedbackReport) => void;
  report: ProfessorQuestionFeedbackReport;
}) {
  const [notes, setNotes] = useState(report.resolutionNotes ?? "");
  const [active, setActive] = useState<QuestionFeedbackStatus>();
  const [notesError, setNotesError] = useState<string>();
  const [error, setError] = useState<string>();
  const isClient = useIsClient();
  const terminal = report.status === "resolved" || report.status === "dismissed";
  const headingId = `feedback-report-${report.id}`;
  const questionHref = `/professor/questions/${encodeURIComponent(report.questionId)}`;
  const topicTitle = report.topicId
    ? (TOPIC_TITLES.get(report.topicId) ?? undefined)
    : undefined;
  const received = formatLocalTime(report.createdAt, isClient);

  async function setStatus(status: QuestionFeedbackStatus) {
    const trimmed = notes.trim();
    const needsNote = status === "resolved" || status === "dismissed";
    if (needsNote && !trimmed) {
      setNotesError("Please add a short note about what you did.");
      return;
    }
    setNotesError(undefined);
    setError(undefined);
    setActive(status);
    const previous = {
      notes: report.resolutionNotes,
      status: report.status,
    };
    const updated = await sendReview(report.id, status, trimmed || undefined);
    setActive(undefined);
    if (!updated) {
      setError(GENERIC_ERROR);
      return;
    }
    onUpdated(updated);
    setNotes(updated.resolutionNotes ?? "");
    toast({
      title: STATUS_TOASTS[status],
      tone: "success",
      action:
        previous.status !== status
          ? {
              label: "Undo",
              onClick: () => {
                void sendReview(report.id, previous.status, previous.notes).then(
                  (restored) => {
                    if (restored) {
                      onUpdated(restored);
                      toast({ title: "Change undone.", tone: "success" });
                    } else {
                      toast({ title: GENERIC_ERROR, tone: "error" });
                    }
                  },
                );
              },
            }
          : undefined,
    });
  }

  return (
    <article
      aria-labelledby={headingId}
      className="grid gap-5 p-4 sm:p-5 xl:grid-cols-5 xl:gap-8"
    >
      <div className="flex min-w-0 flex-col gap-3 xl:col-span-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 id={headingId} className="type-h3 min-w-0 text-ink">
              <Link
                href={questionHref}
                className="text-ink underline underline-offset-4 hover:text-azure-700 focus-ring"
              >
                {report.questionTitle}
              </Link>
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <StatusChip
                tone={STATUS_TONES[report.status]}
                label={STATUS_LABELS[report.status]}
              />
              <Button asChild variant="outline" className="min-h-11">
                <Link href={questionHref}>Open question</Link>
              </Button>
            </div>
          </div>
          <p className="type-body text-ink-muted">
            {topicTitle ? `${topicTitle} · ` : ""}
            Reported on version {report.questionVersionNumber} of this question
          </p>
        </div>
        <p className="type-body-strong text-ink">
          {QUESTION_FEEDBACK_CATEGORY_LABELS[report.category]}
        </p>
        <blockquote className="type-body max-w-prose rounded-control bg-surface-tint px-3 py-2 break-words whitespace-pre-wrap text-ink">
          {report.message}
        </blockquote>
        {received || report.assignedToDisplayName ? (
          <p className="type-small text-ink">
            {received ? (
              <>
                Sent <time dateTime={report.createdAt}>{received}</time>
              </>
            ) : null}
            {received && report.assignedToDisplayName ? " · " : ""}
            {report.assignedToDisplayName
              ? `Handled by ${report.assignedToDisplayName}`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 xl:col-span-2">
        <Field
          label="Note to yourself (what you did)"
          description="Needed when you mark a report as fixed or no change needed."
          error={notesError}
        >
          <Textarea
            maxLength={1_000}
            rows={3}
            value={notes}
            disabled={active !== undefined}
            placeholder="For example: Corrected the answer to 0.25."
            onChange={(event) => {
              setNotes(event.target.value);
              setNotesError(undefined);
              setError(undefined);
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          {terminal ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                loading={active === report.status}
                disabled={active !== undefined}
                onClick={() => void setStatus(report.status)}
              >
                Save note
              </Button>
              <Button
                type="button"
                variant="link"
                className="min-h-11"
                disabled={active !== undefined}
                onClick={() => void setStatus("open")}
              >
                Move back to New
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="cta"
                className="min-h-11"
                loading={active === "resolved"}
                disabled={active !== undefined}
                onClick={() => void setStatus("resolved")}
              >
                Mark as fixed
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                loading={active === "dismissed"}
                disabled={active !== undefined}
                onClick={() => void setStatus("dismissed")}
              >
                No change needed
              </Button>
              {report.status === "open" ? (
                <Button
                  type="button"
                  variant="link"
                  className="min-h-11"
                  disabled={active !== undefined}
                  onClick={() => void setStatus("triaged")}
                >
                  Looking into it
                </Button>
              ) : null}
            </>
          )}
        </div>
        {error ? (
          <p role="alert" className="type-body font-medium text-red-700">
            {error}
          </p>
        ) : null}
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

/* Time: the browser's local zone with its short name. The server (and the
   first client render) uses UTC so the markup matches, then the browser
   swaps in local time. */

const noopSubscribe = () => () => {};

function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** "Mon 6 Oct, 9:00 AM EDT"; nothing for a missing or epoch-0 date. */
function formatLocalTime(value: string | undefined, isClient: boolean) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return "";
  const timeZone = isClient ? undefined : "UTC";
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
    timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(date);
  return `${day}, ${time}`;
}
