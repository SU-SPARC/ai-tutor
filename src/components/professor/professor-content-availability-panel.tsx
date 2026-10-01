"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CalendarClock } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  formatLocalDate,
  formatLocalTime,
  localZoneName,
  useIsClient,
  validDate,
} from "@/components/ui/local-date";
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
  StudentContentAvailabilityEvent,
  StudentContentAvailabilityTarget,
  StudentContentEffectiveAvailability,
  StudentContentReleaseState,
} from "@/lib/types";

const GENERIC_ERROR =
  "That didn't work and nothing changed. Try again, or reload the page.";

/** "Who can see this" choices. The values are the API's release states. */
const WHO_CAN_SEE: { label: string; value: StudentContentReleaseState }[] = [
  { label: "Students can see it", value: "published" },
  { label: "Hidden from students", value: "unpublished" },
  { label: "Archived (hidden, kept for records)", value: "archived" },
];

/** What students experience right now, as a chip: label always shown. */
const EFFECTIVE: Record<
  StudentContentEffectiveAvailability,
  Pick<StatusChipProps, "icon" | "label" | "tone">
> = {
  archived: { label: "Archived", tone: "retired" },
  available: { label: "Students can see it", tone: "released" },
  expired: { icon: CalendarClock, label: "Stopped showing", tone: "neutral" },
  scheduled: { icon: CalendarClock, label: "Scheduled", tone: "neutral" },
  unpublished: { icon: false, label: "Hidden from students", tone: "neutral" },
};

/**
 * A topic's end date closes the week without hiding it (migration 030), so
 * an expired topic reads "Closed"; a question's end date still hides it.
 */
function effectiveChip(target: StudentContentAvailabilityTarget) {
  if (
    target.targetType === "topic" &&
    target.effectiveAvailability === "expired"
  ) {
    return { ...EFFECTIVE.expired, label: "Closed" };
  }
  return EFFECTIVE[target.effectiveAvailability];
}

type AvailabilityChange = {
  availableFrom?: string;
  availableUntil?: string;
  reason?: string;
  releaseState: StudentContentReleaseState;
  targetId: string;
  targetType: "topic" | "question";
};

type FieldErrors = Partial<
  Record<"fromDate" | "fromTime" | "untilDate" | "untilTime" | "note", string>
>;

class AvailabilityRequestError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: FieldErrors = {},
  ) {
    super(message);
  }
}

/**
 * Sends the change exactly as the API expects it and returns the new
 * dashboard. Server messages are developer wording, so they are turned into
 * a plain sentence (next to the field when one is to blame).
 */
async function patchAvailability(
  change: AvailabilityChange,
): Promise<StudentContentAvailabilityDashboard> {
  let response: Response;
  try {
    response = await fetch("/api/professor/availability", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify(change),
    });
  } catch {
    throw new AvailabilityRequestError(GENERIC_ERROR);
  }
  const payload = (await response.json().catch(() => ({}))) as {
    dashboard?: StudentContentAvailabilityDashboard;
    error?: string;
  };
  if (response.ok && payload.dashboard) return payload.dashboard;

  const serverMessage = payload.error ?? "";
  if (/end must be later/i.test(serverMessage)) {
    throw new AvailabilityRequestError(GENERIC_ERROR, {
      untilDate: "Pick a time after the start time.",
    });
  }
  if (/reason must be between/i.test(serverMessage)) {
    throw new AvailabilityRequestError(GENERIC_ERROR, {
      note: "Write at least 3 characters, or leave the note blank.",
    });
  }
  if (/lifecycle|professor-approved/i.test(serverMessage)) {
    throw new AvailabilityRequestError(
      "Approve and publish this question first.",
    );
  }
  throw new AvailabilityRequestError(GENERIC_ERROR);
}

