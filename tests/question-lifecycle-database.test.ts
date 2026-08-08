import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { requireProfessorReview } from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseQuestionLifecycleRepository } from "@/lib/data/question-lifecycle-repository";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  resetAuthMocks();
});

describe("question lifecycle database", () => {
  it("separates approval from publication and enforces takedown, replacement, rollback, and archive", async () => {
    const database = await migratedDatabase();
    await seedLifecycleActorsAndQuestion(database);

    const initial = await lifecycleState(database);
    expect(initial).toMatchObject({
      public_count: 1,
      published_state: "published",
      record_state: "active",
    });
    const firstVersionId = Number(initial.published_version_id);

    await database.exec(`
      insert into tutor_sessions (id, user_id, question_id)
      values ('session-v1', 'user:lifecycle-student', 'lifecycle-question');
    `);
    const pinned = await database.query<{ question_version_id: number }>(`
      select question_version_id from tutor_sessions where id = 'session-v1'
    `);
    expect(Number(pinned.rows[0].question_version_id)).toBe(firstVersionId);

    await database.exec(`
      insert into ai_response_cache (
        request_hash, question_id, topic_id, mode, source,
        response_json, expires_at
      ) values (
        'lifecycle-cache-v1', 'lifecycle-question', 'lifecycle-topic',
        'hint', 'rule', '{"text":"cached"}'::jsonb, now() + interval '1 hour'
      );
    `);

    const unpublishKey = `test:${randomUUID()}`;
    await transition(database, firstVersionId, "unpublish", {
      expectedState: "published",
      idempotencyKey: unpublishKey,
      reasonCode: "content_correction",
    });
    await transition(database, firstVersionId, "unpublish", {
      expectedState: "published",
      idempotencyKey: unpublishKey,
      reasonCode: "content_correction",
    });
    expect(await lifecycleState(database)).toMatchObject({
      public_count: 0,
      published_version_id: null,
      published_state: "unpublished",
    });
    expect(
      (
        await database.query<{ status: string }>(`
          select status from tutor_sessions where id = 'session-v1'
        `)
      ).rows[0].status,
    ).toBe("content_unpublished");
    expect(
      (
        await database.query<{ count: number }>(`
          select count(*)::int as count
          from ai_response_cache
          where question_id = 'lifecycle-question'
            and expires_at > clock_timestamp()
        `)
      ).rows[0].count,
    ).toBe(0);
    await expect(
      database.exec(`
        insert into tutor_sessions (id, user_id, question_id)
        values ('blocked-unpublished-session', 'user:lifecycle-student', 'lifecycle-question')
      `),
    ).rejects.toThrow(/published question version/i);

    const newVersion = await database.query<{ id: number }>(`
      insert into question_versions (
        question_id,
        version_number,
        snapshot_json,
        content_hash,
        created_by_user_id,
        parent_version_id,
        creation_method,
        schema_version
      )
      select
        qv.question_id,
        qv.version_number + 1,
        jsonb_set(qv.snapshot_json, '{prompt}', '"Corrected immutable prompt"'::jsonb),
        md5(jsonb_set(qv.snapshot_json, '{prompt}', '"Corrected immutable prompt"'::jsonb)::text),
        'user:lifecycle-professor',
        qv.id,
        'manual',
        2
      from question_versions qv
      where qv.id = ${firstVersionId}
      returning id
    `);
    const secondVersionId = Number(newVersion.rows[0].id);

    await transition(database, secondVersionId, "submit", {
      expectedState: "draft",
    });
    await transition(database, secondVersionId, "approve", {
      expectedState: "needs_review",
    });
    expect(await lifecycleState(database)).toMatchObject({
      public_count: 0,
      working_state: "approved",
    });

    await transition(database, secondVersionId, "publish", {
      expectedState: "approved",
    });
    const published = await database.query<{
      prompt: string;
      question_version_id: number;
    }>(`select prompt, question_version_id from app_public_questions`);
    expect(published.rows[0]).toMatchObject({
      prompt: "Corrected immutable prompt",
      question_version_id: secondVersionId,
    });

    await database.exec(`
      insert into tutor_sessions (id, user_id, question_id)
      values ('session-v2', 'user:lifecycle-student', 'lifecycle-question');
    `);
    await transition(database, firstVersionId, "rollback", {
      expectedState: "unpublished",
      reasonCode: "restore_previous_release",
    });
    expect(await lifecycleState(database)).toMatchObject({
      published_version_id: firstVersionId,
      published_state: "published",
    });
    expect(
      (
        await database.query<{ status: string }>(`
          select status from tutor_sessions where id = 'session-v2'
        `)
      ).rows[0].status,
    ).toBe("content_unpublished");

    await transition(database, firstVersionId, "unpublish", {
      expectedState: "published",
      reasonCode: "course_retired",
    });
    await transition(database, secondVersionId, "archive", {
      expectedState: "unpublished",
      reasonCode: "course_retired",
    });
    expect(await lifecycleState(database)).toMatchObject({
      public_count: 0,
      record_state: "archived",
    });
    await transition(database, secondVersionId, "restore", {
      expectedState: "unpublished",
    });
    expect(await lifecycleState(database)).toMatchObject({
      public_count: 0,
      published_version_id: null,
      record_state: "active",
    });
  });

  it("rejects direct projection writes and keeps lifecycle events append-only", async () => {
    const database = await migratedDatabase();
    await seedLifecycleActorsAndQuestion(database);

    await expect(
      database.exec(`
        update question_version_lifecycle
        set state = 'rejected'
      `),
    ).rejects.toThrow(/only be changed by lifecycle procedures/i);
    await expect(
      database.exec(`update questions set published_version_id = null`),
    ).rejects.toThrow(/only be changed by lifecycle procedures/i);
    await expect(
      database.exec(`update question_lifecycle_events set note = 'rewritten'`),
    ).rejects.toThrow(/append-only/i);
  });

  it("enforces professor, student, and bounded system transition permissions", async () => {
    const database = await migratedDatabase();
    await seedLifecycleActorsAndQuestion(database);
    const initial = await lifecycleState(database);
    const firstVersionId = Number(initial.published_version_id);

    await database.exec(
      "select set_config('app.current_creation_method', 'regenerated', false)",
    );
    const draft = await database.query<{ id: number }>(`
      insert into question_versions (
        question_id, version_number, snapshot_json, content_hash,
        created_by_user_id, parent_version_id, creation_method,
        generation_metadata_json
      )
      select question_id, version_number + 1, snapshot_json,
             content_hash, 'system:question-generator', id, 'regenerated',
             '{"requestedByUserId":"user:lifecycle-professor","generator":"test-v1"}'::jsonb
      from question_versions where id = ${firstVersionId}
      returning id
    `);
    const draftVersionId = Number(draft.rows[0].id);
    const attribution = await database.query<{
      actor_role: string;
      executed_by_user_id: string;
      requested_by_user_id: string;
    }>(`
      select actor_role, requested_by_user_id, executed_by_user_id
      from question_lifecycle_events
      where question_version_id = ${draftVersionId} and action = 'regenerate'
    `);
    expect(attribution.rows[0]).toEqual({
      actor_role: "system",
      executed_by_user_id: "system:question-generator",
      requested_by_user_id: "user:lifecycle-professor",
    });

    await expect(
      database.query(
        `select * from app_transition_question_version(
          $1, $2, 'submit', $3, $4, 'draft'
        )`,
        [
          "lifecycle-question",
          draftVersionId,
          "user:lifecycle-student",
          "Lifecycle Student",
        ],
      ),
    ).rejects.toThrow(/active professor or system identity/i);

    await database.query(
      `select * from app_transition_question_version(
        $1, $2, 'submit', $3, $4, 'draft'
      )`,
      [
        "lifecycle-question",
        draftVersionId,
        "system:question-generator",
        "Spoofed display name",
      ],
    );
    const submitAttribution = await database.query<{
      actor_display_name: string;
    }>(`
      select actor_display_name
      from question_lifecycle_events
      where question_version_id = ${draftVersionId} and action = 'submit'
    `);
    expect(submitAttribution.rows[0].actor_display_name).toBe(
      "Question generation system",
    );
    await expect(
      database.query(
        `select * from app_transition_question_version(
          $1, $2, 'approve', $3, $4, 'needs_review'
        )`,
        [
          "lifecycle-question",
          draftVersionId,
          "system:question-generator",
          "Question generation system",
        ],
      ),
    ).rejects.toThrow(/may only submit/i);
  });

  it("creates an attributed revision draft while preserving generated and published versions", async () => {
    const database = await migratedDatabase();
    await seedLifecycleActorsAndQuestion(database);
    const { draftVersionId, publishedVersionId } =
      await seedGeneratedWorkingDraft(database);
    mockPrincipal({
      displayName: "Lifecycle Professor",
      email: "professor@lifecycle.invalid",
      kind: "user",
      role: "professor",
      roles: ["student", "professor"],
      userId: "user:lifecycle-professor",
    });
    const authorization = await requireProfessorReview();
    const repository = createDatabaseQuestionLifecycleRepository(
      pgliteQuery(database),
    );

    const revised = await repository.createRevision(authorization, {
      baseVersionId: draftVersionId,
      expectedWorkingVersionId: draftVersionId,
      questionId: "generated-revision-lifecycle",
      revision: {
        answer: {
          acceptedAnswers: ["0.5", "1/2"],
          explanation: "Divide the two favorable outcomes by four outcomes.",
          numericValue: 0.5,
          tolerance: 0.001,
        },
        difficulty: "intermediate",
        hints: ["Count favorable outcomes before dividing."],
        misconceptions: [
          {
            feedback: "Use favorable outcomes over all outcomes.",
            id: "reversed-ratio",
            matchTerms: ["2"],
          },
        ],
        prompt:
          "Two of four equally likely generated outcomes are favorable. What is the probability?",
        solutionSteps: ["Compute 2 / 4 = 0.5."],
        title: "Professor-edited generated probability",
        topicId: "lifecycle-topic",
      },
    });

    expect(revised?.publishedVersion?.versionId).toBe(publishedVersionId);
    expect(revised?.workingVersion).toMatchObject({
      createdBy: {
        displayName: "Lifecycle Professor",
        userId: "user:lifecycle-professor",
      },
      creationMethod: "manual",
      difficulty: "intermediate",
      parentVersionId: draftVersionId,
      source: {
        sourceType: "generated_original",
        trustLevel: "generated_unverified",
        visibility: "public",
      },
      state: "draft",
      validationStatus: "valid",
    });
    expect(revised?.versions).toHaveLength(3);
    expect(
      revised?.versions.find((version) => version.versionId === draftVersionId)
        ?.prompt,
    ).toBe(
      "A generated working draft asks for the probability of two favorable outcomes out of four.",
    );

    const publicQuestion = await database.query<{
      prompt: string;
      question_version_id: number;
    }>(`
      select prompt, question_version_id
      from app_public_questions
      where id = 'generated-revision-lifecycle'
    `);
    expect(publicQuestion.rows[0]).toEqual({
      prompt:
        "One of four generated outcomes is favorable. What is the probability?",
      question_version_id: publishedVersionId,
    });
    const attribution = await database.query<{
      action: string;
      actor_user_id: string;
      occurred_at: string;
    }>(`
      select action, actor_user_id, occurred_at
      from question_lifecycle_events
      where question_version_id = ${revised?.workingVersion.versionId}
    `);
    expect(attribution.rows[0]).toMatchObject({
      action: "create_version",
      actor_user_id: "user:lifecycle-professor",
      occurred_at: expect.anything(),
    });
  });
});

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

