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
 * The name fields a revealed student is ordered by. They exist only on the
 * server, for the duration of one reveal, and never travel to a client: the
 * roster payload carries the display name alone, already in order.
 */
export type RosterSortName = {
  displayName: string;
  familyName?: string;
  givenName?: string;
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
 * Alphabetical order for a revealed group: last name A–Z, then first name,
 * then the whole display name, then the pseudonym as a final tiebreak so the
 * order is total. A name the provider did not split — an account holding only
 * a display name, or only an email address — sorts by its display name in the
 * last-name position rather than being pushed to the end. Students with no
 * name to show, whether anonymous, unlinked, or unavailable, follow every
 * named student in pseudonym order, so the alphabetical run is uninterrupted.
 */
export function sortRosterStudents(
  students: InstructorRosterStudent[],
  names: ReadonlyMap<string, RosterSortName>,
): InstructorRosterStudent[] {
  return [...students].sort((left, right) => {
    const leftName = alphabeticalKey(left, names);
    const rightName = alphabeticalKey(right, names);

    if (!leftName || !rightName) {
      if (!leftName && !rightName) {
        return compareStudentKeys(left, right);
      }
      return leftName ? -1 : 1;
    }

    return (
      collator.compare(leftName.family, rightName.family) ||
      collator.compare(leftName.given, rightName.given) ||
      collator.compare(leftName.display, rightName.display) ||
      compareStudentKeys(left, right)
    );
  });
}

function alphabeticalKey(
  student: InstructorRosterStudent,
  names: ReadonlyMap<string, RosterSortName>,
) {
  if (student.identity?.status !== "identified") {
    return undefined;
  }

  const name = names.get(student.studentKey);
  const display = (name?.displayName ?? student.identity.displayName).trim();

  return {
    display,
    family: name?.familyName?.trim() || display,
    given: name?.givenName?.trim() ?? "",
  };
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
