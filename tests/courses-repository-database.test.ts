import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { requireProfessorReview } from "@/lib/auth/authorization";
import type { StudentOwner } from "@/lib/auth/principal";
import { generateJoinCode } from "@/lib/courses/format";
import type { CoursesAction } from "@/lib/courses/reducer";
import type { CoursesState } from "@/lib/courses/types";
import {
  CoursesConflictError,
  CoursesNotFoundError,
  CoursesValidationError,
  createDatabaseCoursesRepository,
  studentKeyForOwner,
  type CoursesRepository,
} from "@/lib/data/courses-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import {
  createDatabaseQuestionLifecycleRepository,
  type QuestionVersionContentInput,
} from "@/lib/data/question-lifecycle-repository";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";
import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";

const OTHER_PROFESSOR = "user:courses-other-professor";
const TOPIC_A = "courses-topic-a";
const TOPIC_B = "courses-topic-b";
const COURSE_TABLES = [
  "courses",
  "course_topics",
  "course_sections",
  "section_members",
  "section_topic_availability",
  "section_question_availability",
  "course_events",
];
const STUDENT: StudentOwner = { kind: "user", userId: "user:courses-student" };
const ANON: StudentOwner = {
  kind: "anonymous",
  anonymousId: "anon:courses-browser",
};

let db: PGlite;
let query: DatabaseQueryExecutor;
let repo: CoursesRepository;
const versionIds: Record<string, number[]> = {};

beforeAll(async () => {
  db = new PGlite();
  await runPendingMigrations({
    actor: "courses-repository-test",
    allowDestructive: true,
    changeTicket: "TEST-COURSES",
    client: {
      exec: (sql: string) => db.exec(sql),
      query: (sql: string, params?: unknown[]) =>
        db.query<Record<string, unknown>>(sql, params),
    },
    deploymentSha: "c".repeat(40),
    destructiveApprovedBy: "independent-courses-approver",
    migrations: await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    ),
    target: "test",
  });
  await db.exec(readFileSync("db/roles/app_runtime.sql", "utf8"));
  for (const [id, subject] of [
    [TEST_PROFESSOR.userId, "courses-professor"],
    [OTHER_PROFESSOR, "courses-other-professor"],
  ]) {
    await db.query(
      "insert into users (id, display_name, identity_provider, external_subject, status, email) values ($1, 'Professor', 'test', $2, 'active', $3)",
      [id, subject, `${subject}@example.invalid`],
    );
    await db.query(
      "insert into user_roles(user_id, role_id) values ($1, 'professor')",
      [id],
    );
  }
  await db.exec(`
    insert into topics(id,title,description,sort_order,week_number,is_active) values
      ('${TOPIC_A}','Counting','',1,1,true),
      ('${TOPIC_B}','Conditional Probability','',2,2,true);
  `);
  query = async (sql, params = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  query.transaction = (work) =>
    db.transaction(async (tx) =>
      work(
        async (sql, params = []) =>
          (await tx.query<Record<string, unknown>>(sql, params)).rows,
      ),
    );
  repo = createDatabaseCoursesRepository(query);

  mockPrincipal(TEST_PROFESSOR);
  for (const [id, topicId] of [
    ["courses-q1", TOPIC_A],
    ["courses-q2", TOPIC_A],
    ["courses-q3", TOPIC_B],
  ]) {
    const published = await publish(id, topicId);
    versionIds[id] = [published.publishedVersion!.versionId];
  }
  resetAuthMocks();
}, 60_000);
beforeEach(() => mockPrincipal(TEST_PROFESSOR));
afterEach(resetAuthMocks);
afterAll(async () => db?.close());

function content(
  id: string,
  topicId: string,
  variant = "",
): QuestionVersionContentInput {
  return {
    id,
    topicId,
    title: `${id}${variant}`,
    prompt: `A fair coin is tossed for scenario ${id}${variant}. Find the probability of heads.`,
    difficulty: "foundational",
    answer: {
      acceptedAnswers: ["0.5"],
      explanation: "One of two equally likely outcomes is heads.",
    },
    hints: ["Count the equally likely outcomes."],
    solutionSteps: ["Divide one favorable outcome by two outcomes."],
    misconceptions: [],
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
      originalityNote: "Original public-safe question.",
    },
  };
}