async function seedLifecycleActorsAndQuestion(database: PGlite) {
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values
      (
        'user:lifecycle-professor', 'test', 'professor-subject',
        'professor@lifecycle.invalid', 'Lifecycle Professor', 'active'
      ),
      (
        'user:lifecycle-student', 'test', 'student-subject',
        'student@lifecycle.invalid', 'Lifecycle Student', 'active'
      );

    insert into user_roles (user_id, role_id) values
      ('user:lifecycle-professor', 'professor'),
      ('user:lifecycle-student', 'student');

    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values (
      'lifecycle-topic', 'Lifecycle topic', '', 42, 1, 'module-1', true
    );

    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'imported', false);
    select set_config('app.suppress_question_version', 'true', false);

    insert into questions (
      id, topic_id, title, prompt, difficulty,
      accepted_answers_json, answer_explanation,
      source_type, trust_level, review_status, visibility,
      reviewed_by, reviewed_by_user_id, reviewed_at
    ) values (
      'lifecycle-question',
      'lifecycle-topic',
      'Lifecycle question',
      'Original immutable prompt',
      'foundational',
      '["0.5"]'::jsonb,
      'Divide the favorable outcomes by the total.',
      'original_demo',
      'public_original',
      'approved',
      'public',
      'Schema migration system actor',
      'system:schema-migration',
      now()
    );

    insert into solution_steps (question_id, step_order, body)
    values (
      'lifecycle-question', 1,
      'Divide the favorable outcomes by the total.'
    );

    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version('lifecycle-question');
  `);
}

async function seedGeneratedWorkingDraft(database: PGlite) {
  await database.exec(`
    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'generated', false);
    select set_config('app.suppress_question_version', 'true', false);

    insert into questions (
      id, topic_id, title, prompt, difficulty,
      accepted_answers_json, numeric_value, tolerance, answer_explanation,
      source_type, trust_level, review_status, visibility,
      originality_note, reviewed_by, reviewed_by_user_id, reviewed_at
    ) values (
      'generated-revision-lifecycle',
      'lifecycle-topic',
      'Generated probability draft',
      'One of four generated outcomes is favorable. What is the probability?',
      'foundational',
      '["0.25", "1/4"]'::jsonb,
      0.25,
      0.001,
      'Divide one favorable outcome by four outcomes.',
      'generated_original',
      'professor_approved',
      'approved',
      'public',
      'Original generated item from an abstract public-safe pattern.',
      'Schema migration system actor',
      'system:schema-migration',
      now()
    );

    insert into hints (question_id, hint_order, body)
    values (
      'generated-revision-lifecycle', 1,
      'Count favorable outcomes.'
    );
    insert into solution_steps (question_id, step_order, body)
    values (
      'generated-revision-lifecycle', 1,
      'Compute 1 / 4 = 0.25.'
    );
    insert into misconceptions (
      id, question_id, feedback, match_terms_json
    ) values (
      'reversed-ratio',
      'generated-revision-lifecycle',
      'Use favorable outcomes divided by total outcomes.',
      '["4"]'::jsonb
    );

    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version('generated-revision-lifecycle');
  `);
  const published = await database.query<{ published_version_id: number }>(`
    select published_version_id
    from questions
    where id = 'generated-revision-lifecycle'
  `);
  const publishedVersionId = Number(published.rows[0].published_version_id);

  await database.exec(
    "select set_config('app.current_creation_method', 'generated', false)",
  );
  const draft = await database.query<{ id: number }>(`
    insert into question_versions (
      question_id, version_number, snapshot_json, content_hash,
      created_by_user_id, parent_version_id, creation_method, schema_version
    )
    select
      question_id,
      version_number + 1,
      snapshot_json || jsonb_build_object(
        'prompt',
        'A generated working draft asks for the probability of two favorable outcomes out of four.',
        'reviewStatus', 'needs_review',
        'trustLevel', 'generated_unverified'
      ),
      md5((snapshot_json || jsonb_build_object(
        'prompt',
        'A generated working draft asks for the probability of two favorable outcomes out of four.',
        'reviewStatus', 'needs_review',
        'trustLevel', 'generated_unverified'
      ))::text),
      'system:question-generator',
      id,
      'generated',
      2
    from question_versions
    where id = ${publishedVersionId}
    returning id
  `);
  const draftVersionId = Number(draft.rows[0].id);
  await database.query(
    `select * from app_transition_question_version(
      $1, $2, 'submit', $3, $4, 'draft'
    )`,
    [
      "generated-revision-lifecycle",
      draftVersionId,
      "system:question-generator",
      "Question generation system",
    ],
  );
  return { draftVersionId, publishedVersionId };
}

function pgliteQuery(database: PGlite | Transaction): DatabaseQueryExecutor {
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query(sql, params);
    return result.rows as Record<string, unknown>[];
  };
  if (database instanceof PGlite) {
    query.transaction = (work) =>
      database.transaction((transaction) => work(pgliteQuery(transaction)));
  }
  return query;
}

async function transition(
  database: PGlite,
  versionId: number,
  action: string,
  options: {
    expectedState: string;
    idempotencyKey?: string;
    reasonCode?: string;
  },
) {
  return database.query(
    `select * from app_transition_question_version(
      $1, $2, $3, $4, $5, $6, $7, null, $8, $9, '{}'::jsonb
    )`,
    [
      "lifecycle-question",
      versionId,
      action,
      "user:lifecycle-professor",
      "Lifecycle Professor",
      options.expectedState,
      options.reasonCode ?? null,
      options.idempotencyKey ?? `test:${randomUUID()}`,
      `request:${randomUUID()}`,
    ],
  );
}

async function lifecycleState(database: PGlite) {
  const result = await database.query<{
    public_count: number;
    published_state: string | null;
    published_version_id: number | null;
    record_state: string;
    working_state: string;
  }>(`
    select
      q.published_version_id,
      q.record_state,
      working.state as working_state,
      published.state as published_state,
      (select count(*)::int from app_public_questions) as public_count
    from questions q
    join question_version_lifecycle working
      on working.question_version_id = q.working_version_id
    left join question_version_lifecycle published
      on published.question_version_id = coalesce(
        q.published_version_id,
        q.working_version_id
      )
    where q.id = 'lifecycle-question'
  `);
  return result.rows[0];
}
