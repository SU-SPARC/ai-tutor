import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { requireProfessorReview } from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseQuestionLifecycleRepository } from "@/lib/data/question-lifecycle-repository";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

import type {
  ImportClient,
  PublicReviewCandidateFixtures,
} from "../scripts/lib/review-candidate-import.d.mts";
import {
  importPublicReviewCandidates,
  loadPublicReviewCandidateFixtures,
} from "../scripts/lib/review-candidate-import.mjs";
import {
  applyProvenanceRepair,
  buildProvenanceRepairPlan,
} from "../scripts/lib/review-candidate-provenance-repair.mjs";

const FAILING_QUESTION_ID = "generated-syllabus-venn-clubs";
const PATTERN_DERIVED_QUESTION_ID =
  "generated-additional-combinations-workshop-topics";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  resetAuthMocks();
});

describe("review-candidate provenance repair", () => {
  it("unblocks the publication gate by appending a corrected version without touching the stored snapshot", async () => {
    const database = await migratedDatabase();
    const client = pgliteClient(database);
    const fixtures = await legacyClassifiedFixtures();

    await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures,
      target: "test",
    });
    await seedProfessor(database);

    const importedVersionId = await workingVersionId(
      database,
      FAILING_QUESTION_ID,
    );
    const repository = createDatabaseQuestionLifecycleRepository(
      pgliteQuery(database),
    );
    const authorization = await professorAuthorization();

    // The imported draft is approvable but permanently unpublishable.
    await repository.transition(authorization, {
      action: "approve",
      expectedState: "needs_review",
      questionId: FAILING_QUESTION_ID,
      versionId: importedVersionId,
    });
    await expect(
      repository.transition(authorization, {
        action: "publish",
        expectedState: "approved",
        questionId: FAILING_QUESTION_ID,
        versionId: importedVersionId,
      }),
    ).rejects.toMatchObject({
      name: "QuestionPublicationBlockedError",
      reasons: [{ code: "invalid_source_classification" }],
    });

    const repairFixtures = await loadPublicReviewCandidateFixtures(
      process.cwd(),
    );
    const report = await applyProvenanceRepair({
      client,
      dryRun: false,
      fixtures: repairFixtures,
      only: new Set([FAILING_QUESTION_ID]),
      target: "test",
    });
    expect(report).toMatchObject({ committed: true, mode: "apply" });

    // The originally stored immutable version is byte-for-byte unchanged.
    const versions = await database.query<{
      creation_method: string;
      lifecycle_state: string;
      parent_version_id: number | null;
      source_type: string;
      pattern_id: string | null;
      trust_level: string;
      version_number: number;
    }>(
      `select
         qv.version_number,
         qv.creation_method,
         qv.parent_version_id,
         qv.snapshot_json ->> 'sourceType' as source_type,
         qv.snapshot_json ->> 'patternId' as pattern_id,
         qv.snapshot_json ->> 'trustLevel' as trust_level,
         qvl.state as lifecycle_state
       from question_versions qv
       join question_version_lifecycle qvl
         on qvl.question_version_id = qv.id
       where qv.question_id = $1
       order by qv.version_number`,
      [FAILING_QUESTION_ID],
    );
    expect(versions.rows).toEqual([
      {
        creation_method: "imported",
        lifecycle_state: "approved",
        parent_version_id: null,
        pattern_id: null,
        source_type: "pattern_derived_original",
        trust_level: "generated_unverified",
        version_number: 1,
      },
      {
        creation_method: "imported",
        lifecycle_state: "needs_review",
        parent_version_id: importedVersionId,
        pattern_id: null,
        source_type: "generated_original",
        trust_level: "generated_unverified",
        version_number: 2,
      },
    ]);

    // The prior approval never carries over to the corrected version.
    const correctedVersionId = await workingVersionId(
      database,
      FAILING_QUESTION_ID,
    );
    expect(correctedVersionId).not.toBe(importedVersionId);
    await expect(
      repository.transition(authorization, {
        action: "publish",
        expectedState: "needs_review",
        questionId: FAILING_QUESTION_ID,
        versionId: correctedVersionId,
      }),
    ).rejects.toThrow();

    await repository.transition(authorization, {
      action: "approve",
      expectedState: "needs_review",
      questionId: FAILING_QUESTION_ID,
      versionId: correctedVersionId,
    });
    await repository.transition(authorization, {
      action: "publish",
      expectedState: "approved",
      questionId: FAILING_QUESTION_ID,
      versionId: correctedVersionId,
    });

    const published = await database.query<{
      published_version_id: number;
      public_count: number;
    }>(
      `select
         q.published_version_id,
         (select count(*)::int from app_public_questions where id = $1)
           as public_count
       from questions q
       where q.id = $1`,
      [FAILING_QUESTION_ID],
    );
    expect(published.rows[0]).toEqual({
      public_count: 1,
      published_version_id: correctedVersionId,
    });

    const events = await database.query<{ action: string; to_state: string }>(
      `select action, to_state from question_lifecycle_events
       where question_id = $1 and question_version_id = $2
       order by id`,
      [FAILING_QUESTION_ID, correctedVersionId],
    );
    expect(events.rows).toEqual([
      { action: "create_version", to_state: "draft" },
      { action: "submit", to_state: "needs_review" },
      { action: "approve", to_state: "approved" },
      { action: "publish", to_state: "published" },
    ]);

    const audit = await database.query<{ action: string; outcome: string }>(
      `select action, outcome from audit_events
       where entity_id = $1 and action = 'question_lifecycle.publish'`,
      [FAILING_QUESTION_ID],
    );
    expect(audit.rows).toEqual([
      { action: "question_lifecycle.publish", outcome: "success" },
    ]);
  });

  it("never reclassifies a draft that evidences a catalogued pattern and stays idempotent", async () => {
    const database = await migratedDatabase();
    const client = pgliteClient(database);

    await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures: await legacyClassifiedFixtures(),
      target: "test",
    });

    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());
    const plan = await buildProvenanceRepairPlan(client, fixtures);
    const repairableIds = plan.repairable.map((entry) => entry.id);
    expect(repairableIds).toContain(FAILING_QUESTION_ID);
    expect(repairableIds).not.toContain(PATTERN_DERIVED_QUESTION_ID);
    expect(plan.blocked).toEqual([]);
    expect(plan.absent).toEqual([]);

    await applyProvenanceRepair({
      client,
      dryRun: false,
      fixtures,
      target: "test",
    });
    const second = await applyProvenanceRepair({
      client,
      dryRun: false,
      fixtures,
      target: "test",
    });
    expect(second.repaired).toEqual([]);
    expect(second.alreadyCorrect).toBe(repairableIds.length);

    const untouched = await database.query<{ count: number }>(
      `select count(*)::int as count from question_versions
       where question_id = $1`,
      [PATTERN_DERIVED_QUESTION_ID],
    );
    expect(untouched.rows[0].count).toBe(1);

    const stillBlocked = await database.query<{ code: string }>(
      `select code from app_question_publication_gate_failures(
         $1::text,
         (select working_version_id from questions where id = $1::text),
         'approved'
       )`,
      [PATTERN_DERIVED_QUESTION_ID],
    );
    expect(stillBlocked.rows.map((row) => row.code)).toContain(
      "invalid_source_classification",
    );
  });

  it("preserves a professor revision that exists only in the version snapshot", async () => {
    const database = await migratedDatabase();
    const client = pgliteClient(database);

    await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures: await legacyClassifiedFixtures(),
      target: "test",
    });
    await seedProfessor(database);

    // createRevision writes edits only into question_versions and leaves the
    // questions/hints projection stale, so a repair that rebuilt the snapshot
    // from that projection would silently revert the professor.
    const importedVersionId = await workingVersionId(
      database,
      FAILING_QUESTION_ID,
    );
    const repository = createDatabaseQuestionLifecycleRepository(
      pgliteQuery(database),
    );
    const authorization = await professorAuthorization();
    const base = await repository.getQuestion(authorization, FAILING_QUESTION_ID);
    const working = base!.workingVersion;
    await repository.createRevision(authorization, {
      baseVersionId: importedVersionId,
      expectedWorkingVersionId: importedVersionId,
      questionId: FAILING_QUESTION_ID,
      revision: {
        answer: working.answer,
        difficulty: working.difficulty,
        hints: ["Identify whether this is a Venn diagrams question."],
        misconceptions: working.misconceptions,
        prompt: working.prompt,
        solutionSteps: working.solutionSteps,
        title: working.title,
        topicId: working.topicId,
      },
    });

    const projection = await database.query<{ body: string }>(
      "select body from hints where question_id = $1 order by hint_order limit 1",
      [FAILING_QUESTION_ID],
    );
    expect(projection.rows[0].body).not.toContain("Venn diagrams");

    await applyProvenanceRepair({
      client,
      dryRun: false,
      fixtures: await loadPublicReviewCandidateFixtures(process.cwd()),
      only: new Set([FAILING_QUESTION_ID]),
      target: "test",
    });

    const corrected = await database.query<{
      hints: string;
      source_type: string;
    }>(
      `select
         qv.snapshot_json ->> 'hints' as hints,
         qv.snapshot_json ->> 'sourceType' as source_type
       from questions q
       join question_versions qv on qv.id = q.working_version_id
       where q.id = $1`,
      [FAILING_QUESTION_ID],
    );
    expect(corrected.rows[0].source_type).toBe("generated_original");
    expect(corrected.rows[0].hints).toContain(
      "Identify whether this is a Venn diagrams question.",
    );
  });

  it("keeps an unapproved corrected version unpublishable at the database gate", async () => {
    const database = await migratedDatabase();
    const client = pgliteClient(database);

    await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures: await legacyClassifiedFixtures(),
      target: "test",
    });
    await seedProfessor(database);
    await applyProvenanceRepair({
      client,
      dryRun: false,
      fixtures: await loadPublicReviewCandidateFixtures(process.cwd()),
      only: new Set([FAILING_QUESTION_ID]),
      target: "test",
    });

    const versionId = await workingVersionId(database, FAILING_QUESTION_ID);
    await expect(
      database.query(
        `select * from app_transition_question_version(
           $1, $2, 'publish', $3, $4, 'needs_review'
         )`,
        [
          FAILING_QUESTION_ID,
          versionId,
          "user:lifecycle-professor",
          "Lifecycle Professor",
        ],
      ),
    ).rejects.toThrow(/Illegal question lifecycle transition/i);

    const visibility = await database.query<{ count: number }>(
      `select count(*)::int as count from app_public_questions where id = $1`,
      [FAILING_QUESTION_ID],
    );
    expect(visibility.rows[0].count).toBe(0);
  });
});

/**
 * Production was seeded before the fixtures were reclassified, so every
 * imported draft still claims pattern_derived_original with no pattern ID.
 */
async function legacyClassifiedFixtures(): Promise<PublicReviewCandidateFixtures> {
  const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());
  return {
    ...fixtures,
    candidates: fixtures.candidates.map((entry) => ({
      ...entry,
      candidate: {
        ...entry.candidate,
        source: {
          ...entry.candidate.source,
          sourceType: "pattern_derived_original" as const,
        },
      },
    })),
  };
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

async function seedProfessor(database: PGlite) {
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values (
      'user:lifecycle-professor', 'test', 'professor-subject',
      'professor@lifecycle.invalid', 'Lifecycle Professor', 'active'
    );

    insert into user_roles (user_id, role_id)
    values ('user:lifecycle-professor', 'professor');
  `);
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

async function workingVersionId(database: PGlite, questionId: string) {
  const result = await database.query<{ working_version_id: number }>(
    "select working_version_id from questions where id = $1",
    [questionId],
  );
  return Number(result.rows[0].working_version_id);
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

function pgliteClient(database: PGlite): ImportClient {
  return {
    query: async <T extends Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ) => ({ rows: (await database.query<T>(sql, params as never[])).rows }),
  };
}
