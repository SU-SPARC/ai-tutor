import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

import ProfessorStudentsPage from "@/app/professor/students/page";
import { InstructorStudentTable } from "@/components/professor/instructor-student-table";
import { InstructorStudentTopicRoster } from "@/components/professor/instructor-student-topic-roster";
import { requireAnalyticsAccess } from "@/lib/auth/authorization";
import { listInstructorStudents } from "@/lib/data/data-store";
import type { StudentAccountLink } from "@/lib/data/student-identity-repository";
import {
  resolveInstructorStudentIdentities,
  resolveInstructorStudentRoster,
  rosterIdentitiesForLinks,
  setStudentIdentityDependenciesForTests,
  type ProviderIdentity,
} from "@/lib/professor/student-identity";
import { studentLabel } from "@/lib/professor/student-pseudonym";
import {
  groupStudentsByTopic,
  rosterStudentKeys,
  sortRosterStudents,
} from "@/lib/professor/student-roster";
import type {
  InstructorRosterStudent,
  InstructorStudentList,
  InstructorStudentSummary,
  InstructorStudentTopicRoster as TopicRoster,
} from "@/lib/types";

vi.mock("@/lib/data/data-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/data/data-store")>();
  return { ...actual, listInstructorStudents: vi.fn() };
});

/**
 * Pseudonyms whose lexical order is the reverse of their owners' usernames,
 * and usernames whose order differs from the owners' names.
 */
const KEY_ANDERS = "f1".padEnd(64, "0"); // zanders (Zoe Anders)
const KEY_BROWN = "e2".padEnd(64, "0"); // abrown (Adam Brown)
const KEY_CLARK_LIAM = "d3".padEnd(64, "0"); // mclark2 (Liam Clark)
const KEY_CLARK_MIA = "c4".padEnd(64, "0"); // mclark (Mia Clark)
const KEY_NO_USERNAME = "b5".padEnd(64, "0"); // account without a username
const KEY_ANONYMOUS = "a6".padEnd(64, "0");
const KEY_UNLINKED = "97".padEnd(64, "0");

const SUBJECTS: Record<string, string> = {
  [KEY_ANDERS]: "user_anders",
  [KEY_BROWN]: "user_brown",
  [KEY_CLARK_LIAM]: "user_clark_liam",
  [KEY_CLARK_MIA]: "user_clark_mia",
  [KEY_NO_USERNAME]: "user_no_username",
  [KEY_UNLINKED]: "user_gone",
};

const PROVIDER: Record<string, ProviderIdentity> = {
  user_anders: {
    displayName: "Zoe Anders",
    email: "zoe.anders@suffolk.edu",
    username: "zanders",
  },
  user_brown: {
    displayName: "Adam Brown",
    email: "adam.brown@suffolk.edu",
    username: "abrown",
  },
  user_clark_liam: { displayName: "Liam Clark", username: "mclark2" },
  user_clark_mia: { displayName: "Mia Clark", username: "mclark" },
  user_no_username: { displayName: "Bea Noname", email: "bea@suffolk.edu" },
  user_gone: "unlinked",
};

/** Strings that may never appear in a page, a payload, or an audit row. */
const PRIVATE_STRINGS = [
  "Zoe Anders",
  "Adam Brown",
  "Liam Clark",
  "Mia Clark",
  "Bea Noname",
  "zoe.anders@suffolk.edu",
  "adam.brown@suffolk.edu",
  "bea@suffolk.edu",
  "user_anders",
  "user_brown",
  "user_clark_liam",
];

/** Usernames that may appear on the page but never in an audit row. */
const USERNAMES = ["zanders", "abrown", "mclark2", "mclark"];

type RecordedViews = {
  requestId?: string;
  scope: "activity" | "roster";
  views: Array<{ status: string; studentKey: string }>;
};

afterEach(() => {
  resetAuthMocks();
  setStudentIdentityDependenciesForTests(undefined);
  vi.mocked(listInstructorStudents).mockReset();
  vi.unstubAllEnvs();
});

