import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { requireProfessorReview } from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseQuestionSimilarityRepository } from "@/lib/data/question-similarity-repository";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

const databaseUrl = process.env.PG16_VERIFY_DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const prefix = `pg16-similarity-${Date.now()}`;
const professorId = `user:${prefix}-professor`;
const topicId = `${prefix}-topic`;
const originA = `${prefix}-origin-a`;
const originB = `${prefix}-origin-b`;
const reserveA = `${prefix}-reserve-a`;
const reserveB = `${prefix}-reserve-b`;

describePostgres("question similarity repository on PostgreSQL 16", () => {
  let pool: pg.Pool;
  let repository: ReturnType<typeof createDatabaseQuestionSimilarityRepository>;
  let versions: Map<string, number>;

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
    expect(migration.rows[0].count).toBe(26);
    versions = await seedPostgresContent(pool);
    repository = createDatabaseQuestionSimilarityRepository(
      postgresQueryExecutor(pool),
    );
    mockPrincipal({
      displayName: "PG16 Similarity Professor",
      email: `${prefix}@example.invalid`,
      kind: "user",
      role: "professor",
      roles: ["student", "professor"],
      userId: professorId,
    });
  }, 30_000);

  afterAll(async () => {
    resetAuthMocks();
    await pool?.end();
  });

  it("enforces direct update settings and preserves the audited repository workflow", async () => {
    const authorization = await requireProfessorReview();
    const assignment = {
      action: "assign" as const,
      expectedSimilarVersionId: versions.get(reserveA)!,
      originQuestionId: originA,
      originVersionId: versions.get(originA)!,
      similarQuestionId: reserveA,
      slot: 1 as const,
    };
    const assigned = await repository.setLink(authorization, assignment);
    const directLinkId = assigned.find((link) => !link.revokedAt)!.id;

    await expect(repository.setLink(authorization, assignment)).resolves.toEqual(
      assigned,
    );
    await expect(
      repository.setLink(authorization, {
        ...assignment,
        expectedSimilarVersionId: versions.get(reserveB)!,
        similarQuestionId: reserveB,
      }),
    ).rejects.toThrow(/different active/i);
    await expect(
      repository.setLink(authorization, {
        ...assignment,
        originQuestionId: originB,
        originVersionId: versions.get(originB)!,
      }),
    ).rejects.toThrow(/different active/i);

    const directClient = await pool.connect();
    try {
      const original = await directClient.query<Record<string, unknown>>(
        "select * from question_similarity_links where id = $1",
        [directLinkId],
      );
      const revokeDirectly = () =>
        directClient.query(
          `update question_similarity_links
           set revoked_at = now(), revoked_by_user_id = $2
           where id = $1`,
          [directLinkId, professorId],
        );
      await expect(revokeDirectly()).rejects.toThrow(
        /only be revoked through the audited workflow/i,
      );
      await directClient.query(
        "select set_config('app.similarity_link_write', 'wrong', false)",
      );
      await expect(revokeDirectly()).rejects.toThrow(
        /only be revoked through the audited workflow/i,
      );
      await directClient.query(
        "select set_config('app.similarity_link_write', 'allowed', false)",
      );
      await expect(revokeDirectly()).resolves.toBeDefined();
      const revoked = await directClient.query<Record<string, unknown>>(
        "select * from question_similarity_links where id = $1",
        [directLinkId],
      );
      expect(revoked.rows[0]).toMatchObject({
        created_at: original.rows[0].created_at,
        created_by_user_id: original.rows[0].created_by_user_id,
        origin_question_id: original.rows[0].origin_question_id,
        origin_version_id: original.rows[0].origin_version_id,
        relationship_type: original.rows[0].relationship_type,
        revoked_by_user_id: professorId,
        similar_question_id: original.rows[0].similar_question_id,
        similar_version_id: original.rows[0].similar_version_id,
        slot: original.rows[0].slot,
      });
      expect(revoked.rows[0].revoked_at).not.toBeNull();
    } finally {
      directClient.release();
    }

    const repositoryAssignment = {
      action: "assign" as const,
      expectedSimilarVersionId: versions.get(reserveB)!,
      originQuestionId: originB,
      originVersionId: versions.get(originB)!,
      similarQuestionId: reserveB,
      slot: 1 as const,
    };
    const repositoryLinks = await repository.setLink(
      authorization,
      repositoryAssignment,
    );
    const repositoryLinkId = repositoryLinks.find(
      (link) => !link.revokedAt,
    )!.id;
    await pool.query(
      `select * from app_transition_question_version(
        $1, $2, 'unpublish', $3, 'PG16 Similarity Professor', 'published',
        'content_correction', null, $4, $5, '{}'::jsonb
      )`,
      [originB, versions.get(originB), professorId, `${prefix}-unpublish`, `${prefix}-request`],
    );
    await repository.setLink(authorization, {
      action: "remove",
      expectedSimilarVersionId: versions.get(reserveB)!,
      linkId: repositoryLinkId,
      originQuestionId: originB,
      originVersionId: versions.get(originB)!,
      similarQuestionId: reserveB,
      slot: 1,
    });

    await expect(
      pool.query(
        `select revoked_at is not null as revoked, revoked_by_user_id
         from question_similarity_links where id = $1`,
        [repositoryLinkId],
      ),
    ).resolves.toMatchObject({
      rows: [{ revoked: true, revoked_by_user_id: professorId }],
    });
    await expect(
      pool.query(
        `select action from audit_events
         where entity_type = 'question_similarity_link' and entity_id = $1
         order by created_at, id`,
        [String(repositoryLinkId)],
      ),
    ).resolves.toMatchObject({
      rows: [
        { action: "question.similarity.assign" },
        { action: "question.similarity.revoke" },
      ],
    });
  });
});

