import Link from "next/link";

import { PROFESSOR_TABLE_TYPE } from "@/components/professor/instructor-student-table";
import { StudentUsername } from "@/components/professor/instructor-student-username";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { assignStudentLabels } from "@/lib/professor/student-pseudonym";
import { rosterStudentKeys } from "@/lib/professor/student-roster";
import type { InstructorStudentTopicRoster } from "@/lib/types";

const NO_TOPIC_TITLE = "No topic practice yet";

function studentCount(count: number) {
  return `${count} ${count === 1 ? "student" : "students"}`;
}

/**
 * The Students page grouped by practiced topic, rendered on the server with
 * the usernames already resolved and recorded: nothing here fetches, stores,
 * or toggles anything in the browser (there is no button at all). Students
 * arrive in the order the server put them in — username A–Z within each topic.
 */
export function InstructorStudentTopicRoster({
  roster,
}: {
  roster: InstructorStudentTopicRoster;
}) {
  const labels = assignStudentLabels(rosterStudentKeys(roster));
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
      <p className="type-body text-ink">
        <span className="tabular">{studentCount(labels.size)}</span>, listed
        under every topic they have practiced, A to Z by username.
      </p>

      {groups.map((group) => {
        const headingId = `roster-${group.key}`;
        return (
          <section
            key={group.key}
            aria-labelledby={headingId}
            className="rounded-panel bg-sheet"
          >
            <header className="flex items-baseline justify-between gap-4 px-4 pt-4 pb-2">
              <h2 id={headingId} className="type-h3 text-ink">
                {group.title}
              </h2>
              <p className="type-small shrink-0 tabular text-ink">
                {studentCount(group.students.length)}
              </p>
            </header>
            <Table className={PROFESSOR_TABLE_TYPE}>
              <TableCaption className="sr-only">
                {group.key === "no-topic"
                  ? "Students who have signed in but not yet practiced a topic"
                  : `Students with recorded practice in ${group.title}`}
              </TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col" className="w-1/2 pl-4">
                    Username
                  </TableHead>
                  <TableHead scope="col" className="pr-4">
                    Student record
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.students.map((student) => (
                  <TableRow key={student.studentKey}>
                    <TableCell className="pl-4">
                      <StudentUsername
                        identity={
                          roster.revealed ? student.identity : undefined
                        }
                      />
                    </TableCell>
                    <TableCell className="pr-4">
                      <Link
                        className="inline-flex min-h-11 items-center rounded-xs font-medium text-azure-500 underline-offset-4 hover:text-azure-700 hover:underline focus-ring"
                        href={`/professor/students/${student.studentKey}`}
                        prefetch={false}
                      >
                        {labels.get(student.studentKey)}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}