describe("grouping students by practised topic", () => {
  it("lists a student under every topic they practised without duplicating them", () => {
    const grouped = groupStudentsByTopic([
      { studentKey: KEY_ANDERS, topicId: "cp", topicTitle: "Conditional" },
      { studentKey: KEY_BROWN, topicId: "cp", topicTitle: "Conditional" },
      { studentKey: KEY_ANDERS, topicId: "bm", topicTitle: "Binomial" },
      // A repeated pair, as a union of sessions and attempts can produce.
      { studentKey: KEY_ANDERS, topicId: "bm", topicTitle: "Binomial" },
    ]);

    expect(grouped.topics).toEqual([
      {
        students: [{ studentKey: KEY_BROWN }, { studentKey: KEY_ANDERS }],
        topicId: "cp",
        topicTitle: "Conditional",
      },
      { students: [{ studentKey: KEY_ANDERS }], topicId: "bm", topicTitle: "Binomial" },
    ]);
    expect(grouped.unassigned).toEqual([]);
  });

  it("lists a student with no topic once, under unassigned", () => {
    const grouped = groupStudentsByTopic([
      { studentKey: KEY_CLARK_MIA },
      { studentKey: KEY_CLARK_LIAM },
      { studentKey: KEY_ANDERS, topicId: "cp", topicTitle: "Conditional" },
      // A topic-less row for a student who also has a topic adds nothing.
      { studentKey: KEY_ANDERS },
    ]);

    expect(grouped.topics.map((group) => group.students)).toEqual([
      [{ studentKey: KEY_ANDERS }],
    ]);
    expect(grouped.unassigned).toEqual([
      { studentKey: KEY_CLARK_MIA },
      { studentKey: KEY_CLARK_LIAM },
    ]);
  });

  it("keeps the topics in the order the rows arrived and names every student once", () => {
    const grouped = groupStudentsByTopic([
      { studentKey: KEY_BROWN, topicId: "week-3", topicTitle: "Week 3" },
      { studentKey: KEY_BROWN, topicId: "week-1", topicTitle: "Week 1" },
      { studentKey: KEY_ANONYMOUS },
    ]);

    expect(grouped.topics.map((group) => group.topicId)).toEqual([
      "week-3",
      "week-1",
    ]);
    expect(rosterStudentKeys(grouped)).toEqual([KEY_BROWN, KEY_ANONYMOUS]);
  });
});

describe("alphabetical order within a topic", () => {
  function identified(studentKey: string): InstructorRosterStudent {
    const identity = PROVIDER[SUBJECTS[studentKey]];
    return typeof identity === "string"
      ? { identity: { status: identity }, studentKey }
      : {
          identity: {
            status: "identified",
            ...(identity.username ? { username: identity.username } : {}),
          },
          studentKey,
        };
  }

  it("sorts by username, not by name, pseudonym, or provider order", () => {
    const sorted = sortRosterStudents([
      identified(KEY_CLARK_LIAM),
      identified(KEY_ANDERS),
      identified(KEY_CLARK_MIA),
      identified(KEY_BROWN),
    ]);

    // abrown leads although Anders's name and pseudonym both sort first;
    // mclark precedes mclark2 as a shorter prefix.
    expect(sorted.map((student) => student.identity)).toEqual([
      { status: "identified", username: "abrown" },
      { status: "identified", username: "mclark" },
      { status: "identified", username: "mclark2" },
      { status: "identified", username: "zanders" },
    ]);
  });

  it("ignores letter case when ordering", () => {
    const sorted = sortRosterStudents([
      { identity: { status: "identified", username: "zed" }, studentKey: "1".repeat(64) },
      { identity: { status: "identified", username: "Young" }, studentKey: "2".repeat(64) },
      { identity: { status: "identified", username: "alpha" }, studentKey: "3".repeat(64) },
    ]);

    expect(sorted.map((student) => student.identity)).toEqual([
      { status: "identified", username: "alpha" },
      { status: "identified", username: "Young" },
      { status: "identified", username: "zed" },
    ]);
  });

  it("places an account without a username after every account with one", () => {
    const sorted = sortRosterStudents([
      identified(KEY_NO_USERNAME),
      identified(KEY_ANDERS),
      identified(KEY_BROWN),
    ]);

    expect(sorted.map((student) => student.studentKey)).toEqual([
      KEY_BROWN,
      KEY_ANDERS,
      KEY_NO_USERNAME,
    ]);
  });

  it("puts students with no account to show last, in pseudonym order", () => {
    const sorted = sortRosterStudents([
      { identity: { status: "unavailable" }, studentKey: KEY_UNLINKED },
      identified(KEY_ANDERS),
      { identity: { status: "anonymous" }, studentKey: KEY_ANONYMOUS },
      identified(KEY_NO_USERNAME),
      identified(KEY_BROWN),
    ]);

    expect(sorted.map((student) => student.studentKey)).toEqual([
      KEY_BROWN,
      KEY_ANDERS,
      KEY_NO_USERNAME,
      KEY_UNLINKED,
      KEY_ANONYMOUS,
    ]);
  });

  it("does not reorder its input and orders the same input the same way twice", () => {
    const input = [identified(KEY_ANDERS), identified(KEY_BROWN)];
    const first = sortRosterStudents(input);
    const second = sortRosterStudents([...input].reverse());

    expect(input.map((student) => student.studentKey)).toEqual([
      KEY_ANDERS,
      KEY_BROWN,
    ]);
    expect(first).toEqual(second);
  });
});

