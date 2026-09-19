import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

import { POST as revealRoster } from "@/app/api/professor/students/identities/route";
import ProfessorStudentsPage from "@/app/professor/students/page";
import { InstructorStudentTopicRoster } from "@/components/professor/instructor-student-topic-roster";
import {
  listInstructorStudents,
  listInstructorStudentTopicRoster,
} from "@/lib/data/data-store";
import type { StudentAccountLink } from "@/lib/data/student-identity-repository";
import {
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
  type RosterSortName,
} from "@/lib/professor/student-roster";
import type {
  InstructorRosterStudent,
  InstructorStudentTopicRoster as TopicRoster,
} from "@/lib/types";

vi.mock("@/lib/data/data-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/data/data-store")>();
  return {
    ...actual,
    listInstructorStudents: vi.fn(),
    listInstructorStudentTopicRoster: vi.fn(),
  };
});

/** Pseudonyms whose lexical order is the reverse of their owners' surnames. */
const KEY_ANDERS = "f1".padEnd(64, "0"); // Zoe Anders
const KEY_BROWN = "e2".padEnd(64, "0"); // Adam Brown
const KEY_CLARK_LIAM = "d3".padEnd(64, "0"); // Liam Clark
const KEY_CLARK_MIA = "c4".padEnd(64, "0"); // Mia Clark
const KEY_EMAIL_ONLY = "b5".padEnd(64, "0"); // no split name
const KEY_ANONYMOUS = "a6".padEnd(64, "0");
const KEY_UNLINKED = "97".padEnd(64, "0");

const SUBJECTS: Record<string, string> = {
  [KEY_ANDERS]: "user_anders",
  [KEY_BROWN]: "user_brown",
  [KEY_CLARK_LIAM]: "user_clark_liam",
  [KEY_CLARK_MIA]: "user_clark_mia",
  [KEY_EMAIL_ONLY]: "user_email_only",
  [KEY_UNLINKED]: "user_gone",
};

const PROVIDER: Record<string, ProviderIdentity> = {
  user_anders: {
    displayName: "Zoe Anders",
    email: "zoe.anders@suffolk.edu",
    familyName: "Anders",
    givenName: "Zoe",
    username: "zanders",
  },
  user_brown: {
    displayName: "Adam Brown",
    email: "adam.brown@suffolk.edu",
    familyName: "Brown",
    givenName: "Adam",
  },
  user_clark_liam: {
    displayName: "Liam Clark",
    familyName: "Clark",
    givenName: "Liam",
  },
  user_clark_mia: {
    displayName: "Mia Clark",
    familyName: "Clark",
    givenName: "Mia",
  },
  user_email_only: { displayName: "bea@suffolk.edu", email: "bea@suffolk.edu" },
  user_gone: "unlinked",
};

/** Strings that may appear only after an audited reveal, and never in a URL. */
const PRIVATE_STRINGS = [
  "zoe.anders@suffolk.edu",
  "zanders",
  "adam.brown@suffolk.edu",
  "user_anders",
  "user_brown",
  "user_clark_liam",
];

