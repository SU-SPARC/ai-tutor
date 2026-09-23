import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

import { POST as revealIdentity } from "@/app/api/professor/students/[studentKey]/identity/route";
import ProfessorStudentPage from "@/app/professor/students/[studentKey]/page";
import { InstructorStudentDetailPanel } from "@/components/professor/instructor-student-detail";
import { InstructorStudentIdentityPanel } from "@/components/professor/instructor-student-identity";
import { InstructorStudentTable } from "@/components/professor/instructor-student-table";
import {
  requireAnalyticsAccess,
  requireStudent,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import { getInstructorStudentDetail } from "@/lib/data/data-store";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseInstructorStudentRepository } from "@/lib/data/instructor-student-repository";
import { createDatabasePilotAnalyticsExportRepository } from "@/lib/data/pilot-analytics-export-repository";
import { createDatabaseStudentIdentityRepository } from "@/lib/data/student-identity-repository";
import { setStudentIdentityDependenciesForTests } from "@/lib/professor/student-identity";
import { studentLabel } from "@/lib/professor/student-pseudonym";
import type { InstructorStudentDetail } from "@/lib/types";

vi.mock("@/lib/data/data-store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/data/data-store")>();
  return { ...actual, getInstructorStudentDetail: vi.fn() };
});

/**
 * The bug: a student signs in, which creates their `users` row, but never
 * answers a question. Nothing about them appears on the Students page. These
 * accounts model the population an instructor should and should not see.
 */
const NEW_STUDENT = {
  email: "nora.newcomer@suffolk.edu",
  name: "Nora Newcomer",
  subject: "user_2rosterNewStudent",
  userId: "user:roster-new-student",
  username: "nnewcomer",
};
const SECOND_NEW_STUDENT = {
  email: "sam.second@suffolk.edu",
  name: "Sam Second",
  subject: "user_2rosterSecondStudent",
  userId: "user:roster-second-student",
};
const FORMER_PROFESSOR = {
  email: "former.professor@suffolk.edu",
  name: "Former Professor",
  subject: "user_2rosterFormerProfessor",
  userId: "user:roster-former-professor",
};
const PRACTICED_STUDENT = {
  email: "paula.practised@suffolk.edu",
  name: "Paula Practised",
  subject: "user_2rosterPractised",
  userId: "user:roster-practised-student",
};
const REVIEWER = {
  email: "reviewer@suffolk.edu",
  name: "Second Reviewer",
  subject: "user_2rosterReviewer",
  userId: "user:roster-reviewer",
};
const DISABLED_STUDENT = {
  email: "disabled.student@suffolk.edu",
  name: "Disabled Student",
  subject: "user_2rosterDisabled",
  userId: "user:roster-disabled-student",
};
const DELETED_STUDENT = {
  email: "deleted.student@suffolk.edu",
  name: "Deleted Student",
  subject: "user_2rosterDeleted",
  userId: "user:roster-deleted-student",
};
const ANONYMOUS_OWNER = "roster-anonymous-owner";
const SYSTEM_ACTOR_ID = "system:schema-migration";

const NEW_KEY = keyFor(`user:${NEW_STUDENT.userId}`);
const SECOND_NEW_KEY = keyFor(`user:${SECOND_NEW_STUDENT.userId}`);
const FORMER_PROFESSOR_KEY = keyFor(`user:${FORMER_PROFESSOR.userId}`);
const PRACTICED_KEY = keyFor(`user:${PRACTICED_STUDENT.userId}`);
const ANONYMOUS_KEY = keyFor(`anon:${ANONYMOUS_OWNER}`);
const PROFESSOR_KEY = keyFor(`user:${TEST_PROFESSOR.userId}`);
const REVIEWER_KEY = keyFor(`user:${REVIEWER.userId}`);
const DISABLED_KEY = keyFor(`user:${DISABLED_STUDENT.userId}`);
const DELETED_KEY = keyFor(`user:${DELETED_STUDENT.userId}`);
const SYSTEM_ACTOR_KEY = keyFor(`user:${SYSTEM_ACTOR_ID}`);

