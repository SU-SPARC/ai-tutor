import Link from "next/link";

import { StudentName } from "@/components/professor/instructor-student-name";
import { Badge } from "@/components/ui/badge";
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
import type { InstructorStudentTopicRoster } from "@/lib/types";

const NO_TOPIC_TITLE = "No topic practice yet";

/**
 * The Students page grouped by practised topic, rendered on the server with
 * the names already resolved and recorded: nothing here fetches, stores, or
 * toggles anything in the browser. Students arrive in the order the server
 * put them in — last name A–Z, then first name, within each topic.
 */
export function InstructorStudentTopicRoster({
  roster,
}: {
  roster: InstructorStudentTopicRoster;
}) {
  const labels = assignStudentLabels(rosterStudentKeys(roster));
  const groups = [
    ...roster.topics.map((group) => ({
      description: "Students with recorded practice in this topic.",
      key: group.topicId,
      students: group.students,
      title: group.topicTitle,
    })),
    ...(roster.unassigned.length > 0
      ? [
          {
            description:
              "Students who have signed in but not yet practised a topic.",
            key: "no-topic",
            students: roster.unassigned,
            title: NO_TOPIC_TITLE,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        {labels.size} {labels.size === 1 ? "student" : "students"}, listed
        under every topic they have practised and sorted by last name, then
        first name. Names are read from the account provider for this visit and
        each display is recorded; they are not stored in practice analytics.
      </p>

      {groups.map((group) => (
        <Card key={group.key}>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <CardTitle>{group.title}</CardTitle>
              <CardDescription>{group.description}</CardDescription>
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
                      <StudentName
                        identity={roster.revealed ? student.identity : undefined}
                      />
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
