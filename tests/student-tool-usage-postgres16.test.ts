import { createHash } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  requireAnalyticsAccess,
  requireStudent,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/principal";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseInstructorStudentRepository } from "@/lib/data/instructor-student-repository";
import { createStudentToolUsageRepository } from "@/lib/data/student-tool-usage-repository";
import { mockPrincipal, resetAuthMocks, TEST_PROFESSOR } from "./auth-test-helpers";

/**
 * The PGlite suites prove the usage queries' shape; this suite runs the same
 * repository code against a real PostgreSQL 16 database (the Production
 * major) so the consequential SQL, the primary-key deduplication, and the
 * topic-scoped aggregation are not trusted to the embedded engine alone. It
 * runs only when `PG16_VERIFY_DATABASE_URL` names a disposable database that
 * already carries the full migration chain.
 */
const databaseUrl = process.env.PG16_VERIFY_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const prefix = `pg16-usage-${Date.now()}`;
const STUDENT: AuthenticatedPrincipal = {
  kind: "user",
  userId: `user:${prefix}-student`,
  displayName: "PG16 Usage Student",
  email: `${prefix}-student@example.invalid`,
  role: "student",
  roles: ["student"],
};
const PROFESSOR: AuthenticatedPrincipal = {
  ...TEST_PROFESSOR,
  email: `${prefix}-professor@example.invalid`,
  userId: `user:${prefix}-professor`,
};
const topicA = `${prefix}-topic-a`;
const topicB = `${prefix}-topic-b`;
const questionA = `${prefix}-question-a`;
const questionB = `${prefix}-question-b`;
const sessionA = `${prefix}-session-a`;
const sessionB = `${prefix}-session-b`;
const professorSession = `${prefix}-session-professor`;
// `topics.sort_order` is unique, so each run takes its own pair and the suite
// can be rerun against a reused disposable database.
const sortOrderBase = 100_000 + (Date.now() % 1_000_000) * 2;
const STUDENT_KEY = keyFor(`user:${STUDENT.userId}`);
const PROFESSOR_KEY = keyFor(`user:${PROFESSOR.userId}`);

