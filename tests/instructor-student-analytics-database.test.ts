import { readFileSync, readdirSync } from "node:fs";
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
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";

const databases: PGlite[] = [];

/**
 * Two students with deliberately different shapes: one struggling on a single
 * topic, one mostly succeeding across two. Every count asserted below is hand
 * derived from these rows.
 */
const STRUGGLING = "anon:11111111-1111-1111-1111-111111111111";
const STEADY = "user:instructor-analytics-student";

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

  // Every case here reads; migrating and seeding once keeps the file from
  // rebuilding eighteen migrations per test.
  beforeAll(async () => {
    const database = await migratedDatabase();
    repository = createDatabaseInstructorStudentRepository(
      pgliteQuery(database),
    );
    await seed(database);
    // Eighteen migrations under load can outrun the default hook timeout.
  }, 60_000);

  it("lists one row per student with derived counts and no raw identity", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization);

    expect(list.total).toBe(2);
    expect(list.students).toHaveLength(2);

    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain(STRUGGLING);
    expect(serialized).not.toContain("instructor-analytics-student");
    for (const student of list.students) {
      expect(student.studentKey).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("counts attempts, correctness, hints, and solution reveals per student", async () => {
    const authorization = await professorAuthorization();
    const list = await repository.listStudents(authorization, {
      sort: "lowest_accuracy",
    });
    const struggling = list.students[0];

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
  });

  it("orders by lowest accuracy so the struggling student surfaces first", async () => {
    const authorization = await professorAuthorization();
    const byAccuracy = await repository.listStudents(authorization, {
      sort: "lowest_accuracy",
    });

    expect(byAccuracy.students[0].correctAttempts).toBe(1);
    expect(byAccuracy.students[1].correctAttempts).toBe(3);
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

    expect(firstPage.total).toBe(2);
    expect(secondPage.total).toBe(2);
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
      list.students[0].studentKey,
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
      list.students[0].studentKey,
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
      list.students[0].studentKey,
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

  it("aggregates the cohort with the tutor path split", async () => {
    const authorization = await professorAuthorization();
    const cohort = await repository.getCohortAnalytics(authorization);

    expect(cohort.activeStudents).toBe(2);
    expect(cohort.attempts).toBe(8);
    expect(cohort.correctAttempts).toBe(4);
    // Eight of the ten recorded rows were answered by the rule engine; the
    // other two are the single retrieval and single LLM fallback.
    expect(cohort.ruleAttempts).toBe(8);
    expect(cohort.retrievalAttempts).toBe(1);
    expect(cohort.llmAttempts).toBe(1);
    expect(cohort.studentsNeedingAttention).toBe(1);
    expect(cohort.misconceptions[0]).toMatchObject({
      misconceptionId: "conditional-probability-denominator-mistake",
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
       ($2, 'test', 'analytics-student', 'student@example.edu', 'Student', 'active')`,
    [TEST_PROFESSOR.userId, STEADY.slice("user:".length)],
  );
  await database.query(
    "insert into user_roles (user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await database.query(
    `insert into topics (id, title, description, sort_order, is_active) values
       ('conditional-probability', 'Conditional Probability', '', 1, true),
       ('binomial-models', 'Binomial Models', '', 2, true)`,
  );

  for (const [questionId, topicId] of [
    ["cp-question", "conditional-probability"],
    ["bm-question", "binomial-models"],
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
  }

  const versions = await database.query<{ id: number; question_id: string }>(
    "select id, question_id from question_versions",
  );
  const versionByQuestion = new Map(
    versions.rows.map((row) => [row.question_id, row.id]),
  );

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
    misconceptionIds: [],
    questionId: "bm-question",
    questionVersionId: versionByQuestion.get("bm-question"),
    revealedHints: 1,
    revealedSteps: 0,
    sessionId: "session-steady-2",
    solved: true,
    userId: STEADY.slice("user:".length),
  });

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
      input.solved ? "completed" : "active",
      input.solved ? "solved" : "working",
    ],
  );
}
