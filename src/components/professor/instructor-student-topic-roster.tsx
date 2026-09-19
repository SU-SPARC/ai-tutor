"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assignStudentLabels } from "@/lib/professor/student-pseudonym";
import { rosterStudentKeys } from "@/lib/professor/student-roster";
import type {
  InstructorRosterStudent,
  InstructorStudentTopicRoster,
} from "@/lib/types";

const NO_TOPIC_TITLE = "No topic practice yet";

/**
 * The Students page grouped by practised topic. It arrives pseudonymous and
 * stays that way until the instructor asks for names, which are then fetched
 * for every student at once and shown in the order the server put them in:
 * last name A–Z within each topic. As on the detail page, nothing about a
 * reveal is kept in the browser; leaving or reloading hides the names again,
 * and "Hide names" does the same without a reload.
 */
export function InstructorStudentTopicRoster({
  roster: initial,
}: {
  roster: InstructorStudentTopicRoster;
}) {
  const [roster, setRoster] = useState(initial);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const labels = assignStudentLabels(rosterStudentKeys(roster));
  const studentCount = labels.size;

  async function revealAll() {
    setPending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/professor/students/identities", {
        method: "POST",
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setRoster((await response.json()) as InstructorStudentTopicRoster);
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  function hideAll() {
    setRoster(initial);
    setFailed(false);
  }

  const groups = [
    ...roster.topics.map((group) => ({
      key: group.topicId,
      students: group.students,
      title: group.topicTitle,
    })),
    ...(roster.unassigned.length > 0
      ? [
          {
            key: "no-topic",
            students: roster.unassigned,
            title: NO_TOPIC_TITLE,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Student names</CardTitle>
          <CardDescription>
            Names are shown only to authorized instructors, are read from the
            account provider when you ask, and are not stored in practice
            analytics. Each reveal is recorded.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <p aria-live="polite" className="text-sm font-medium">
                {roster.revealed ? "Names revealed" : "Names hidden"}
              </p>
              <p className="text-sm text-muted-foreground">
                {roster.revealed
                  ? "Students are listed under every topic they have practised, sorted by last name and then first name."
                  : `${studentCount} ${studentCount === 1 ? "student is" : "students are"} listed by pseudonym under every topic they have practised.`}
              </p>
              {failed ? (
                <p className="text-sm text-muted-foreground" role="alert">
                  Names are temporarily unavailable. Please try again.
                </p>
              ) : null}
            </div>
            {roster.revealed ? (
              <Button onClick={hideAll} variant="outline">
                <EyeOff aria-hidden="true" className="h-4 w-4" />
                Hide names
              </Button>
            ) : (
              <Button
                disabled={pending || studentCount === 0}
                onClick={revealAll}
                variant="outline"
              >
                {pending ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Eye aria-hidden="true" className="h-4 w-4" />
                )}
                Reveal all names
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>{group.title}</CardTitle>
              <CardDescription>
                {group.key === "no-topic"
                  ? "Students who have signed in but not yet practised a topic."
                  : "Students with recorded practice in this topic."}
              </CardDescription>
            </div>
            <Badge variant="outline" className="shrink-0">
              {group.students.length}{" "}
              {group.students.length === 1 ? "student" : "students"}
            </Badge>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-6">Name</TableHead>
                  <TableHead className="px-6">Student</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.students.map((student) => (
                  <TableRow key={student.studentKey}>
                    <TableCell className="px-6 py-3">
                      <StudentName revealed={roster.revealed} student={student} />
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      <Link
                        className="font-medium text-primary hover:underline"
                        href={`/professor/students/${student.studentKey}`}
                      >
                        {labels.get(student.studentKey)}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * A student with no name to show is told apart from one whose name is merely
 * hidden, so an instructor can tell an absent account from a reveal that has
 * not happened yet.
 */
function StudentName({
  revealed,
  student,
}: {
  revealed: boolean;
  student: InstructorRosterStudent;
}) {
  if (!revealed || !student.identity) {
    return <span className="text-sm text-muted-foreground">Hidden</span>;
  }

  if (student.identity.status === "identified") {
    return (
      <span className="text-sm font-medium break-words">
        {student.identity.displayName}
      </span>
    );
  }

  return (
    <span className="text-sm text-muted-foreground">
      {MESSAGES[student.identity.status]}
    </span>
  );
}

const MESSAGES = {
  anonymous: "No account: practised without signing in",
  unavailable: "Temporarily unavailable",
  unlinked: "No longer has an account",
} as const;