describePostgres("student tool usage analytics on PostgreSQL 16", () => {
  let pool: pg.Pool;
  let usage: ReturnType<typeof createStudentToolUsageRepository>;
  let instructor: ReturnType<typeof createDatabaseInstructorStudentRepository>;

  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    if (!/(?:test|scratch|disposable|sandbox)/i.test(parsed.pathname)) {
      throw new Error(
        "PG16_VERIFY_DATABASE_URL must identify an explicitly disposable database.",
      );
    }
    pool = new pg.Pool({ connectionString: databaseUrl!, max: 2 });
    const version = await pool.query<{ server_version_num: string }>(
      "show server_version_num",
    );
    expect(Number(version.rows[0].server_version_num)).toBeGreaterThanOrEqual(
      160_000,
    );
    expect(Number(version.rows[0].server_version_num)).toBeLessThan(170_000);
    const migration = await pool.query<{ count: number }>(
      "select count(*)::int as count from schema_migrations",
    );
    expect(migration.rows[0].count).toBe(27);
    await seed(pool);
    const query = postgresQueryExecutor(pool);
    usage = createStudentToolUsageRepository(query);
    instructor = createDatabaseInstructorStudentRepository(query);
  }, 30_000);

  afterAll(async () => {
    resetAuthMocks();
    if (pool) {
      // Usage rows, attempts, and sessions are removed in foreign-key order;
      // the accounts, topics, and published questions stay like the other
      // PostgreSQL 16 suite's fixtures, because this database is disposable.
      await pool.query(
        "delete from student_usage_events where user_id = any($1)",
        [[STUDENT.userId, PROFESSOR.userId]],
      );
      await pool.query(
        "delete from student_tool_active_buckets where user_id = any($1)",
        [[STUDENT.userId, PROFESSOR.userId]],
      );
      await pool.query("delete from attempts where session_id = any($1)", [
        [sessionA, sessionB, professorSession],
      ]);
      await pool.query("delete from tutor_sessions where id = any($1)", [
        [sessionA, sessionB, professorSession],
      ]);
      await pool.end();
    }
  });

  it("deduplicates AI Help requests and Sketchpad buckets with the real constraints", async () => {
    mockPrincipal(STUDENT);
    const authorization = await requireStudent();
    const version = await questionVersions(pool);

    const outcomes: string[] = [];
    for (let n = 1; n <= 2; n += 1) {
      outcomes.push(
        await usage.recordAiHelpRequest(authorization, {
          eventId: `${prefix}-help-a-${n}`,
          questionId: questionA,
          questionVersionId: version.get(questionA)!,
          sessionId: sessionA,
          topicId: topicA,
        }),
      );
    }
    // The client's automatic retry replays the same event id.
    outcomes.push(
      await usage.recordAiHelpRequest(authorization, {
        eventId: `${prefix}-help-a-2`,
        questionId: questionA,
        questionVersionId: version.get(questionA)!,
        sessionId: sessionA,
        topicId: topicA,
      }),
    );
    for (let n = 1; n <= 5; n += 1) {
      outcomes.push(
        await usage.recordAiHelpRequest(authorization, {
          eventId: `${prefix}-help-b-${n}`,
          questionId: questionB,
          questionVersionId: version.get(questionB)!,
          sessionId: sessionB,
          topicId: topicB,
        }),
      );
    }
    expect(outcomes).toEqual([
      "recorded",
      "recorded",
      "duplicate",
      "recorded",
      "recorded",
      "recorded",
      "recorded",
      "recorded",
    ]);

    await expect(
      usage.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T12:00:01Z"),
      ),
    ).resolves.toBe("recorded");
    await expect(
      usage.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T12:00:14Z"),
      ),
    ).resolves.toBe("duplicate");
    await expect(
      usage.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T12:00:16Z"),
      ),
    ).resolves.toBe("recorded");

    // A professor satisfies the student permission but never becomes a
    // student usage record.
    mockPrincipal(PROFESSOR);
    await expect(
      usage.recordSketchpadHeartbeat(
        await requireStudent(),
        new Date("2026-09-27T12:00:01Z"),
      ),
    ).resolves.toBe("ineligible");

    const stored = await pool.query<{ events: number; seconds: number }>(
      `select
         (select count(*) from student_usage_events where user_id = $1)::int as events,
         (select coalesce(sum(credited_seconds), 0)
            from student_tool_active_buckets where user_id = $1)::int as seconds`,
      [STUDENT.userId],
    );
    expect(stored.rows[0]).toEqual({ events: 7, seconds: 30 });
  });

  it("scopes AI Help requests to the event's topic and keeps the global total", async () => {
    // Rows written outside the application for the professor must be
    // excluded by the population filter, not by the write path alone.
    const version = await questionVersions(pool);
    await pool.query(
      `insert into student_usage_events (
         user_id, event_type, idempotency_key, tutor_session_id, question_id,
         question_version_id, topic_id
       ) values ($1, 'ai_help_click', $2, $3, $4, $5, $6)
       on conflict do nothing`,
      [
        PROFESSOR.userId,
        `${prefix}-professor-help`,
        professorSession,
        questionA,
        version.get(questionA),
        topicA,
      ],
    );
    const authorization = await professorAuthorization();

    const roster = await instructor.listTopicRoster(authorization);
    const groupA = roster.topics.find((group) => group.topicId === topicA);
    const groupB = roster.topics.find((group) => group.topicId === topicB);
    expect(
      groupA?.students.find((student) => student.studentKey === STUDENT_KEY),
    ).toEqual({ aiHelpRequests: 2, studentKey: STUDENT_KEY });
    expect(
      groupB?.students.find((student) => student.studentKey === STUDENT_KEY),
    ).toEqual({ aiHelpRequests: 5, studentKey: STUDENT_KEY });
    expect(JSON.stringify(roster)).not.toContain(PROFESSOR_KEY);
    expect(JSON.stringify(roster)).not.toContain(STUDENT.userId);

    const list = await instructor.listStudents(authorization, {
      limit: 5,
      search: STUDENT_KEY.slice(0, 12),
    });
    expect(list.students).toHaveLength(1);
    expect(list.students[0]).toMatchObject({
      aiHelpRequests: 7,
      sketchpadActiveSeconds: 30,
      studentKey: STUDENT_KEY,
    });

    const detail = await instructor.getStudentDetail(authorization, STUDENT_KEY);
    expect(detail?.summary).toMatchObject({
      aiHelpRequests: 7,
      sketchpadActiveSeconds: 30,
    });
    expect(JSON.stringify(detail)).not.toContain(STUDENT.userId);
  });
});

