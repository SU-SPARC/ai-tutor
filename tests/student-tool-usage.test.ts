import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
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
  POST as recordSketchpadHeartbeatRoute,
  SKETCHPAD_HEARTBEAT_OWNER_MAX_PER_MINUTE,
} from "@/app/api/student/tools/sketchpad/heartbeat/route";
import { requireStudent } from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import {
  createStudentToolUsageRepository,
  setStudentToolUsageRepositoryForTests,
  sketchpadActivityBucketStart,
} from "@/lib/data/student-tool-usage-repository";
import { resetRateLimitsForTests } from "@/lib/rate-limit";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const SECOND_STUDENT = {
  ...TEST_STUDENT,
  email: "second-student@example.invalid",
  userId: "user:test-student-two",
};
const databases: PGlite[] = [];

afterEach(() => {
  resetAuthMocks();
  resetRateLimitsForTests();
  setStudentToolUsageRepositoryForTests(undefined);
});

afterAll(async () => {
  while (databases.length > 0) await databases.pop()?.close();
});

describe("student tool usage persistence", () => {
  let database: PGlite;
  let repository: ReturnType<typeof createStudentToolUsageRepository>;
  let questionVersionId: number;

  beforeAll(async () => {
    database = await migratedDatabase();
    questionVersionId = await seed(database);
    repository = createStudentToolUsageRepository(pgliteQuery(database));
  }, 60_000);

  it("records one AI Help request when an authenticated POST is retried", async () => {
    mockPrincipal(TEST_STUDENT);
    const authorization = await requireStudent();
    const context = {
      eventId: "ai-help-event-1",
      questionId: "usage-question",
      questionVersionId,
      sessionId: "usage-session",
      topicId: "usage-topic",
    };

    await expect(
      repository.recordAiHelpRequest(authorization, context),
    ).resolves.toBe("recorded");
    await expect(
      repository.recordAiHelpRequest(authorization, context),
    ).resolves.toBe("duplicate");

    const result = await database.query<{ count: number }>(
      `select count(*)::int as count from student_usage_events
       where user_id = $1 and event_type = 'ai_help_click'`,
      [TEST_STUDENT.userId],
    );
    expect(result.rows).toEqual([{ count: 1 }]);
  });

  it("allows the same event id once for each student", async () => {
    const context = {
      eventId: "shared-event-id",
      questionId: "usage-question",
      questionVersionId,
      sessionId: "usage-session",
      topicId: "usage-topic",
    };
    mockPrincipal(TEST_STUDENT);
    await repository.recordAiHelpRequest(await requireStudent(), context);
    mockPrincipal(SECOND_STUDENT);
    await repository.recordAiHelpRequest(await requireStudent(), {
      ...context,
      sessionId: "usage-session-two",
    });

    const result = await database.query<{ count: number }>(
      `select count(*)::int as count from student_usage_events
       where idempotency_key = 'shared-event-id'`,
    );
    expect(result.rows).toEqual([{ count: 2 }]);
  });

  it("deduplicates concurrent tabs and never derives duration from heartbeat gaps", async () => {
    mockPrincipal(TEST_STUDENT);
    const authorization = await requireStudent();

    await expect(
      repository.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T12:00:01Z"),
      ),
    ).resolves.toBe("recorded");
    await expect(
      repository.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T12:00:14Z"),
      ),
    ).resolves.toBe("duplicate");
    await expect(
      repository.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T12:00:16Z"),
      ),
    ).resolves.toBe("recorded");
    await expect(
      repository.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T20:00:01Z"),
      ),
    ).resolves.toBe("recorded");

    const result = await database.query<{ buckets: number; seconds: number }>(
      `select count(*)::int as buckets,
              coalesce(sum(credited_seconds), 0)::int as seconds
       from student_tool_active_buckets where user_id = $1`,
      [TEST_STUDENT.userId],
    );
    expect(result.rows).toEqual([{ buckets: 3, seconds: 45 }]);
  });

  it("never records usage for a professor, even through the student helper", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const authorization = await requireStudent();

    await expect(
      repository.recordSketchpadHeartbeat(
        authorization,
        new Date("2026-09-27T13:00:01Z"),
      ),
    ).resolves.toBe("ineligible");
    await expect(
      repository.recordAiHelpRequest(authorization, {
        eventId: "professor-ai-help",
        questionId: "usage-question",
        questionVersionId,
        sessionId: "usage-session",
        topicId: "usage-topic",
      }),
    ).resolves.toBe("ineligible");

    const result = await database.query<{ buckets: number; events: number }>(
      `select
         (select count(*) from student_tool_active_buckets where user_id = $1)::int as buckets,
         (select count(*) from student_usage_events where user_id = $1)::int as events`,
      [TEST_PROFESSOR.userId],
    );
    expect(result.rows).toEqual([{ buckets: 0, events: 0 }]);
  });

  it("keeps duration fixed in the database and aligns UTC buckets", async () => {
    await expect(
      database.query(
        `insert into student_tool_active_buckets (
           user_id, tool, bucket_started_at, credited_seconds
         ) values ($1, 'sketchpad', '2026-09-27T21:00:00Z', 50000)`,
        [TEST_STUDENT.userId],
      ),
    ).rejects.toThrow();
    expect(
      sketchpadActivityBucketStart(
        new Date("2026-09-27T12:34:29.999Z"),
      ).toISOString(),
    ).toBe("2026-09-27T12:34:15.000Z");
  });
});

