import Link from "next/link";

import { StudentUsername } from "@/components/professor/instructor-student-username";
import { Button } from "@/components/ui/button";
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
import { activeCanonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import {
  assignStudentLabels,
  formatAccuracy,
} from "@/lib/professor/student-pseudonym";
import type {
  InstructorStudentIdentities,
  InstructorStudentList,
} from "@/lib/types";

const DATE_TIME = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const DATE_ONLY = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const MONTH_DAY = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
});
const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const NUMBER = new Intl.NumberFormat("en");

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Professor tables read in 16px: cells in type-body, headers in type-small
 * ink. Applied from the table element so the shared primitive's 13/14px
 * defaults are overridden without editing it.
 */
export const PROFESSOR_TABLE_TYPE =
  "[&_td]:type-body [&_th]:type-small [&_th]:font-medium [&_th]:text-ink";

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  // A missing date stored as epoch 0 must never read as Dec 31 1969.
  return Number.isNaN(date.getTime()) || date.getTime() <= 0
    ? undefined
    : date;
}

/** "Aug 14, 2026, 10:00 AM", or "—" when there is no usable date. */
export function formatDateTime(value: string | undefined) {
  const date = parseDate(value);
  return date ? DATE_TIME.format(date) : "—";
}

/**
 * The request's clock. These tables render on the server once per request,
 * so "3 days ago" is fixed for that response and never recomputed on a
 * client re-render.
 */
export function requestTime() {
  return Date.now();
}

/** Within the last 30 days, a relative phrase; older, the date itself. */
function isRecent(date: Date, now: number) {
  return Math.abs(date.getTime() - now) < 30 * DAY * 1000;
}

function relativeLabel(date: Date, now: number) {
  const seconds = Math.round((date.getTime() - now) / 1000);
  const distance = Math.abs(seconds);
  if (distance < MINUTE) return "just now";
  if (distance < HOUR)
    return RELATIVE.format(Math.round(seconds / MINUTE), "minute");
  if (distance < DAY)
    return RELATIVE.format(Math.round(seconds / HOUR), "hour");
  if (distance < 30 * DAY)
    return RELATIVE.format(Math.round(seconds / DAY), "day");
  return DATE_ONLY.format(date);
}

/**
 * "3 days ago" inside a `<time>`. With `withDate`, the date is printed too
 * ("3 days ago · Sep 26"), so the exact day is never hidden in a tooltip.
 * Server rendered only, so the clock it reads is the request's. With no
 * usable date it renders a bare "—", which the tables keep as the whole cell.
 */
export function RelativeTime({
  now,
  value,
  withDate = false,
}: {
  now?: number;
  value: string | undefined;
  withDate?: boolean;
}) {
  const date = parseDate(value);
  if (!date) return "—";
  const clock = now ?? requestTime();
  const relative = relativeLabel(date, clock);
  return (
    <time dateTime={date.toISOString()}>
      {withDate && isRecent(date, clock)
        ? `${relative} · ${MONTH_DAY.format(date)}`
        : relative}
    </time>
  );
}

/** "18 of 25 (72%)", or "—" before any answer has been checked. */
export function formatCorrect(correct: number, checked: number) {
  if (checked <= 0) return "—";
  return `${NUMBER.format(correct)} of ${NUMBER.format(checked)} (${formatAccuracy(correct, checked)})`;
}

/**
 * The Students list: five columns and a labelled way into each record. When
 * the page has resolved and recorded username identities, each row leads
 * with the student's username and shows their code under it; without them
 * the row shows the code alone, as it does wherever the table is rendered
 * without an audited lookup. Hints, solutions, study sessions, extra
 * practice, AI tutor use and sketchpad time live on the student's record.
 */
export function InstructorStudentTable({
  identities,
  list,
  topicCount = activeCanonicalSyllabusTopics.length,
}: {
  identities?: InstructorStudentIdentities;
  list: InstructorStudentList;
  /** How many topics the course has; "Topics practiced" is shown out of this. */
  topicCount?: number;
}) {
  const labels = assignStudentLabels(
    list.students.map((student) => student.studentKey),
  );
  const now = requestTime();

  return (
    <div className="rounded-panel bg-sheet">
      <Table
        stickyHeader
        containerClassName="lg:max-h-[70svh] rounded-panel"
        className={`[&_thead_th]:bg-sheet ${PROFESSOR_TABLE_TYPE}`}
      >
        <TableCaption className="sr-only">
          Students on this page with what they have done so far. Choose View
          record to see a student&apos;s full record.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="pl-4">
              Student
            </TableHead>
            <TableHead scope="col">Last active</TableHead>
            <TableHead scope="col">Correct answers</TableHead>
            <TableHead scope="col">Topics practiced</TableHead>
            <TableHead scope="col">Needs attention</TableHead>
            <TableHead scope="col" className="pr-4">
              <span className="sr-only">Record</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.students.length > 0 ? (
            list.students.map((student) => {
              const label = labels.get(student.studentKey);
              return (
                <TableRow key={student.studentKey}>
                  <TableCell className="py-2.5 pl-4">
                    <div className="flex min-w-40 flex-col items-start gap-0.5">
                      {identities ? (
                        <StudentUsername
                          identity={identities[student.studentKey]}
                        />
                      ) : null}
                      <span
                        className={
                          identities
                            ? "type-small text-ink-muted"
                            : "font-medium text-ink"
                        }
                      >
                        {label}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <RelativeTime now={now} value={student.lastActiveAt} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular">
                    {formatCorrect(
                      student.correctAttempts,
                      student.correctAttempts +
                        (student.incorrectAttempts ?? 0),
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular">
                    {`${student.topicsPracticed} of ${topicCount}`}
                  </TableCell>
                  <TableCell>
                    {student.needsAttention ? (
                      <StatusChip tone="hint" label="Needs help" />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="py-2 pr-4 text-right">
                    <Button asChild variant="outline" className="min-h-11">
                      <Link
                        href={`/professor/students/${student.studentKey}`}
                        // Nothing on this page is prefetched on hover; see
                        // the pagination links.
                        prefetch={false}
                      >
                        View record
                        <span className="sr-only"> for {label}</span>
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={6} className="px-4 py-6 text-ink-muted">
                No students on this page.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
