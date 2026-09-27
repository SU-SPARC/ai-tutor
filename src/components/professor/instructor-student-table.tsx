import Link from "next/link";
import { Flag } from "lucide-react";

import { StudentUsername } from "@/components/professor/instructor-student-username";
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
import { sketchpadTimeDisplay } from "@/lib/professor/student-usage";
import type {
  InstructorStudentIdentities,
  InstructorStudentList,
} from "@/lib/types";

const DATE_TIME = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});
const DATE_ONLY = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parseDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
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
 * "3 days ago" inside a `<time>` whose title carries the exact date. Server
 * rendered only, so the clock it reads is the request's. With no usable date
 * it renders a bare "—", which the tables keep as the whole cell.
 */
export function RelativeTime({
  now,
  value,
}: {
  now?: number;
  value: string | undefined;
}) {
  const date = parseDate(value);
  if (!date) return "—";
  return (
    <time dateTime={date.toISOString()} title={DATE_TIME.format(date)}>
      {relativeLabel(date, now ?? requestTime())}
    </time>
  );
}

/**
 * The activity table. When the page has resolved and recorded username
 * identities, each row shows the student's username above their code; without
 * them the row stays pseudonymous, as it is wherever the table is rendered
 * without an audited lookup.
 */
export function InstructorStudentTable({
  identities,
  list,
  sketchpadMeasurementEnabled = false,
}: {
  identities?: InstructorStudentIdentities;
  list: InstructorStudentList;
  /** From the typed server environment; see `sketchpadTimeDisplay`. */
  sketchpadMeasurementEnabled?: boolean;
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
        className="[&_thead_th]:bg-sheet"
      >
        <TableCaption className="sr-only">
          Students on this page with their recorded practice. Open a student
          code for the full record.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="pl-4">
              Student
            </TableHead>
            <TableHead scope="col">Last active</TableHead>
            <TableHead scope="col" numeric>
              Topics (of {activeCanonicalSyllabusTopics.length})
            </TableHead>
            <TableHead scope="col" numeric>
              Attempts
            </TableHead>
            <TableHead scope="col" numeric>
              Correct
            </TableHead>
            <TableHead scope="col" numeric>
              Hints
            </TableHead>
            <TableHead scope="col" numeric>
              Solutions
            </TableHead>
            <TableHead scope="col" numeric>
              Est. Sketchpad Time
            </TableHead>
            <TableHead scope="col" numeric>
              AI Help Requests
            </TableHead>
            <TableHead scope="col" numeric>
              Practice sessions
            </TableHead>
            <TableHead scope="col" numeric className="pr-4">
              Extra practice
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.students.length > 0 ? (
            list.students.map((student) => (
              <TableRow key={student.studentKey}>
                <TableCell className="py-2.5 pl-4">
                  <div className="flex min-w-40 flex-col items-start gap-1">
                    {identities ? (
                      <StudentUsername
                        identity={identities[student.studentKey]}
                      />
                    ) : null}
                    <Link
                      className="relative rounded-xs font-medium text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-3"
                      href={`/professor/students/${student.studentKey}`}
                    >
                      {labels.get(student.studentKey)}
                    </Link>
                    {student.needsAttention ? (
                      <StatusChip
                        tone="neutral"
                        icon={Flag}
                        label="Repeated difficulty"
                      />
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap text-ink-muted">
                  <RelativeTime now={now} value={student.lastActiveAt} />
                </TableCell>
                <TableCell numeric>{student.topicsPracticed}</TableCell>
                <TableCell numeric>{student.attempts}</TableCell>
                <TableCell numeric className="whitespace-nowrap">
                  <span>{student.correctAttempts}</span>
                  <span className="text-ink-muted">
                    {" "}
                    (
                    {formatAccuracy(
                      student.correctAttempts,
                      student.correctAttempts +
                        (student.incorrectAttempts ?? 0),
                    )}
                    )
                  </span>
                </TableCell>
                <TableCell numeric>{student.hintsUsed}</TableCell>
                <TableCell numeric>{student.solutionsRevealed}</TableCell>
                <TableCell numeric className="whitespace-nowrap">
                  {sketchpadTimeDisplay(
                    student.sketchpadActiveSeconds,
                    sketchpadMeasurementEnabled,
                  )}
                </TableCell>
                <TableCell numeric>{student.aiHelpRequests}</TableCell>
                <TableCell numeric>{student.sessions}</TableCell>
                <TableCell numeric className="pr-4">
                  {student.extraPracticeSessions}
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={11} className="px-4 py-6 text-ink-muted">
                No students on this page.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
