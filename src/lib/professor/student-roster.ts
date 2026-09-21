import type {
  InstructorRosterStudent,
  InstructorStudentTopicGroup,
  InstructorStudentTopicRoster,
} from "@/lib/types";

/** One (student, topic) pair, or a student alone when they have no topic. */
export type StudentTopicRow = {
  studentKey: string;
  topicId?: string;
  topicTitle?: string;
};

/**
 * Builds the topic roster from one row per (student, topic) pair. Rows arrive
 * in syllabus order, which the groups keep; students within a group and in
 * the unassigned list are in pseudonym order, so the roster is deterministic
 * before any name is known. A student who practised several topics is listed
 * under each one — the same record, never a copy — and a student with no
 * topic at all is listed once under `unassigned`. A topic-less row for a
 * student who also has topics adds nothing.
 */
export function groupStudentsByTopic(
  rows: StudentTopicRow[],
): Pick<InstructorStudentTopicRoster, "topics" | "unassigned"> {
  const groups = new Map<string, InstructorStudentTopicGroup>();
  const assigned = new Set<string>();
  const everyone = new Set<string>();

  for (const row of rows) {
    everyone.add(row.studentKey);

    if (!row.topicId) {
      continue;
    }

    const group = groups.get(row.topicId) ?? {
      students: [],
      topicId: row.topicId,
      topicTitle: row.topicTitle ?? row.topicId,
    };
    if (!group.students.some((s) => s.studentKey === row.studentKey)) {
      group.students.push({ studentKey: row.studentKey });
    }
    groups.set(row.topicId, group);
    assigned.add(row.studentKey);
  }

  return {
    topics: [...groups.values()].map((group) => ({
      ...group,
      students: sortByStudentKey(group.students),
    })),
    unassigned: sortByStudentKey(
      [...everyone]
        .filter((studentKey) => !assigned.has(studentKey))
        .map((studentKey) => ({ studentKey })),
    ),
  };
}

/** Every pseudonym on the roster, once each, in first-listed order. */
export function rosterStudentKeys(
  roster: Pick<InstructorStudentTopicRoster, "topics" | "unassigned">,
): string[] {
  const keys = new Set<string>();
  for (const group of roster.topics) {
    for (const student of group.students) {
      keys.add(student.studentKey);
    }
  }
  for (const student of roster.unassigned) {
    keys.add(student.studentKey);
  }
  return [...keys];
}

const collator = new Intl.Collator("en", { sensitivity: "base" });

/**
 * Alphabetical order for a group: username A–Z, ignoring case, with the
 * pseudonym as a final tiebreak so the order is total. An identified account
 * without a username follows every account that has one, and students with
 * no account to show — anonymous, unlinked, or unavailable — follow those, in
 * pseudonym order, so the alphabetical run is uninterrupted.
 */
export function sortRosterStudents(
  students: InstructorRosterStudent[],
): InstructorRosterStudent[] {
  return [...students].sort((left, right) => {
    const rankDifference = rank(left) - rank(right);
    if (rankDifference !== 0) {
      return rankDifference;
    }

    return (
      collator.compare(username(left), username(right)) ||
      compareStudentKeys(left, right)
    );
  });
}

function username(student: InstructorRosterStudent) {
  return student.identity?.status === "identified"
    ? (student.identity.username?.trim() ?? "")
    : "";
}

function rank(student: InstructorRosterStudent) {
  if (student.identity?.status !== "identified") {
    return 2;
  }
  return username(student) ? 0 : 1;
}

function compareStudentKeys(
  left: InstructorRosterStudent,
  right: InstructorRosterStudent,
) {
  return left.studentKey < right.studentKey
    ? -1
    : left.studentKey > right.studentKey
      ? 1
      : 0;
}

function sortByStudentKey(students: InstructorRosterStudent[]) {
  return [...students].sort(compareStudentKeys);
}