describe("resolving usernames for the by-topic view", () => {
  it("looks up account holders together and never sends anonymous students to the provider", async () => {
    const lookUpIdentities = vi.fn(async (links: Array<{ subject: string }>) =>
      new Map(links.map(({ subject }) => [subject, PROVIDER[subject]])),
    );

    const resolved = await rosterIdentitiesForLinks(
      [KEY_ANDERS, KEY_ANONYMOUS, KEY_UNLINKED, KEY_NO_USERNAME, "0".repeat(64)],
      new Map<string, StudentAccountLink>([
        [KEY_ANDERS, accountLink(KEY_ANDERS)],
        [KEY_ANONYMOUS, { kind: "anonymous" }],
        [KEY_UNLINKED, accountLink(KEY_UNLINKED)],
        [KEY_NO_USERNAME, accountLink(KEY_NO_USERNAME)],
      ]),
      lookUpIdentities,
    );

    expect(lookUpIdentities).toHaveBeenCalledTimes(1);
    expect(
      lookUpIdentities.mock.calls[0][0].map(({ subject }) => subject).sort(),
    ).toEqual(["user_anders", "user_gone", "user_no_username"]);
    expect(resolved.get(KEY_ANDERS)).toEqual({
      status: "identified",
      username: "zanders",
    });
    // An account without a username is identified, with no username field.
    expect(resolved.get(KEY_NO_USERNAME)).toEqual({ status: "identified" });
    expect(resolved.get(KEY_ANONYMOUS)).toEqual({ status: "anonymous" });
    expect(resolved.get(KEY_UNLINKED)).toEqual({ status: "unlinked" });
    // A key the population no longer holds is reported, not invented.
    expect(resolved.get("0".repeat(64))).toEqual({ status: "unlinked" });
    // The display name and email the provider also holds are not read.
    expect(JSON.stringify([...resolved])).not.toContain("displayName");
    for (const value of PRIVATE_STRINGS) {
      expect(JSON.stringify([...resolved])).not.toContain(value);
    }
  });

  it("returns usernames only, grouped and ordered, after one audit write for everyone", async () => {
    const recordViews = recordViewsMock();
    setStudentIdentityDependenciesForTests({ ...rosterDependencies(), recordViews });

    const roster = await resolveInstructorStudentRoster(
      await professorAuthorization(),
      { requestId: "request-roster-1" },
    );

    expect(roster.revealed).toBe(true);
    expect(roster.topics.map((group) => group.topicTitle)).toEqual([
      "Conditional Probability",
      "Binomial Models",
    ]);
    expect(roster.topics[0].students).toEqual([
      { identity: { status: "identified", username: "abrown" }, studentKey: KEY_BROWN },
      { identity: { status: "identified", username: "zanders" }, studentKey: KEY_ANDERS },
      { identity: { status: "anonymous" }, studentKey: KEY_ANONYMOUS },
    ]);
    expect(roster.topics[1].students).toEqual([
      { identity: { status: "identified", username: "zanders" }, studentKey: KEY_ANDERS },
      { identity: { status: "unlinked" }, studentKey: KEY_UNLINKED },
    ]);
    expect(roster.unassigned).toEqual([
      { identity: { status: "identified", username: "mclark" }, studentKey: KEY_CLARK_MIA },
      { identity: { status: "identified", username: "mclark2" }, studentKey: KEY_CLARK_LIAM },
    ]);

    // One audit call, one row per student in the order the roster lists
    // them, marked as the by-topic view, with no username or name in it.
    expect(recordViews).toHaveBeenCalledTimes(1);
    expect(recordViews.mock.calls[0][1]).toEqual({
      requestId: "request-roster-1",
      scope: "roster",
      views: [
        { status: "anonymous", studentKey: KEY_ANONYMOUS },
        { status: "identified", studentKey: KEY_BROWN },
        { status: "identified", studentKey: KEY_ANDERS },
        { status: "unlinked", studentKey: KEY_UNLINKED },
        { status: "identified", studentKey: KEY_CLARK_LIAM },
        { status: "identified", studentKey: KEY_CLARK_MIA },
      ],
    });
    const audited = JSON.stringify(recordViews.mock.calls);
    for (const value of [...PRIVATE_STRINGS, ...USERNAMES]) {
      expect(audited).not.toContain(value);
    }

    // Each student carries the username and status and nothing else: no
    // name, email, subject, or id.
    const serialized = JSON.stringify(roster);
    for (const value of PRIVATE_STRINGS) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain("displayName");
    for (const student of everyStudent(roster)) {
      expect(Object.keys(student).sort()).toEqual(["identity", "studentKey"]);
      expect(Object.keys(student.identity ?? {}).sort()).toEqual(
        student.identity?.status === "identified"
          ? ["status", "username"]
          : ["status"],
      );
    }
  });

  it("withholds every username when the display cannot be audited", async () => {
    const lookUpIdentities = vi.fn(rosterDependencies().lookUpIdentities);
    setStudentIdentityDependenciesForTests({
      ...rosterDependencies(),
      lookUpIdentities,
      recordViews: async () => {
        throw new Error('relation "audit_events" does not exist');
      },
    });

    const roster = await resolveInstructorStudentRoster(
      await professorAuthorization(),
    );
    const serialized = JSON.stringify(roster);

    // The usernames were resolved and then discarded.
    expect(lookUpIdentities).toHaveBeenCalled();
    for (const student of everyStudent(roster)) {
      expect(student.identity).toEqual({ status: "unavailable" });
    }
    for (const value of [...PRIVATE_STRINGS, ...USERNAMES]) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain("audit_events");
    // With no usernames, students keep their pseudonymous order.
    expect(roster.topics[0].students.map((s) => s.studentKey)).toEqual(
      [KEY_ANDERS, KEY_BROWN, KEY_ANONYMOUS].sort(),
    );
  });

  it("refuses a principal without professor permission before reading anything", async () => {
    const listTopicRoster = vi.fn();
    setStudentIdentityDependenciesForTests({ listTopicRoster });

    await expect(
      resolveInstructorStudentRoster({ permission: "student" } as never),
    ).rejects.toThrow();
    expect(listTopicRoster).not.toHaveBeenCalled();
  });
});

