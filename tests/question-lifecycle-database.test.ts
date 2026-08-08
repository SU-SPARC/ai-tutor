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

  it("keeps partial batch publication failures invisible and commits only after every item passes", async () => {
    const database = await migratedDatabase();
    await seedLifecycleActorsAndQuestion(database);
    const versions = await seedBatchReviewQuestions(database);
    const authorization = await professorAuthorization();
    const repository = createDatabaseQuestionLifecycleRepository(
      pgliteQuery(database),
    );
    const items = versions.slice(0, 2).map((version) => ({
      expectedState: "approved" as const,
      questionId: version.questionId,
      versionId: version.versionId,
    }));

    await repository.recordInspection(authorization, items[0]);
    const missingInspection = await repository.batchTransition(
      authorization,
      {
        action: "publish",
        idempotencyKey: "batch-publish-missing-inspection",
        items,
        requestId: "batch-request-missing-inspection",
      },
    );
    expect(missingInspection).toMatchObject({
      applied: false,
      failures: [
        {
          code: "not_inspected",
          questionId: items[1].questionId,
          title: "Batch question 2",
          topicId: "batch-topic-two",
        },
      ],
    });
    expect(await batchPublicationState(database, items)).toEqual({
      publicCount: 0,
      publishedPointerCount: 0,
    });

    await repository.recordInspection(authorization, items[1]);
    await database.exec(
      "update topics set is_active = false where id = 'batch-topic-two'",
    );
    const invalidTopic = await repository.batchTransition(authorization, {
      action: "publish",
      idempotencyKey: "batch-publish-invalid-topic",
      items,
      requestId: "batch-request-invalid-topic",
    });
    expect(invalidTopic).toMatchObject({
      applied: false,
      failures: [
        {
          code: "validation_failed",
          questionId: items[1].questionId,
          topicId: "batch-topic-two",
        },
      ],
    });
    expect(await batchPublicationState(database, items)).toEqual({
      publicCount: 0,
      publishedPointerCount: 0,
    });

    await database.exec(
      "update topics set is_active = true where id = 'batch-topic-two'",
    );
    await database.exec(`
      create function app_test_fail_second_batch_publish()
      returns trigger
      language plpgsql
      as $$
      begin
        if new.action = 'publish'
          and new.question_id = 'batch-question-2'
          and new.metadata_json ->> 'batchAction' = 'publish'
        then
          raise exception 'forced second-item publication failure';
        end if;
        return new;
      end;
      $$;

      create trigger test_fail_second_batch_publish
      before insert on question_lifecycle_events
      for each row execute function app_test_fail_second_batch_publish();
    `);
    await expect(
      repository.batchTransition(authorization, {
        action: "publish",
        idempotencyKey: "batch-publish-forced-rollback",
        items,
        requestId: "batch-request-forced-rollback",
      }),
    ).rejects.toThrow(/forced second-item publication failure/i);
    expect(await batchPublicationState(database, items)).toEqual({
      publicCount: 0,
      publishedPointerCount: 0,
    });
    await database.exec(`
      drop trigger test_fail_second_batch_publish
        on question_lifecycle_events;
      drop function app_test_fail_second_batch_publish();
    `);

    const published = await repository.batchTransition(authorization, {
      action: "publish",
      idempotencyKey: "batch-publish-success",
      items,
      requestId: "batch-request-success",
    });
    expect(published).toMatchObject({
      action: "publish",
      applied: true,
      failures: [],
      idempotent: false,
      reviewedBy: {
        displayName: "Lifecycle Professor",
        occurredAt: expect.anything(),
        userId: "user:lifecycle-professor",
      },
    });
    expect(await batchPublicationState(database, items)).toEqual({
      publicCount: 2,
      publishedPointerCount: 2,
    });
    const evidence = await database.query<{
      actor_user_id: string;
      event_count: number;
      timestamp_count: number;
    }>(`
      select
        min(actor_user_id) as actor_user_id,
        count(*)::int as event_count,
        count(distinct occurred_at)::int as timestamp_count
      from question_lifecycle_events
      where request_id = 'batch-request-success'
        and action = 'publish'
    `);
    expect(evidence.rows[0]).toEqual({
      actor_user_id: "user:lifecycle-professor",
      event_count: 2,
      timestamp_count: 1,
    });

    const retry = await repository.batchTransition(authorization, {
      action: "publish",
      idempotencyKey: "batch-publish-success",
      items,
      requestId: "batch-request-success-retry",
    });
    expect(retry).toMatchObject({ applied: true, idempotent: true });
    expect(
      (
        await database.query<{ count: number }>(`
          select count(*)::int as count
          from question_lifecycle_events
          where request_id = 'batch-request-success'
            and action = 'publish'
        `)
      ).rows[0].count,
    ).toBe(2);
  });

  it("applies inspected batch revision requests and rejections without batch approval", async () => {
    const database = await migratedDatabase();
    await seedLifecycleActorsAndQuestion(database);
    const versions = await seedBatchReviewQuestions(database);
    const authorization = await professorAuthorization();
    const repository = createDatabaseQuestionLifecycleRepository(
      pgliteQuery(database),
    );
    for (const version of versions) {
      await repository.recordInspection(authorization, {
        expectedState: "approved",
        questionId: version.questionId,
        versionId: version.versionId,
      });
    }

    const revisionItems = versions.slice(0, 2).map((version) => ({
      expectedState: "approved" as const,
      questionId: version.questionId,
      versionId: version.versionId,
    }));
    const rejectionItems = versions.slice(2, 4).map((version) => ({
      expectedState: "approved" as const,
      questionId: version.questionId,
      versionId: version.versionId,
    }));
    const revised = await repository.batchTransition(authorization, {
      action: "request_revision",
      idempotencyKey: "batch-request-revision",
      items: revisionItems,
      reasonCode: "clarify_wording",
      requestId: "batch-revision-request",
      revisionMethod: "manual",
    });
    const rejected = await repository.batchTransition(authorization, {
      action: "reject",
      idempotencyKey: "batch-reject",
      items: rejectionItems,
      reasonCode: "incorrect_structure",
      requestId: "batch-reject-request",
    });

    expect(revised).toMatchObject({ applied: true, failures: [] });
    expect(rejected).toMatchObject({ applied: true, failures: [] });
    const states = await database.query<{
      question_id: string;
      state: string;
    }>(`
      select qvl.question_id, qvl.state
      from question_version_lifecycle qvl
      where qvl.question_id like 'batch-question-%'
      order by qvl.question_id
    `);
    expect(states.rows).toEqual([
      { question_id: "batch-question-1", state: "revision_requested" },
      { question_id: "batch-question-2", state: "revision_requested" },
      { question_id: "batch-question-3", state: "rejected" },
      { question_id: "batch-question-4", state: "rejected" },
    ]);
    const attribution = await database.query<{
      action: string;
      actor_user_id: string;
      event_count: number;
      reason_code: string;
      timestamp_count: number;
    }>(`
      select
        action,
        min(actor_user_id) as actor_user_id,
        count(*)::int as event_count,
        min(reason_code) as reason_code,
        count(distinct occurred_at)::int as timestamp_count
      from question_lifecycle_events
      where request_id in ('batch-revision-request', 'batch-reject-request')
      group by action
      order by action
    `);
    expect(attribution.rows).toEqual([
      {
        action: "reject",
        actor_user_id: "user:lifecycle-professor",
        event_count: 2,
        reason_code: "incorrect_structure",
        timestamp_count: 1,
      },
      {
        action: "request_revision",
        actor_user_id: "user:lifecycle-professor",
        event_count: 2,
        reason_code: "clarify_wording",
        timestamp_count: 1,
      },
    ]);
    await expect(
      database.exec(
        "update question_version_inspections set inspected_at = now()",
      ),
    ).rejects.toThrow(/append-only/i);
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

async function seedBatchReviewQuestions(database: PGlite) {
  await database.exec(`
    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values
      (
        'batch-topic-one', 'Batch topic one', '', 43, 1,
        'module-batch-1', true
      ),
      (
        'batch-topic-two', 'Batch topic two', '', 44, 1,
        'module-batch-2', true
      );

    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'generated', false);
    select set_config('app.suppress_question_version', 'true', false);

    insert into questions (
      id, topic_id, title, prompt, difficulty,
      accepted_answers_json, numeric_value, tolerance, answer_explanation,
      source_type, trust_level, review_status, visibility,
      originality_note, reviewed_by, reviewed_by_user_id
    )
    select
      'batch-question-' || item,
      case when item % 2 = 1 then 'batch-topic-one' else 'batch-topic-two' end,
      'Batch question ' || item,
      'What is ' || item || ' divided by 4?',
      'foundational',
      jsonb_build_array((item::numeric / 4)::text),
      item::double precision / 4,
      0.001,
      'Divide the numerator by four.',
      'generated_original',
      'generated_unverified',
      'needs_review',
      'public',
      'Original generated batch review item.',
      'Question generation system',
      'system:question-generator'
    from generate_series(1, 4) as item;

    insert into solution_steps (question_id, step_order, body)
    select
      'batch-question-' || item,
      1,
      'Compute ' || item || ' / 4.'
    from generate_series(1, 4) as item;

    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version('batch-question-' || item)
    from generate_series(1, 4) as item;

    do $$
    declare
      candidate record;
    begin
      for candidate in
        select qv.question_id, qv.id
        from question_versions qv
        where qv.question_id like 'batch-question-%'
        order by qv.question_id
      loop
        perform app_transition_question_version(
          candidate.question_id,
          candidate.id,
          'submit',
          'user:lifecycle-professor',
          'Lifecycle Professor',
          'draft'
        );
        perform app_transition_question_version(
          candidate.question_id,
          candidate.id,
          'approve',
          'user:lifecycle-professor',
          'Lifecycle Professor',
          'needs_review'
        );
      end loop;
    end;
    $$;
  `);
  const versions = await database.query<{
    question_id: string;
    version_id: number;
  }>(`
    select q.id as question_id, q.working_version_id as version_id
    from questions q
    where q.id like 'batch-question-%'
    order by q.id
  `);
  return versions.rows.map((row) => ({
    questionId: row.question_id,
    versionId: Number(row.version_id),
  }));
}

async function professorAuthorization() {
  mockPrincipal({
    displayName: "Lifecycle Professor",
    email: "professor@lifecycle.invalid",
    kind: "user",
    role: "professor",
    roles: ["student", "professor"],
    userId: "user:lifecycle-professor",
  });
  return requireProfessorReview();
}

async function batchPublicationState(
  database: PGlite,
  items: Array<{ questionId: string }>,
) {
  const questionIds = items.map((item) => item.questionId);
  const result = await database.query<{
    public_count: number;
    published_pointer_count: number;
  }>(`
    select
      (
        select count(*)::int
        from app_public_questions public_question
        where public_question.id = any($1::text[])
      ) as public_count,
      count(*) filter (where q.published_version_id is not null)::int
        as published_pointer_count
    from questions q
    where q.id = any($1::text[])
  `, [questionIds]);
  return {
    publicCount: result.rows[0].public_count,
    publishedPointerCount: result.rows[0].published_pointer_count,
  };
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
