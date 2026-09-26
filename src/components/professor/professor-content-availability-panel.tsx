"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip, type StatusChipProps } from "@/components/ui/status-chip";
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
import type {
  StudentContentAvailabilityDashboard,
  StudentContentAvailabilityTarget,
  StudentContentEffectiveAvailability,
  StudentContentPublicationState,
  StudentContentReleaseState,
} from "@/lib/types";

const RELEASE_LABELS: Record<StudentContentReleaseState, string> = {
  archived: "Archived",
  published: "Published globally",
  unpublished: "Unpublished",
};
const RELEASE_STATES: StudentContentReleaseState[] = [
  "published",
  "unpublished",
  "archived",
];

/** What students experience right now, as a chip: label always shown. */
const EFFECTIVE: Record<
  StudentContentEffectiveAvailability,
  Pick<StatusChipProps, "icon" | "label" | "tone">
> = {
  archived: { label: "Archived", tone: "retired" },
  available: { label: "Available now", tone: "released" },
  expired: { icon: CalendarClock, label: "Schedule ended", tone: "neutral" },
  scheduled: { icon: CalendarClock, label: "Scheduled", tone: "neutral" },
  unpublished: { icon: false, label: "Unavailable", tone: "neutral" },
};

const LIFECYCLE_WORDS: Record<StudentContentPublicationState, string> = {
  archived: "archived",
  published: "published",
  unpublished: "not published",
};

