import { readFile } from "node:fs/promises";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { requireProfessorReview } from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { classifyPostgresError } from "@/lib/data/postgres";
import { createDatabaseQuestionLifecycleRepository } from "@/lib/data/question-lifecycle-repository";
import { QuestionLifecycleStorageError } from "@/lib/tutor/question-lifecycle";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";

const PROFESSOR_ID = "user:runtime-publish-professor";
const QUESTION_IDS = [
  "runtime-publish-single",
  "runtime-publish-batch-a",
  "runtime-publish-batch-b",
  "runtime-publish-denied",
] as const;
const ASSERT_FUNCTION =
  "app_assert_question_publication_quality(text, bigint, text)";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  resetAuthMocks();
});

/**
 * Publishing runs as the least-privilege `app_runtime` role in Production,
 * where every driver error is classified before the lifecycle code sees it.
 * These tests execute the real transitions under that role with the same
 * classification, so a missing grant or a lost database message shows up
 * here instead of as a generic failure in front of the professor.
 */
describe("publishing under the runtime role", () => {
  it("publishes single and batch approvals as app_runtime with the provisioned grants", async () => {
    const { database, repository } = await runtimeRoleDatabase();
    const authorization = await professorAuthorization();
    const versions = await workingVersions(database);

    await database.exec("set role app_runtime");
    const single = await repository.transition(authorization, {
      action: "publish",
      expectedState: "approved",
      idempotencyKey: "runtime-publish-single-1",
      questionId: "runtime-publish-single",
      versionId: versions.get("runtime-publish-single")!,
    });
    expect(single.workingVersion.state).toBe("published");
    expect(single.publishedVersion?.versionId).toBe(
      versions.get("runtime-publish-single"),
    );

    const batch = await repository.batchTransition(authorization, {
      action: "publish",
      idempotencyKey: "runtime-publish-batch-1",
      items: batchItems(versions, [
        "runtime-publish-batch-a",
        "runtime-publish-batch-b",
      ]),
      requestId: "runtime-publish-batch-request-1",
    });
    expect(batch).toMatchObject({ applied: true, failures: [] });
    await database.exec("reset role");

    expect(await publicationState(database)).toEqual({
      publicCount: 3,
      publishEvents: 3,
    });
  });

  it("explains a missing runtime permission, changes nothing, and lets a retry succeed once the grant is restored", async () => {
    const { database, repository } = await runtimeRoleDatabase();
    const authorization = await professorAuthorization();
    const versions = await workingVersions(database);

    // Reproduce the 2026-09-22 Production incident: the publication trigger
    // calls the assertion as the invoking role, which lacks EXECUTE on it.
    await database.exec(
      `revoke execute on function ${ASSERT_FUNCTION} from app_runtime`,
    );
    await database.exec("set role app_runtime");

    const denied = repository.transition(authorization, {
      action: "publish",
      expectedState: "approved",
      idempotencyKey: "runtime-publish-denied-1",
      questionId: "runtime-publish-denied",
      versionId: versions.get("runtime-publish-denied")!,
    });
    await expect(denied).rejects.toBeInstanceOf(QuestionLifecycleStorageError);
    await expect(denied).rejects.toMatchObject({
      message: expect.stringMatching(
        /database permission problem, not by this question[\s\S]*Nothing was changed[\s\S]*site operator/,
      ),
      sqlState: "42501",
    });

    const batchItemsToPublish = batchItems(versions, [
      "runtime-publish-batch-a",
      "runtime-publish-batch-b",
    ]);
    const deniedBatch = repository.batchTransition(authorization, {
      action: "publish",
      idempotencyKey: "runtime-publish-batch-retry",
      items: batchItemsToPublish,
      requestId: "runtime-publish-batch-request-2",
    });
    await expect(deniedBatch).rejects.toMatchObject({
      name: "QuestionLifecycleStorageError",
      sqlState: "42501",
    });
    await database.exec("reset role");
    expect(await publicationState(database)).toEqual({
      publicCount: 0,
      publishEvents: 0,
    });

    // Restoring the grant (what db/roles/app_runtime.sql now does) lets the
    // same batch, with the same idempotency key, publish exactly once.
    await database.exec(
      `grant execute on function ${ASSERT_FUNCTION} to app_runtime`,
    );
    await database.exec("set role app_runtime");
    const retried = await repository.batchTransition(authorization, {
      action: "publish",
      idempotencyKey: "runtime-publish-batch-retry",
      items: batchItemsToPublish,
      requestId: "runtime-publish-batch-request-3",
    });
    expect(retried).toMatchObject({ applied: true, idempotent: false });
    const replay = await repository.batchTransition(authorization, {
      action: "publish",
      idempotencyKey: "runtime-publish-batch-retry",
      items: batchItemsToPublish,
      requestId: "runtime-publish-batch-request-4",
    });
    expect(replay).toMatchObject({ applied: true, idempotent: true });
    await database.exec("reset role");
    expect(await publicationState(database)).toEqual({
      publicCount: 2,
      publishEvents: 2,
    });
  });

  it("keeps database-raised lifecycle messages when they are classified inside a transaction", async () => {
    const { database, repository } = await runtimeRoleDatabase();
    const authorization = await professorAuthorization();
    const versions = await workingVersions(database);

    await database.exec("set role app_runtime");
    // The application-side checks pass (the version really is approved), so
    // the database itself rejects the stale expected state with its own
    // `raise exception`. The professor must see that wording, not the generic
    // "could not be completed" text the transaction wrapper substitutes.
    const stale = repository.transition(authorization, {
      action: "publish",
      expectedState: "needs_review",
      idempotencyKey: "runtime-publish-stale-1",
      questionId: "runtime-publish-single",
      versionId: versions.get("runtime-publish-single")!,
    });
    await expect(stale).rejects.toMatchObject({
      message: expect.stringMatching(
        /Stale question lifecycle state: expected needs_review, found approved/,
      ),
      name: "QuestionLifecycleConflictError",
    });
    await database.exec("reset role");
    expect(await publicationState(database)).toEqual({
      publicCount: 0,
      publishEvents: 0,
    });
  });
});