describe("resolving usernames for the activity table", () => {
  it("resolves the students on the page after one audit write marked as the activity view", async () => {
    const recordViews = recordViewsMock();
    setStudentIdentityDependenciesForTests({ ...rosterDependencies(), recordViews });

    const identities = await resolveInstructorStudentIdentities(
      await professorAuthorization(),
      [KEY_BROWN, KEY_ANONYMOUS, KEY_BROWN, KEY_ANDERS, KEY_NO_USERNAME],
      { requestId: "request-activity-1" },
    );

    expect(identities).toEqual({
      [KEY_BROWN]: { status: "identified", username: "abrown" },
      [KEY_ANONYMOUS]: { status: "anonymous" },
      [KEY_ANDERS]: { status: "identified", username: "zanders" },
      [KEY_NO_USERNAME]: { status: "identified" },
    });
    expect(recordViews).toHaveBeenCalledTimes(1);
    expect(recordViews.mock.calls[0][1]).toEqual({
      requestId: "request-activity-1",
      scope: "activity",
      views: [
        { status: "identified", studentKey: KEY_BROWN },
        { status: "anonymous", studentKey: KEY_ANONYMOUS },
        { status: "identified", studentKey: KEY_ANDERS },
        { status: "identified", studentKey: KEY_NO_USERNAME },
      ],
    });
    const serialized = JSON.stringify(identities);
    for (const value of PRIVATE_STRINGS) {
      expect(serialized).not.toContain(value);
    }
  });

  it("looks up and records nothing for an empty page", async () => {
    const findAccountLinks = vi.fn();
    const recordViews = recordViewsMock();
    setStudentIdentityDependenciesForTests({ findAccountLinks, recordViews });

    await expect(
      resolveInstructorStudentIdentities(await professorAuthorization(), []),
    ).resolves.toEqual({});
    expect(findAccountLinks).not.toHaveBeenCalled();
    expect(recordViews).not.toHaveBeenCalled();
  });

  it("withholds every username on the page when the display cannot be audited", async () => {
    setStudentIdentityDependenciesForTests({
      ...rosterDependencies(),
      recordViews: async () => {
        throw new Error("audit store unavailable");
      },
    });

    const identities = await resolveInstructorStudentIdentities(
      await professorAuthorization(),
      [KEY_ANDERS, KEY_ANONYMOUS],
    );

    expect(identities).toEqual({
      [KEY_ANDERS]: { status: "unavailable" },
      [KEY_ANONYMOUS]: { status: "unavailable" },
    });
  });

  it("refuses a principal without professor permission", async () => {
    const findAccountLinks = vi.fn();
    setStudentIdentityDependenciesForTests({ findAccountLinks });

    await expect(
      resolveInstructorStudentIdentities({ permission: "student" } as never, [
        KEY_ANDERS,
      ]),
    ).rejects.toThrow();
    expect(findAccountLinks).not.toHaveBeenCalled();
  });
});

