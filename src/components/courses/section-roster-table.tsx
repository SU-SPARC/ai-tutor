"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { formatRelativeTime, shortStudentLabel } from "@/lib/courses/format";
import { formatAccuracy } from "@/lib/professor/student-pseudonym";
import type { SectionMember } from "@/lib/courses/types";

/**
 * A section roster is a list of hashed student keys, never names. The label is
 * the first four hex digits, with the whole key in the title attribute so two
 * lookalike codes can still be told apart.
 *
 * There is no link to `/professor/students/<key>` here: that page reads the
 * analytics repository, which knows nothing about these demo members.
 */
export function SectionRosterTable({ members }: { members: SectionMember[] }) {
  return (
    <div className="rounded-lg border border-border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Student</TableHead>
            <TableHead className="px-4">Sessions</TableHead>
            <TableHead className="px-4">Correct</TableHead>
            <TableHead className="px-4">Hints</TableHead>
            <TableHead className="px-4">Attention</TableHead>
            <TableHead className="px-4">Last active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.length === 0 ? (
            <TableRow>
              <TableCell
                className="px-4 py-6 text-sm text-muted-foreground"
                colSpan={6}
              >
                No student code matches that search.
              </TableCell>
            </TableRow>
          ) : null}
          {members.map((member) => (
            <TableRow key={member.studentKey}>
              <TableCell className="px-4 py-3">
                <span className="font-mono text-sm" title={member.studentKey}>
                  {shortStudentLabel(member.studentKey)}
                </span>
              </TableCell>
              <TableCell className="px-4 py-3 tabular-nums">
                {member.sessions}
              </TableCell>
              <TableCell className="px-4 py-3 tabular-nums">
                {formatAccuracy(member.correctAttempts, member.attempts)}
              </TableCell>
              <TableCell className="px-4 py-3 tabular-nums">
                {member.hintsUsed}
              </TableCell>
              <TableCell className="px-4 py-3">
                {member.attentionNote ? (
                  <Badge className="gap-1.5" variant="secondary">
                    <span aria-hidden className="text-warning">
                      ●
                    </span>
                    {member.attentionNote}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                {formatRelativeTime(member.lastActiveAt, SEED_NOW)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