/** Every pseudonym the page should list, in no particular order. */
const EXPECTED_ROSTER = [
  ANONYMOUS_KEY,
  FORMER_PROFESSOR_KEY,
  NEW_KEY,
  PRACTICED_KEY,
  SECOND_NEW_KEY,
].sort();
const ZERO_ACTIVITY_KEYS = [FORMER_PROFESSOR_KEY, NEW_KEY, SECOND_NEW_KEY];

/** Strings that must never appear in an analytics payload, URL, or export. */
const IDENTIFIERS = [
  NEW_STUDENT.email,
  NEW_STUDENT.name,
  NEW_STUDENT.subject,
  NEW_STUDENT.userId,
  NEW_STUDENT.username,
  PRACTICED_STUDENT.email,
  PRACTICED_STUDENT.name,
  PRACTICED_STUDENT.subject,
  PRACTICED_STUDENT.userId,
  ANONYMOUS_OWNER,
];

const databases: PGlite[] = [];

afterEach(() => {
  resetAuthMocks();
  setStudentIdentityDependenciesForTests(undefined);
  vi.mocked(getInstructorStudentDetail).mockReset();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  while (databases.length > 0) {
    await databases.pop()?.close();
  }
});

describe("signed-in students on the professor Students page", () => {
  let database: PGlite;
  let query: DatabaseQueryExecutor;
  let repository: ReturnType<typeof createDatabaseInstructorStudentRepository>;
  let identity: ReturnType<typeof createDatabaseStudentIdentityRepository>;

  beforeAll(async () => {
    database = await migratedDatabase();
    query = pgliteQuery(database);
    repository = createDatabaseInstructorStudentRepository(query);
    identity = createDatabaseStudentIdentityRepository(query);
    await seed(database);
  }, 60_000);

  it("lists a student who has signed in but never practised", async () => {
    const list = await repository.listStudents(await professorAuthorization());

    expect(list.students.map((student) => student.studentKey)).toContain(
      NEW_KEY,
    );
  });

  it("lists the whole signed-in roster alongside students who practised", async () => {
    const list = await repository.listStudents(await professorAuthorization());

    expect(list.students.map((student) => student.studentKey).sort()).toEqual(
      EXPECTED_ROSTER,
    );
    expect(list.total).toBe(EXPECTED_ROSTER.length);
  });

  it("reports truthful zeros for a student with no practice activity", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization);
    const summary = list.students.find(
      (student) => student.studentKey === NEW_KEY,
    );

    // The student opened one question without interacting; that row is not
    // practice and must not count as a session or supply a last-active time.
    expect(summary).toEqual({
      attempts: 0,
      correctAttempts: 0,
      extraPracticeSessions: 0,
      firstActiveAt: undefined,
      hintsUsed: 0,
      incorrectAttempts: 0,
      lastActiveAt: undefined,
      llmAttempts: 0,
      misconceptionAttempts: 0,
      needsAttention: false,
      sessions: 0,
      solutionsRevealed: 0,
      solvedSessions: 0,
      studentKey: NEW_KEY,
      topicsPracticed: 0,
    });
  });

  it("resolves a zero-activity student's detail without fabricating activity", async () => {
    const detail = await repository.getStudentDetail(
      await professorAuthorization(),
      NEW_KEY,
    );

    expect(detail).toBeDefined();
    expect(detail?.summary).toMatchObject({
      attempts: 0,
      hintsUsed: 0,
      sessions: 0,
      studentKey: NEW_KEY,
    });
    expect(detail?.summary.lastActiveAt).toBeUndefined();
    expect(detail?.activity).toEqual([]);
    expect(detail?.attempts).toEqual([]);
    expect(detail?.attention).toEqual([]);
    expect(detail?.misconceptions).toEqual([]);
    expect(detail?.topics).toEqual([]);
  });

  it("renders the zero-activity detail without crashing and without any identity", async () => {
    const detail = await repository.getStudentDetail(
      await professorAuthorization(),
      NEW_KEY,
    );
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentDetailPanel, {
        detail: detail as InstructorStudentDetail,
      }),
    );

    expect(markup).toContain("No practice activity yet");
    expect(markup).toContain("Accuracy");
    // An accuracy with no scored attempts is shown as absent, never as 0%.
    expect(markup).not.toContain("0%");
    for (const identifier of IDENTIFIERS) {
      expect(markup).not.toContain(identifier);
    }
  });

  it("renders the zero-activity row in the Students table with a dash for last active", async () => {
    const list = await repository.listStudents(await professorAuthorization(), {
      search: NEW_KEY,
    });
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentTable, { list }),
    );

    expect(markup).toContain(studentLabel(NEW_KEY));
    expect(markup).toContain(`href="/professor/students/${NEW_KEY}"`);
    // Sessions, extra practice, attempts, correct, topics, hints, solutions.
    expect(markup.match(/<td[^>]*>0<\/td>/g)).toHaveLength(6);
    expect(markup).toContain("(—)");
    expect(markup).toContain(">—</td>");
    for (const identifier of IDENTIFIERS) {
      expect(markup).not.toContain(identifier);
    }
  });

  it("renders the detail page for a zero-activity student with identity hidden", async () => {
    mockPrincipal(TEST_PROFESSOR);
    vi.stubEnv("APP_DEMO_MODE", "true");
    const detail = await repository.getStudentDetail(
      await professorAuthorization(),
      NEW_KEY,
    );
    vi.mocked(getInstructorStudentDetail).mockResolvedValue(detail);

    const markup = renderToStaticMarkup(
      await ProfessorStudentPage({
        params: Promise.resolve({ studentKey: NEW_KEY }),
      }),
    );

    expect(markup).toContain(studentLabel(NEW_KEY));
    expect(markup).toContain("No practice activity yet");
    expect(markup).toContain("Identity hidden");
    expect(markup).toContain("Reveal identity");
    for (const identifier of IDENTIFIERS) {
      expect(markup).not.toContain(identifier);
    }
  });

  it("keeps a practised student's analytics exactly as before", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization);
    const practised = list.students.find(
      (student) => student.studentKey === PRACTICED_KEY,
    );
    const anonymous = list.students.find(
      (student) => student.studentKey === ANONYMOUS_KEY,
    );

    // Hand-derived from the seed: one session with one hint, two answer
    // submissions, one of them correct.
    expect(practised).toMatchObject({
      attempts: 2,
      correctAttempts: 1,
      extraPracticeSessions: 0,
      hintsUsed: 1,
      incorrectAttempts: 1,
      needsAttention: false,
      sessions: 1,
      solutionsRevealed: 0,
      solvedSessions: 0,
      topicsPracticed: 1,
    });
    expect(practised?.lastActiveAt).toBeDefined();
    expect(anonymous).toMatchObject({
      attempts: 1,
      correctAttempts: 0,
      incorrectAttempts: 1,
      sessions: 1,
    });

    const detail = await repository.getStudentDetail(
      authorization,
      PRACTICED_KEY,
    );
    expect(detail?.topics).toEqual([
      expect.objectContaining({
        attempts: 2,
        correctAttempts: 1,
        incorrectAttempts: 1,
        topicId: "conditional-probability",
      }),
    ]);
    expect(detail?.attempts).toHaveLength(3);
  });

  it("keeps the cohort's active-student count activity-based", async () => {
    const cohort = await repository.getCohortAnalytics(
      await professorAuthorization(),
    );

    // Two students practised; three merely signed in. "Active students" is a
    // practice metric and does not grow with the roster.
    expect(cohort).toMatchObject({
      activeStudents: 2,
      attempts: 3,
      correctAttempts: 1,
      excludedStaffSessions: 1,
      hintsUsed: 1,
      sessions: 2,
    });
  });

  it("never lists professor, reviewer, system, disabled, or deleted accounts", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization);
    const keys = list.students.map((student) => student.studentKey);

    for (const excluded of [
      PROFESSOR_KEY,
      REVIEWER_KEY,
      SYSTEM_ACTOR_KEY,
      DISABLED_KEY,
      DELETED_KEY,
    ]) {
      expect(keys).not.toContain(excluded);
      await expect(
        repository.getStudentDetail(authorization, excluded),
      ).resolves.toBeUndefined();
      await expect(
        repository.listStudents(authorization, { search: excluded }),
      ).resolves.toMatchObject({ students: [], total: 0 });
    }
  });

  it("treats a revoked professor grant as a student account", async () => {
    const list = await repository.listStudents(await professorAuthorization());

    expect(list.students.map((student) => student.studentKey)).toContain(
      FORMER_PROFESSOR_KEY,
    );
  });

  it("refuses every roster read for a student principal", async () => {
    mockPrincipal(TEST_STUDENT);
    const student = (await requireStudent()) as never;

    await expect(repository.listStudents(student)).rejects.toThrow();
    await expect(
      repository.getStudentDetail(student, NEW_KEY),
    ).rejects.toThrow();
    await expect(identity.findAccountLink(student, NEW_KEY)).rejects.toThrow();
  });

  it("finds a zero-activity student by their pseudonym", async () => {
    const authorization = await professorAuthorization();
    const exact = await repository.listStudents(authorization, {
      search: NEW_KEY,
    });
    const prefix = await repository.listStudents(authorization, {
      search: NEW_KEY.slice(0, 4).toUpperCase(),
    });

    expect(exact.total).toBe(1);
    expect(exact.students[0]).toMatchObject({ sessions: 0, studentKey: NEW_KEY });
    expect(prefix.students.map((student) => student.studentKey)).toContain(
      NEW_KEY,
    );
    expect(prefix.total).toBe(prefix.students.length);
  });

  it("counts and paginates zero-activity students with the same population", async () => {
    const authorization = await professorAuthorization();
    const seen: string[] = [];

    for (let offset = 0; offset < EXPECTED_ROSTER.length; offset += 2) {
      const page = await repository.listStudents(authorization, {
        limit: 2,
        offset,
      });
      expect(page.total).toBe(EXPECTED_ROSTER.length);
      expect(page.students.length).toBeLessThanOrEqual(2);
      seen.push(...page.students.map((student) => student.studentKey));
    }

    expect(seen.sort()).toEqual(EXPECTED_ROSTER);
  });

  it("orders students with activity first and zero-activity students deterministically", async () => {
    const authorization = await professorAuthorization();
    const first = await repository.listStudents(authorization, {
      sort: "last_active",
    });
    const second = await repository.listStudents(authorization, {
      sort: "last_active",
    });
    const keys = first.students.map((student) => student.studentKey);

    expect(keys.slice(0, 2).sort()).toEqual([ANONYMOUS_KEY, PRACTICED_KEY].sort());
    // Nothing distinguishes students who never practised except the pseudonym,
    // so they follow in pseudonym order rather than wherever a null lands.
    expect(keys.slice(2)).toEqual([...ZERO_ACTIVITY_KEYS].sort());
    expect(second.students).toEqual(first.students);

    for (const sort of ["attempts", "lowest_accuracy", "sessions"] as const) {
      const sorted = await repository.listStudents(authorization, { sort });
      const sortedKeys = sorted.students.map((student) => student.studentKey);
      expect(sortedKeys.slice(-3)).toEqual([...ZERO_ACTIVITY_KEYS].sort());
      expect(sorted.total).toBe(EXPECTED_ROSTER.length);
    }
  });

  it("does not duplicate an anonymous student or a signed-in student", async () => {
    const list = await repository.listStudents(await professorAuthorization(), {
      limit: 100,
    });
    const keys = list.students.map((student) => student.studentKey);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((key) => key === ANONYMOUS_KEY)).toHaveLength(1);
    expect(keys.filter((key) => key === PRACTICED_KEY)).toHaveLength(1);
  });

  it("keeps names, usernames, email addresses, and ids out of the analytics payload", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization);
    const detail = await repository.getStudentDetail(authorization, NEW_KEY);
    const serialized = JSON.stringify({ detail, list });

    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
    expect(serialized).not.toContain("@");
    expect(Object.keys(list.students[0] ?? {}).sort()).toEqual([
      "attempts",
      "correctAttempts",
      "extraPracticeSessions",
      "firstActiveAt",
      "hintsUsed",
      "incorrectAttempts",
      "lastActiveAt",
      "llmAttempts",
      "misconceptionAttempts",
      "needsAttention",
      "sessions",
      "solutionsRevealed",
      "solvedSessions",
      "studentKey",
      "topicsPracticed",
    ]);
  });

  it("leaves the pilot export activity-based and free of identity", async () => {
    const exported = await createDatabasePilotAnalyticsExportRepository(
      query,
    ).build(await professorAuthorization(), "2026-09-15T12:00:00.000Z");
    const participants = exported.participants.map((row) => row.participantId);
    const serialized = JSON.stringify(exported);

    // The export describes recorded practice; signing in is not practice.
    expect(participants.sort()).toEqual([ANONYMOUS_KEY, PRACTICED_KEY].sort());
    expect(participants).not.toContain(NEW_KEY);
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
  });

  it("resolves the identity reveal for a zero-activity student", async () => {
    const link = await identity.findAccountLink(
      await professorAuthorization(),
      NEW_KEY,
    );

    expect(link).toEqual({
      identityProvider: "clerk",
      kind: "account",
      subject: NEW_STUDENT.subject,
    });
  });

  it("resolves nothing for accounts the roster does not list", async () => {
    const authorization = await professorAuthorization();

    for (const excluded of [
      PROFESSOR_KEY,
      REVIEWER_KEY,
      SYSTEM_ACTOR_KEY,
      DISABLED_KEY,
      DELETED_KEY,
    ]) {
      await expect(
        identity.findAccountLink(authorization, excluded),
      ).resolves.toBeUndefined();
    }
    await expect(
      identity.findAccountLink(authorization, ANONYMOUS_KEY),
    ).resolves.toEqual({ kind: "anonymous" });
  });

  it("reveals name, username, and email for a zero-activity student through the endpoint", async () => {
    mockPrincipal(TEST_PROFESSOR);
    vi.stubEnv("APP_DEMO_MODE", "true");
    const lookUpIdentity = vi.fn(async (link: { subject: string }) =>
      link.subject === NEW_STUDENT.subject
        ? {
            displayName: NEW_STUDENT.name,
            email: NEW_STUDENT.email,
            username: NEW_STUDENT.username,
          }
        : ("unlinked" as const),
    );
    const recordView = vi.fn(async () => {});
    setStudentIdentityDependenciesForTests({
      findAccountLink: (authorization, studentKey) =>
        identity.findAccountLink(authorization, studentKey),
      lookUpIdentity,
      recordView,
    });

    const url = `http://test/api/professor/students/${NEW_KEY}/identity`;
    const response = await revealIdentity(new Request(url, { method: "POST" }), {
      params: Promise.resolve({ studentKey: NEW_KEY }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      displayName: NEW_STUDENT.name,
      email: NEW_STUDENT.email,
      status: "identified",
      username: NEW_STUDENT.username,
    });
    expect(recordView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "identified", studentKey: NEW_KEY }),
    );
    const audited = JSON.stringify(recordView.mock.calls);
    for (const identifier of IDENTIFIERS) {
      expect(audited).not.toContain(identifier);
      expect(url).not.toContain(identifier);
    }
  });

  it("shows the identity panel hidden until the instructor asks", () => {
    const markup = renderToStaticMarkup(
      createElement(InstructorStudentIdentityPanel, {
        studentKey: NEW_KEY,
        studentLabel: studentLabel(NEW_KEY),
      }),
    );

    expect(markup).toContain("Identity hidden");
    expect(markup).toContain("Reveal identity");
    for (const identifier of IDENTIFIERS) {
      expect(markup).not.toContain(identifier);
    }
  });
});