describe("Students page", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  it("shows every username in the by-topic view on load, ordered by username, with nothing to click", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const recordViews = recordViewsMock();
    setStudentIdentityDependenciesForTests({ ...rosterDependencies(), recordViews });

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({
        searchParams: Promise.resolve({ view: "topics" }),
      }),
    );

    expect(markup).toContain("Conditional Probability");
    expect(markup).toContain("Binomial Models");
    expect(markup).toContain("No topic practice yet");
    expect(markup).toContain(">Username<");
    expect(markup).toContain(`href="/professor/students/${KEY_ANDERS}"`);
    expect(markup).toContain(studentLabel(KEY_ANDERS));
    // abrown before zanders before the anonymous student, within the first
    // group; mclark before mclark2 in the unassigned group.
    expect(markup.indexOf("abrown")).toBeLessThan(markup.indexOf("zanders"));
    expect(markup.indexOf("zanders")).toBeLessThan(
      markup.indexOf("practised without signing in"),
    );
    expect(markup.indexOf(">mclark<")).toBeLessThan(markup.indexOf(">mclark2<"));
    expect(markup).not.toContain("Reveal all names");
    expect(markup).not.toContain("Hide names");
    expect(markup).not.toContain("Username hidden");
    for (const value of PRIVATE_STRINGS) {
      expect(markup).not.toContain(value);
    }
    expect(recordViews).toHaveBeenCalledTimes(1);
    expect(recordViews.mock.calls[0][1].scope).toBe("roster");
    expect(listInstructorStudents).not.toHaveBeenCalled();
  });

  it("shows usernames beside the codes in the activity view and records the display", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const recordViews = recordViewsMock();
    setStudentIdentityDependenciesForTests({ ...rosterDependencies(), recordViews });
    vi.mocked(listInstructorStudents).mockResolvedValue(
      activityList([KEY_ANDERS, KEY_ANONYMOUS, KEY_BROWN, KEY_NO_USERNAME]),
    );

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Practice sessions");
    expect(markup).toContain("Search by student code");
    expect(markup).toContain("zanders");
    expect(markup).toContain("abrown");
    expect(markup).toContain("practised without signing in");
    expect(markup).toContain("Username unavailable");
    expect(markup).toContain(studentLabel(KEY_BROWN));
    // The activity view keeps its own order: the list's, not the alphabet's.
    expect(markup.indexOf("zanders")).toBeLessThan(markup.indexOf("abrown"));
    expect(markup).toContain('href="/professor/students?view=topics"');
    expect(markup).not.toContain("Reveal all names");
    for (const value of PRIVATE_STRINGS) {
      expect(markup).not.toContain(value);
    }
    expect(recordViews).toHaveBeenCalledTimes(1);
    expect(recordViews.mock.calls[0][1]).toMatchObject({
      scope: "activity",
      views: [
        { status: "identified", studentKey: KEY_ANDERS },
        { status: "anonymous", studentKey: KEY_ANONYMOUS },
        { status: "identified", studentKey: KEY_BROWN },
        { status: "identified", studentKey: KEY_NO_USERNAME },
      ],
    });
  });

  it("does not prefetch either view from its links", async () => {
    mockPrincipal(TEST_PROFESSOR);
    setStudentIdentityDependenciesForTests(rosterDependencies());
    vi.mocked(listInstructorStudents).mockResolvedValue(
      activityList([KEY_BROWN], { limit: 1, total: 2 }),
    );

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
    );

    // Rendering usernames is an audited event, so no link into the page may
    // be prefetched on hover. Next renders prefetch={false} links without the
    // prefetch attribute, and the pagination link must exist to be checked.
    expect(markup).toContain("Next");
    expect(markup).toContain('href="/professor/students?page=2');
    expect(markup).not.toContain("prefetch");
  });

  it("shows unavailable usernames rather than the page failing when the audit write fails", async () => {
    mockPrincipal(TEST_PROFESSOR);
    setStudentIdentityDependenciesForTests({
      ...rosterDependencies(),
      recordViews: async () => {
        throw new Error("audit store unavailable");
      },
    });

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({
        searchParams: Promise.resolve({ view: "topics" }),
      }),
    );

    expect(markup).toContain("Username temporarily unavailable");
    expect(markup).toContain(studentLabel(KEY_ANDERS));
    for (const value of [...PRIVATE_STRINGS, ...USERNAMES]) {
      expect(markup).not.toContain(value);
    }
    expect(markup).not.toContain("audit store");
  });

  it("falls back to the activity view for an unknown view parameter", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const listTopicRoster = vi.fn();
    setStudentIdentityDependenciesForTests({ listTopicRoster });
    vi.mocked(listInstructorStudents).mockResolvedValue(activityList([]));

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({
        searchParams: Promise.resolve({ view: "names" }),
      }),
    );

    expect(markup).toContain("No students have signed in");
    expect(listTopicRoster).not.toHaveBeenCalled();
  });

  it("refuses both views to a student and to a signed-out visitor before any username is read", async () => {
    const findAccountLinks = vi.fn();
    const listTopicRoster = vi.fn();
    setStudentIdentityDependenciesForTests({ findAccountLinks, listTopicRoster });

    for (const principal of [TEST_STUDENT, undefined]) {
      mockPrincipal(principal);
      await expect(
        ProfessorStudentsPage({ searchParams: Promise.resolve({ view: "topics" }) }),
      ).rejects.toThrow();
      await expect(
        ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow();
    }
    expect(findAccountLinks).not.toHaveBeenCalled();
    expect(listTopicRoster).not.toHaveBeenCalled();
    expect(listInstructorStudents).not.toHaveBeenCalled();
  });

  it("shows the demo notice in both views and records nothing", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const recordViews = recordViewsMock();
    setStudentIdentityDependenciesForTests({
      listTopicRoster: async () => ({
        mode: "demo",
        revealed: false,
        topics: [],
        unassigned: [],
      }),
      recordViews,
    });
    vi.mocked(listInstructorStudents).mockResolvedValue({
      limit: 25,
      mode: "demo",
      offset: 0,
      students: [],
      total: 0,
    });

    const topics = renderToStaticMarkup(
      await ProfessorStudentsPage({
        searchParams: Promise.resolve({ view: "topics" }),
      }),
    );
    const activity = renderToStaticMarkup(
      await ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(topics).toContain("there is no class to list here");
    expect(activity).toContain("there is no class to list here");
    expect(recordViews).not.toHaveBeenCalled();
  });
});