async function approveAndPublish(questionId: string, versionId: number) {
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  await lifecycle.transition(auth, {
    action: "approve",
    expectedState: "needs_review",
    questionId,
    versionId,
  });
  return lifecycle.transition(auth, {
    action: "publish",
    expectedState: "approved",
    questionId,
    versionId,
  });
}

async function publish(id: string, topicId: string) {
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  const created = await lifecycle.createQuestion(auth, {
    content: content(id, topicId),
    creationMethod: "manual",
    submit: true,
  });
  return approveAndPublish(id, created.workingVersion.versionId);
}

async function publishNewVersion(id: string, topicId: string) {
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  const current = (await lifecycle.getQuestion(auth, id))!;
  const next = await lifecycle.createVersion(auth, {
    questionId: id,
    baseVersionId: current.workingVersion.versionId,
    expectedWorkingVersionId: current.workingVersion.versionId,
    content: content(id, topicId, " (revised)"),
    creationMethod: "manual",
    submit: true,
  });
  return approveAndPublish(id, next!.workingVersion.versionId);
}

function apply(action: CoursesAction, professor = TEST_PROFESSOR.userId) {
  return repo.applyProfessorAction(professor, action, "req-test");
}

async function rowCount(table: string, where = "true", params: unknown[] = []) {
  const result = await db.query<{ count: number }>(
    `select count(*)::int as count from ${table} where ${where}`,
    params,
  );
  return result.rows[0].count;
}

function sectionOf(state: CoursesState, id: string) {
  return state.sections.find((section) => section.id === id);
}

describe("migration 029 courses and sections", () => {
  it("creates the tables with row level security and least-privilege runtime grants", async () => {
    const security = await db.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(
      "select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1) order by relname",
      [COURSE_TABLES],
    );
    expect(security.rows).toHaveLength(COURSE_TABLES.length);
    expect(security.rows.every((row) => row.relrowsecurity)).toBe(true);
    const policies = await db.query<{ tablename: string }>(
      "select tablename from pg_policies where policyname = 'app_runtime_full_access' and tablename = any($1)",
      [COURSE_TABLES],
    );
    expect(policies.rows).toHaveLength(COURSE_TABLES.length);

    const privileges = await db.query<Record<string, boolean | string>>(
      `select t as table_name,
         has_table_privilege('app_runtime', t, 'SELECT') as can_select,
         has_table_privilege('app_runtime', t, 'INSERT') as can_insert,
         has_table_privilege('app_runtime', t, 'UPDATE') as can_update,
         has_table_privilege('app_runtime', t, 'DELETE') as can_delete
       from unnest($1::text[]) t order by t`,
      [COURSE_TABLES],
    );
    const byTable = Object.fromEntries(
      privileges.rows.map((row) => [row.table_name, row]),
    );
    for (const table of COURSE_TABLES) {
      expect(byTable[table].can_select).toBe(true);
      expect(byTable[table].can_insert).toBe(true);
    }
    expect(byTable.course_events).toMatchObject({
      can_update: false,
      can_delete: false,
    });
    for (const table of [
      "courses",
      "course_topics",
      "course_sections",
      "section_members",
      "section_topic_availability",
    ]) {
      expect(byTable[table]).toMatchObject({
        can_update: true,
        can_delete: false,
      });
    }
    expect(byTable.section_question_availability).toMatchObject({
      can_update: true,
      can_delete: true,
    });
  });
});