describe("a student's first practice", () => {
  it("keeps the same pseudonym and the same row once practice begins", async () => {
    const database = await migratedDatabase();
    await seed(database);
    const query = pgliteQuery(database);
    const repository = createDatabaseInstructorStudentRepository(query);
    const identity = createDatabaseStudentIdentityRepository(query);
    const authorization = await professorAuthorization();

    const before = await repository.listStudents(authorization, { limit: 100 });
    const linkBefore = await identity.findAccountLink(authorization, NEW_KEY);
    expect(before.students.find((s) => s.studentKey === NEW_KEY)).toMatchObject(
      { attempts: 0, sessions: 0 },
    );

    await database.query(
      `insert into tutor_sessions (
         id, user_id, question_id, revealed_hints
       ) values ('roster-new-first-session', $1, 'cp-question', 1)`,
      [NEW_STUDENT.userId],
    );
    await database.query(
      `insert into attempts (session_id, question_id, topic_id, mode, source, verdict)
       values ('roster-new-first-session', 'cp-question', 'conditional-probability', 'check', 'rule', 'correct')`,
    );

    const after = await repository.listStudents(authorization, { limit: 100 });
    const rows = after.students.filter((s) => s.studentKey === NEW_KEY);
    const linkAfter = await identity.findAccountLink(authorization, NEW_KEY);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      attempts: 1,
      correctAttempts: 1,
      hintsUsed: 1,
      sessions: 1,
      studentKey: NEW_KEY,
    });
    expect(rows[0].lastActiveAt).toBeDefined();
    expect(after.total).toBe(before.total);
    expect(after.students.map((s) => s.studentKey).sort()).toEqual(
      before.students.map((s) => s.studentKey).sort(),
    );
    expect(linkAfter).toEqual(linkBefore);
    // The student now sorts with the active students rather than the roster tail.
    const byActivity = await repository.listStudents(authorization, {
      sort: "last_active",
    });
    expect(
      byActivity.students.findIndex((s) => s.studentKey === NEW_KEY),
    ).toBeLessThan(3);
  }, 60_000);
});

