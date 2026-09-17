import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { requireProfessorReview } from "@/lib/auth/authorization";
import {
  createDatabaseQuestionSimilarityRepository,
  createDatabaseQuestionSimilaritySelectionRepository,
} from "@/lib/data/question-similarity-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

const databases: PGlite[] = [];

afterEach(async () => {
  resetAuthMocks();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("version-pinned question similarity relationships", () => {
  let database: PGlite;
  let versions: Map<string, number>;

  beforeEach(async () => {
    database = await migratedDatabase();
    versions = await seedContent(database);
    mockPrincipal({
      displayName: "Similarity Professor",
      email: "similarity@example.invalid",
      kind: "user",
      role: "professor",
      roles: ["student", "professor"],
      userId: "user:similarity-professor",
    });
  }, 60_000);

  it("uses the real repository path for idempotent assignment, conflicts, revocation, and audit", async () => {
    const repository = createDatabaseQuestionSimilarityRepository(
      pgliteQuery(database),
    );
    const authorization = await requireProfessorReview();
    const assignment = {
      action: "assign" as const,
      expectedSimilarVersionId: versions.get("reserve-1")!,
      originQuestionId: "origin-a",
      originVersionId: versions.get("origin-a")!,
      requestId: "assign-a-1",
      similarQuestionId: "reserve-1",
      slot: 1 as const,
    };

    const assigned = await repository.setLink(authorization, assignment);
    const linkId = assigned.find((link) => !link.revokedAt)?.id;
    expect(linkId).toEqual(expect.any(Number));
    await expect(repository.setLink(authorization, assignment)).resolves.toEqual(
      assigned,
    );
    await expect(
      repository.setLink(authorization, {
        ...assignment,
        expectedSimilarVersionId: versions.get("reserve-2")!,
        similarQuestionId: "reserve-2",
      }),
    ).rejects.toThrow(/slot already has a different active/i);
    await expect(
      repository.setLink(authorization, {
        ...assignment,
        originQuestionId: "origin-b",
        originVersionId: versions.get("origin-b")!,
      }),
    ).rejects.toThrow(/sibling.*different active/i);

    await database.query(
      `select * from app_transition_question_version(
        'origin-a', $1, 'unpublish', 'user:similarity-professor',
        'Similarity Professor', 'published', 'content_correction', null,
        'unpublish-origin-a', 'unpublish-origin-a-request', '{}'::jsonb
      )`,
      [versions.get("origin-a")],
    );
    await repository.setLink(authorization, {
      action: "remove",
      expectedSimilarVersionId: versions.get("reserve-1")!,
      linkId: linkId!,
      originQuestionId: "origin-a",
      originVersionId: versions.get("origin-a")!,
      requestId: "revoke-a-1",
      similarQuestionId: "reserve-1",
      slot: 1,
    });

    await expect(
      database.query(
        `select id, revoked_at is not null as revoked,
                revoked_by_user_id
         from question_similarity_links where id = $1`,
        [linkId!],
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          id: linkId,
          revoked: true,
          revoked_by_user_id: "user:similarity-professor",
        },
      ],
    });
    await expect(
      database.query(
        `select action from audit_events
         where entity_type = 'question_similarity_link' and entity_id = $1
         order by created_at, id`,
        [String(linkId)],
      ),
    ).resolves.toMatchObject({
      rows: [
        { action: "question.similarity.assign" },
        { action: "question.similarity.revoke" },
      ],
    });
  });

  it("allows slots 1 through 3 and rejects a fourth, a duplicate slot, and sibling reuse", async () => {
    await insertLink(database, versions, "origin-a", "reserve-1", 1);
    await expect(
      insertLink(database, versions, "origin-a", "reserve-1", 2),
    ).rejects.toThrow(/pair_unique|unique constraint/i);
    await insertLink(database, versions, "origin-a", "reserve-2", 2);
    await insertLink(database, versions, "origin-a", "reserve-3", 3);

    await expect(
      insertLink(database, versions, "origin-a", "reserve-4", 4),
    ).rejects.toThrow(/slot_check|check constraint/i);
    await expect(
      insertLink(database, versions, "origin-a", "reserve-4", 3),
    ).rejects.toThrow(/origin_slot_unique|unique constraint/i);
    await expect(
      insertLink(database, versions, "origin-b", "reserve-1", 1),
    ).rejects.toThrow(/similar_practice_sibling_idx|unique constraint/i);
  });

  it("rejects absent and wrong write settings and permits only an attributed one-way revocation", async () => {
    const inserted = await insertLink(
      database,
      versions,
      "origin-a",
      "reserve-1",
      1,
    );
    const linkId = Number(inserted.rows[0].id);
    const original = await database.query<Record<string, unknown>>(
      "select * from question_similarity_links where id = $1",
      [linkId],
    );

    await expect(
      database.query(
        `update question_similarity_links
         set revoked_at = now(),
             revoked_by_user_id = 'user:similarity-professor'
         where id = $1`,
        [linkId],
      ),
    ).rejects.toThrow(/only be revoked through the audited workflow/i);

    await database.exec(
      "select set_config('app.similarity_link_write', 'wrong', false)",
    );
    await expect(
      database.query(
        `update question_similarity_links
         set revoked_at = now(),
             revoked_by_user_id = 'user:similarity-professor'
         where id = $1`,
        [linkId],
      ),
    ).rejects.toThrow(/only be revoked through the audited workflow/i);

    await database.exec(
      "select set_config('app.similarity_link_write', 'allowed', false)",
    );
    await expect(
      database.query(
        `update question_similarity_links
         set revoked_at = now(),
             revoked_by_user_id = 'user:similarity-professor'
         where id = $1`,
        [linkId],
      ),
    ).resolves.toBeDefined();

    const revoked = await database.query<Record<string, unknown>>(
      "select * from question_similarity_links where id = $1",
      [linkId],
    );
    expect(revoked.rows[0]).toMatchObject({
      created_at: original.rows[0].created_at,
      created_by_user_id: original.rows[0].created_by_user_id,
      id: linkId,
      origin_question_id: original.rows[0].origin_question_id,
      origin_version_id: original.rows[0].origin_version_id,
      relationship_type: original.rows[0].relationship_type,
      revoked_by_user_id: "user:similarity-professor",
      similar_question_id: original.rows[0].similar_question_id,
      similar_version_id: original.rows[0].similar_version_id,
      slot: original.rows[0].slot,
    });
    expect(revoked.rows[0].revoked_at).not.toBeNull();
  });

  it("rejects self-links, mismatched version ownership, and in-place edits", async () => {
    await expect(
      database.query(
        `insert into question_similarity_links (
           origin_question_id, similar_question_id, origin_version_id,
           similar_version_id, relationship_type, slot, created_by_user_id
         ) values ('origin-a', 'origin-a', $1, $1,
           'similar_practice', 1, 'user:similarity-professor')`,
        [versions.get("origin-a")],
      ),
    ).rejects.toThrow(
      /distinct_questions_check|check constraint|exact current versions/i,
    );
    await expect(
      database.query(
        `insert into question_similarity_links (
           origin_question_id, similar_question_id, origin_version_id,
           similar_version_id, relationship_type, slot, created_by_user_id
         ) values ('origin-a', 'reserve-1', $1, $1,
           'similar_practice', 1, 'user:similarity-professor')`,
        [versions.get("origin-a")],
      ),
    ).rejects.toThrow(
      /similar_version_fkey|foreign key|exact current versions/i,
    );

    await insertLink(database, versions, "origin-a", "reserve-1", 1);
    await database.exec(
      "select set_config('app.similarity_link_write', 'allowed', false)",
    );
    await expect(
      database.exec(
        "update question_similarity_links set slot = 2 where similar_question_id = 'reserve-1'",
      ),
    ).rejects.toThrow(/append-only|immutable/i);
  });

  it("selects only eligible links for the exact origin and restores the same link after a harmless toggle", async () => {
    await insertLink(database, versions, "origin-a", "reserve-1", 1);
    const repository = createDatabaseQuestionSimilaritySelectionRepository(
      pgliteQuery(database),
    );
    const managementRepository = createDatabaseQuestionSimilarityRepository(
      pgliteQuery(database),
    );
    const authorization = await requireProfessorReview();

    await expect(
      repository.listEligibleForOrigin("origin-a", versions.get("origin-a")!),
    ).resolves.toMatchObject([{ question: { id: "reserve-1" }, slot: 1 }]);
    await expect(
      repository.listEligibleForOrigin("origin-b", versions.get("origin-b")!),
    ).resolves.toEqual([]);
    await expect(
      repository.listEligibleForOrigin("origin-a", versions.get("origin-b")!),
    ).resolves.toEqual([]);

    await database.exec(
      "select set_config('app.reserve_write', 'allowed', false)",
    );
    await database.exec(
      "update questions set reserve_practice_allowed = false where id = 'reserve-1'",
    );
    await expect(
      repository.listEligibleForOrigin("origin-a", versions.get("origin-a")!),
    ).resolves.toEqual([]);
    await expect(
      managementRepository.listCoverage(authorization, "similarity-topic"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eligibleSiblingCount: 0,
          linkedSiblingCount: 1,
          originQuestionId: "origin-a",
        }),
      ]),
    );
    await database.exec(
      "update questions set reserve_practice_allowed = true where id = 'reserve-1'",
    );
    await expect(
      repository.listEligibleForOrigin("origin-a", versions.get("origin-a")!),
    ).resolves.toHaveLength(1);
    await expect(
      managementRepository.listCoverage(authorization, "similarity-topic"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eligibleSiblingCount: 1,
          linkedSiblingCount: 1,
          originQuestionId: "origin-a",
        }),
      ]),
    );

    const revised = await database.query<{ id: number }>(
      `insert into question_versions (
         question_id, version_number, snapshot_json, content_hash,
         created_by_user_id, parent_version_id, creation_method,
         schema_version, content_sha256, generation_metadata_json
       ) select
         question_id, version_number + 1, snapshot_json, content_hash,
         'user:similarity-professor', id, 'manual', schema_version,
         content_sha256, '{}'::jsonb
       from question_versions where id = $1
       returning id`,
      [versions.get("origin-a")],
    );
    const revisedVersionId = Number(revised.rows[0].id);
    for (const [action, expectedState] of [
      ["submit", "draft"],
      ["approve", "needs_review"],
      ["publish", "approved"],
    ] as const) {
      await database.query(
        `select * from app_transition_question_version(
          $1, $2, $3, 'user:similarity-professor',
          'Similarity Professor', $4
        )`,
        ["origin-a", revisedVersionId, action, expectedState],
      );
    }
    await expect(
      repository.listEligibleForOrigin("origin-a", versions.get("origin-a")!),
    ).resolves.toEqual([]);
  });

  it("invalidates a revised sibling, permits a reviewed v2 re-pin, and preserves the v1 evidence row", async () => {
    const repository = createDatabaseQuestionSimilarityRepository(
      pgliteQuery(database),
    );
    const authorization = await requireProfessorReview();
    const originVersionId = versions.get("origin-a")!;
    const siblingV1 = versions.get("reserve-1")!;
    const first = await repository.setLink(authorization, {
      action: "assign",
      expectedSimilarVersionId: siblingV1,
      originQuestionId: "origin-a",
      originVersionId,
      similarQuestionId: "reserve-1",
      slot: 1,
    });
    const oldLinkId = first.find((link) => !link.revokedAt)!.id;

    await database.query(
      `insert into tutor_sessions (
         id, anonymous_user_id, question_id, question_version_id,
         solved, status, current_state, completed_at
       ) values ('revision-origin-session', 'anon:revision', 'origin-a', $1,
         true, 'completed', 'solved', now())`,
      [originVersionId],
    );
    await database.query(
      `insert into tutor_sessions (
         id, anonymous_user_id, question_id, question_version_id,
         practice_context, origin_session_id, solved, status, current_state,
         completed_at
       ) values ('revision-sibling-v1-session', 'anon:revision', 'reserve-1', $1,
         'reserve_practice', 'revision-origin-session', true, 'completed',
         'solved', now())`,
      [siblingV1],
    );

    const siblingV2 = await reviseReserveQuestion(database, "reserve-1", siblingV1);
    await expect(
      repository.listEligibleForOrigin("origin-a", originVersionId),
    ).resolves.toEqual([]);
    await repository.setLink(authorization, {
      action: "remove",
      expectedSimilarVersionId: siblingV1,
      linkId: oldLinkId,
      originQuestionId: "origin-a",
      originVersionId,
      similarQuestionId: "reserve-1",
      slot: 1,
    });
    await repository.setLink(authorization, {
      action: "assign",
      expectedSimilarVersionId: siblingV2,
      originQuestionId: "origin-a",
      originVersionId,
      similarQuestionId: "reserve-1",
      slot: 1,
    });

    await expect(
      repository.listEligibleForOrigin("origin-a", originVersionId),
    ).resolves.toMatchObject([
      { question: { id: "reserve-1" }, slot: 1, versionId: siblingV2 },
    ]);
    await expect(
      repository.listCoverage(authorization, "similarity-topic"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eligibleSiblingCount: 1,
          linkedSiblingCount: 1,
          originQuestionId: "origin-a",
        }),
      ]),
    );
    await expect(
      database.query(
        `select similar_version_id, revoked_at is not null as revoked
         from question_similarity_links
         where origin_question_id = 'origin-a'
           and similar_question_id = 'reserve-1'
         order by id`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { revoked: true, similar_version_id: siblingV1 },
        { revoked: false, similar_version_id: siblingV2 },
      ],
    });
    await expect(
      database.query(
        `select count(*)::int as count
         from tutor_sessions reserve_session
         join tutor_sessions origin_session
           on origin_session.id = reserve_session.origin_session_id
         join question_similarity_links link
           on link.origin_question_id = origin_session.question_id
          and link.origin_version_id = origin_session.question_version_id
          and link.similar_question_id = reserve_session.question_id
          and link.similar_version_id = reserve_session.question_version_id
          and link.relationship_type = 'similar_practice'
         where reserve_session.id = 'revision-sibling-v1-session'`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("invalidates a revised origin, re-pins the current origin, and preserves old origin-version evidence", async () => {
    const repository = createDatabaseQuestionSimilarityRepository(
      pgliteQuery(database),
    );
    const authorization = await requireProfessorReview();
    const originV1 = versions.get("origin-a")!;
    const siblingVersionId = versions.get("reserve-1")!;
    const initial = await repository.setLink(authorization, {
      action: "assign",
      expectedSimilarVersionId: siblingVersionId,
      originQuestionId: "origin-a",
      originVersionId: originV1,
      similarQuestionId: "reserve-1",
      slot: 1,
    });
    const oldLinkId = initial.find((link) => !link.revokedAt)!.id;
    await database.query(
      `insert into tutor_sessions (
         id, anonymous_user_id, question_id, question_version_id,
         solved, status, current_state, completed_at
       ) values ('origin-v1-evidence-session', 'anon:origin-revision',
         'origin-a', $1, true, 'completed', 'solved', now())`,
      [originV1],
    );
    await database.query(
      `insert into tutor_sessions (
         id, anonymous_user_id, question_id, question_version_id,
         practice_context, origin_session_id, solved, status, current_state,
         completed_at
       ) values ('origin-v1-sibling-evidence', 'anon:origin-revision',
         'reserve-1', $1, 'reserve_practice', 'origin-v1-evidence-session',
         true, 'completed', 'solved', now())`,
      [siblingVersionId],
    );
    const originV2 = await revisePublishedQuestion(database, "origin-a", originV1);

    await expect(
      repository.listEligibleForOrigin("origin-a", originV1),
    ).resolves.toEqual([]);
    await expect(
      repository.listCoverage(authorization, "similarity-topic"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eligibleSiblingCount: 0,
          originQuestionId: "origin-a",
          originVersionId: originV2,
        }),
      ]),
    );
    await repository.setLink(authorization, {
      action: "remove",
      expectedSimilarVersionId: siblingVersionId,
      linkId: oldLinkId,
      originQuestionId: "origin-a",
      originVersionId: originV1,
      similarQuestionId: "reserve-1",
      slot: 1,
    });
    await repository.setLink(authorization, {
      action: "assign",
      expectedSimilarVersionId: siblingVersionId,
      originQuestionId: "origin-a",
      originVersionId: originV2,
      similarQuestionId: "reserve-1",
      slot: 1,
    });

    await expect(
      repository.listEligibleForOrigin("origin-a", originV2),
    ).resolves.toHaveLength(1);
    await expect(
      database.query(
        `select origin_version_id, revoked_at is not null as revoked
         from question_similarity_links
         where origin_question_id = 'origin-a'
           and similar_question_id = 'reserve-1'
         order by id`,
      ),
    ).resolves.toMatchObject({
      rows: [
        { origin_version_id: originV1, revoked: true },
        { origin_version_id: originV2, revoked: false },
      ],
    });
    await expect(
      database.query(
        `select count(*)::int as count
         from tutor_sessions reserve_session
         join tutor_sessions origin_session
           on origin_session.id = reserve_session.origin_session_id
         join question_similarity_links link
           on link.origin_question_id = origin_session.question_id
          and link.origin_version_id = origin_session.question_version_id
          and link.similar_question_id = reserve_session.question_id
          and link.similar_version_id = reserve_session.question_version_id
         where reserve_session.id = 'origin-v1-sibling-evidence'`,
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("rejects direct SQL bypass for cross-topic links", async () => {
    await expect(
      insertLink(database, versions, "origin-a", "reserve-cross", 1),
    ).rejects.toThrow(/same topic/i);
  });

  it("enforces the exact active link on direct session inserts and preserves history after revocation", async () => {
    const inserted = await insertLink(
      database,
      versions,
      "origin-a",
      "reserve-1",
      1,
    );
    const linkId = Number(inserted.rows[0].id);
    await database.query(
      `insert into tutor_sessions (
         id, anonymous_user_id, question_id, question_version_id,
         solved, status, current_state, completed_at
       ) values ('origin-session-a', 'anon:similarity', 'origin-a', $1,
         true, 'completed', 'solved', now())`,
      [versions.get("origin-a")],
    );
    await expect(
      database.query(
        `insert into tutor_sessions (
           id, anonymous_user_id, question_id, question_version_id,
           practice_context, origin_session_id
         ) values ('similar-session-1', 'anon:similarity', 'reserve-1', $1,
           'reserve_practice', 'origin-session-a')`,
        [versions.get("reserve-1")],
      ),
    ).resolves.toBeDefined();
    await expect(
      database.query(
        `insert into tutor_sessions (
           id, anonymous_user_id, question_id, question_version_id,
           practice_context, origin_session_id
         ) values ('unlinked-session', 'anon:similarity', 'reserve-2', $1,
           'reserve_practice', 'origin-session-a')`,
        [versions.get("reserve-2")],
      ),
    ).rejects.toThrow(/active approved similar-practice relationship/i);

    await database.exec(
      "select set_config('app.similarity_link_write', 'allowed', false)",
    );
    await database.query(
      `update question_similarity_links
       set revoked_at = now(),
           revoked_by_user_id = 'user:similarity-professor'
       where id = $1`,
      [linkId],
    );
    await expect(
      database.query(
        `insert into tutor_sessions (
           id, anonymous_user_id, question_id, question_version_id,
           practice_context, origin_session_id
         ) values ('removed-link-session', 'anon:similarity', 'reserve-1', $1,
           'reserve_practice', 'origin-session-a')`,
        [versions.get("reserve-1")],
      ),
    ).rejects.toThrow(/active approved similar-practice relationship/i);
    await expect(
      database.query<{ count: number }>(
        "select count(*)::int as count from tutor_sessions where id = 'similar-session-1'",
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});

describe("migration 026 controlled backfill", () => {
  it("backfills only the reviewed Event Token v387 to Raffle Ticket v464 pair", async () => {
    const database = await databaseThrough(25);
    await seedReviewedBackfillPair(database, true);

    await applyMigration(database, 26);

    await expect(
      database.query(
        `select origin_question_id, similar_question_id, origin_version_id,
                similar_version_id, slot
         from question_similarity_links`,
      ),
    ).resolves.toMatchObject({
      rows: [
        {
          origin_question_id: "generated-syllabus-uniform-event-tokens",
          origin_version_id: 387,
          similar_question_id: "reserve-similar-uniform-raffle-tickets-1",
          similar_version_id: 464,
          slot: 1,
        },
      ],
    });
  });

  it("fails closed when only one known backfill record exists", async () => {
    const database = await databaseThrough(25);
    await seedReviewedBackfillPair(database, false);

    await expect(applyMigration(database, 26)).rejects.toThrow(
      /requires both the Event Token origin and Raffle Ticket sibling/i,
    );
  });
});

async function migratedDatabase() {
  return databaseThrough(26);
}

async function databaseThrough(maxVersion: number) {
  const database = new PGlite();
  databases.push(database);
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory)
    .filter((value) => value.endsWith(".sql"))
    .sort()
    .filter((value) => Number(value.slice(0, 3)) <= maxVersion)) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  return database;
}

async function applyMigration(database: PGlite, version: number) {
  const filename = readdirSync(path.join(process.cwd(), "db/migrations"))
    .filter((value) => value.startsWith(`${String(version).padStart(3, "0")}_`))
    .at(0);
  if (!filename) throw new Error(`Migration ${version} not found.`);
  return database.exec(
    readFileSync(path.join(process.cwd(), "db/migrations", filename), "utf8"),
  );
}

async function seedReviewedBackfillPair(
  database: PGlite,
  includeSibling: boolean,
) {
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values (
      'user:backfill-professor', 'test', 'backfill-professor',
      'backfill@example.invalid', 'Backfill Professor', 'active'
    );
    insert into user_roles (user_id, role_id)
      values ('user:backfill-professor', 'professor');
    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values ('backfill-topic', 'Backfill topic', '', 986, 1,
      'backfill-module', true);
    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'imported', false);
    select set_config('app.suppress_question_version', 'true', false);
  `);
  await insertBackfillQuestion(database, {
    id: "generated-syllabus-uniform-event-tokens",
    prompt: "There are 100 equally likely event tokens and 25 are winners.",
    title: "Event Token Probability",
  });
  await database.exec(
    "select set_config('app.suppress_question_version', 'false', false)",
  );
  await database.exec("select setval('question_versions_id_seq', 386, true)");
  await database.query("select app_record_question_version($1)", [
    "generated-syllabus-uniform-event-tokens",
  ]);
  if (!includeSibling) return;

  await database.exec(
    "select set_config('app.suppress_question_version', 'true', false)",
  );
  await insertBackfillQuestion(database, {
    id: "reserve-similar-uniform-raffle-tickets-1",
    prompt: "A raffle has 25 tickets and 9 winners. Find the probability.",
    title: "Raffle Ticket Probability",
  });
  await database.exec(
    "select set_config('app.suppress_question_version', 'false', false)",
  );
  await database.exec("select setval('question_versions_id_seq', 463, true)");
  await database.query("select app_record_question_version($1)", [
    "reserve-similar-uniform-raffle-tickets-1",
  ]);
  await database.query(
    `select * from app_transition_question_version(
      $1, 464, 'unpublish', 'user:backfill-professor',
      'Backfill Professor', 'published', 'content_correction', null,
      'backfill-unpublish', 'backfill-request', '{}'::jsonb
    )`,
    ["reserve-similar-uniform-raffle-tickets-1"],
  );
  await database.exec(
    "select set_config('app.reserve_write', 'allowed', false)",
  );
  await database.exec(`
    update questions
    set is_reserved = true,
        reserve_practice_allowed = true,
        reserve_reason_code = 'extra_practice',
        reserved_by_user_id = 'user:backfill-professor',
        reserved_at = now()
    where id = 'reserve-similar-uniform-raffle-tickets-1';
  `);
}

async function insertBackfillQuestion(
  database: PGlite,
  input: { id: string; prompt: string; title: string },
) {
  await database.query(
    `insert into questions (
       id, topic_id, title, prompt, difficulty, accepted_answers_json,
       answer_explanation, source_type, trust_level, review_status,
       visibility, originality_note, reviewed_by, reviewed_by_user_id,
       reviewed_at
     ) values ($1, 'backfill-topic', $2, $3, 'foundational',
       '["0.36"]'::jsonb, 'Divide winners by total.', 'professor_provided',
       'public_original', 'approved', 'public', 'Original reviewed content.',
       'Backfill Professor', 'user:backfill-professor', now())`,
    [input.id, input.title, input.prompt],
  );
  await database.query(
    "insert into hints (question_id, hint_order, body) values ($1, 1, 'Count winning outcomes.')",
    [input.id],
  );
  await database.query(
    "insert into solution_steps (question_id, step_order, body) values ($1, 1, 'Divide winners by total outcomes.')",
    [input.id],
  );
}

async function seedContent(database: PGlite) {
  const questionIds = [
    "origin-a",
    "origin-b",
    "reserve-1",
    "reserve-2",
    "reserve-3",
    "reserve-4",
    "reserve-cross",
  ];
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values (
      'user:similarity-professor', 'test', 'similarity-professor',
      'similarity@example.invalid', 'Similarity Professor', 'active'
    );
    insert into user_roles (user_id, role_id)
      values ('user:similarity-professor', 'professor');
    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values ('similarity-topic', 'Similarity topic', '', 987, 1,
      'similarity-module', true),
      ('other-similarity-topic', 'Other similarity topic', '', 988, 1,
      'other-similarity-module', true);
    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'imported', false);
    select set_config('app.suppress_question_version', 'true', false);
  `);
  for (const questionId of questionIds) {
    await database.query(
      `insert into questions (
         id, topic_id, title, prompt, difficulty, accepted_answers_json,
         answer_explanation, source_type, trust_level, review_status,
         visibility, originality_note, reviewed_by, reviewed_by_user_id,
         reviewed_at
       ) values ($1, $4, $2, $3, 'foundational',
         '["0.5"]'::jsonb, 'Divide one by two.', 'professor_provided',
         'public_original', 'approved', 'public', 'Original test content.',
         'Similarity Professor', 'user:similarity-professor', now())`,
      [
        questionId,
        `Title ${questionId}`,
        `Prompt ${questionId}`,
        questionId === "reserve-cross"
          ? "other-similarity-topic"
          : "similarity-topic",
      ],
    );
    await database.query(
      "insert into hints (question_id, hint_order, body) values ($1, 1, 'Count outcomes.')",
      [questionId],
    );
    await database.query(
      "insert into solution_steps (question_id, step_order, body) values ($1, 1, 'Compute the probability.')",
      [questionId],
    );
  }
  await database.exec(
    "select set_config('app.suppress_question_version', 'false', false)",
  );
  for (const questionId of questionIds) {
    await database.query("select app_record_question_version($1)", [
      questionId,
    ]);
  }

  const rows = await database.query<{ id: number; question_id: string }>(
    `select coalesce(published_version_id, working_version_id) as id,
            id as question_id
     from questions`,
  );
  const versions = new Map(
    rows.rows.map((row) => [row.question_id, Number(row.id)]),
  );
  for (const questionId of questionIds.filter((id) =>
    id.startsWith("reserve"),
  )) {
    await database.query(
      `select * from app_transition_question_version(
        $1, $2, 'unpublish', $3, $4, 'published', 'content_correction',
        null, $5, $6, '{}'::jsonb
      )`,
      [
        questionId,
        versions.get(questionId),
        "user:similarity-professor",
        "Similarity Professor",
        `unpublish:${questionId}`,
        `request:${questionId}`,
      ],
    );
  }
  await database.exec(
    "select set_config('app.reserve_write', 'allowed', false)",
  );
  await database.exec(`
    update questions
    set is_reserved = true,
        reserve_practice_allowed = true,
        reserve_reason_code = 'extra_practice',
        reserved_by_user_id = 'user:similarity-professor',
        reserved_at = now()
    where id like 'reserve-%';
  `);
  return versions;
}

async function reviseReserveQuestion(
  database: PGlite,
  questionId: string,
  previousVersionId: number,
) {
  await database.exec(
    "select set_config('app.reserve_write', 'allowed', false)",
  );
  await database.query(
    `update questions
     set is_reserved = false,
         reserve_practice_allowed = false,
         reserve_reason_code = null,
         reserved_by_user_id = null,
         reserved_at = null
     where id = $1`,
    [questionId],
  );
  const versionId = await insertRevision(database, previousVersionId);
  for (const [action, expectedState] of [
    ["submit", "draft"],
    ["approve", "needs_review"],
  ] as const) {
    await database.query(
      `select * from app_transition_question_version(
        $1, $2, $3, 'user:similarity-professor',
        'Similarity Professor', $4
      )`,
      [questionId, versionId, action, expectedState],
    );
  }
  await database.query(
    `update questions
     set is_reserved = true,
         reserve_practice_allowed = true,
         reserve_reason_code = 'extra_practice',
         reserved_by_user_id = 'user:similarity-professor',
         reserved_at = now()
     where id = $1`,
    [questionId],
  );
  return versionId;
}

async function revisePublishedQuestion(
  database: PGlite,
  questionId: string,
  previousVersionId: number,
) {
  const versionId = await insertRevision(database, previousVersionId);
  for (const [action, expectedState] of [
    ["submit", "draft"],
    ["approve", "needs_review"],
    ["publish", "approved"],
  ] as const) {
    await database.query(
      `select * from app_transition_question_version(
        $1, $2, $3, 'user:similarity-professor',
        'Similarity Professor', $4
      )`,
      [questionId, versionId, action, expectedState],
    );
  }
  return versionId;
}

async function insertRevision(database: PGlite, previousVersionId: number) {
  const result = await database.query<{ id: number }>(
    `insert into question_versions (
       question_id, version_number, snapshot_json, content_hash,
       created_by_user_id, parent_version_id, creation_method,
       schema_version, content_sha256, generation_metadata_json
     ) select
       question_id, version_number + 1, snapshot_json, content_hash,
       'user:similarity-professor', id, 'manual', schema_version,
       content_sha256, '{}'::jsonb
     from question_versions where id = $1
     returning id`,
    [previousVersionId],
  );
  return Number(result.rows[0].id);
}

function insertLink(
  database: PGlite,
  versions: Map<string, number>,
  originQuestionId: string,
  similarQuestionId: string,
  slot: number,
) {
  return database.query<{ id: number }>(
    `insert into question_similarity_links (
       origin_question_id, similar_question_id, origin_version_id,
       similar_version_id, relationship_type, slot, created_by_user_id
    ) values ($1, $2, $3, $4, 'similar_practice', $5,
       'user:similarity-professor')
     returning id`,
    [
      originQuestionId,
      similarQuestionId,
      versions.get(originQuestionId),
      versions.get(similarQuestionId),
      slot,
    ],
  );
}

function pgliteQuery(database: PGlite): DatabaseQueryExecutor {
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query<Record<string, unknown>>(sql, params);
    return result.rows;
  };
  query.transaction = async (work) => {
    await database.exec("begin");
    try {
      const result = await work(query);
      await database.exec("commit");
      return result;
    } catch (cause) {
      await database.exec("rollback");
      throw cause;
    }
  };
  return query;
}