describe("roster and table markup", () => {
  it("renders resolved usernames in the order given", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentTopicRoster, {
        roster: {
          mode: "database",
          revealed: true,
          topics: [
            {
              students: [
                { identity: { status: "identified", username: "abrown" }, studentKey: KEY_BROWN },
                { identity: { status: "identified", username: "zanders" }, studentKey: KEY_ANDERS },
                { identity: { status: "identified" }, studentKey: KEY_NO_USERNAME },
                { identity: { status: "anonymous" }, studentKey: KEY_ANONYMOUS },
                { identity: { status: "unlinked" }, studentKey: KEY_UNLINKED },
              ],
              topicId: "conditional-probability",
              topicTitle: "Conditional Probability",
            },
          ],
          unassigned: [],
        },
      }),
    );

    expect(markup.indexOf("abrown")).toBeLessThan(markup.indexOf("zanders"));
    expect(markup.indexOf("zanders")).toBeLessThan(
      markup.indexOf("Username unavailable"),
    );
    expect(markup.indexOf("Username unavailable")).toBeLessThan(
      markup.indexOf("practised without signing in"),
    );
    expect(markup).toContain("No longer has an account");
    expect(markup).toContain("5 students");
    expect(markup).toContain(">Username<");
    expect(markup).not.toContain("No topic practice yet");
    expect(markup).not.toContain("<button");
  });

  it("stays pseudonymous when handed an unresolved roster", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentTopicRoster, { roster: pseudonymousRoster() }),
    );

    expect(markup).toContain("Username hidden");
    expect(markup).toContain(studentLabel(KEY_ANDERS));
    expect(markup).not.toContain("zanders");
  });

  it("shows usernames in table rows only when identities are supplied", () => {
    const list = activityList([KEY_ANDERS]);
    const named = renderToStaticMarkup(
      createElement(InstructorStudentTable, {
        identities: { [KEY_ANDERS]: { status: "identified", username: "zanders" } },
        list,
      }),
    );
    const pseudonymous = renderToStaticMarkup(
      createElement(InstructorStudentTable, { list }),
    );

    expect(named).toContain("zanders");
    expect(named).toContain(studentLabel(KEY_ANDERS));
    expect(pseudonymous).toContain(studentLabel(KEY_ANDERS));
    expect(pseudonymous).not.toContain("zanders");
    expect(pseudonymous).not.toContain("Username hidden");
  });
});