async function seedPostgresContent(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into users (
         id, identity_provider, external_subject, email, display_name, status
       ) values ($1, 'test', $2, $3, 'PG16 Similarity Professor', 'active')`,
      [professorId, `${prefix}-subject`, `${prefix}@example.invalid`],
    );
    await client.query(
      "insert into user_roles (user_id, role_id) values ($1, 'professor')",
      [professorId],
    );
    await client.query(
      `insert into topics (
         id, title, description, sort_order, week_number, module_ref, is_active
       ) values ($1, 'PG16 similarity topic', '', 989, 1, $2, true)`,
      [topicId, `${prefix}-module`],
    );
    await client.query(
      "select set_config('app.current_user_id', 'system:schema-migration', true)",
    );
    await client.query(
      "select set_config('app.current_creation_method', 'imported', true)",
    );
    await client.query(
      "select set_config('app.suppress_question_version', 'true', true)",
    );
    for (const questionId of [originA, originB, reserveA, reserveB]) {
      await client.query(
        `insert into questions (
           id, topic_id, title, prompt, difficulty, accepted_answers_json,
           answer_explanation, source_type, trust_level, review_status,
           visibility, originality_note, reviewed_by, reviewed_by_user_id,
           reviewed_at
         ) values ($1, $2, $3, $4, 'foundational', '["0.5"]'::jsonb,
           'Divide one by two.', 'professor_provided', 'public_original',
           'approved', 'public', 'Original test content.',
           'PG16 Similarity Professor', $5, now())`,
        [questionId, topicId, `Title ${questionId}`, `Prompt ${questionId}`, professorId],
      );
      await client.query(
        "insert into hints (question_id, hint_order, body) values ($1, 1, 'Count outcomes.')",
        [questionId],
      );
      await client.query(
        "insert into solution_steps (question_id, step_order, body) values ($1, 1, 'Compute.')",
        [questionId],
      );
    }
    await client.query(
      "select set_config('app.suppress_question_version', 'false', true)",
    );
    for (const questionId of [originA, originB, reserveA, reserveB]) {
      await client.query("select app_record_question_version($1)", [questionId]);
    }
    const rows = await client.query<{ id: number; question_id: string }>(
      `select coalesce(published_version_id, working_version_id) as id,
              id as question_id
       from questions where id = any($1::text[])`,
      [[originA, originB, reserveA, reserveB]],
    );
    const result = new Map(
      rows.rows.map((row) => [row.question_id, Number(row.id)]),
    );
    for (const questionId of [reserveA, reserveB]) {
      await client.query(
        `select * from app_transition_question_version(
          $1, $2, 'unpublish', $3, 'PG16 Similarity Professor', 'published',
          'content_correction', null, $4, $5, '{}'::jsonb
        )`,
        [questionId, result.get(questionId), professorId, `${questionId}-unpublish`, `${questionId}-request`],
      );
    }
    await client.query(
      "select set_config('app.reserve_write', 'allowed', true)",
    );
    await client.query(
      `update questions
       set is_reserved = true,
           reserve_practice_allowed = true,
           reserve_reason_code = 'extra_practice',
           reserved_by_user_id = $2,
           reserved_at = now()
       where id = any($1::text[])`,
      [[reserveA, reserveB], professorId],
    );
    await client.query("commit");
    return result;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
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