describe("database courses repository", () => {
  it("runs the professor flow from course creation to a student's pinned releases", async () => {
    let state = await apply({
      type: "course/create",
      course: {
        id: "stat-101-fall-2026",
        code: " STAT-101 ",
        title: "Intro Statistics",
        term: "Fall 2026",
        status: "active",
      },
      includeAllTopics: true,
    });
    expect(state.activeCourseId).toBeNull();
    expect(state.courses).toEqual([
      expect.objectContaining({
        id: "stat-101-fall-2026",
        code: "STAT-101",
        status: "active",
      }),
    ]);
    expect(
      state.courseTopics.map((row) => [row.topicId, row.position]),
    ).toEqual([
      [TOPIC_A, 0],
      [TOPIC_B, 1],
    ]);
    expect(state.topics.map((topic) => topic.id)).toEqual([TOPIC_A, TOPIC_B]);
    const q1 = state.bank.find((question) => question.id === "courses-q1");
    expect(q1).toMatchObject({
      state: "published",
      publishedVersion: 1,
      latestVersion: 1,
      topicId: TOPIC_A,
      finalAnswer: "0.5",
    });

    state = await apply({
      type: "section/create",
      section: {
        id: "stat-101-fall-2026-sec-01",
        courseId: "stat-101-fall-2026",
        label: "Section 1",
        meetingTime: "MWF 10:00",
      },
    });
    const section = sectionOf(state, "stat-101-fall-2026-sec-01")!;
    expect(section.joinCode).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{2}$/);
    expect(section.joinCode).not.toMatch(/[01IOLS5]/);
    // The reducer's deterministic code is predictable; the server's is not.
    expect(section.joinCode).not.toBe(generateJoinCode(section.id));
    expect(
      state.topicAvailability.filter((row) => row.sectionId === section.id),
    ).toHaveLength(2);

    state = await apply({
      type: "section/setTopicState",
      sectionId: section.id,
      topicId: TOPIC_A,
      state: "open",
    });
    state = await apply({
      type: "section/applyReleaseChanges",
      sectionId: section.id,
      changes: [{ kind: "add", questionId: "courses-q1" }],
      now: "2000-01-01T00:00:00.000Z",
    });
    const released = state.questionAvailability.find(
      (row) => row.sectionId === section.id,
    )!;
    expect(released).toMatchObject({
      questionId: "courses-q1",
      state: "released",
      releasedVersion: 1,
      position: 0,
    });
    // The server clock wins over the client's `now`.
    expect(released.releasedAt).not.toBe("2000-01-01T00:00:00.000Z");
    const pinned = await db.query<{ released_version_id: number }>(
      "select released_version_id from section_question_availability where section_id = $1",
      [section.id],
    );
    expect(Number(pinned.rows[0].released_version_id)).toBe(
      versionIds["courses-q1"][0],
    );

    const lowerCode = section.joinCode.replace("-", "").toLowerCase();
    const joined = await repo.joinSection(STUDENT, ` ${lowerCode} `);
    expect(joined).toMatchObject({
      sectionId: section.id,
      sectionLabel: "Section 1",
      courseId: "stat-101-fall-2026",
      courseCode: "STAT-101",
      courseTitle: "Intro Statistics",
      term: "Fall 2026",
    });
    expect(await repo.joinSection(STUDENT, section.joinCode)).toEqual(joined);
    expect(await repo.getStudentSection(STUDENT)).toEqual(joined);

    const releases = await repo.getSectionReleases(section.id);
    expect(releases).toEqual([
      {
        questionId: "courses-q1",
        questionVersionId: versionIds["courses-q1"][0],
        releasedVersion: 1,
        position: 0,
        topicId: TOPIC_A,
        topicPosition: 0,
        topicState: "open",
        delivery: {
          attemptsAllowed: 3,
          hintsEnabled: true,
          solutionReveal: "after_2_wrong",
        },
      },
    ]);

    const roster = await repo.loadProfessorState(TEST_PROFESSOR.userId);
    expect(roster.members).toEqual([
      expect.objectContaining({
        sectionId: section.id,
        studentKey: studentKeyForOwner(STUDENT),
        sessions: 0,
        attempts: 0,
      }),
    ]);
    expect(JSON.stringify(roster)).not.toContain(
      STUDENT.kind === "user" ? STUDENT.userId : "",
    );

    state = await apply({
      type: "section/updateDelivery",
      sectionId: section.id,
      questionId: "courses-q1",
      patch: {
        attemptsAllowed: 5,
        hintsEnabled: false,
        solutionReveal: "never",
      },
    });
    expect((await repo.getSectionReleases(section.id))[0].delivery).toEqual({
      attemptsAllowed: 5,
      hintsEnabled: false,
      solutionReveal: "never",
    });
    await expect(
      apply({
        type: "section/updateDelivery",
        sectionId: section.id,
        questionId: "courses-q1",
        patch: { attemptsAllowed: 11 },
      }),
    ).rejects.toBeInstanceOf(CoursesValidationError);

    const v2 = await publishNewVersion("courses-q1", TOPIC_A);
    versionIds["courses-q1"].push(v2.publishedVersion!.versionId);
    state = await repo.loadProfessorState(TEST_PROFESSOR.userId);
    expect(
      state.bank.find((question) => question.id === "courses-q1"),
    ).toMatchObject({ publishedVersion: 2, latestVersion: 2 });
    // Still pinned to version 1 until the professor moves it.
    expect((await repo.getSectionReleases(section.id))[0]).toMatchObject({
      releasedVersion: 1,
      questionVersionId: versionIds["courses-q1"][0],
    });

    state = await apply({
      type: "section/moveToVersion",
      sectionId: section.id,
      questionId: "courses-q1",
      version: 2,
    });
    expect((await repo.getSectionReleases(section.id))[0]).toMatchObject({
      releasedVersion: 2,
      questionVersionId: versionIds["courses-q1"][1],
    });
    await expect(
      apply({
        type: "section/moveToVersion",
        sectionId: section.id,
        questionId: "courses-q1",
        version: 1,
      }),
    ).rejects.toBeInstanceOf(CoursesValidationError);

    state = await apply({
      type: "course/archive",
      courseId: "stat-101-fall-2026",
    });
    expect(state.courses[0].status).toBe("archived");
    const archived = await db.query<{ archived_at: unknown }>(
      "select archived_at from courses where id = 'stat-101-fall-2026'",
    );
    expect(archived.rows[0].archived_at).not.toBeNull();
    expect(await repo.getStudentSection(STUDENT)).toBeUndefined();
    await expect(
      repo.joinSection(ANON, section.joinCode),
    ).rejects.toBeInstanceOf(CoursesNotFoundError);

    state = await apply({
      type: "course/unarchive",
      courseId: "stat-101-fall-2026",
    });
    expect(await repo.getStudentSection(STUDENT)).toEqual(joined);

    const events = await db.query<{
      action: string;
      actor_user_id: string;
      request_id: string;
      section_id: string | null;
    }>(
      "select action, actor_user_id, request_id, section_id from course_events where course_id = 'stat-101-fall-2026' order by id",
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      "course/create",
      "section/create",
      "section/setTopicState",
      "section/applyReleaseChanges",
      "section/updateDelivery",
      "section/moveToVersion",
      "course/archive",
      "course/unarchive",
    ]);
    expect(
      events.rows.every(
        (row) =>
          row.actor_user_id === TEST_PROFESSOR.userId &&
          row.request_id === "req-test",
      ),
    ).toBe(true);
    expect(events.rows[1].section_id).toBe(section.id);
    expect(events.rows[0].section_id).toBeNull();
  });

  it("treats a reducer no-op as a no-op without a ledger row", async () => {
    const before = await rowCount("course_events");
    await apply({
      type: "course/moveTopic",
      courseId: "stat-101-fall-2026",
      topicId: TOPIC_A,
      direction: "up",
    });
    expect(await rowCount("course_events")).toBe(before);
  });

  it("isolates professors from each other's courses", async () => {
    const other = await repo.loadProfessorState(OTHER_PROFESSOR);
    expect(other.courses).toEqual([]);
    expect(other.sections).toEqual([]);
    expect(other.members).toEqual([]);
    await expect(
      apply(
        { type: "course/archive", courseId: "stat-101-fall-2026" },
        OTHER_PROFESSOR,
      ),
    ).rejects.toBeInstanceOf(CoursesNotFoundError);
    await expect(
      apply(
        {
          type: "section/update",
          sectionId: "stat-101-fall-2026-sec-01",
          patch: { label: "Hijacked" },
        },
        OTHER_PROFESSOR,
      ),
    ).rejects.toBeInstanceOf(CoursesNotFoundError);
    await expect(
      apply(
        {
          type: "section/create",
          section: {
            id: "intruder-sec",
            courseId: "stat-101-fall-2026",
            label: "Intruder",
            meetingTime: "",
          },
        },
        OTHER_PROFESSOR,
      ),
    ).rejects.toBeInstanceOf(CoursesNotFoundError);
    await expect(
      apply(
        {
          type: "course/clone",
          sourceCourseId: "stat-101-fall-2026",
          newCourse: {
            id: "copy",
            code: "STAT-101",
            title: "Copy",
            term: "Spring 2027",
          },
        },
        OTHER_PROFESSOR,
      ),
    ).rejects.toBeInstanceOf(CoursesNotFoundError);

    // The other professor proposing an id that is already taken gets a fresh one.
    const created = await apply(
      {
        type: "course/create",
        course: {
          id: "stat-101-fall-2026",
          code: "STAT-101",
          title: "Their statistics",
          term: "Fall 2026",
          status: "active",
        },
      },
      OTHER_PROFESSOR,
    );
    expect(created.courses).toHaveLength(1);
    expect(created.courses[0].id).toMatch(/^stat-101-fall-2026-[a-z0-9]{6}$/);
    const mine = await repo.loadProfessorState(TEST_PROFESSOR.userId);
    expect(mine.courses.map((course) => course.title)).toEqual([
      "Intro Statistics",
    ]);
  });

  it("rejects a second course with the same code and term for one professor", async () => {
    await expect(
      apply({
        type: "course/create",
        course: {
          id: "stat-101-fall-2026-again",
          code: "STAT-101",
          title: "Duplicate",
          term: "Fall 2026",
          status: "active",
        },
      }),
    ).rejects.toBeInstanceOf(CoursesValidationError);
  });

  it("keeps join codes unique and one active section per course per student", async () => {
    let state = await apply({
      type: "section/create",
      section: {
        id: "stat-101-fall-2026-sec-02",
        courseId: "stat-101-fall-2026",
        label: "Section 2",
        meetingTime: "",
      },
    });
    const first = sectionOf(state, "stat-101-fall-2026-sec-01")!;
    const second = sectionOf(state, "stat-101-fall-2026-sec-02")!;
    expect(second.joinCode).not.toBe(first.joinCode);
    await expect(
      db.query("update course_sections set join_code = $1 where id = $2", [
        first.joinCode,
        second.id,
      ]),
    ).rejects.toThrow(/duplicate key|unique/i);

    const moved = await repo.joinSection(STUDENT, second.joinCode);
    expect(moved.sectionId).toBe(second.id);
    const memberships = await db.query<{
      left_at: unknown;
      section_id: string;
    }>(
      "select section_id, left_at from section_members where owner_kind = 'user' and owner_id = $1 order by section_id",
      ["user:courses-student"],
    );
    expect(memberships.rows).toHaveLength(2);
    expect(memberships.rows[0].left_at).not.toBeNull();
    expect(memberships.rows[1].left_at).toBeNull();
    expect((await repo.getStudentSection(STUDENT))?.sectionId).toBe(second.id);
    await expect(
      db.query(
        "update section_members set left_at = null where section_id = $1 and owner_id = $2",
        [first.id, "user:courses-student"],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);

    // Rejoining the first section reuses its row.
    expect((await repo.joinSection(STUDENT, first.joinCode)).sectionId).toBe(
      first.id,
    );
    expect(
      await rowCount("section_members", "owner_id = $1 and left_at is null", [
        "user:courses-student",
      ]),
    ).toBe(1);

    const anonymous = await repo.joinSection(ANON, second.joinCode);
    expect(anonymous.sectionId).toBe(second.id);
    await repo.leaveSection(ANON);
    expect(await repo.getStudentSection(ANON)).toBeUndefined();

    state = await apply({
      type: "section/regenerateJoinCode",
      sectionId: second.id,
    });
    const regenerated = sectionOf(state, second.id)!;
    expect(regenerated.joinCode).not.toBe(second.joinCode);
    await expect(
      repo.joinSection(ANON, second.joinCode),
    ).rejects.toBeInstanceOf(CoursesNotFoundError);
    await expect(repo.joinSection(ANON, "nope")).rejects.toBeInstanceOf(
      CoursesNotFoundError,
    );
  });

  it("rejects demo-only and client-only actions in database mode", async () => {
    const actions: CoursesAction[] = [
      { type: "reset" },
      { type: "hydrate" },
      { type: "course/setActive", courseId: "stat-101-fall-2026" },
      { type: "bank/publish", questionId: "courses-q2", now: "2026-01-01" },
      {
        type: "bank/addDraft",
        question: {
          id: "draft",
          topicId: TOPIC_A,
          title: "Draft",
          prompt: "Prompt",
          answerType: "numeric",
          difficulty: "core",
          finalAnswer: "1",
          hints: [],
          solutionSteps: [],
        },
        now: "2026-01-01",
      },
    ];
    for (const action of actions) {
      await expect(apply(action)).rejects.toBeInstanceOf(
        CoursesValidationError,
      );
    }
    await expect(
      apply({ type: "nonsense" } as unknown as CoursesAction),
    ).rejects.toBeInstanceOf(CoursesValidationError);
    await expect(
      apply({
        type: "section/update",
        sectionId: "stat-101-fall-2026-sec-01",
      } as unknown as CoursesAction),
    ).rejects.toBeInstanceOf(CoursesValidationError);
  });

  it("serialises concurrent actions on one course so neither overwrites the other", async () => {
    const sectionId = "stat-101-fall-2026-sec-01";
    const [first, second] = await Promise.all([
      apply({
        type: "section/applyReleaseChanges",
        sectionId,
        changes: [{ kind: "add", questionId: "courses-q2" }],
        now: "2026-01-01T00:00:00.000Z",
      }),
      apply({
        type: "section/applyReleaseChanges",
        sectionId,
        changes: [{ kind: "add", questionId: "courses-q3" }],
        now: "2026-01-01T00:00:00.000Z",
      }),
    ]);
    expect(first).toBeDefined();
    const rows = second.questionAvailability
      .filter((row) => row.sectionId === sectionId)
      .map((row) => [row.questionId, row.position])
      .sort();
    expect(rows).toEqual([
      ["courses-q1", 0],
      ["courses-q2", 1],
      ["courses-q3", 0],
    ]);
    // Topic B is still closed, so the release is listed with its state.
    const releases = await repo.getSectionReleases(sectionId);
    expect(releases.map((row) => [row.questionId, row.topicState])).toEqual([
      ["courses-q1", "open"],
      ["courses-q2", "open"],
      ["courses-q3", "closed"],
    ]);
  });

  it("removes a release, appends to the ledger, and keeps the ledger immutable", async () => {
    const sectionId = "stat-101-fall-2026-sec-01";
    const before = await rowCount("course_events");
    const state = await apply({
      type: "section/applyReleaseChanges",
      sectionId,
      changes: [{ kind: "remove", questionId: "courses-q3" }],
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(
      state.questionAvailability.some(
        (row) => row.sectionId === sectionId && row.questionId === "courses-q3",
      ),
    ).toBe(false);
    expect(await rowCount("course_events")).toBe(before + 1);
    await expect(
      db.query("update course_events set action = 'course/archive'"),
    ).rejects.toThrow();
    await expect(db.query("delete from course_events")).rejects.toThrow();
  });

  it("clones a course with held releases on fresh sections and closed topics", async () => {
    const state = await apply({
      type: "course/clone",
      sourceCourseId: "stat-101-fall-2026",
      newCourse: {
        id: "stat-101-spring-2027",
        code: "STAT-101",
        title: "Intro Statistics",
        term: "Spring 2027",
      },
    });
    const sections = state.sections.filter(
      (section) => section.courseId === "stat-101-spring-2027",
    );
    expect(sections).toHaveLength(2);
    const codes = new Set(state.sections.map((section) => section.joinCode));
    expect(codes.size).toBe(state.sections.length);
    const cloned = state.questionAvailability.filter((row) =>
      sections.some((section) => section.id === row.sectionId),
    );
    expect(cloned.length).toBeGreaterThan(0);
    expect(cloned.every((row) => row.state === "held")).toBe(true);
    expect(
      state.topicAvailability
        .filter((row) => sections.some((s) => s.id === row.sectionId))
        .every((row) => row.state === "closed"),
    ).toBe(true);
  });

  it("maps a unique-key race to a conflict", async () => {
    await expect(
      createDatabaseCoursesRepository(async () => {
        throw Object.assign(new Error("duplicate"), { code: "23505" });
      }).joinSection(STUDENT, "ABC-DE"),
    ).rejects.toBeInstanceOf(CoursesConflictError);
  });
});
