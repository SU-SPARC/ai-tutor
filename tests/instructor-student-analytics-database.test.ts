import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  mockPrincipal,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

import {
  requireAnalyticsAccess,
  requireStudent,
} from "@/lib/auth/authorization";
import { createDatabaseInstructorStudentRepository } from "@/lib/data/instructor-student-repository";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import type { InstructorStudentList } from "@/lib/types";

const databases: PGlite[] = [];

/**
 * Three students with deliberately different shapes: one struggling on a
 * single topic, one mostly succeeding across two, and one with low overall
 * accuracy spread across three topics. Every count asserted below is hand
 * derived from these rows.
 */
const STRUGGLING = "anon:11111111-1111-1111-1111-111111111111";
const STEADY = "user:instructor-analytics-student";
const DISTRIBUTED = "user:distributed-attempts-student";
const PROFESSOR_STUDENT_KEY = createHash("sha256")
  .update(`user:${TEST_PROFESSOR.userId}`)
  .digest("hex");

afterEach(() => {
  mockPrincipal(undefined);
});

afterAll(async () => {
  while (databases.length > 0) {
    await databases.pop()?.close();
  }
});

describe("instructor student analytics", () => {
  let repository: ReturnType<typeof createDatabaseInstructorStudentRepository>;
  let database: PGlite;

  // Every case here reads; migrating and seeding once keeps the file from
  // rebuilding eighteen migrations per test.
  beforeAll(async () => {
    database = await migratedDatabase();
    repository = createDatabaseInstructorStudentRepository(
      pgliteQuery(database),
    );
    await seed(database);
    // The complete migration chain under load can outrun the default hook timeout.
  }, 60_000);

  it("lists one row per student with derived counts and no raw identity", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization);

    expect(list.total).toBe(3);
    expect(list.students).toHaveLength(3);

    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(STRUGGLING);
    expect(serialized).not.toContain("instructor-analytics-student");
    expect(serialized).not.toContain("distributed-attempts-student");
    expect(list.students.map((student) => student.studentKey)).not.toContain(
      PROFESSOR_STUDENT_KEY,
    );
    for (const student of list.students) {
      expect(student.studentKey).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("counts attempts, correctness, hints, and solution reveals per student", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization, {
      sort: "lowest_accuracy",
    });
    const struggling = studentNeedingAttention(list);

    // Four `check` attempts, one correct. The hint and solution rows are not
    // answer submissions and must not inflate the attempt count.
    expect(struggling.attempts).toBe(4);
    expect(struggling.correctAttempts).toBe(1);
    expect(struggling.incorrectAttempts).toBe(3);
    expect(struggling.hintsUsed).toBe(3);
    expect(struggling.solutionsRevealed).toBe(2);
    expect(struggling.sessions).toBe(2);
    expect(struggling.topicsPracticed).toBe(1);
    expect(struggling.misconceptionAttempts).toBe(2);
    expect(struggling.extraPracticeSessions).toBe(1);
  });

  it("orders by lowest overall accuracy", async () => {
    const authorization = await professorAuthorization();
    const byAccuracy = await repository.listStudents(authorization, {
      sort: "lowest_accuracy",
    });

    expect(byAccuracy.students[0]).toMatchObject({
      attempts: 6,
      correctAttempts: 1,
      needsAttention: false,
    });
    expect(byAccuracy.students[1]).toMatchObject({
      attempts: 4,
      correctAttempts: 1,
      needsAttention: true,
    });
  });

  it("flags students from per-topic difficulty rather than overall accuracy", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization);
    const struggling = studentNeedingAttention(list);
    const distributed = list.students.find((student) => student.attempts === 6);

    expect(struggling).toMatchObject({
      attempts: 4,
      correctAttempts: 1,
      needsAttention: true,
      topicsPracticed: 1,
    });
    expect(distributed).toMatchObject({
      attempts: 6,
      correctAttempts: 1,
      needsAttention: false,
      topicsPracticed: 3,
    });
  });

  it("excludes professor practice from the student population and attention count", async () => {
    const authorization = await professorAuthorization();
    const [list, cohort] = await Promise.all([
      repository.listStudents(authorization),
      repository.getCohortAnalytics(authorization),
    ]);

    expect(list.total).toBe(3);
    expect(list.students.map((student) => student.studentKey)).not.toContain(
      PROFESSOR_STUDENT_KEY,
    );
    expect(cohort).toMatchObject({
      activeStudents: 3,
      attempts: 15,
      excludedStaffSessions: 1,
      studentsNeedingAttention: 1,
    });
  });

  it("paginates without losing the total", async () => {
    const authorization = await professorAuthorization();
    const firstPage = await repository.listStudents(authorization, {
      limit: 1,
      sort: "lowest_accuracy",
    });
    const secondPage = await repository.listStudents(authorization, {
      limit: 1,
      offset: 1,
      sort: "lowest_accuracy",
    });

    expect(firstPage.total).toBe(3);
    expect(secondPage.total).toBe(3);
    expect(firstPage.students).toHaveLength(1);
    expect(secondPage.students).toHaveLength(1);
    expect(firstPage.students[0].studentKey).not.toBe(
      secondPage.students[0].studentKey,
    );
  });

  it("aggregates topic performance and recent attempts for one student", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization, {
      sort: "lowest_accuracy",
    });
    const detail = await repository.getStudentDetail(
      authorization,
      studentNeedingAttention(list).studentKey,
    );

    expect(detail).toBeDefined();
    expect(detail?.topics).toHaveLength(1);
    expect(detail?.topics[0]).toMatchObject({
      attempts: 4,
      correctAttempts: 1,
      incorrectAttempts: 3,
      topicId: "conditional-probability",
    });
    expect(detail?.attempts.length).toBeGreaterThan(0);
    expect(
      detail?.attempts.some((attempt) => attempt.misconceptionDetected),
    ).toBe(true);
  });

  it("counts misconceptions from recorded codes rather than from low scores", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization, {
      sort: "lowest_accuracy",
    });
    const detail = await repository.getStudentDetail(
      authorization,
      studentNeedingAttention(list).studentKey,
    );

    expect(detail?.misconceptions).toEqual([
      {
        label: "Conditional probability denominator mistake",
        misconceptionId: "conditional-probability-denominator-mistake",
        sessions: 2,
      },
    ]);
  });

  it("never returns answers, feedback text, or retrieval content", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization, {
      sort: "lowest_accuracy",
    });
    const detail = await repository.getStudentDetail(
      authorization,
      studentNeedingAttention(list).studentKey,
    );
    const serialized = JSON.stringify(detail);

    expect(serialized).not.toContain("7/12");
    expect(serialized).not.toContain("denominator should be the reduced total");
    expect(serialized).not.toContain(STRUGGLING);
  });

  it("returns nothing for a key that matches no student", async () => {
    const authorization = await professorAuthorization();
    const detail = await repository.getStudentDetail(
      authorization,
      "f".repeat(64),
    );

    expect(detail).toBeUndefined();
  });

  it("does not expose professor-owned activity through direct drilldown", async () => {
    const detail = await repository.getStudentDetail(
      await professorAuthorization(),
      PROFESSOR_STUDENT_KEY,
    );

    expect(detail).toBeUndefined();
  });

  it("aggregates the cohort with the tutor path split", async () => {
    const authorization = await professorAuthorization();
    const cohort = await repository.getCohortAnalytics(authorization);

    expect(cohort.activeStudents).toBe(3);
    expect(cohort.extraPracticeSessions).toBe(1);
    expect(cohort.attempts).toBe(15);
    expect(cohort.correctAttempts).toBe(5);
    expect(cohort.excludedStaffSessions).toBe(1);
    // Fourteen of the seventeen included published rows use the rule engine;
    // the others use retrieval, LLM fallback, and blocked paths.
    expect(cohort.ruleAttempts).toBe(14);
    expect(cohort.retrievalAttempts).toBe(1);
    expect(cohort.llmAttempts).toBe(1);
    expect(cohort.blockedAttempts).toBe(1);
    expect(cohort.studentsNeedingAttention).toBe(1);
    expect(cohort.misconceptions[0]).toMatchObject({
      misconceptionId: "conditional-probability-denominator-mistake",
    });
  });

  it("excludes Reserve practice and counts only explicit incorrect verdicts", async () => {
    const analytics = await createDatabaseContentRepository(
      "postgres://unused.example/db",
      pgliteQuery(database),
    ).getProfessorPracticeAnalytics(await professorAuthorization());

    expect(analytics).toMatchObject({
      summary: {
        totalAttempts: 15,
        totalHintsUsed: 4,
        totalStepsRevealed: 2,
        totalTutorSessions: 7,
      },
    });
    expect(
      analytics.questions.find(
        (question) => question.questionId === "cp-question",
      ),
    ).toMatchObject({
      attempts: 9,
      correctAttempts: 3,
      hintsUsed: 3,
      incorrectAttempts: 5,
      llmAttempts: 0,
      stepsRevealed: 2,
    });
  });

  it("refuses every instructor read for a student principal", async () => {
    mockPrincipal(TEST_STUDENT);
    const studentAuthorization = await requireStudent();

    await expect(
      repository.listStudents(studentAuthorization as never),
    ).rejects.toThrow();
    await expect(
      repository.getStudentDetail(
        studentAuthorization as never,
        "a".repeat(64),
      ),
    ).rejects.toThrow();
    await expect(
      repository.getCohortAnalytics(studentAuthorization as never),
    ).rejects.toThrow();
  });

  it("reports an empty cohort rather than failing when nothing is recorded", async () => {
    const empty = await migratedDatabase();
    const emptyRepository = createDatabaseInstructorStudentRepository(
      pgliteQuery(empty),
    );
    const authorization = await professorAuthorization();

    await expect(
      emptyRepository.listStudents(authorization),
    ).resolves.toMatchObject({ students: [], total: 0 });
    await expect(
      emptyRepository.getCohortAnalytics(authorization),
    ).resolves.toMatchObject({ activeStudents: 0, attempts: 0 });
  });
});