export function ProfessorContentAvailabilityPanel({
  initialDashboard,
}: {
  initialDashboard: StudentContentAvailabilityDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);

  /** Saves a change, then says what students now see, with Undo. */
  function announce(
    target: StudentContentAvailabilityTarget,
    change: AvailabilityChange,
    next: StudentContentAvailabilityDashboard,
  ) {
    setDashboard(next);
    const previous: AvailabilityChange = {
      availableFrom: target.availableFrom,
      availableUntil: target.availableUntil,
      reason: "Undo",
      releaseState: target.releaseState,
      targetId: target.id,
      targetType: target.targetType,
    };
    toast({
      title: toastSentence(target.title, change),
      tone: "success",
      action: {
        label: "Undo",
        onClick: () => {
          void patchAvailability(previous)
            .then((restored) => {
              setDashboard(restored);
              toast({
                title: `Change to “${target.title}” undone.`,
                tone: "success",
              });
            })
            .catch(() => {
              toast({ title: GENERIC_ERROR, tone: "error" });
            });
        },
      },
    });
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex max-w-prose flex-col items-start gap-3">
        <p className="type-body text-ink">
          To choose what one section sees and when, open Courses → your course →
          the section.
        </p>
        <Button asChild variant="cta" className="min-h-11">
          <Link href="/professor/courses">Go to my courses</Link>
        </Button>
        <p className="type-body text-ink">
          Students only see questions you have approved.
        </p>
        {dashboard.readOnly && dashboard.mode !== "demo" ? (
          <p role="note" className="type-body text-ink">
            You can look at this page, but changes can&apos;t be made right now.
          </p>
        ) : null}
      </div>

      <AvailabilitySection
        emptyText="No topics yet."
        heading="Topics"
        sectionId="topic-availability"
        readOnly={dashboard.readOnly}
        targets={dashboard.topics}
        onSaved={announce}
      />

      <AvailabilitySection
        emptyAction={
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/professor/review">Review questions</Link>
          </Button>
        }
        emptyText="No approved questions yet. They appear here after you approve them."
        heading="Approved questions"
        sectionId="question-availability"
        readOnly={dashboard.readOnly}
        targets={dashboard.questions}
        onSaved={announce}
      />

      <RecentChanges dashboard={dashboard} />
    </div>
  );
}

