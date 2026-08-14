"use client";

import { useState } from "react";
import { CalendarClock, Loader2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  StudentContentAvailabilityDashboard,
  StudentContentAvailabilityTarget,
  StudentContentEffectiveAvailability,
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

const EFFECTIVE_LABELS: Record<StudentContentEffectiveAvailability, string> = {
  archived: "Archived",
  available: "Available now",
  expired: "Schedule ended",
  scheduled: "Scheduled",
  unpublished: "Unavailable",
};

export function ProfessorContentAvailabilityPanel({
  initialDashboard,
}: {
  initialDashboard: StudentContentAvailabilityDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [message, setMessage] = useState<string>();

  return (
    <div className="space-y-7">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            Separate release gate
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This controls student availability only. Review approval and
            immutable-version publication remain separate requirements, so an
            unapproved or lifecycle-unpublished question cannot be exposed by
            this setting.
          </p>
        </div>
        <div className="border border-border bg-muted/20 p-4">
          <div className="flex items-center gap-2 font-medium">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
            Global scope
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The current data model has no course, cohort, membership, or
            enrollment records, so availability is global. No LMS assignment
            behavior is inferred or simulated.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{dashboard.mode}</Badge>
        <Badge variant="outline">global only</Badge>
        {dashboard.readOnly ? <Badge variant="outline">read-only</Badge> : null}
      </div>

      {dashboard.readOnlyReason ? (
        <p className="border border-border bg-muted px-3 py-2 text-sm">
          {dashboard.readOnlyReason}
        </p>
      ) : null}
      {message ? (
        <p
          className="border border-border bg-muted px-3 py-2 text-sm"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <AvailabilitySection
        description="Topic rules apply to every student-facing question and retrieval item in that syllabus topic. Topics remain in canonical syllabus order."
        heading="Syllabus topic availability"
        sectionId="topic-availability"
        readOnly={dashboard.readOnly}
        targets={dashboard.topics}
        onError={setMessage}
        onUpdated={(next) => {
          setDashboard(next);
          setMessage("Topic availability saved and audited.");
        }}
      />

      <AvailabilitySection
        description="Question rules apply only after the approved immutable version is published in the question lifecycle."
        heading="Approved question availability"
        sectionId="question-availability"
        readOnly={dashboard.readOnly}
        targets={dashboard.questions}
        onError={setMessage}
        onUpdated={(next) => {
          setDashboard(next);
          setMessage("Question availability saved and audited.");
        }}
      />

      <AvailabilityAudit events={dashboard.auditEvents} />
    </div>
  );
}

function AvailabilitySection({
  description,
  heading,
  onError,
  onUpdated,
  readOnly,
  sectionId,
  targets,
}: {
  description: string;
  heading: string;
  onError: (message: string) => void;
  onUpdated: (dashboard: StudentContentAvailabilityDashboard) => void;
  readOnly: boolean;
  sectionId: string;
  targets: StudentContentAvailabilityTarget[];
}) {
  return (
    <section aria-labelledby={sectionId}>
      <h3 id={sectionId} className="text-lg font-semibold">
        {heading}
      </h3>
      <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
      {targets.length > 0 ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {targets.map((target, index) => (
            <AvailabilityEditor
              key={`${target.targetType}:${target.id}:${target.releaseState}:${target.availableFrom ?? ""}:${target.availableUntil ?? ""}`}
              index={index}
              readOnly={readOnly}
              target={target}
              onError={onError}
              onUpdated={onUpdated}
            />
          ))}
        </div>
      ) : (
        <p className="mt-4 border border-dashed p-4 text-sm text-muted-foreground">
          No eligible content is available for this control.
        </p>
      )}
    </section>
  );
}

function AvailabilityEditor({
  index,
  onError,
  onUpdated,
  readOnly,
  target,
}: {
  index: number;
  onError: (message: string) => void;
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
  const [reason, setReason] = useState("");
  const [releaseState, setReleaseState] =
    useState<StudentContentReleaseState>(target.releaseState);
  const lifecycleBlocksChanges = target.publicationState !== "published";
  const disabled = readOnly || lifecycleBlocksChanges || active;

  async function save() {
    let startIso: string | undefined;
    let endIso: string | undefined;
    try {
      startIso = releaseState === "published" ? localToIso(availableFrom) : undefined;
      endIso = releaseState === "published" ? localToIso(availableUntil) : undefined;
    } catch {
      onError("Schedule values must be valid dates.");
      return;
    }

    setActive(true);
    onError("");
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
        onError(payload.error ?? "Availability could not be saved.");
        return;
      }
      onUpdated(payload.dashboard);
    } catch {
      onError("Availability could not be saved.");
    } finally {
      setActive(false);
    }
  }

  return (
    <article className="space-y-4 border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {target.targetType === "topic" ? (
            <p className="text-xs font-medium text-muted-foreground">
              Syllabus topic {index + 1}
            </p>
          ) : target.topicTitle ? (
            <p className="text-xs font-medium text-muted-foreground">
              {target.topicTitle}
            </p>
          ) : null}
          <h4 className="mt-1 font-medium">{target.title}</h4>
        </div>
        <Badge variant={target.effectiveAvailability === "available" ? "success" : "outline"}>
          {EFFECTIVE_LABELS[target.effectiveAvailability]}
        </Badge>
      </div>

      {lifecycleBlocksChanges ? (
        <p className="text-sm leading-6 text-muted-foreground">
          This item is {target.publicationState} in its content lifecycle. Use
          the lifecycle controls below before changing student availability.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Student release state
          <select
            className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm text-foreground"
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
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Audit reason (optional)
          <Input
            maxLength={240}
            placeholder="pilot_week_3"
            value={reason}
            disabled={disabled}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Available from (optional)
          <Input
            type="datetime-local"
            value={availableFrom}
            disabled={disabled || releaseState !== "published"}
            onChange={(event) => setAvailableFrom(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Available until (optional)
          <Input
            type="datetime-local"
            value={availableUntil}
            disabled={disabled || releaseState !== "published"}
            onChange={(event) => setAvailableUntil(event.target.value)}
          />
        </label>
      </div>
      <Button type="button" size="sm" disabled={disabled} onClick={() => void save()}>
        {active ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Save availability
      </Button>
    </article>
  );
}

function AvailabilityAudit({
  events,
}: {
  events: StudentContentAvailabilityDashboard["auditEvents"];
}) {
  return (
    <section aria-labelledby="availability-audit-heading">
      <h3 id="availability-audit-heading" className="text-lg font-semibold">
        Availability audit
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Recent attributed changes to global student availability.
      </p>
      {events.length > 0 ? (
        <div className="mt-4 overflow-x-auto border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>Professor</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell>
                    {event.targetType}: {event.targetId}
                  </TableCell>
                  <TableCell>
                    {RELEASE_LABELS[event.fromReleaseState]} →{" "}
                    {RELEASE_LABELS[event.toReleaseState]}
                    {event.toAvailableFrom || event.toAvailableUntil
                      ? " (scheduled)"
                      : ""}
                  </TableCell>
                  <TableCell>{event.actorDisplayName}</TableCell>
                  <TableCell>{formatDate(event.occurredAt)}</TableCell>
                  <TableCell>{event.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="mt-4 border border-dashed p-4 text-sm text-muted-foreground">
          No availability changes have been recorded yet.
        </p>
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

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