describe("Sketchpad heartbeat API", () => {
  function usageRepository() {
    return {
      recordAiHelpRequest: vi.fn(async (authorization: unknown) => {
        void authorization;
        return "recorded" as const;
      }),
      recordSketchpadHeartbeat: vi.fn(async (authorization: unknown) => {
        void authorization;
        return "recorded" as const;
      }),
    };
  }

  it("accepts normal frequency and derives ownership from authentication", async () => {
    const repository = usageRepository();
    setStudentToolUsageRepositoryForTests(repository);
    mockPrincipal(TEST_STUDENT);

    expect((await recordSketchpadHeartbeatRoute(heartbeatRequest("{}"))).status).toBe(204);
    expect((await recordSketchpadHeartbeatRoute(heartbeatRequest(""))).status).toBe(204);
    expect(repository.recordSketchpadHeartbeat).toHaveBeenCalledTimes(2);
    expect(repository.recordSketchpadHeartbeat.mock.calls[0]?.[0]).toMatchObject({
      owner: { kind: "user", userId: TEST_STUDENT.userId },
      permission: "student",
    });
  });

  it("returns 429 before persistence after excessive requests", async () => {
    const repository = usageRepository();
    setStudentToolUsageRepositoryForTests(repository);
    mockPrincipal(TEST_STUDENT);

    for (let index = 0; index < SKETCHPAD_HEARTBEAT_OWNER_MAX_PER_MINUTE; index += 1) {
      expect((await recordSketchpadHeartbeatRoute(heartbeatRequest(""))).status).toBe(204);
    }
    const response = await recordSketchpadHeartbeatRoute(heartbeatRequest(""));

    expect(response.status).toBe(429);
    expect(repository.recordSketchpadHeartbeat).toHaveBeenCalledTimes(
      SKETCHPAD_HEARTBEAT_OWNER_MAX_PER_MINUTE,
    );
  });

  it("rejects professors without persisting student activity", async () => {
    const repository = usageRepository();
    setStudentToolUsageRepositoryForTests(repository);
    mockPrincipal(TEST_PROFESSOR);

    const response = await recordSketchpadHeartbeatRoute(heartbeatRequest(""));

    expect(response.status).toBe(403);
    expect(repository.recordSketchpadHeartbeat).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated, cross-origin, and client-controlled requests", async () => {
    const repository = usageRepository();
    setStudentToolUsageRepositoryForTests(repository);

    const unauthenticated = await recordSketchpadHeartbeatRoute(heartbeatRequest("{}"));
    mockPrincipal(TEST_STUDENT);
    const crossOrigin = await recordSketchpadHeartbeatRoute(
      heartbeatRequest("{}", "https://interactive-sketchpad.onrender.com"),
    );
    const forged = await recordSketchpadHeartbeatRoute(
      heartbeatRequest(JSON.stringify({ activeSeconds: 50_000, userId: "other" })),
    );

    expect(unauthenticated.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
    expect(forged.status).toBe(400);
    expect(repository.recordSketchpadHeartbeat).not.toHaveBeenCalled();
  });
});

function heartbeatRequest(body: string, origin = "http://localhost") {
  return new Request("http://localhost/api/student/tools/sketchpad/heartbeat", {
    body,
    headers: { "Content-Type": "application/json", Origin: origin },
    method: "POST",
  });
}

async function migratedDatabase() {
  const database = new PGlite();
  databases.push(database);
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory).filter((value) => value.endsWith(".sql")).sort()) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  return database;
}