function AvailabilitySection({
  emptyAction,
  emptyText,
  heading,
  onSaved,
  readOnly,
  sectionId,
  targets,
}: {
  emptyAction?: ReactNode;
  emptyText: string;
  heading: string;
  onSaved: (
    target: StudentContentAvailabilityTarget,
    change: AvailabilityChange,
    next: StudentContentAvailabilityDashboard,
  ) => void;
  readOnly: boolean;
  sectionId: string;
  targets: StudentContentAvailabilityTarget[];
}) {
  return (
    <section aria-labelledby={sectionId} className="flex flex-col gap-3">
      <h2 id={sectionId} className="type-h2 text-ink">
        {heading}
      </h2>
      {targets.length > 0 ? (
        <ol className="flex flex-col divide-y divide-rule rounded-panel bg-sheet">
          {targets.map((target, index) => (
            <li
              key={`${target.targetType}:${target.id}:${target.releaseState}:${target.availableFrom ?? ""}:${target.availableUntil ?? ""}`}
            >
              <AvailabilityRow
                index={index}
                readOnly={readOnly}
                target={target}
                onSaved={onSaved}
              />
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState className="py-2" action={emptyAction}>
          {emptyText}
        </EmptyState>
      )}
    </section>
  );
}

/** One read-only row: what students see now, and one [Change] button. */
function AvailabilityRow({
  index,
  onSaved,
  readOnly,
  target,
}: {
  index: number;
  onSaved: (
    target: StudentContentAvailabilityTarget,
    change: AvailabilityChange,
    next: StudentContentAvailabilityDashboard,
  ) => void;
  readOnly: boolean;
  target: StudentContentAvailabilityTarget;
}) {
  const [open, setOpen] = useState(false);
  const isClient = useIsClient();
  const blocked = target.publicationState !== "published";
  const headingId = `availability-${target.targetType}-${target.id}`;
  const summary = scheduleSentence(target, isClient);

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-5"
    >
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        {target.targetType === "topic" ? (
          <p className="type-body text-ink-muted">Topic {index + 1}</p>
        ) : target.topicTitle ? (
          <p className="type-body text-ink-muted">{target.topicTitle}</p>
        ) : null}
        <h3 id={headingId} className="type-h3 text-ink">
          {target.title}
        </h3>
        <StatusChip {...effectiveChip(target)} />
        {summary ? <p className="type-body text-ink">{summary}</p> : null}
        {blocked ? (
          <div className="flex flex-col items-start gap-1">
            <p className="type-body text-ink">
              {target.targetType === "question"
                ? "Approve and publish this question first."
                : "This topic is turned off, so students can't see it."}
            </p>
            {target.targetType === "question" ? (
              <Link
                href={`/professor/questions/${encodeURIComponent(target.id)}`}
                className="type-body inline-flex min-h-11 items-center font-medium text-azure-500 underline underline-offset-4 hover:text-azure-700 focus-ring"
              >
                Open question
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      {!readOnly && !blocked ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 self-start"
            aria-label={`Change who can see “${target.title}”`}
            onClick={() => setOpen(true)}
          >
            Change
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            {open ? (
              <ChangeDialog
                target={target}
                onDone={(change, next) => {
                  setOpen(false);
                  onSaved(target, change, next);
                }}
              />
            ) : null}
          </Dialog>
        </>
      ) : null}
    </article>
  );
}

/**
 * The fields, then (when what students see changes) one consequence
 * sentence with [Cancel] and the action restated.
 */
function ChangeDialog({
  onDone,
  target,
}: {
  onDone: (
    change: AvailabilityChange,
    next: StudentContentAvailabilityDashboard,
  ) => void;
  target: StudentContentAvailabilityTarget;
}) {
  const [releaseState, setReleaseState] = useState(target.releaseState);
  const [fromDate, setFromDate] = useState(
    () => toLocalParts(target.availableFrom).date,
  );
  const [fromTime, setFromTime] = useState(
    () => toLocalParts(target.availableFrom).time,
  );
  const [untilDate, setUntilDate] = useState(
    () => toLocalParts(target.availableUntil).date,
  );
  const [untilTime, setUntilTime] = useState(
    () => toLocalParts(target.availableUntil).time,
  );
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<AvailabilityChange>();
  const [saving, setSaving] = useState(false);
  const showing = releaseState === "published";

  function buildChange(): AvailabilityChange | undefined {
    const errors: FieldErrors = {};
    const trimmedNote = note.trim();
    if (trimmedNote && trimmedNote.length < 3) {
      errors.note = "Write at least 3 characters, or leave the note blank.";
    }
    let availableFrom: string | undefined;
    let availableUntil: string | undefined;
    if (showing) {
      availableFrom = partsToIso(fromDate, fromTime, errors, "from");
      availableUntil = partsToIso(untilDate, untilTime, errors, "until");
      if (
        availableFrom &&
        availableUntil &&
        Date.parse(availableUntil) <= Date.parse(availableFrom)
      ) {
        errors.untilDate = "Pick a time after the start time.";
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return undefined;
    return {
      availableFrom,
      availableUntil,
      reason: trimmedNote || undefined,
      releaseState,
      targetId: target.id,
      targetType: target.targetType,
    };
  }

  function changesWhatStudentsSee(change: AvailabilityChange) {
    return (
      change.releaseState !== target.releaseState ||
      (change.availableFrom ?? "") !== normalizeIso(target.availableFrom) ||
      (change.availableUntil ?? "") !== normalizeIso(target.availableUntil)
    );
  }

  async function save(change: AvailabilityChange) {
    setSaving(true);
    setError(undefined);
    try {
      const next = await patchAvailability(change);
      onDone(change, next);
    } catch (cause) {
      if (cause instanceof AvailabilityRequestError) {
        setFieldErrors(cause.fieldErrors);
        setError(cause.message);
      } else {
        setError(GENERIC_ERROR);
      }
      setPending(undefined);
    } finally {
      setSaving(false);
    }
  }

  if (pending) {
    const show = pending.releaseState === "published";
    return (
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {show ? "Show this to students?" : "Hide this from students?"}
          </DialogTitle>
          <DialogDescription className="text-ink">
            {consequenceSentence(target.title, pending)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            className="min-h-11"
            disabled={saving}
            onClick={() => setPending(undefined)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={show ? "cta" : "primary"}
            className="min-h-11"
            loading={saving}
            onClick={() => void save(pending)}
          >
            {show ? "Show to students" : "Hide from students"}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent size="md">
      <form
        className="flex min-h-0 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          const change = buildChange();
          if (!change) return;
          if (changesWhatStudentsSee(change)) {
            setPending(change);
          } else {
            void save(change);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{target.title}</DialogTitle>
          <DialogDescription>
            Choose who can see this and when.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          <Field label="Who can see this">
            <NativeSelect
              value={releaseState}
              className="min-h-11"
              onChange={(event) =>
                setReleaseState(
                  event.target.value as StudentContentReleaseState,
                )
              }
            >
              {WHO_CAN_SEE.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </NativeSelect>
          </Field>

          {showing ? (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="type-body-strong text-ink">
                  Show starting
                </legend>
                <p className="type-body text-ink-muted">
                  Leave blank to show right away. Times are in your time zone (
                  {localZoneName()}).
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date" error={fieldErrors.fromDate}>
                    <Input
                      type="date"
                      className="min-h-11"
                      value={fromDate}
                      onChange={(event) => setFromDate(event.target.value)}
                    />
                  </Field>
                  <Field label="Time" error={fieldErrors.fromTime}>
                    <Input
                      type="time"
                      className="min-h-11"
                      value={fromTime}
                      onChange={(event) => setFromTime(event.target.value)}
                    />
                  </Field>
                </div>
              </fieldset>
              <fieldset className="flex flex-col gap-2">
                <legend className="type-body-strong text-ink">
                  {untilFieldHeading(target.targetType)}{" "}
                  <span className="font-normal text-ink-muted">(optional)</span>
                </legend>
                <p className="type-body text-ink-muted">
                  {target.targetType === "topic"
                    ? "Leave blank to never mark it closed. Students can still practice a closed week."
                    : "Leave blank to keep showing it."}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Date" error={fieldErrors.untilDate}>
                    <Input
                      type="date"
                      className="min-h-11"
                      value={untilDate}
                      onChange={(event) => setUntilDate(event.target.value)}
                    />
                  </Field>
                  <Field label="Time" error={fieldErrors.untilTime}>
                    <Input
                      type="time"
                      className="min-h-11"
                      value={untilTime}
                      onChange={(event) => setUntilTime(event.target.value)}
                    />
                  </Field>
                </div>
              </fieldset>
            </>
          ) : null}

          <Field
            label="Note"
            optional
            description="Only instructors see this."
            error={fieldErrors.note}
          >
            <Input
              maxLength={240}
              className="min-h-11"
              placeholder="For example: Opening Week 3"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {error ? (
            <p role="alert" className="type-body font-medium text-red-700">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button
            type="submit"
            variant="primary"
            className="min-h-11"
            loading={saving}
          >
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function RecentChanges({
  dashboard,
}: {
  dashboard: StudentContentAvailabilityDashboard;
}) {
  const isClient = useIsClient();
  const events = dashboard.auditEvents;
  const titles = new Map(
    [...dashboard.topics, ...dashboard.questions].map((target) => [
      `${target.targetType}:${target.id}`,
      target.title,
    ]),
  );

  return (
    <section
      aria-labelledby="availability-changes-heading"
      className="flex flex-col gap-3"
    >
      <h2 id="availability-changes-heading" className="type-h2 text-ink">
        Recent changes
      </h2>
      {events.length > 0 ? (
        <div className="rounded-panel bg-sheet">
          <Table containerClassName="rounded-panel">
            <TableCaption className="sr-only">
              Recent changes to what students see
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="type-small pl-4 text-ink">
                  What
                </TableHead>
                <TableHead scope="col" className="type-small text-ink">
                  Change
                </TableHead>
                <TableHead scope="col" className="type-small text-ink">
                  Who
                </TableHead>
                <TableHead scope="col" className="type-small text-ink">
                  When
                </TableHead>
                <TableHead scope="col" className="type-small pr-4 text-ink">
                  Note
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="type-body min-w-48 py-2.5 pl-4">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {titles.get(`${event.targetType}:${event.targetId}`) ??
                          (event.targetType === "topic"
                            ? "A topic"
                            : "A question")}
                      </span>
                      <span className="type-small text-ink-muted">
                        {event.targetType === "topic" ? "Topic" : "Question"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="type-body min-w-48">
                    {changeInWords(event, isClient)}
                  </TableCell>
                  <TableCell className="type-body whitespace-nowrap">
                    {event.actorDisplayName}
                  </TableCell>
                  <TableCell className="type-small whitespace-nowrap tabular text-ink">
                    {formatLocalTime(event.occurredAt, isClient)}
                  </TableCell>
                  <TableCell className="type-body pr-4">
                    {event.reason ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState className="py-2">
          Changes you make on this page will be listed here.
        </EmptyState>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

/** The end-date field: a topic closes on it, a question hides after it. */
export function untilFieldHeading(targetType: "topic" | "question") {
  return targetType === "topic" ? "Close on" : "Hide after";
}

export function scheduleSentence(
  target: StudentContentAvailabilityTarget,
  isClient: boolean,
) {
  const from = formatLocalTime(target.availableFrom, isClient);
  const until = formatLocalTime(target.availableUntil, isClient);
  if (target.targetType === "topic") {
    // A topic's end date closes the week; students keep practicing it.
    switch (target.effectiveAvailability) {
      case "scheduled":
        return from ? `Students will see it on ${from}.` : undefined;
      case "available": {
        const since = from ? `Visible since ${from}.` : "";
        const end = until
          ? ` Closes on ${until}; students can still practice it after that.`
          : "";
        return `${since}${end}`.trim() || undefined;
      }
      case "expired":
        return until
          ? `Closed on ${until}. Students can still practice it.`
          : undefined;
      default:
        return undefined;
    }
  }
  switch (target.effectiveAvailability) {
    case "scheduled":
      return from ? `Students will see it on ${from}.` : undefined;
    case "available": {
      const since = from ? `Visible since ${from}.` : "";
      const end = until ? ` Students stop seeing it after ${until}.` : "";
      return `${since}${end}`.trim() || undefined;
    }
    case "expired":
      return until ? `Students stopped seeing it after ${until}.` : undefined;
    default:
      return undefined;
  }
}

export function consequenceSentence(title: string, change: AvailabilityChange) {
  if (change.releaseState !== "published") {
    return `Students will no longer see “${title}”. Hide it?`;
  }
  const start = change.availableFrom
    ? formatLocalTime(change.availableFrom, true)
    : "now";
  if (change.targetType === "topic" && change.availableUntil) {
    return `All students will see “${title}” starting ${start}. It will be marked closed on ${formatLocalTime(change.availableUntil, true)} but stays open for practice. Show it?`;
  }
  const until = change.availableUntil
    ? `, until ${formatLocalTime(change.availableUntil, true)}`
    : "";
  return `All students will see “${title}” starting ${start}${until}. Show it?`;
}

function toastSentence(title: string, change: AvailabilityChange) {
  if (change.releaseState === "archived") {
    return `“${title}” is archived and hidden from students.`;
  }
  if (change.releaseState === "unpublished") {
    return `“${title}” is hidden from students.`;
  }
  if (change.availableFrom && Date.parse(change.availableFrom) > Date.now()) {
    return `“${title}” will be visible to students on ${formatLocalTime(change.availableFrom, true)}.`;
  }
  return `“${title}” is now visible to students.`;
}

function changeInWords(
  event: StudentContentAvailabilityEvent,
  isClient: boolean,
) {
  if (event.toReleaseState === "archived") return "Archived";
  if (event.toReleaseState === "unpublished") return "Hidden";
  if (
    event.toAvailableFrom &&
    Date.parse(event.toAvailableFrom) > Date.parse(event.occurredAt)
  ) {
    return `Scheduled to show ${formatLocalDate(event.toAvailableFrom, isClient)}`;
  }
  return "Shown to students";
}

/* ------------------------------------------------------------------ */
/* Local date and time inputs (shared formatting: ui/local-date).        */
/* ------------------------------------------------------------------ */

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** An ISO time split into the local date and time inputs. */
function toLocalParts(value?: string) {
  const date = validDate(value);
  if (!date) return { date: "", time: "" };
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function normalizeIso(value?: string) {
  const date = validDate(value);
  return date ? date.toISOString() : "";
}

/** Local date + time inputs to ISO; field errors when only half is filled. */
function partsToIso(
  date: string,
  time: string,
  errors: FieldErrors,
  which: "from" | "until",
) {
  if (!date && !time) return undefined;
  if (!date) {
    errors[which === "from" ? "fromDate" : "untilDate"] =
      "Add a date, or clear the time.";
    return undefined;
  }
  if (!time) {
    errors[which === "from" ? "fromTime" : "untilTime"] =
      "Add a time, for example 9:00 AM.";
    return undefined;
  }
  const parsed = new Date(`${date}T${time}`);
  if (Number.isNaN(parsed.getTime())) {
    errors[which === "from" ? "fromDate" : "untilDate"] = "Enter a real date.";
    return undefined;
  }
  return parsed.toISOString();
}
