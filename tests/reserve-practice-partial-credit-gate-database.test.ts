import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  similarProblemOriginQualifies,
  type ValidAnswerAttemptLike,
} from "@/lib/tutor/practice-credit";

/**
 * Migration 025 widens the reserve-practice origin rule, and migration 026
 * requires an exact professor-approved relationship. Every case below is
 * run twice over identical facts: once as a real insert through the database
 * trigger, once through the application predicate the server gate uses. The
 * two must agree on every row (scenario L), and the pre-existing guards must
 * still hold.
 *
 * By default the file migrates an in-process PGlite. Set
 * PG16_VERIFY_DATABASE_URL to a disposable PostgreSQL database that the
 * migration runner has already brought to the current version, and the same
 * case table runs against the real server instead.
 */

type Db = {
  close(): Promise<void>;
  exec(sql: string): Promise<void>;
  query<Row>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }>;
};

function pgliteDb(database: PGlite): Db {
  return {
    close: () => database.close(),
    exec: (sql) => database.exec(sql).then(() => undefined),
    query: (sql, params) => database.query(sql, params as never),
  };
}

function postgresDb(client: pg.Client): Db {
  return {
    close: () => client.end(),
    exec: (sql) => client.query(sql).then(() => undefined),
    // pg types rows as QueryResultRow; the caller names the row shape.
    query: async (sql, params) => {
      const result = await client.query(sql, params as never);
      return { rows: result.rows as never[] };
    },
  };
}

type Verdict = "correct" | "incorrect" | "guidance" | "blocked";
type Interaction = {
  mode: "check" | "hint" | "full_solution";
  verdict: Verdict;
};

type GateCase = {
  allowed: boolean;
  name: string;
  origin: {
    revealedSteps: number;
    solved: boolean;
    interactions: Interaction[];
  };
  /** Extra published sessions for the same student, e.g. before Start over. */
  otherSessions?: Array<{ interactions: Interaction[]; questionId?: string }>;
};

const ORIGIN_STEP_COUNT = 2;

const incorrect = (n: number): Interaction[] =>
  Array.from({ length: n }, () => ({ mode: "check", verdict: "incorrect" }));

const CASES: GateCase[] = [
  {
    allowed: true,
    name: "K: a solved origin qualifies as before",
    origin: {
      interactions: [{ mode: "check", verdict: "correct" }],
      revealedSteps: 0,
      solved: true,
    },
  },
  {
    allowed: true,
    name: "E: three valid attempts and the fully revealed solution",
    origin: {
      interactions: [
        ...incorrect(3),
        { mode: "full_solution", verdict: "guidance" },
      ],
      revealedSteps: ORIGIN_STEP_COUNT,
      solved: false,
    },
  },
  {
    allowed: false,
    name: "D: three valid attempts but the solution is not revealed",
    origin: { interactions: incorrect(3), revealedSteps: 0, solved: false },
  },
  {
    allowed: false,
    name: "D': three valid attempts but only part of the solution revealed",
    origin: {
      interactions: incorrect(3),
      revealedSteps: ORIGIN_STEP_COUNT - 1,
      solved: false,
    },
  },
  {
    allowed: false,
    name: "F: two valid attempts plus unreadable submissions and the solution",
    origin: {
      interactions: [
        { mode: "check", verdict: "incorrect" },
        { mode: "check", verdict: "guidance" },
        { mode: "check", verdict: "incorrect" },
        { mode: "check", verdict: "guidance" },
        { mode: "full_solution", verdict: "guidance" },
      ],
      revealedSteps: ORIGIN_STEP_COUNT,
      solved: false,
    },
  },
  {
    allowed: false,
    name: "AI help, hints and blocked replies are not valid attempts",
    origin: {
      interactions: [
        { mode: "check", verdict: "guidance" },
        { mode: "check", verdict: "guidance" },
        { mode: "check", verdict: "blocked" },
        { mode: "hint", verdict: "guidance" },
        { mode: "full_solution", verdict: "guidance" },
      ],
      revealedSteps: ORIGIN_STEP_COUNT,
      solved: false,
    },
  },
  {
    allowed: true,
    name: "J: attempts made before Start over still count",
    origin: {
      interactions: [{ mode: "full_solution", verdict: "guidance" }],
      revealedSteps: ORIGIN_STEP_COUNT,
      solved: false,
    },
    otherSessions: [{ interactions: incorrect(3) }],
  },
  {
    allowed: false,
    name: "attempts on a different question do not count",
    origin: {
      interactions: [{ mode: "full_solution", verdict: "guidance" }],
      revealedSteps: ORIGIN_STEP_COUNT,
      solved: false,
    },
    otherSessions: [
      { interactions: incorrect(3), questionId: "gate-other-question" },
    ],
  },
];

