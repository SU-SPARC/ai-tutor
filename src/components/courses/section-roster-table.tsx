"use client";

import { CircleAlert } from "lucide-react";

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
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { formatRelativeTime, shortStudentLabel } from "@/lib/courses/format";
import { formatAccuracy } from "@/lib/professor/student-pseudonym";
import type { SectionMember } from "@/lib/courses/types";

export type RosterSortKey = "last_active" | "sessions" | "correctness" | "hints";

const SORT_NAMES: Record<RosterSortKey, string> = {
  last_active: "last active",
  sessions: "sessions",
  correctness: "correct answers",
  hints: "hints used",
};

/**
 * A section roster is a list of private student codes, never names. The code
 * is the first four characters of the student's key, printed in full view.
 *
 * There is no link to `/professor/students/<key>` here: that page reads the
 * analytics repository, which knows nothing about these demo members.
 */
export function SectionRosterTable({
  emptyMessage = "No student code matches that search.",
  members,
  sectionLabel,
  sort,
}: {
  emptyMessage?: string;
  members: SectionMember[];
  sectionLabel?: string;
  sort?: RosterSortKey;
}) {
  const ariaSort = (key: RosterSortKey) =>
    sort === key ? ("descending" as const) : undefined;

  return (
    <div className="rounded-panel bg-sheet px-2 pb-2">
      <Table>
        <TableCaption className="sr-only">
          Students in {sectionLabel ?? "this section"}
          {sort ? `, sorted by ${SORT_NAMES[sort]}` : ""}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Student code</TableHead>
            <TableHead aria-sort={ariaSort("sessions")} numeric scope="col">
              Sessions
            </TableHead>
            <TableHead aria-sort={ariaSort("correctness")} numeric scope="col">
              Correct
            </TableHead>
            <TableHead aria-sort={ariaSort("hints")} numeric scope="col">
              Hints used
            </TableHead>
            <TableHead scope="col">Note</TableHead>
            <TableHead aria-sort={ariaSort("last_active")} scope="col">
              Last active
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell className="py-4 text-ink-muted" colSpan={6}>
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : null}
          {members.map((member) => (
            <TableRow key={member.studentKey}>
              <TableCell>
                <span className="font-mono whitespace-nowrap">
                  {shortStudentLabel(member.studentKey)}
                </span>
              </TableCell>
              <TableCell numeric>{member.sessions}</TableCell>
              <TableCell numeric>
                {formatAccuracy(member.correctAttempts, member.attempts)}
              </TableCell>
              <TableCell numeric>{member.hintsUsed}</TableCell>
              <TableCell>
                {member.attentionNote ? (
                  <StatusChip
                    icon={CircleAlert}
                    label={member.attentionNote}
                    tone="neutral"
                  />
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-ink-muted">
                {formatRelativeTime(member.lastActiveAt, SEED_NOW)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