afterEach(() => {
  resetAuthMocks();
  setStudentIdentityDependenciesForTests(undefined);
  vi.mocked(listInstructorStudents).mockReset();
  vi.mocked(listInstructorStudentTopicRoster).mockReset();
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
  const names = new Map<string, RosterSortName>(
    Object.entries(SUBJECTS).flatMap(([studentKey, subject]) => {
      const identity = PROVIDER[subject];
      return typeof identity === "string" ? [] : [[studentKey, identity]];
    }),
  );

  function identified(studentKey: string): InstructorRosterStudent {
    const identity = PROVIDER[SUBJECTS[studentKey]];
    return typeof identity === "string"
      ? { identity: { status: identity }, studentKey }
      : {
          identity: { displayName: identity.displayName, status: "identified" },
          studentKey,
        };
  }

  it("sorts by last name and then first name, not by pseudonym or display name", () => {
    const sorted = sortRosterStudents(
      [
        identified(KEY_CLARK_MIA),
        identified(KEY_BROWN),
        identified(KEY_CLARK_LIAM),
        identified(KEY_ANDERS),
      ],
      names,
    );

    // "Zoe Anders" leads although her first name and pseudonym both sort
    // last; the two Clarks are separated by first name.
    expect(sorted.map((student) => student.studentKey)).toEqual([
      KEY_ANDERS,
      KEY_BROWN,
      KEY_CLARK_LIAM,
      KEY_CLARK_MIA,
    ]);
  });

  it("ignores letter case when ordering", () => {
    const sorted = sortRosterStudents(
      [
        { identity: { displayName: "amy zed", status: "identified" }, studentKey: "1".repeat(64) },
        { identity: { displayName: "Bo Young", status: "identified" }, studentKey: "2".repeat(64) },
      ],
      new Map([
        ["1".repeat(64), { displayName: "amy zed", familyName: "zed", givenName: "amy" }],
        ["2".repeat(64), { displayName: "Bo Young", familyName: "Young", givenName: "Bo" }],
      ]),
    );

    expect(sorted.map((student) => student.identity)).toEqual([
      { displayName: "Bo Young", status: "identified" },
      { displayName: "amy zed", status: "identified" },
    ]);
  });

  it("places a name the provider did not split by its display name", () => {
    const sorted = sortRosterStudents(
      [identified(KEY_CLARK_MIA), identified(KEY_EMAIL_ONLY), identified(KEY_ANDERS)],
      names,
    );

    // "bea@suffolk.edu" has no last name; it sorts as a whole, between
    // Anders and Clark, rather than falling to the end.
    expect(sorted.map((student) => student.studentKey)).toEqual([
      KEY_ANDERS,
      KEY_EMAIL_ONLY,
      KEY_CLARK_MIA,
    ]);
  });

  it("puts students with no name to show after every named student, in pseudonym order", () => {
    const sorted = sortRosterStudents(
      [
        { identity: { status: "unavailable" }, studentKey: KEY_UNLINKED },
        identified(KEY_BROWN),
        { identity: { status: "anonymous" }, studentKey: KEY_ANONYMOUS },
        identified(KEY_ANDERS),
      ],
      names,
    );

    expect(sorted.map((student) => student.studentKey)).toEqual([
      KEY_ANDERS,
      KEY_BROWN,
      KEY_UNLINKED,
      KEY_ANONYMOUS,
    ]);
  });

  it("does not reorder its input and orders the same input the same way twice", () => {
    const input = [identified(KEY_BROWN), identified(KEY_ANDERS)];
    const first = sortRosterStudents(input, names);
    const second = sortRosterStudents([...input].reverse(), names);

    expect(input.map((student) => student.studentKey)).toEqual([
      KEY_BROWN,
      KEY_ANDERS,
    ]);
    expect(first).toEqual(second);
  });
});