async function runtimeRoleDatabase() {
  const database = new PGlite();
  databases.push(database);
  const client = {
    async exec(sql: string) {
      return database.exec(sql);
    },
    async query(sql: string, params?: unknown[]) {
      return database.query<Record<string, unknown>>(sql, params);
    },
  };
  await runPendingMigrations({
    actor: "runtime-publish-test",
    allowDestructive: true,
    changeTicket: "TEST-RUNTIME-PUBLISH",
    client,
    deploymentSha: "d".repeat(40),
    destructiveApprovedBy: "independent-runtime-publish-approver",
    migrations: await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    ),
    target: "test",
  });
  await database.exec(
    await readFile(
      path.resolve(process.cwd(), "db/roles/app_runtime.sql"),
      "utf8",
    ),
  );
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values (
      '${PROFESSOR_ID}', 'test', 'runtime-publish-professor',
      'runtime-publish@example.invalid', 'Runtime Publish Professor', 'active'
    );
    insert into user_roles (user_id, role_id) values ('${PROFESSOR_ID}', 'professor');
    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values (
      'runtime-publish-topic', 'Runtime publish topic', '', 998, 1,
      'runtime-publish-module', true
    );
    select set_config('app.current_user_id', '${PROFESSOR_ID}', false);
    select set_config('app.current_creation_method', 'manual', false);
    select set_config('app.suppress_question_version', 'true', false);
    insert into questions (
      id, topic_id, title, prompt, difficulty, accepted_answers_json,
      numeric_value, tolerance, answer_explanation, source_type, trust_level,
      review_status, visibility, originality_note, reviewed_by,
      reviewed_by_user_id
    )
    select
      id, 'runtime-publish-topic', 'Runtime publish ' || id,
      'What is one divided by four for ' || id || '?', 'foundational',
      '["0.25", "1/4"]'::jsonb, 0.25, 0.001,
      'Divide one favorable outcome by four equally likely outcomes.',
      'professor_provided', 'public_original', 'needs_review', 'public',
      'Original runtime publish fixture.', 'Runtime Publish Professor',
      '${PROFESSOR_ID}'
    from unnest(array['${QUESTION_IDS.join("','")}']) as id;
    insert into hints (question_id, hint_order, body)
    select id, 1, 'Count the favorable outcomes before dividing.'
    from unnest(array['${QUESTION_IDS.join("','")}']) as id;
    insert into solution_steps (question_id, step_order, body)
    select id, 1, 'Compute 1 / 4 = 0.25.'
    from unnest(array['${QUESTION_IDS.join("','")}']) as id;
    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version(id)
    from unnest(array['${QUESTION_IDS.join("','")}']) as id;
    do $$
    declare
      candidate record;
    begin
      for candidate in
        select q.id, q.working_version_id
        from questions q
        where q.id like 'runtime-publish-%'
        order by q.id
      loop
        perform app_transition_question_version(
          candidate.id, candidate.working_version_id, 'submit',
          '${PROFESSOR_ID}', 'Runtime Publish Professor', 'draft'
        );
        perform app_transition_question_version(
          candidate.id, candidate.working_version_id, 'approve',
          '${PROFESSOR_ID}', 'Runtime Publish Professor', 'needs_review'
        );
      end loop;
    end;
    $$;
  `);
  return {
    database,
    repository: createDatabaseQuestionLifecycleRepository(
      classifyingQuery(database),
    ),
  };
}

/**
 * Mirrors the Production executor: driver errors are classified into a
 * generic DatabaseOperationError before the lifecycle code sees them.
 */
function classifyingQuery(database: PGlite): DatabaseQueryExecutor {
  const run = async (
    target: { query: PGlite["query"] },
    sql: string,
    params: unknown[] = [],
  ) => {
    try {
      const result = await target.query(sql, params as never[]);
      return result.rows as Record<string, unknown>[];
    } catch (cause) {
      throw classifyPostgresError(cause);
    }
  };
  const query: DatabaseQueryExecutor = (sql, params) =>
    run(database, sql, params);
  query.transaction = (work) =>
    database.transaction(async (transaction) => {
      const transactionQuery: DatabaseQueryExecutor = (sql, params) =>
        run(transaction, sql, params);
      transactionQuery.read = transactionQuery;
      return work(transactionQuery);
    });
  query.read = query;
  return query;
}

async function professorAuthorization() {
  mockPrincipal({
    displayName: "Runtime Publish Professor",
    email: "runtime-publish@example.invalid",
    kind: "user",
    role: "professor",
    roles: ["student", "professor"],
    userId: PROFESSOR_ID,
  });
  return requireProfessorReview();
}

async function workingVersions(database: PGlite) {
  const result = await database.query<{ id: string; version_id: number }>(
    "select id, working_version_id as version_id from questions where id like 'runtime-publish-%'",
  );
  return new Map(result.rows.map((row) => [row.id, Number(row.version_id)]));
}

function batchItems(versions: Map<string, number>, ids: string[]) {
  return ids.map((questionId) => ({
    expectedState: "approved" as const,
    questionId,
    versionId: versions.get(questionId)!,
  }));
}

async function publicationState(database: PGlite) {
  const result = await database.query<{
    public_count: number;
    publish_events: number;
  }>(`
    select
      (select count(*)::int from app_public_questions where id like 'runtime-publish-%') as public_count,
      (select count(*)::int from question_lifecycle_events where action = 'publish' and question_id like 'runtime-publish-%') as publish_events
  `);
  return {
    publicCount: result.rows[0].public_count,
    publishEvents: result.rows[0].publish_events,
  };
}