const databases: Db[] = [];

afterAll(async () => {
  while (databases.length > 0) {
    await databases.pop()?.close();
  }
});

describe("reserve-practice origin gate: trigger (migration 025) and application predicate", () => {
  let database: Db;
  let originVersionId: number;
  let reserveVersionId: number;
  let caseIndex = 0;

  beforeAll(async () => {
    database = await openDatabase();
    ({ originVersionId, reserveVersionId } = await seedContent(database));
  }, 60_000);

  for (const gateCase of CASES) {
    it(gateCase.name, async () => {
      const student = `anon:gate-${++caseIndex}`;
      const originId = `gate-origin-${caseIndex}`;
      await seedPublishedSession(database, {
        interactions: gateCase.origin.interactions,
        questionId: "gate-origin-question",
        questionVersionId: originVersionId,
        revealedSteps: gateCase.origin.revealedSteps,
        sessionId: originId,
        solved: gateCase.origin.solved,
        student,
      });
      const otherSessions = gateCase.otherSessions ?? [];
      for (const [index, other] of otherSessions.entries()) {
        await seedPublishedSession(database, {
          interactions: other.interactions,
          questionId: other.questionId ?? "gate-origin-question",
          questionVersionId:
            other.questionId === "gate-other-question"
              ? await versionOf(database, "gate-other-question")
              : originVersionId,
          revealedSteps: 0,
          sessionId: `${originId}-other-${index}`,
          solved: false,
          student,
        });
      }

      // Application side: the same facts the server gate reads.
      const predicate = similarProblemOriginQualifies({
        origin: {
          practiceContext: "published",
          questionId: "gate-origin-question",
          revealedSteps: gateCase.origin.revealedSteps,
          solved: gateCase.origin.solved,
          status: gateCase.origin.solved ? "completed" : "active",
        },
        stepCount: ORIGIN_STEP_COUNT,
        studentSessions: [
          {
            attempts: gateCase.origin.interactions as ValidAnswerAttemptLike[],
            practiceContext: "published",
            questionId: "gate-origin-question",
          },
          ...otherSessions.map((other) => ({
            attempts: other.interactions as ValidAnswerAttemptLike[],
            practiceContext: "published" as const,
            questionId: other.questionId ?? "gate-origin-question",
          })),
        ],
      });

      // Database side: a real reserve_practice insert through the trigger.
      const insert = database.query(
        `insert into tutor_sessions (
           id, anonymous_user_id, question_id, question_version_id,
           practice_context, origin_session_id, expires_at
         ) values ($1, $2, 'gate-reserve-question', $3, 'reserve_practice', $4,
           now() + interval '30 days')`,
        [`gate-reserve-${caseIndex}`, student, reserveVersionId, originId],
      );

      expect(predicate).toBe(gateCase.allowed);
      if (gateCase.allowed) {
        await expect(insert).resolves.toBeDefined();
      } else {
        await expect(insert).rejects.toThrow(
          /solved origin session, or three valid answer attempts/,
        );
      }
    });
  }

  it("keeps the 023 protections: another student's origin, the same question, and a published origin link are still rejected", async () => {
    const student = `anon:gate-guard-${++caseIndex}`;
    const originId = `gate-origin-${caseIndex}`;
    await seedPublishedSession(database, {
      interactions: incorrect(3),
      questionId: "gate-origin-question",
      questionVersionId: originVersionId,
      revealedSteps: ORIGIN_STEP_COUNT,
      sessionId: originId,
      solved: false,
      student,
    });

    // Cross-student: a different owner cannot use this qualifying origin.
    await expect(
      database.query(
        `insert into tutor_sessions (
           id, anonymous_user_id, question_id, question_version_id,
           practice_context, origin_session_id, expires_at
         ) values ($1, 'anon:someone-else', 'gate-reserve-question', $2,
           'reserve_practice', $3, now() + interval '30 days')`,
        [`gate-reserve-${caseIndex}-other-owner`, reserveVersionId, originId],
      ),
    ).rejects.toThrow(/owned published origin session/);

    // Same question as the origin is never a similar problem.
    await expect(
      database.query(
        `insert into tutor_sessions (
           id, anonymous_user_id, question_id, question_version_id,
           practice_context, origin_session_id, expires_at
         ) values ($1, $2, 'gate-origin-question', $3,
           'reserve_practice', $4, now() + interval '30 days')`,
        [
          `gate-reserve-${caseIndex}-same-question`,
          student,
          originVersionId,
          originId,
        ],
      ),
    ).rejects.toThrow(/owned published origin session/);

    // A published session can never carry an origin.
    await expect(
      database.query(
        `insert into tutor_sessions (
           id, anonymous_user_id, question_id, question_version_id,
           practice_context, origin_session_id, expires_at
         ) values ($1, $2, 'gate-reserve-question', $3,
           'published', $4, now() + interval '30 days')`,
        [`gate-published-${caseIndex}`, student, reserveVersionId, originId],
      ),
    ).rejects.toThrow(/cannot have a similar-practice origin|practice_context/);
  });
});