describe("roster identity resolution", () => {
  it("looks up account holders together and never sends anonymous students to the provider", async () => {
    const lookUpIdentities = vi.fn(async (links: Array<{ subject: string }>) =>
      new Map(links.map(({ subject }) => [subject, PROVIDER[subject]])),
    );

    const resolved = await rosterIdentitiesForLinks(
      [KEY_ANDERS, KEY_ANONYMOUS, KEY_UNLINKED, KEY_BROWN, "0".repeat(64)],
      new Map<string, StudentAccountLink>([
        [KEY_ANDERS, accountLink(KEY_ANDERS)],
        [KEY_ANONYMOUS, { kind: "anonymous" }],
        [KEY_UNLINKED, accountLink(KEY_UNLINKED)],
        [KEY_BROWN, accountLink(KEY_BROWN)],
      ]),
      lookUpIdentities,
    );

    expect(lookUpIdentities).toHaveBeenCalledTimes(1);
    expect(
      lookUpIdentities.mock.calls[0][0].map(({ subject }) => subject).sort(),
    ).toEqual(["user_anders", "user_brown", "user_gone"]);
    expect(resolved.get(KEY_ANDERS)).toEqual({
      identity: { displayName: "Zoe Anders", status: "identified" },
      name: { displayName: "Zoe Anders", familyName: "Anders", givenName: "Zoe" },
    });
    expect(resolved.get(KEY_ANONYMOUS)).toEqual({ identity: { status: "anonymous" } });
    expect(resolved.get(KEY_UNLINKED)).toEqual({ identity: { status: "unlinked" } });
    // A key the population no longer holds is reported, not invented.
    expect(resolved.get("0".repeat(64))).toEqual({ identity: { status: "unlinked" } });
  });

  it("returns display names only, grouped and ordered, after one audit write for everyone", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const recordViews = vi.fn<
      (authorization: unknown, input: RecordedViews) => Promise<void>
    >(async () => {});
    setStudentIdentityDependenciesForTests({
      ...rosterDependencies(),
      recordViews,
    });

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
      { identity: { displayName: "Zoe Anders", status: "identified" }, studentKey: KEY_ANDERS },
      { identity: { displayName: "Adam Brown", status: "identified" }, studentKey: KEY_BROWN },
      { identity: { status: "anonymous" }, studentKey: KEY_ANONYMOUS },
    ]);
    expect(roster.topics[1].students).toEqual([
      { identity: { displayName: "Zoe Anders", status: "identified" }, studentKey: KEY_ANDERS },
      { identity: { status: "unlinked" }, studentKey: KEY_UNLINKED },
    ]);
    expect(roster.unassigned).toEqual([
      { identity: { displayName: "Liam Clark", status: "identified" }, studentKey: KEY_CLARK_LIAM },
      { identity: { displayName: "Mia Clark", status: "identified" }, studentKey: KEY_CLARK_MIA },
    ]);

    // One audit call, one row per student in the order the roster lists
    // them, no name in it.
    expect(recordViews).toHaveBeenCalledTimes(1);
    expect(recordViews.mock.calls[0][1]).toEqual({
      requestId: "request-roster-1",
      views: [
        { status: "anonymous", studentKey: KEY_ANONYMOUS },
        { status: "identified", studentKey: KEY_BROWN },
        { status: "identified", studentKey: KEY_ANDERS },
        { status: "unlinked", studentKey: KEY_UNLINKED },
        { status: "identified", studentKey: KEY_CLARK_MIA },
        { status: "identified", studentKey: KEY_CLARK_LIAM },
      ],
    });
    const audited = JSON.stringify(recordViews.mock.calls);
    expect(audited).not.toContain("Anders");
    expect(audited).not.toContain("Clark");
    for (const value of PRIVATE_STRINGS) {
      expect(audited).not.toContain(value);
    }

    // The payload holds the display name and status of each student and
    // nothing else: no email, username, split name, subject, or id.
    const serialized = JSON.stringify(roster);
    for (const value of PRIVATE_STRINGS) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain("familyName");
    expect(serialized).not.toContain("givenName");
    for (const student of [...roster.topics.flatMap((g) => g.students), ...roster.unassigned]) {
      expect(Object.keys(student).sort()).toEqual(["identity", "studentKey"]);
      expect(Object.keys(student.identity ?? {}).sort()).toEqual(
        student.identity?.status === "identified"
          ? ["displayName", "status"]
          : ["status"],
      );
    }
  });

  it("withholds every name when the roster reveal cannot be audited", async () => {
    mockPrincipal(TEST_PROFESSOR);
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

    // The names were resolved and then discarded.
    expect(lookUpIdentities).toHaveBeenCalled();
    expect(roster.revealed).toBe(true);
    for (const student of [...roster.topics.flatMap((g) => g.students), ...roster.unassigned]) {
      expect(student.identity).toEqual({ status: "unavailable" });
    }
    expect(serialized).not.toContain("Anders");
    expect(serialized).not.toContain("Brown");
    expect(serialized).not.toContain("Clark");
    expect(serialized).not.toContain("audit_events");
    for (const value of PRIVATE_STRINGS) {
      expect(serialized).not.toContain(value);
    }
    // With no names, students keep their pseudonymous order.
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

describe("roster reveal endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  it("denies a signed-out request before the roster is read", async () => {
    mockPrincipal(undefined);
    const listTopicRoster = vi.fn();
    setStudentIdentityDependenciesForTests({ listTopicRoster });

    const response = await reveal();
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(listTopicRoster).not.toHaveBeenCalled();
    expect(body).not.toContain("Anders");
    for (const value of PRIVATE_STRINGS) {
      expect(body).not.toContain(value);
    }
  });

  it("denies an ordinary student without reading the roster", async () => {
    mockPrincipal(TEST_STUDENT);
    const listTopicRoster = vi.fn();
    setStudentIdentityDependenciesForTests({ listTopicRoster });

    const response = await reveal();
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(listTopicRoster).not.toHaveBeenCalled();
    expect(body).not.toContain("Anders");
    expect(body).not.toContain("Conditional");
  });

  it("returns the named roster to an authorized professor with no caching", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const recordViews = vi.fn(async () => {});
    setStudentIdentityDependenciesForTests({
      ...rosterDependencies(),
      recordViews,
    });

    const request = new Request("http://test/api/professor/students/identities", {
      method: "POST",
    });
    const response = await revealRoster(request);
    const roster = (await response.json()) as TopicRoster;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(roster.revealed).toBe(true);
    expect(
      roster.topics[0].students.map((student) =>
        student.identity?.status === "identified"
          ? student.identity.displayName
          : student.identity?.status,
      ),
    ).toEqual(["Zoe Anders", "Adam Brown", "anonymous"]);
    expect(recordViews).toHaveBeenCalledTimes(1);
    // The URL names no student and carries no identity.
    expect(request.url).toBe("http://test/api/professor/students/identities");
  });

  it("reports the roster unavailable rather than failing when it cannot be audited", async () => {
    mockPrincipal(TEST_PROFESSOR);
    setStudentIdentityDependenciesForTests({
      ...rosterDependencies(),
      recordViews: async () => {
        throw new Error("audit store unavailable");
      },
    });

    const response = await reveal();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"status":"unavailable"');
    expect(body).not.toContain("identified");
    expect(body).not.toContain("Anders");
    expect(body).not.toContain("audit store");
  });
});

