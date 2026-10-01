import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";

/**
 * Migration 030: a topic's available_until closes the week without hiding
 * it. The topic stays listed (with `closesAt`) and its published questions,
 * Reserve practice and retrieval chunks stay available; topic available_from
 * and a question's own available_until still hide.
 */

const VIEWS = [
  "app_public_questions",
  "app_student_retrieval_chunks",
  "app_reserve_practice_questions",
] as const;

let database: PGlite;

beforeAll(async () => {
  database = new PGlite();
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  await seed(database);
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.exec(`
    delete from question_student_availability;
    delete from topic_student_availability;
  `);
});

describe("migration 030: topic windows close without hiding", () => {
  it("keeps a closed week's questions, Reserve practice and chunks visible and lists it with closesAt", async () => {
    await setTopicWindow(
      "now() - interval '2 days'",
      "now() - interval '1 day'",
    );

    await expect(visibleCounts()).resolves.toEqual({
      chunks: 1,
      public: 1,
      reserve: 1,
    });

    const repository = createDatabaseContentRepository(
      "postgres://unused.example/db",
      pgliteQuery(database),
    );
    const topic = (await repository.listTopics()).find(
      (item) => item.id === "close-topic",
    );
    const until = await database.query<{ available_until: Date }>(
      "select available_until from topic_student_availability where topic_id = 'close-topic'",
    );
    expect(topic).toBeDefined();
    expect(topic?.closesAt).toBe(until.rows[0].available_until.toISOString());
    expect(Date.parse(topic?.closesAt ?? "")).toBeLessThan(Date.now());
  });

  it("omits closesAt for a topic without an end date", async () => {
    const repository = createDatabaseContentRepository(
      "postgres://unused.example/db",
      pgliteQuery(database),
    );
    const topic = (await repository.listTopics()).find(
      (item) => item.id === "close-topic",
    );
    expect(topic).toBeDefined();
    expect(topic).not.toHaveProperty("closesAt");
  });

  it("still hides a topic whose available_from is in the future", async () => {
    await setTopicWindow(
      "now() + interval '1 day'",
      "now() + interval '2 days'",
    );

    await expect(visibleCounts()).resolves.toEqual({
      chunks: 0,
      public: 0,
      reserve: 0,
    });
    const repository = createDatabaseContentRepository(
      "postgres://unused.example/db",
      pgliteQuery(database),
    );
    expect(
      (await repository.listTopics()).map((topic) => topic.id),
    ).not.toContain("close-topic");
  });

  it("still hides an unpublished topic", async () => {
    await database.exec(`
      insert into topic_student_availability (
        topic_id, release_state, updated_by_user_id
      ) values ('close-topic', 'unpublished', 'user:close-professor');
    `);
    await expect(visibleCounts()).resolves.toEqual({
      chunks: 0,
      public: 0,
      reserve: 0,
    });
  });

  it("still hides a question whose own available_until has passed", async () => {
    await database.exec(`
      insert into question_student_availability (
        question_id, release_state, available_from, available_until,
        updated_by_user_id
      ) values
        ('close-origin-question', 'published', now() - interval '2 days',
         now() - interval '1 day', 'user:close-professor'),
        ('close-reserve-question', 'published', now() - interval '2 days',
         now() - interval '1 day', 'user:close-professor');
    `);
    await expect(visibleCounts()).resolves.toEqual({
      chunks: 0,
      public: 0,
      reserve: 0,
    });
  });

  it("keeps figure_json, security_invoker, and drops only the topic end-date predicate", async () => {
    for (const view of [
      "app_public_questions",
      "app_reserve_practice_questions",
    ]) {
      const columns = await database.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_name = $1 order by ordinal_position`,
        [view],
      );
      const names = columns.rows.map((row) => row.column_name);
      expect(names).toContain("figure_json");
      expect(names).toContain("answer_spec_json");
      expect(names.at(-1)).toBe("figure_json");
    }

    for (const view of VIEWS) {
      const options = await database.query<{ reloptions: string[] | null }>(
        "select reloptions from pg_class where relname = $1",
        [view],
      );
      expect(options.rows[0].reloptions).toContain("security_invoker=true");

      const definition = await database.query<{ definition: string }>(
        "select pg_get_viewdef($1::regclass, true) as definition",
        [view],
      );
      const text = definition.rows[0].definition;
      expect(text).not.toMatch(/tsa\.available_until/i);
      expect(text).toMatch(/tsa\.available_from/i);
      expect(text).toMatch(/qsa\.available_until/i);
    }
  });
});

async function setTopicWindow(fromSql: string, untilSql: string) {
  await database.exec(`
    insert into topic_student_availability (
      topic_id, release_state, available_from, available_until,
      updated_by_user_id
    ) values (
      'close-topic', 'published', ${fromSql}, ${untilSql},
      'user:close-professor'
    );
  `);
}

async function visibleCounts() {
  const result = await database.query<{
    chunks: number;
    public: number;
    reserve: number;
  }>(`
    select
      (select count(*)::int from app_public_questions
        where id = 'close-origin-question') as public,
      (select count(*)::int from app_reserve_practice_questions
        where id = 'close-reserve-question') as reserve,
      (select count(*)::int from app_student_retrieval_chunks
        where id = 'close-origin-chunk') as chunks
  `);
  return result.rows[0];
}

async function seed(db: PGlite) {
  await db.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values (
      'user:close-professor', 'test', 'close-professor',
      'close-professor@example.invalid', 'Close Professor', 'active'
    );
    insert into user_roles (user_id, role_id)
      values ('user:close-professor', 'professor');

    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values (
      'close-topic', 'Close topic', '', 986, 1, 'close-module', true
    );

    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'imported', false);
    select set_config('app.suppress_question_version', 'true', false);

    insert into questions (
      id, topic_id, title, prompt, difficulty,
      accepted_answers_json, answer_explanation,
      source_type, trust_level, review_status, visibility,
      originality_note, reviewed_by, reviewed_by_user_id, reviewed_at
    ) values
      (
        'close-origin-question', 'close-topic', 'Close origin',
        'What is one divided by two?', 'foundational', '["0.5"]'::jsonb,
        'Divide one by two.', 'professor_provided', 'public_original',
        'approved', 'public', 'Original public-safe close origin.',
        'Close Professor', 'user:close-professor', now()
      ),
      (
        'close-reserve-question', 'close-topic', 'Close Reserve',
        'What is one divided by four?', 'foundational', '["0.25"]'::jsonb,
        'Divide one by four.', 'professor_provided', 'public_original',
        'approved', 'public', 'Original public-safe close Reserve question.',
        'Close Professor', 'user:close-professor', now()
      );

    insert into hints (question_id, hint_order, body) values
      ('close-origin-question', 1, 'Divide the numerator by the denominator.'),
      ('close-reserve-question', 1, 'Divide the numerator by the denominator.');
    insert into solution_steps (question_id, step_order, body) values
      ('close-origin-question', 1, 'Compute 1 / 2 = 0.5.'),
      ('close-reserve-question', 1, 'Compute 1 / 4 = 0.25.');

    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version('close-origin-question');
    select app_record_question_version('close-reserve-question');
  `);
  const version = await db.query<{ published_version_id: number }>(
    "select published_version_id from questions where id = 'close-reserve-question'",
  );
  await db.query(
    `select * from app_transition_question_version(
      $1, $2, 'unpublish', $3, $4, 'published', 'content_correction',
      null, 'close-unpublish', 'close-request', '{}'::jsonb
    )`,
    [
      "close-reserve-question",
      Number(version.rows[0].published_version_id),
      "user:close-professor",
      "Close Professor",
    ],
  );
  await db.exec("select set_config('app.reserve_write', 'allowed', false)");
  await db.query(
    `update questions
     set is_reserved = true,
         reserve_practice_allowed = true,
         reserve_reason_code = 'extra_practice',
         reserved_by_user_id = 'user:close-professor',
         reserved_at = now(),
         updated_at = now()
     where id = 'close-reserve-question'`,
  );
  await db.query(
    `insert into retrieval_chunks (
       id, topic_id, question_id, question_version_id, chunk_type, title,
       body, source_type, trust_level, review_status, visibility,
       priority_tier
     ) select
       'close-origin-chunk', q.topic_id, q.id, q.published_version_id,
       'question', 'Close test chunk', 'Public-safe test retrieval text.',
       'original_demo', 'public_original', 'approved', 'public', 'safe_demo'
     from questions q
     where q.id = 'close-origin-question'`,
  );
  await db.exec(
    "select set_config('app.current_user_id', 'user:close-professor', false)",
  );
}

function pgliteQuery(db: PGlite): DatabaseQueryExecutor {
  return async (sql, params = []) => {
    const result = await db.query<Record<string, unknown>>(sql, params);
    return result.rows;
  };
}