async function professorAuthorization() {
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}

function studentNeedingAttention(list: InstructorStudentList) {
  const student = list.students.find((candidate) => candidate.needsAttention);

  if (!student) {
    throw new Error("Expected a student needing instructor attention.");
  }

  return student;
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
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query(sql, params);
    return result.rows as Record<string, unknown>[];
  };
  return query;
}

async function seed(database: PGlite) {
  await database.query(
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values
       ($1, 'test', 'analytics-professor', 'professor@example.edu', 'Professor', 'active'),
       ($2, 'test', 'analytics-student', 'student@example.edu', 'Student', 'active'),
       ($3, 'test', 'distributed-student', 'distributed@example.edu', 'Distributed Student', 'active')`,
    [
      TEST_PROFESSOR.userId,
      STEADY.slice("user:".length),
      DISTRIBUTED.slice("user:".length),
    ],
  );
  await database.query(
    "insert into user_roles (user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await database.query(
    `insert into topics (id, title, description, sort_order, is_active) values
       ('conditional-probability', 'Conditional Probability', '', 1, true),
       ('binomial-models', 'Binomial Models', '', 2, true),
       ('normal-models', 'Normal Models', '', 3, true)`,
  );
  await database.exec(
    "select set_config('app.current_creation_method', 'manual', false)",
  );

  for (const [questionId, topicId] of [
    ["cp-question", "conditional-probability"],
    ["bm-question", "binomial-models"],
    ["nm-question", "normal-models"],
  ]) {
    await database.query(
      `insert into questions (
         id, topic_id, title, prompt, difficulty, accepted_answers_json,
         answer_explanation, source_type, trust_level, review_status,
         visibility, originality_note, reviewed_by, reviewed_by_user_id,
         reviewed_at
       ) values ($1, $2, $3, 'Prompt text', 'foundational', '["0.5"]'::jsonb,
         'Divide the favorable outcomes by the total.', 'original_demo',
         'public_original', 'approved', 'public', 'Original test question.',
         'Professor', $4, now())`,
      [questionId, topicId, `${topicId} question`, TEST_PROFESSOR.userId],
    );
    await database.query(
      `insert into hints (question_id, hint_order, body)
       values ($1, 1, 'Start with the numerator and denominator.')`,
      [questionId],
    );
    await database.query(
      `insert into solution_steps (question_id, step_order, body)
       values ($1, 1, 'Divide the favorable outcomes by the total.')`,
      [questionId],
    );
  }

  const versions = await database.query<{ id: number; question_id: string }>(
    `select q.working_version_id as id, q.id as question_id
     from questions q`,
  );
  const versionByQuestion = new Map(
    versions.rows.map((row) => [row.question_id, row.id]),
  );

  for (const [questionId, versionId] of versionByQuestion) {
    for (const [action, expectedState] of [
      ["submit", "draft"],
      ["approve", "needs_review"],
      ["publish", "approved"],
    ]) {
      await database.query(
        `select * from app_transition_question_version(
           target_question_id => $1,
           target_question_version_id => $2,
           transition_action => $3,
           actor_id => $4,
           actor_display => 'Professor',
           expected_state => $5,
           idempotency_key_value => $6
         )`,
        [
          questionId,
          versionId,
          action,
          TEST_PROFESSOR.userId,
          expectedState,
          `seed:${questionId}:${action}`,
        ],
      );
    }
  }

  // Struggling student: two sessions on one topic, one correct answer out of
  // four, hints and solutions revealed, the same misconception code twice.
  await seedSession(database, {
    anonymousUserId: STRUGGLING,
    misconceptionIds: ["conditional-probability-denominator-mistake"],
    questionId: "cp-question",
    questionVersionId: versionByQuestion.get("cp-question"),
    revealedHints: 2,
    revealedSteps: 1,
    sessionId: "session-struggling-1",
    solved: false,
  });
  await seedSession(database, {
    anonymousUserId: STRUGGLING,
    misconceptionIds: ["conditional-probability-denominator-mistake"],
    questionId: "cp-question",
    questionVersionId: versionByQuestion.get("cp-question"),
    revealedHints: 1,
    revealedSteps: 1,
    sessionId: "session-struggling-2",
    solved: false,
  });
  await seedSession(database, {
    misconceptionIds: [],
    questionId: "cp-question",
    questionVersionId: versionByQuestion.get("cp-question"),
    revealedHints: 0,
    revealedSteps: 0,
    sessionId: "session-steady-1",
    solved: true,
    userId: STEADY.slice("user:".length),
  });
  await seedSession(database, {
    misconceptionIds: ["staff-only-misconception"],
    questionId: "cp-question",
    questionVersionId: versionByQuestion.get("cp-question"),
    revealedHints: 7,
    revealedSteps: 7,
    sessionId: "session-professor-practice",
    solved: false,
    userId: TEST_PROFESSOR.userId,
  });

  await database.exec(`
    alter table tutor_sessions
      disable trigger tutor_sessions_guard_practice_context;
  `);
  await database.query(
    `insert into tutor_sessions (
       id, anonymous_user_id, question_id, question_version_id,
       practice_context, origin_session_id, revealed_hints, revealed_steps,
       status, current_state
     ) values (
       'session-struggling-extra', $1, 'cp-question', $2,
       'reserve_practice', 'session-struggling-1', 9, 9, 'active', 'working'
     )`,
    [STRUGGLING, versionByQuestion.get("cp-question")],
  );
  await database.exec(`
    alter table tutor_sessions
      enable trigger tutor_sessions_guard_practice_context;
  `);
  await seedSession(database, {
    misconceptionIds: [],
    questionId: "bm-question",
    questionVersionId: versionByQuestion.get("bm-question"),
    revealedHints: 1,
    revealedSteps: 0,
    sessionId: "session-steady-2",
    solved: true,
    userId: STEADY.slice("user:".length),
  });
  for (const [questionId, sessionId, solved] of [
    ["cp-question", "session-distributed-cp", true],
    ["bm-question", "session-distributed-bm", false],
    ["nm-question", "session-distributed-nm", false],
  ] as const) {
    await seedSession(database, {
      misconceptionIds: [],
      questionId,
      questionVersionId: versionByQuestion.get(questionId),
      revealedHints: 0,
      revealedSteps: 0,
      sessionId,
      solved,
      userId: DISTRIBUTED.slice("user:".length),
    });
  }

  const attemptRows: Array<
    [string, string, string, string, string, string, string]
  > = [
    // sessionId, questionId, topicId, mode, source, verdict, misconceptions
    [
      "session-struggling-1",
      "cp-question",
      "conditional-probability",
      "check",
      "rule",
      "incorrect",
      '["The denominator should be the reduced total."]',
    ],
    [
      "session-struggling-1",
      "cp-question",
      "conditional-probability",
      "hint",
      "rule",
      "guidance",
      "[]",
    ],
    [
      "session-struggling-1",
      "cp-question",
      "conditional-probability",
      "check",
      "rule",
      "incorrect",
      '["The denominator should be the reduced total."]',
    ],
    [
      "session-struggling-2",
      "cp-question",
      "conditional-probability",
      "check",
      "retrieval",
      "incorrect",
      "[]",
    ],
    [
      "session-struggling-2",
      "cp-question",
      "conditional-probability",
      "solution",
      "rule",
      "guidance",
      "[]",
    ],
    [
      "session-struggling-2",
      "cp-question",
      "conditional-probability",
      "check",
      "rule",
      "correct",
      "[]",
    ],
    [
      "session-steady-1",
      "cp-question",
      "conditional-probability",
      "check",
      "rule",
      "correct",
      "[]",
    ],
    ...Array.from({ length: 4 }, () =>
      [
        "session-professor-practice",
        "cp-question",
        "conditional-probability",
        "check",
        "rule",
        "incorrect",
        '["STAFF-ONLY-MISCONCEPTION"]',
      ] as [string, string, string, string, string, string, string],
    ),
    [
      "session-steady-1",
      "cp-question",
      "conditional-probability",
      "check",
      "rule",
      "incorrect",
      "[]",
    ],
    [
      "session-steady-1",
      "cp-question",
      "conditional-probability",
      "check",
      "blocked",
      "blocked",
      "[]",
    ],
    [
      "session-steady-2",
      "bm-question",
      "binomial-models",
      "check",
      "rule",
      "correct",
      "[]",
    ],
    [
      "session-steady-2",
      "bm-question",
      "binomial-models",
      "check",
      "llm",
      "correct",
      "[]",
    ],
    [
      "session-distributed-cp",
      "cp-question",
      "conditional-probability",
      "check",
      "rule",
      "correct",
      "[]",
    ],
    [
      "session-distributed-cp",
      "cp-question",
      "conditional-probability",
      "check",
      "rule",
      "incorrect",
      "[]",
    ],
    [
      "session-distributed-bm",
      "bm-question",
      "binomial-models",
      "check",
      "rule",
      "incorrect",
      "[]",
    ],
    [
      "session-distributed-bm",
      "bm-question",
      "binomial-models",
      "check",
      "rule",
      "incorrect",
      "[]",
    ],
    [
      "session-distributed-nm",
      "nm-question",
      "normal-models",
      "check",
      "rule",
      "incorrect",
      "[]",
    ],
    [
      "session-distributed-nm",
      "nm-question",
      "normal-models",
      "check",
      "rule",
      "incorrect",
      "[]",
    ],
    [
      "session-struggling-extra",
      "cp-question",
      "conditional-probability",
      "check",
      "llm",
      "correct",
      '["EXTRA-PRACTICE-MISCONCEPTION"]',
    ],
  ];

  for (const [
    sessionId,
    questionId,
    topicId,
    mode,
    source,
    verdict,
    misconceptions,
  ] of attemptRows) {
    await database.query(
      `insert into attempts (
         session_id, question_id, topic_id, question_version_id, mode, source,
         verdict, answer_preview, misconception_feedback_json
       ) values ($1, $2, $3, $4, $5, $6, $7, '7/12', $8::jsonb)`,
      [
        sessionId,
        questionId,
        topicId,
        versionByQuestion.get(questionId),
        mode,
        source,
        verdict,
        misconceptions,
      ],
    );
  }
}

async function seedSession(
  database: PGlite,
  input: {
    anonymousUserId?: string;
    misconceptionIds: string[];
    questionId: string;
    questionVersionId?: number;
    revealedHints: number;
    revealedSteps: number;
    sessionId: string;
    solved: boolean;
    userId?: string;
  },
) {
  await database.query(
    `insert into tutor_sessions (
       id, user_id, anonymous_user_id, question_id, question_version_id,
       revealed_hints, revealed_steps, solved, last_misconception_ids_json,
       status, current_state, completed_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11,
       case when $8 then now() end
     )`,
    [
      input.sessionId,
      input.userId ?? null,
      input.anonymousUserId ?? null,
      input.questionId,
      input.questionVersionId ?? null,
      input.revealedHints,
      input.revealedSteps,
      input.solved,
      JSON.stringify(input.misconceptionIds),
      input.solved ? "completed" : "content_unpublished",
      input.solved ? "solved" : "working",
    ],
  );
}