describe("Students page topic view", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  it("renders the pseudonymous roster grouped by topic with names hidden", async () => {
    mockPrincipal(TEST_PROFESSOR);
    vi.mocked(listInstructorStudentTopicRoster).mockResolvedValue(
      pseudonymousRoster(),
    );

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({
        searchParams: Promise.resolve({ view: "topics" }),
      }),
    );

    expect(markup).toContain("Conditional Probability");
    expect(markup).toContain("Binomial Models");
    expect(markup).toContain("No topic practice yet");
    expect(markup).toContain("Reveal all names");
    expect(markup).toContain("Names hidden");
    expect(markup).toContain(studentLabel(KEY_ANDERS));
    expect(markup).toContain(`href="/professor/students/${KEY_ANDERS}"`);
    expect(markup).toContain('href="/professor/students"');
    expect(markup).toContain('href="/professor/students?view=topics"');
    // Nothing identifying is rendered before a reveal.
    expect(markup).not.toContain("Anders");
    expect(markup).not.toContain("Clark");
    for (const value of PRIVATE_STRINGS) {
      expect(markup).not.toContain(value);
    }
    expect(listInstructorStudents).not.toHaveBeenCalled();
  });

  it("keeps the activity table as the default view, with a link to the topic view", async () => {
    mockPrincipal(TEST_PROFESSOR);
    vi.mocked(listInstructorStudents).mockResolvedValue({
      limit: 25,
      mode: "database",
      offset: 0,
      students: [
        {
          attempts: 2,
          correctAttempts: 1,
          extraPracticeSessions: 0,
          hintsUsed: 0,
          incorrectAttempts: 1,
          llmAttempts: 0,
          misconceptionAttempts: 0,
          needsAttention: false,
          sessions: 1,
          solutionsRevealed: 0,
          solvedSessions: 0,
          studentKey: KEY_ANDERS,
          topicsPracticed: 1,
        },
      ],
      total: 1,
    });

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).toContain("Practice sessions");
    expect(markup).toContain("Search by student code");
    expect(markup).toContain('href="/professor/students?view=topics"');
    expect(markup).not.toContain("Reveal all names");
    expect(listInstructorStudentTopicRoster).not.toHaveBeenCalled();
  });

  it("falls back to the activity view for an unknown view parameter", async () => {
    mockPrincipal(TEST_PROFESSOR);
    vi.mocked(listInstructorStudents).mockResolvedValue({
      limit: 25,
      mode: "database",
      offset: 0,
      students: [],
      total: 0,
    });

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({
        searchParams: Promise.resolve({ view: "names" }),
      }),
    );

    expect(markup).toContain("No students have signed in");
    expect(listInstructorStudentTopicRoster).not.toHaveBeenCalled();
  });

  it("refuses the topic view to a student and to a signed-out visitor", async () => {
    mockPrincipal(TEST_STUDENT);
    await expect(
      ProfessorStudentsPage({ searchParams: Promise.resolve({ view: "topics" }) }),
    ).rejects.toThrow();

    mockPrincipal(undefined);
    await expect(
      ProfessorStudentsPage({ searchParams: Promise.resolve({ view: "topics" }) }),
    ).rejects.toThrow();
    expect(listInstructorStudentTopicRoster).not.toHaveBeenCalled();
  });

  it("shows the demo notice in the topic view rather than an empty roster", async () => {
    mockPrincipal(TEST_PROFESSOR);
    vi.mocked(listInstructorStudentTopicRoster).mockResolvedValue({
      mode: "demo",
      revealed: false,
      topics: [],
      unassigned: [],
    });

    const markup = renderToStaticMarkup(
      await ProfessorStudentsPage({
        searchParams: Promise.resolve({ view: "topics" }),
      }),
    );

    expect(markup).toContain("there is no class to list here");
    expect(markup).not.toContain("Reveal all names");
  });
});

