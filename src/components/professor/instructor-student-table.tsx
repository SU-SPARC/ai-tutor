import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  assignStudentLabels,
  formatAccuracy,
} from "@/lib/professor/student-pseudonym";
import type { InstructorStudentList } from "@/lib/types";

const REPEATED_DIFFICULTY_MINIMUM_ATTEMPTS = 4;
const REPEATED_DIFFICULTY_MAXIMUM_ACCURACY = 0.4;

function formatDate(value: string | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * The same rule the repository uses for the cohort count, applied to a row so
 * the table and the cohort total can never disagree.
 */
function needsAttention(attempts: number, correctAttempts: number) {
  return (
    attempts >= REPEATED_DIFFICULTY_MINIMUM_ATTEMPTS &&
    correctAttempts / attempts <= REPEATED_DIFFICULTY_MAXIMUM_ACCURACY
  );
}

export function InstructorStudentTable({
  list,
}: {
  list: InstructorStudentList;
}) {
  const labels = assignStudentLabels(
    list.students.map((student) => student.studentKey),
  );

  return (
    <div className="rounded-lg border border-border bg-card shadow-xs">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="px-4">Student</TableHead>
            <TableHead className="px-4">Sessions</TableHead>
            <TableHead className="px-4">Attempts</TableHead>
            <TableHead className="px-4">Correct</TableHead>
            <TableHead className="px-4">Topics</TableHead>
            <TableHead className="px-4">Hints</TableHead>
            <TableHead className="px-4">Solutions</TableHead>
            <TableHead className="px-4">Last active</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.students.map((student) => (
            <TableRow key={student.studentKey}>
              <TableCell className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  <Link
                    className="font-medium text-primary hover:underline"
                    href={`/professor/students/${student.studentKey}`}
                  >
                    {labels.get(student.studentKey)}
                  </Link>
                  {needsAttention(student.attempts, student.correctAttempts) ? (
                    <Badge variant="outline" className="w-fit gap-1">
                      May benefit from instructor attention
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="px-4 py-3">{student.sessions}</TableCell>
              <TableCell className="px-4 py-3">{student.attempts}</TableCell>
              <TableCell className="px-4 py-3">
                <span className="font-medium">{student.correctAttempts}</span>
                <span className="text-muted-foreground">
                  {" "}
                  ({formatAccuracy(student.correctAttempts, student.attempts)})
                </span>
              </TableCell>
              <TableCell className="px-4 py-3">
                {student.topicsPracticed}
              </TableCell>
              <TableCell className="px-4 py-3">{student.hintsUsed}</TableCell>
              <TableCell className="px-4 py-3">
                {student.solutionsRevealed}
              </TableCell>
              <TableCell className="px-4 py-3 text-muted-foreground">
                {formatDate(student.lastActiveAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