async function openDatabase(): Promise<Db> {
  const realDatabaseUrl = process.env.PG16_VERIFY_DATABASE_URL;
  if (realDatabaseUrl) {
    const client = new pg.Client({ connectionString: realDatabaseUrl });
    await client.connect();
    const database = postgresDb(client);
    databases.push(database);
    // The runner has already applied the chain; prove it before trusting it.
    const ledger = await database.query<{ version: number | string }>(
      "select max(version) as version from schema_migrations",
    );
    expect(Number(ledger.rows[0]?.version)).toBeGreaterThanOrEqual(26);
    return database;
  }
  const database = pgliteDb(new PGlite());
  databases.push(database);
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  return database;
}

async function versionOf(database: Db, questionId: string) {
  const result = await database.query<{ id: number }>(
    `select coalesce(published_version_id, working_version_id) as id
     from questions where id = $1`,
    [questionId],
  );
  return Number(result.rows[0].id);
}

/**
 * One topic, a published origin question with two solution steps, a second
 * published question, and an eligible Reserve question: the same shape the
 * claim tests use, so the trigger's other guards are exercised for real.
 */
async function seedContent(database: Db) {
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values (
      'user:gate-professor', 'test', 'gate-professor',
      'gate-professor@example.invalid', 'Gate Professor', 'active'
    );
    insert into user_roles (user_id, role_id)
      values ('user:gate-professor', 'professor');
    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values ('gate-topic', 'Gate topic', '', 988, 1, 'gate-module', true);

    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'imported', false);
    select set_config('app.suppress_question_version', 'true', false);

    insert into questions (
      id, topic_id, title, prompt, difficulty,
      accepted_answers_json, answer_explanation,
      source_type, trust_level, review_status, visibility,
      originality_note, reviewed_by, reviewed_by_user_id, reviewed_at
    ) values
      ('gate-origin-question', 'gate-topic', 'Gate origin',
       'What is one divided by two?', 'foundational', '["0.5"]'::jsonb,
       'Divide one by two.', 'professor_provided', 'public_original',
       'approved', 'public', 'Original gate origin.',
       'Gate Professor', 'user:gate-professor', now()),
      ('gate-other-question', 'gate-topic', 'Gate other',
       'What is one divided by five?', 'foundational', '["0.2"]'::jsonb,
       'Divide one by five.', 'professor_provided', 'public_original',
       'approved', 'public', 'Original gate other.',
       'Gate Professor', 'user:gate-professor', now()),
      ('gate-reserve-question', 'gate-topic', 'Gate Reserve',
       'What is one divided by four?', 'foundational', '["0.25"]'::jsonb,
       'Divide one by four.', 'professor_provided', 'public_original',
       'approved', 'public', 'Original gate Reserve question.',
       'Gate Professor', 'user:gate-professor', now());

    insert into hints (question_id, hint_order, body) values
      ('gate-origin-question', 1, 'Divide the numerator by the denominator.'),
      ('gate-other-question', 1, 'Divide the numerator by the denominator.'),
      ('gate-reserve-question', 1, 'Divide the numerator by the denominator.');
    insert into solution_steps (question_id, step_order, body) values
      ('gate-origin-question', 1, 'Write the fraction.'),
      ('gate-origin-question', 2, 'Compute 1 / 2 = 0.5.'),
      ('gate-other-question', 1, 'Compute 1 / 5 = 0.2.'),
      ('gate-reserve-question', 1, 'Compute 1 / 4 = 0.25.');

    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version('gate-origin-question');
    select app_record_question_version('gate-other-question');
    select app_record_question_version('gate-reserve-question');
  `);
  const reserveVersionId = await versionOf(database, "gate-reserve-question");
  await database.query(
    `select * from app_transition_question_version(
      $1, $2, 'unpublish', $3, $4, 'published', 'content_correction',
      null, 'gate-unpublish', 'gate-request', '{}'::jsonb
    )`,
    [
      "gate-reserve-question",
      reserveVersionId,
      "user:gate-professor",
      "Gate Professor",
    ],
  );
  await database.exec(
    "select set_config('app.reserve_write', 'allowed', false)",
  );
  await database.query(
    `update questions
     set is_reserved = true,
         reserve_practice_allowed = true,
         reserve_reason_code = 'extra_practice',
         reserved_by_user_id = 'user:gate-professor',
         reserved_at = now(),
         updated_at = now()
     where id = 'gate-reserve-question'`,
  );
  const originVersionId = await versionOf(database, "gate-origin-question");
  await database.query(
    `insert into question_similarity_links (
       origin_question_id, similar_question_id, origin_version_id,
       similar_version_id, relationship_type, slot, created_by_user_id
     ) values ($1, 'gate-reserve-question', $2, $3,
       'similar_practice', 1, 'user:gate-professor')`,
    ["gate-origin-question", originVersionId, reserveVersionId],
  );
  const stepCount = await database.query<{ steps: number }>(
    `select jsonb_array_length(snapshot_json -> 'solutionSteps')::int as steps
     from question_versions where id = $1`,
    [originVersionId],
  );
  expect(Number(stepCount.rows[0].steps)).toBe(ORIGIN_STEP_COUNT);
  return { originVersionId, reserveVersionId };
}

async function seedPublishedSession(
  database: Db,
  input: {
    interactions: Interaction[];
    questionId: string;
    questionVersionId: number;
    revealedSteps: number;
    sessionId: string;
    solved: boolean;
    student: string;
  },
) {
  await database.query(
    `insert into tutor_sessions (
       id, anonymous_user_id, question_id, question_version_id,
       revealed_hints, revealed_steps, solved, status, current_state,
       completed_at, expires_at
     ) values ($1, $2, $3, $4, 3, $5, $6, $7, $8,
       case when $6 then now() end, now() + interval '30 days')`,
    [
      input.sessionId,
      input.student,
      input.questionId,
      input.questionVersionId,
      input.revealedSteps,
      input.solved,
      input.solved ? "completed" : "active",
      input.solved ? "solved" : "working",
    ],
  );
  for (const [index, interaction] of input.interactions.entries()) {
    await database.query(
      `insert into attempts (
         session_id, question_id, topic_id, question_version_id, mode, source,
         verdict, created_at
       ) values ($1, $2, 'gate-topic', $3, $4, 'rule', $5, $6)`,
      [
        input.sessionId,
        input.questionId,
        input.questionVersionId,
        interaction.mode,
        interaction.verdict,
        new Date(Date.UTC(2026, 8, 16, 9, index)).toISOString(),
      ],
    );
  }
}