describe("roster panel", () => {
  it("renders revealed names in the order given, with a way to hide them again", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentTopicRoster, {
        roster: {
          mode: "database",
          revealed: true,
          topics: [
            {
              students: [
                { identity: { displayName: "Zoe Anders", status: "identified" }, studentKey: KEY_ANDERS },
                { identity: { displayName: "Adam Brown", status: "identified" }, studentKey: KEY_BROWN },
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

    expect(markup).toContain("Names revealed");
    expect(markup).toContain("Hide names");
    expect(markup.indexOf("Zoe Anders")).toBeLessThan(markup.indexOf("Adam Brown"));
    expect(markup.indexOf("Adam Brown")).toBeLessThan(
      markup.indexOf("practised without signing in"),
    );
    expect(markup).toContain("No longer has an account");
    expect(markup).toContain("4 students");
    expect(markup).not.toContain("No topic practice yet");
  });

  it("shows only pseudonyms until the instructor asks", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentTopicRoster, { roster: pseudonymousRoster() }),
    );

    expect(markup).toContain("Names hidden");
    expect(markup).toContain("Reveal all names");
    expect(markup).toContain("6 students are listed by pseudonym");
    expect(markup).toContain(">Hidden<");
    expect(markup).not.toContain("Anders");
  });
});

type RecordedViews = {
  requestId?: string;
  views: Array<{ status: string; studentKey: string }>;
};

function reveal() {
  return revealRoster(
    new Request("http://test/api/professor/students/identities", {
      method: "POST",
    }),
  );
}

function accountLink(studentKey: string): StudentAccountLink {
  return { identityProvider: "clerk", kind: "account", subject: SUBJECTS[studentKey] };
}

/**
 * Two topics and an unassigned pair. Every group is in pseudonym order, which
 * is the reverse of the alphabetical order the reveal must produce.
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
    unassigned: [KEY_CLARK_MIA, KEY_CLARK_LIAM].map((studentKey) => ({ studentKey })),
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
  const { requireAnalyticsAccess } = await import("@/lib/auth/authorization");
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}