function pgliteQuery(database: PGlite): DatabaseQueryExecutor {
  return async (sql, params = []) =>
    (await database.query(sql, params)).rows as Record<string, unknown>[];
}

async function seed(database: PGlite) {
  for (const principal of [TEST_PROFESSOR, TEST_STUDENT, SECOND_STUDENT]) {
    await database.query(
      `insert into users (
         id, identity_provider, external_subject, email, display_name, status
       ) values ($1, 'test', $1, $2, $3, 'active')`,
      [principal.userId, principal.email, principal.displayName],
    );
  }
  await database.query(
    "insert into user_roles (user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await database.exec(
    `insert into topics (id, title, description, sort_order, is_active)
     values ('usage-topic', 'Usage Topic', '', 901, true)`,
  );
  await database.exec("select set_config('app.current_creation_method', 'manual', false)");
  await database.query(
    `insert into questions (
       id, topic_id, title, prompt, difficulty, accepted_answers_json,
       answer_explanation, source_type, trust_level, review_status,
       visibility, originality_note, reviewed_by, reviewed_by_user_id,
       reviewed_at
     ) values ('usage-question', 'usage-topic', 'Usage question',
       'What is one half?', 'foundational', '["0.5"]'::jsonb,
       'Divide one by two.', 'original_demo', 'public_original', 'approved',
       'public', 'Original test question.', 'Test Professor', $1, now())`,
    [TEST_PROFESSOR.userId],
  );
  await database.exec(
    "insert into hints (question_id, hint_order, body) values ('usage-question', 1, 'Use the favorable ratio.')",
  );
  await database.exec(
    "insert into solution_steps (question_id, step_order, body) values ('usage-question', 1, 'Compute 1 / 2.')",
  );
  const version = (
    await database.query<{ id: number }>(
      "select working_version_id as id from questions where id = 'usage-question'",
    )
  ).rows[0].id;
  for (const [action, expectedState] of [
    ["submit", "draft"],
    ["approve", "needs_review"],
    ["publish", "approved"],
  ] as const) {
    await database.query(
      `select * from app_transition_question_version(
         target_question_id => 'usage-question', target_question_version_id => $1,
         transition_action => $2, actor_id => $3, actor_display => 'Test Professor',
         expected_state => $4, idempotency_key_value => $5)`,
      [version, action, TEST_PROFESSOR.userId, expectedState, `usage:${action}`],
    );
  }
  await database.query(
    `insert into tutor_sessions (id, user_id, question_id, question_version_id)
     values ('usage-session', $1, 'usage-question', $3),
            ('usage-session-two', $2, 'usage-question', $3)`,
    [TEST_STUDENT.userId, SECOND_STUDENT.userId, version],
  );
  return version;
}