async function professorAuthorization(): Promise<AnalyticsAuthorization> {
  mockPrincipal(PROFESSOR);
  return requireAnalyticsAccess();
}

function keyFor(owner: string) {
  return createHash("sha256").update(owner).digest("hex");
}

async function questionVersions(pool: pg.Pool) {
  const rows = await pool.query<{ id: number; question_id: string }>(
    `select coalesce(published_version_id, working_version_id) as id,
            id as question_id
     from questions where id = any($1)`,
    [[questionA, questionB]],
  );
  return new Map(rows.rows.map((row) => [row.question_id, Number(row.id)]));
}

async function seed(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    for (const principal of [STUDENT, PROFESSOR]) {
      await client.query(
        `insert into users (
           id, identity_provider, external_subject, email, display_name, status
         ) values ($1, 'test', $1, $2, $3, 'active')`,
        [principal.userId, principal.email, principal.displayName],
      );
    }
    await client.query(
      "insert into user_roles (user_id, role_id) values ($1, 'professor')",
      [PROFESSOR.userId],
    );
    await client.query(
      `insert into topics (id, title, description, sort_order, is_active) values
         ($1, 'PG16 Usage Topic A', '', $3, true),
         ($2, 'PG16 Usage Topic B', '', $4, true)`,
      [topicA, topicB, sortOrderBase, sortOrderBase + 1],
    );
    await client.query(
      "select set_config('app.current_creation_method', 'manual', false)",
    );
    for (const [questionId, topicId] of [
      [questionA, topicA],
      [questionB, topicB],
    ]) {
      await client.query(
        `insert into questions (
           id, topic_id, title, prompt, difficulty, accepted_answers_json,
           answer_explanation, source_type, trust_level, review_status,
           visibility, originality_note, reviewed_by, reviewed_by_user_id,
           reviewed_at
         ) values ($1, $2, $3, 'Prompt text', 'foundational', '["0.5"]'::jsonb,
           'Divide the favorable outcomes by the total.', 'original_demo',
           'public_original', 'approved', 'public', 'Original test question.',
           'PG16 Usage Professor', $4, now())`,
        [questionId, topicId, `Title ${questionId}`, PROFESSOR.userId],
      );
      await client.query(
        "insert into hints (question_id, hint_order, body) values ($1, 1, 'Count outcomes.')",
        [questionId],
      );
      await client.query(
        "insert into solution_steps (question_id, step_order, body) values ($1, 1, 'Divide.')",
        [questionId],
      );
      const version = (
        await client.query<{ id: number }>(
          "select working_version_id as id from questions where id = $1",
          [questionId],
        )
      ).rows[0].id;
      for (const [action, expectedState] of [
        ["submit", "draft"],
        ["approve", "needs_review"],
        ["publish", "approved"],
      ] as const) {
        await client.query(
          `select * from app_transition_question_version(
             target_question_id => $1,
             target_question_version_id => $2,
             transition_action => $3,
             actor_id => $4,
             actor_display => 'PG16 Usage Professor',
             expected_state => $5,
             idempotency_key_value => $6
           )`,
          [
            questionId,
            version,
            action,
            PROFESSOR.userId,
            expectedState,
            `${questionId}:${action}`,
          ],
        );
      }
    }
    // One revealed hint makes each session meaningful practice, which is what
    // places the student under the topic on the by-topic roster.
    await client.query(
      `insert into tutor_sessions (id, user_id, question_id, revealed_hints) values
         ($1, $2, $4, 1),
         ($3, $2, $5, 1),
         ($6, $7, $4, 1)`,
      [
        sessionA,
        STUDENT.userId,
        sessionB,
        questionA,
        questionB,
        professorSession,
        PROFESSOR.userId,
      ],
    );
  } finally {
    client.release();
  }
}

function postgresQueryExecutor(pool: pg.Pool): DatabaseQueryExecutor {
  const query: DatabaseQueryExecutor = async (sql, params = []) =>
    (await pool.query<Record<string, unknown>>(sql, params)).rows;
  query.transaction = async (work) => {
    const client = await pool.connect();
    const transactionQuery: DatabaseQueryExecutor = async (sql, params = []) =>
      (await client.query<Record<string, unknown>>(sql, params)).rows;
    try {
      await client.query("begin");
      const result = await work(transactionQuery);
      await client.query("commit");
      return result;
    } catch (cause) {
      await client.query("rollback");
      throw cause;
    } finally {
      client.release();
    }
  };
  return query;
}