// UTC so the server render and the browser agree on the text.
const AUDIT_TIME = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function ProfessorContentAvailabilityPanel({
  initialDashboard,
}: {
  initialDashboard: StudentContentAvailabilityDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <p className="type-small max-w-prose text-ink-muted">
          <span className="font-medium text-ink">Separate release gate.</span>{" "}
          This controls student availability only; review approval and
          publication stay separate requirements, so an unapproved or
          lifecycle-unpublished question cannot be exposed by this setting.
          Scope is global only: there are no course, cohort, membership, or
          enrollment records to narrow it.
        </p>
        {dashboard.readOnlyReason ? (
          <Alert role="note">
            <AlertDescription>
              {dashboard.readOnly ? "Read-only. " : ""}
              {dashboard.readOnlyReason}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <AvailabilitySection
        description="Topic rules apply to every student-facing question and retrieval item in the topic, in syllabus order."
        emptyText="No syllabus topics are eligible yet."
        heading="Syllabus topics"
        sectionId="topic-availability"
        readOnly={dashboard.readOnly}
        targets={dashboard.topics}
        onUpdated={(next) => {
          setDashboard(next);
          toast({
            title: "Topic availability saved and audited.",
            tone: "success",
          });
        }}
      />

      <AvailabilitySection
        description="Question rules apply only after the approved version is published in the question lifecycle."
        emptyText="No approved questions yet; they appear here once approved in review."
        heading="Approved questions"
        sectionId="question-availability"
        readOnly={dashboard.readOnly}
        targets={dashboard.questions}
        onUpdated={(next) => {
          setDashboard(next);
          toast({
            title: "Question availability saved and audited.",
            tone: "success",
          });
        }}
      />

      <AvailabilityAudit dashboard={dashboard} />
    </div>
  );
}

function AvailabilitySection({
  description,
  emptyText,
  heading,
  onUpdated,
  readOnly,
  sectionId,
  targets,
}: {
  description: string;
  emptyText: string;
  heading: string;
  onUpdated: (dashboard: StudentContentAvailabilityDashboard) => void;
  readOnly: boolean;
  sectionId: string;
  targets: StudentContentAvailabilityTarget[];
}) {
  return (
    <section aria-labelledby={sectionId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={sectionId} className="type-h2 text-ink">
          {heading}
        </h2>
        <p className="type-small max-w-prose text-ink-muted">{description}</p>
      </div>
      {targets.length > 0 ? (
        <ol className="flex flex-col divide-y divide-rule rounded-panel bg-sheet">
          {targets.map((target, index) => (
            <li
              key={`${target.targetType}:${target.id}:${target.releaseState}:${target.availableFrom ?? ""}:${target.availableUntil ?? ""}`}
            >
              <AvailabilityEditor
                index={index}
                readOnly={readOnly}
                target={target}
                onUpdated={onUpdated}
              />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState className="py-2">{emptyText}</EmptyState>
      )}
    </section>
  );
}

function AvailabilityEditor({
  index,
  onUpdated,
  readOnly,
  target,
}: {
  index: number;
  onUpdated: (dashboard: StudentContentAvailabilityDashboard) => void;
  readOnly: boolean;
  target: StudentContentAvailabilityTarget;
}) {
  const [active, setActive] = useState(false);
  const [availableFrom, setAvailableFrom] = useState(() =>
    toLocalDateTime(target.availableFrom),
  );
  const [availableUntil, setAvailableUntil] = useState(() =>
    toLocalDateTime(target.availableUntil),
  );
  const [error, setError] = useState<string>();
  const [reason, setReason] = useState("");
  const [releaseState, setReleaseState] = useState<StudentContentReleaseState>(
    target.releaseState,
  );
  const lifecycleBlocksChanges = target.publicationState !== "published";
  const disabled = readOnly || lifecycleBlocksChanges || active;
  const headingId = `availability-${target.targetType}-${target.id}`;
  const effective = EFFECTIVE[target.effectiveAvailability];

  async function save() {
    let startIso: string | undefined;
    let endIso: string | undefined;
    try {
      startIso =
        releaseState === "published" ? localToIso(availableFrom) : undefined;
      endIso =
        releaseState === "published" ? localToIso(availableUntil) : undefined;
    } catch {
      setError("Enter the schedule as a full date and time.");
      return;
    }

    setActive(true);
    setError(undefined);
    try {
      const response = await fetch("/api/professor/availability", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          availableFrom: startIso,
          availableUntil: endIso,
          reason: reason.trim() || undefined,
          releaseState,
          targetId: target.id,
          targetType: target.targetType,
        }),
      });
      const payload = (await response.json()) as {
        dashboard?: StudentContentAvailabilityDashboard;
        error?: string;
      };
      if (!response.ok || !payload.dashboard) {
        setError(
          payload.error ?? "Availability could not be saved. Try again.",
        );
        return;
      }
      onUpdated(payload.dashboard);
    } catch {
      setError("Availability could not be saved. Try again.");
    } finally {
      setActive(false);
    }
  }

  return (
    <article
      aria-labelledby={headingId}
      className="grid gap-4 p-4 sm:p-5 lg:grid-cols-3 lg:gap-8"
    >
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        {target.targetType === "topic" ? (
          <p className="type-label">Syllabus topic {index + 1}</p>
        ) : target.topicTitle ? (
          <p className="type-label">{target.topicTitle}</p>
        ) : null}
        <h3 id={headingId} className="type-h3 text-ink">
          {target.title}
        </h3>
        <StatusChip {...effective} />
        {lifecycleBlocksChanges ? (
          <p className="type-small max-w-prose text-ink-muted">
            This item is {LIFECYCLE_WORDS[target.publicationState]} in its
            content lifecycle. Change it in Question lifecycle before changing
            student availability.
          </p>
        ) : null}
      </div>

      {readOnly ? (
        <dl className="grid content-start gap-x-6 gap-y-2 type-small sm:grid-cols-3 lg:col-span-2">
          <div className="flex flex-col gap-0.5">
            <dt className="type-label">Student release state</dt>
            <dd className="text-ink">{RELEASE_LABELS[target.releaseState]}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="type-label">Available from</dt>
            <dd className="tabular text-ink">
              {formatScheduleTime(target.availableFrom)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="type-label">Available until</dt>
            <dd className="tabular text-ink">
              {formatScheduleTime(target.availableUntil)}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2">
          <Field label="Student release state">
            <NativeSelect
              value={releaseState}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value as StudentContentReleaseState;
                setReleaseState(next);
                if (next !== "published") {
                  setAvailableFrom("");
                  setAvailableUntil("");
                }
              }}
            >
              {RELEASE_STATES.map((value) => (
                <option key={value} value={value}>
                  {RELEASE_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Audit reason (optional)">
            <Input
              maxLength={240}
              placeholder="e.g. Opening week 3…"
              value={reason}
              disabled={disabled}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Field label="Available from (optional)">
            <Input
              type="datetime-local"
              className="tabular"
              value={availableFrom}
              disabled={disabled || releaseState !== "published"}
              onChange={(event) => setAvailableFrom(event.target.value)}
            />
          </Field>
          <Field label="Available until (optional)">
            <Input
              type="datetime-local"
              className="tabular"
              value={availableUntil}
              disabled={disabled || releaseState !== "published"}
              onChange={(event) => setAvailableUntil(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button
              type="button"
              variant="secondary"
              loading={active}
              disabled={readOnly || lifecycleBlocksChanges}
              onClick={() => void save()}
            >
              Save availability
            </Button>
            {error ? (
              <p role="alert" className="type-small font-medium text-red-700">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}

function AvailabilityAudit({
  dashboard,
}: {
  dashboard: StudentContentAvailabilityDashboard;
}) {
  const events = dashboard.auditEvents;
  const titles = new Map(
    [...dashboard.topics, ...dashboard.questions].map((target) => [
      `${target.targetType}:${target.id}`,
      target.title,
    ]),
  );

  return (
    <section
      aria-labelledby="availability-audit-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <h2 id="availability-audit-heading" className="type-h2 text-ink">
          Availability audit
        </h2>
        <p className="type-small text-ink-muted">
          Recent attributed changes to global student availability. Times are
          UTC.
        </p>
      </div>
      {events.length > 0 ? (
        <div className="rounded-panel bg-sheet">
          <Table containerClassName="rounded-panel">
            <TableCaption className="sr-only">
              Recent availability changes
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="pl-4">
                  Content
                </TableHead>
                <TableHead scope="col">Change</TableHead>
                <TableHead scope="col">Professor</TableHead>
                <TableHead scope="col">Time</TableHead>
                <TableHead scope="col" className="pr-4">
                  Reason
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="min-w-48 py-2.5 pl-4">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {titles.get(`${event.targetType}:${event.targetId}`) ??
                          event.targetId}
                      </span>
                      <span className="type-caption">
                        {event.targetType === "topic" ? "Topic" : "Question"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-56">
                    {RELEASE_LABELS[event.fromReleaseState]} →{" "}
                    {RELEASE_LABELS[event.toReleaseState]}
                    {event.toAvailableFrom || event.toAvailableUntil
                      ? " (scheduled)"
                      : ""}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {event.actorDisplayName}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular text-ink-muted">
                    {formatAuditTime(event.occurredAt)}
                  </TableCell>
                  <TableCell className="pr-4">{event.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState className="py-2">
          No availability changes have been recorded yet.
        </EmptyState>
      )}
    </section>
  );
}

function toLocalDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localToIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid date");
  return date.toISOString();
}

/** A schedule bound in UTC, or "—" when there is none. */
function formatScheduleTime(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${AUDIT_TIME.format(date)} UTC`;
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return AUDIT_TIME.format(date);
}