function accountLink(studentKey: string): StudentAccountLink {
  return { identityProvider: "clerk", kind: "account", subject: SUBJECTS[studentKey] };
}

function everyStudent(roster: TopicRoster) {
  return [...roster.topics.flatMap((group) => group.students), ...roster.unassigned];
}

function recordViewsMock() {
  return vi.fn<(authorization: unknown, input: RecordedViews) => Promise<void>>(
    async () => {},
  );
}

function activityList(
  studentKeys: string[],
  overrides: Partial<InstructorStudentList> = {},
): InstructorStudentList {
  return {
    limit: 25,
    mode: "database",
    offset: 0,
    students: studentKeys.map(
      (studentKey): InstructorStudentSummary => ({
        attempts: 0,
        correctAttempts: 0,
        extraPracticeSessions: 0,
        hintsUsed: 0,
        incorrectAttempts: 0,
        llmAttempts: 0,
        misconceptionAttempts: 0,
        needsAttention: false,
        sessions: 0,
        solutionsRevealed: 0,
        solvedSessions: 0,
        studentKey,
        topicsPracticed: 0,
      }),
    ),
    total: studentKeys.length,
    ...overrides,
  };
}

/**
 * Two topics and an unassigned pair. Every group is in pseudonym order, which
 * is the reverse of the alphabetical order the page must produce.
 */
function pseudonymousRoster(): TopicRoster {
  return {
    mode: "database",
    revealed: false,
    topics: [
      {
        students: [KEY_ANONYMOUS, KEY_BROWN, KEY_ANDERS].map((studentKey) => ({ studentKey })),
        topicId: "conditional-probability",
        topicTitle: "Conditional Probability",
      },
      {
        students: [KEY_UNLINKED, KEY_ANDERS].map((studentKey) => ({ studentKey })),
        topicId: "binomial-models",
        topicTitle: "Binomial Models",
      },
    ],
    unassigned: [KEY_CLARK_LIAM, KEY_CLARK_MIA].map((studentKey) => ({ studentKey })),
  };
}

function rosterDependencies() {
  return {
    findAccountLinks: async (_authorization: unknown, studentKeys: string[]) =>
      new Map<string, StudentAccountLink>(
        studentKeys.map((studentKey) => [
          studentKey,
          studentKey === KEY_ANONYMOUS
            ? { kind: "anonymous" as const }
            : accountLink(studentKey),
        ]),
      ),
    listTopicRoster: async () => pseudonymousRoster(),
    lookUpIdentities: async (links: Array<{ subject: string }>) =>
      new Map(links.map(({ subject }) => [subject, PROVIDER[subject]])),
    recordViews: async () => {},
  };
}

async function professorAuthorization() {
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}