async function professorAuthorization(): Promise<AnalyticsAuthorization> {
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}

function keyFor(owner: string) {
  return createHash("sha256").update(owner).digest("hex");
}

async function migratedDatabase() {
  const database = new PGlite();
  databases.push(database);
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  return database;
}

function pgliteQuery(database: PGlite): DatabaseQueryExecutor {
  return async (sql, params = []) =>
    (await database.query(sql, params)).rows as Record<string, unknown>[];
}

/**
 * Mirrors what a Clerk sign-in leaves behind: a human `users` row with a
 * login timestamp and the `student` role projection, plus `professor` for
 * staff. Only two of the students, and the professor, ever practise.
 */
async function seed(database: PGlite) {
  const accounts: Array<{
    email: string;
    name: string;
    professor?: "current" | "revoked";
    status?: "active" | "disabled" | "deleted";
    subject: string;
    userId: string;
  }> = [
    {
      ...TEST_PROFESSOR,
      email: "roster.professor@suffolk.edu",
      name: "Roster Professor",
      professor: "current",
      subject: "user_2rosterProfessor",
    },
    { ...REVIEWER, professor: "current" },
    { ...FORMER_PROFESSOR, professor: "revoked" },
    NEW_STUDENT,
    SECOND_NEW_STUDENT,
    PRACTICED_STUDENT,
    { ...DISABLED_STUDENT, status: "disabled" },
    { ...DELETED_STUDENT, status: "deleted" },
  ];

  for (const account of accounts) {
    const status = account.status ?? "active";
    await database.query(
      `insert into users (
         id, identity_provider, external_subject, email, display_name, status,
         last_login_at, disabled_at, deleted_at
       ) values ($1, 'clerk', $2, $3, $4, $5, now(),
         case when $5 = 'disabled' then now() end,
         case when $5 = 'deleted' then now() end)`,
      [account.userId, account.subject, account.email, account.name, status],
    );
    await database.query(
      `insert into user_roles (user_id, role_id, granted_by_user_id)
       values ($1, 'student', $2)`,
      [account.userId, SYSTEM_ACTOR_ID],
    );
    if (account.professor) {
      await database.query(
        `insert into user_roles (
           user_id, role_id, granted_by_user_id, revoked_at, revoked_by_user_id
         ) values ($1, 'professor', $2,
           case when $3 then now() end,
           case when $3 then $2 end)`,
        [account.userId, SYSTEM_ACTOR_ID, account.professor === "revoked"],
      );
    }
  }

  await database.query(
    `insert into topics (id, title, description, sort_order, is_active)
     values ('conditional-probability', 'Conditional Probability', '', 1, true)`,
  );
  await database.exec(
    "select set_config('app.current_creation_method', 'manual', false)",
  );
  await database.query(
    `insert into questions (
       id, topic_id, title, prompt, difficulty, accepted_answers_json,
       answer_explanation, source_type, trust_level, review_status,
       visibility, originality_note, reviewed_by, reviewed_by_user_id,
       reviewed_at
     ) values ('cp-question', 'conditional-probability', 'Question',
       'Prompt text', 'foundational', '["0.5"]'::jsonb,
       'Divide the favorable outcomes by the total.', 'original_demo',
       'public_original', 'approved', 'public', 'Original test question.',
       'Professor', $1, now())`,
    [TEST_PROFESSOR.userId],
  );
  await database.query(
    `insert into hints (question_id, hint_order, body)
     values ('cp-question', 1, 'Start with the numerator and denominator.')`,
  );
  await database.query(
    `insert into solution_steps (question_id, step_order, body)
     values ('cp-question', 1, 'Divide the favorable outcomes by the total.')`,
  );

  const [version] = (
    await database.query<{ id: number }>(
      "select working_version_id as id from questions where id = 'cp-question'",
    )
  ).rows;
  for (const [action, expectedState] of [
    ["submit", "draft"],
    ["approve", "needs_review"],
    ["publish", "approved"],
  ]) {
    await database.query(
      `select * from app_transition_question_version(
         target_question_id => 'cp-question',
         target_question_version_id => $1,
         transition_action => $2,
         actor_id => $3,
         actor_display => 'Professor',
         expected_state => $4,
         idempotency_key_value => $5
       )`,
      [
        version.id,
        action,
        TEST_PROFESSOR.userId,
        expectedState,
        `seed:${action}`,
      ],
    );
  }

  // Practised student: one hint and two answers. Anonymous student: one
  // answer. Professor: staff practice that must stay excluded. New student:
  // opened a question and left, which is not practice.
  const sessions: Array<[string, string | null, string | null, number]> = [
    ["roster-practised-session", PRACTICED_STUDENT.userId, null, 1],
    ["roster-anonymous-session", null, ANONYMOUS_OWNER, 0],
    ["roster-professor-session", TEST_PROFESSOR.userId, null, 1],
    ["roster-new-student-opened", NEW_STUDENT.userId, null, 0],
  ];
  for (const [sessionId, userId, anonymousUserId, hints] of sessions) {
    await database.query(
      `insert into tutor_sessions (
         id, user_id, anonymous_user_id, question_id, revealed_hints
       ) values ($1, $2, $3, 'cp-question', $4)`,
      [sessionId, userId, anonymousUserId, hints],
    );
  }
  await database.exec(`
    insert into attempts (session_id, question_id, topic_id, mode, source, verdict)
    values
      ('roster-practised-session', 'cp-question', 'conditional-probability', 'check', 'rule', 'correct'),
      ('roster-practised-session', 'cp-question', 'conditional-probability', 'hint', 'rule', 'guidance'),
      ('roster-practised-session', 'cp-question', 'conditional-probability', 'check', 'rule', 'incorrect'),
      ('roster-anonymous-session', 'cp-question', 'conditional-probability', 'check', 'rule', 'incorrect');
  `);
}
