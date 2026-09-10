import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  REVIEW_CANDIDATE_FILES,
  ReviewCandidateImportValidationError,
  importPublicReviewCandidates,
  loadPublicReviewCandidateFixtures,
  resolveReviewCandidateDatabaseUrl,
  sameStoredReviewCandidateSnapshot,
  validatePublicReviewCandidateFixtures,
  type ImportClient,
  type PublicReviewCandidateFixtures,
} from "../scripts/lib/review-candidate-import.mjs";
import { requireProfessorReview } from "@/lib/auth/authorization";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseQuestionLifecycleRepository } from "@/lib/data/question-lifecycle-repository";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

const migrationDirectory = path.join(process.cwd(), "db/migrations");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const openDatabases: PGlite[] = [];
const EXPECTED_COUNTS_BY_TOPIC = {
  "axioms-probability-counting-methods": 33,
  "binomial-models": 32,
  "central-limit-theorem": 20,
  "chebyshev-law-large-numbers": 20,
  "conditional-probability": 24,
  "continuous-random-variables": 20,
  "independent-random-variables-sums-correlation": 20,
  "introduction-probability-venn-diagrams": 31,
  "moment-generating-functions-joint-distributions": 20,
  "normal-standardization": 20,
  "random-variables": 24,
};

afterEach(async () => {
  resetAuthMocks();
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

describe("public review-candidate fixture validation", () => {
  it("uses DATABASE_URL first and falls back to managed POSTGRES_URL", () => {
    expect(
      resolveReviewCandidateDatabaseUrl({
        DATABASE_URL: "postgresql://explicit.example/database",
        POSTGRES_URL: "postgresql://managed.example/database",
      }),
    ).toBe("postgresql://explicit.example/database");
    expect(
      resolveReviewCandidateDatabaseUrl({
        DATABASE_URL: "   ",
        POSTGRES_URL: " postgresql://managed.example/database ",
      }),
    ).toBe("postgresql://managed.example/database");
    expect(resolveReviewCandidateDatabaseUrl({})).toBeUndefined();
  });

  it("loads all canonical topics and more than 250 unique public-safe drafts", async () => {
    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());

    expect(fixtures.topics).toHaveLength(11);
    expect(fixtures.candidates).toHaveLength(264);
    expect(REVIEW_CANDIDATE_FILES).toHaveLength(7);
    expect(
      REVIEW_CANDIDATE_FILES.every(
        (sourceFile) =>
          sourceFile.startsWith("data/demo/") &&
          !sourceFile.includes("private"),
      ),
    ).toBe(true);
    expect(
      new Set(fixtures.candidates.map(({ candidate }) => candidate.id)).size,
    ).toBe(264);
    expect(
      fixtures.candidates.every(
        ({ candidate }) =>
          candidate.review.status === "needs_review" &&
          candidate.source.sourceType === "generated_original" &&
          candidate.source.trustLevel === "generated_unverified" &&
          candidate.source.visibility === "public" &&
          !candidate.source.patternIds?.length,
      ),
    ).toBe(true);
  });

  it("rejects duplicate IDs, invalid topic references, and private-source fields", async () => {
    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());

    const duplicate = structuredClone(fixtures);
    duplicate.candidates.push(structuredClone(duplicate.candidates[0]));
    expectValidationFailure(duplicate, /duplicates candidate ID/);

    const invalidTopic = structuredClone(fixtures);
    invalidTopic.candidates[0].candidate.topicId = "missing-topic";
    expectValidationFailure(invalidTopic, /active canonical topic/);

    const privateField = structuredClone(fixtures);
    (
      privateField.candidates[0]
        .candidate as (typeof privateField.candidates)[number]["candidate"] & {
        sourceLocator?: string;
      }
    ).sourceLocator = "private-page-1";
    expectValidationFailure(privateField, /forbidden private-source field/);

    const unapprovedPath = structuredClone(fixtures);
    unapprovedPath.candidates[0].sourceFile =
      "data/private/unapproved-review-candidates.json";
    expectValidationFailure(unapprovedPath, /not an allowed public fixture/);

    const unlinkedPattern = structuredClone(fixtures);
    unlinkedPattern.candidates[0].candidate.source.sourceType =
      "pattern_derived_original";
    expectValidationFailure(unlinkedPattern, /exactly one catalogued pattern/);

    const generatedWithPattern = structuredClone(fixtures);
    generatedWithPattern.candidates[0].candidate.source.patternIds = [
      "pattern-should-not-be-invented",
    ];
    expectValidationFailure(
      generatedWithPattern,
      /empty for generated_original/,
    );
  });
});

describe("production-safe review-candidate database import", () => {
  it("rejects pattern-derived provenance when the catalogued pattern is not in the database", async () => {
    const database = await migratedDatabase();
    const allFixtures = await loadPublicReviewCandidateFixtures(process.cwd());
    const fixtures = {
      candidates: structuredClone(allFixtures.candidates.slice(0, 1)),
      topics: structuredClone(allFixtures.topics),
    };
    fixtures.candidates[0].candidate.source.sourceType =
      "pattern_derived_original";
    fixtures.candidates[0].candidate.source.patternIds = [
      "pattern-not-approved-in-database",
    ];
    fixtures.candidates[0].candidate.patternSource =
      "pattern-not-approved-in-database / test pattern";

    await expect(
      importPublicReviewCandidates({
        client: importClient(database),
        dryRun: false,
        fixtures,
        target: "test",
      }),
    ).rejects.toMatchObject({
      issues: [expect.stringMatching(/not present in question_patterns/i)],
    });

    const counts = await database.query<{ questions: number; topics: number }>(`
      select
        (select count(*)::int from questions) as questions,
        (select count(*)::int from topics) as topics
    `);
    expect(counts.rows[0]).toEqual({ questions: 0, topics: 0 });
  });

  it("imports an authored typed candidate without converting legacy candidates or rewriting snapshots on replay", async () => {
    const database = await migratedDatabase();
    const all = await loadPublicReviewCandidateFixtures(process.cwd());
    const fixtures = {
      candidates: structuredClone(all.candidates.slice(0, 2)),
      topics: structuredClone(all.topics),
    };
    const candidate = fixtures.candidates[0].candidate;
    const spec = {
      kind: "categorical" as const,
      canonical: candidate.answer.acceptedAnswers[0],
      aliases: candidate.answer.acceptedAnswers,
    };
    candidate.answer.spec = spec;
    await importPublicReviewCandidates({
      client: importClient(database),
      dryRun: false,
      fixtures,
      target: "test",
    });
    const before = (
      await database.query(
        "select snapshot_json, content_sha256 from question_versions order by id",
      )
    ).rows;
    expect(before[0]).toMatchObject({ snapshot_json: { answer: { spec } } });
    expect(
      (before[1] as { snapshot_json: { answer?: unknown } }).snapshot_json
        .answer,
    ).toBeUndefined();
    await importPublicReviewCandidates({
      client: importClient(database),
      dryRun: false,
      fixtures,
      target: "test",
    });
    expect(
      (
        await database.query(
          "select snapshot_json, content_sha256 from question_versions order by id",
        )
      ).rows,
    ).toEqual(before);
  });

  it("persists a verified catalogued pattern in the question and immutable snapshot", async () => {
    const database = await migratedDatabase();
    const allFixtures = await loadPublicReviewCandidateFixtures(process.cwd());
    const fixtures = {
      candidates: structuredClone(allFixtures.candidates.slice(0, 1)),
      topics: structuredClone(allFixtures.topics),
    };
    const candidate = fixtures.candidates[0].candidate;
    const patternId = "pattern-approved-for-import-test";
    candidate.source.sourceType = "pattern_derived_original";
    candidate.source.patternIds = [patternId];
    candidate.patternSource = `${patternId} / approved test pattern`;

    const topic = fixtures.topics.find(
      (item) => item.id === candidate.topicId,
    )!;
    await database.query(
      `insert into topics (
         id, title, description, sort_order, week_number, module_ref, is_active
       ) values ($1, $2, $3, $4, $5, $6, true)`,
      [
        topic.id,
        topic.title,
        topic.description,
        topic.order,
        topic.weekNumber,
        topic.moduleRef,
      ],
    );
    await createProfessor(database);
    await database.query(
      `insert into question_patterns (
         id, topic_id, title, description, difficulty,
         reviewed_by_user_id, reviewed_at, created_at
       ) values (
         $1, $2, 'Approved test pattern', 'Public-safe import test pattern',
         'foundational', 'user:import-test-professor', now(), now()
       )`,
      [patternId, candidate.topicId],
    );

    await importPublicReviewCandidates({
      client: importClient(database),
      dryRun: false,
      fixtures,
      target: "test",
    });

    const stored = await database.query<{
      pattern_id: string;
      snapshot_pattern_id: string;
    }>(
      `select
         q.pattern_id,
         qv.snapshot_json ->> 'patternId' as snapshot_pattern_id
       from questions q
       join question_versions qv on qv.id = q.working_version_id
       where q.id = $1`,
      [candidate.id],
    );
    expect(stored.rows[0]).toEqual({
      pattern_id: patternId,
      snapshot_pattern_id: patternId,
    });

    await transition(database, candidate.id, "approve");
    await transition(database, candidate.id, "publish");
    const publicQuestion = await database.query<{ count: number }>(
      `select count(*)::int as count
       from app_public_questions
       where id = $1`,
      [candidate.id],
    );
    expect(publicQuestion.rows[0].count).toBe(1);
  });

  it("imports topics and 264 drafts idempotently for professors while students see none", async () => {
    const database = await migratedDatabase();
    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());
    const client = importClient(database);

    const first = await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures,
      target: "test",
    });

    const second = await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures,
      target: "test",
    });

    expect(first).toMatchObject({
      candidates: {
        inserted: 264,
        preservedProfessorReviewed: 0,
        skipped: 0,
        total: 264,
      },
      committed: true,
      topics: { inserted: 11, skipped: 0, total: 11, updated: 0 },
    });
    expect(second).toMatchObject({
      candidates: {
        inserted: 0,
        preservedProfessorReviewed: 0,
        skipped: 264,
        total: 264,
      },
      committed: true,
      topics: { inserted: 0, skipped: 11, total: 11, updated: 0 },
    });

    mockPrincipal(TEST_PROFESSOR);
    const authorization = await requireProfessorReview();
    const lifecycleRepository = createDatabaseQuestionLifecycleRepository(
      queryExecutor(database),
    );
    const topicSummaries =
      await lifecycleRepository.listReviewTopicSummaries(authorization);
    const firstTopicCandidates = await lifecycleRepository.listReviewCandidates(
      authorization,
      fixtures.topics[0].id,
    );

    expect(topicSummaries).toHaveLength(11);
    expect(
      topicSummaries.reduce((total, topic) => total + topic.needsReview, 0),
    ).toBe(264);
    expect(
      Object.fromEntries(
        topicSummaries.map((topic) => [topic.topicId, topic.needsReview]),
      ),
    ).toEqual(EXPECTED_COUNTS_BY_TOPIC);
    expect(firstTopicCandidates).toHaveLength(31);

    const studentRepository = createDatabaseContentRepository(
      "postgresql://unused.invalid/database",
      queryExecutor(database),
    );
    const [topics, questions, counts, topicQuestions, retrieval] =
      await Promise.all([
        studentRepository.listTopics(),
        studentRepository.listQuestions(),
        studentRepository.getQuestionCounts(),
        studentRepository.listQuestionsByTopic(fixtures.topics[0].id),
        studentRepository.getRetrievalChunks(),
      ]);

    expect(topics).toHaveLength(11);
    expect(questions).toEqual([]);
    expect(counts).toEqual({ byTopic: {}, total: 0 });
    expect(topicQuestions).toEqual([]);
    expect(retrieval).toEqual([]);

    const databaseState = await database.query<{
      candidate_count: number;
      published_count: number;
      private_metadata_count: number;
    }>(`
        select
          count(*)::int as candidate_count,
          count(*) filter (where q.published_version_id is not null)::int
            as published_count,
          count(*) filter (
            where qv.generation_metadata_json::text ~*
              '(sourceLocator|sourceItemId|phraseHash|rawText|extractedText|privateChunk)'
          )::int as private_metadata_count
        from questions q
        join question_versions qv on qv.id = q.working_version_id
      `);
    expect(databaseState.rows[0]).toEqual({
      candidate_count: 264,
      private_metadata_count: 0,
      published_count: 0,
    });
  }, 30_000);

  it("treats only database float serialization noise as an exact snapshot", () => {
    const expected = {
      numericValue: 0.5714285714285714,
      prompt: "A public-safe probability question",
      tolerance: 0.00000000000000014,
    };

    expect(
      sameStoredReviewCandidateSnapshot(
        {
          ...expected,
          numericValue: 0.571428571428571,
          tolerance: 0.00000000000000013999999999999999,
        },
        expected,
      ),
    ).toBe(true);
    expect(
      sameStoredReviewCandidateSnapshot(
        { ...expected, numericValue: 1.36666666666667 },
        { ...expected, numericValue: 1.3666666666666667 },
      ),
    ).toBe(true);
    expect(
      sameStoredReviewCandidateSnapshot(
        { ...expected, numericValue: 0.5714 },
        expected,
      ),
    ).toBe(false);
    expect(
      sameStoredReviewCandidateSnapshot(
        { ...expected, prompt: "Professor-edited prompt" },
        expected,
      ),
    ).toBe(false);
  });

  it("preserves approved, rejected, and materially edited existing questions", async () => {
    const database = await migratedDatabase();
    const allFixtures = await loadPublicReviewCandidateFixtures(process.cwd());
    const fixtures = {
      candidates: structuredClone(allFixtures.candidates.slice(0, 3)),
      topics: structuredClone(allFixtures.topics),
    };
    const client = importClient(database);
    await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures,
      target: "test",
    });
    await createProfessor(database);

    const databaseProfessor = {
      ...TEST_PROFESSOR,
      userId: "user:import-test-professor",
    };
    mockPrincipal(databaseProfessor);
    const uploadAuthorization = await requireProfessorReview();
    const contentRepository = createDatabaseContentRepository(
      "postgresql://unused.invalid/database",
      queryExecutor(database),
    );
    const uploadedCandidate = structuredClone(
      allFixtures.candidates[3].candidate,
    );
    const uploaded = await contentRepository.importReviewCandidates(
      uploadAuthorization,
      [uploadedCandidate],
    );
    const repeatedUpload = await contentRepository.importReviewCandidates(
      uploadAuthorization,
      [uploadedCandidate],
    );
    expect(uploaded.candidates).toHaveLength(1);
    expect(repeatedUpload.candidates).toEqual([]);
    const uploadedState = await database.query<{ state: string }>(
      `select qvl.state
         from questions q
         join question_version_lifecycle qvl
           on qvl.question_version_id = q.working_version_id
         where q.id = $1`,
      [uploadedCandidate.id],
    );
    expect(uploadedState.rows[0]?.state).toBe("needs_review");

    const [approved, rejected, edited] = fixtures.candidates.map(
      ({ candidate }) => candidate,
    );
    await transition(database, approved.id, "approve");
    await transition(database, rejected.id, "reject", "fixture-rejected");
    await database.query(
      `select
           set_config('app.current_user_id', 'user:import-test-professor', true),
           set_config('app.current_creation_method', 'manual', true)`,
    );
    await database.query("update questions set prompt = $2 where id = $1", [
      edited.id,
      "Professor-edited wording that must be preserved.",
    ]);

    const repeated = await importPublicReviewCandidates({
      client,
      dryRun: false,
      fixtures,
      target: "test",
    });

    expect(repeated.candidates).toEqual({
      inserted: 0,
      preservedProfessorReviewed: 3,
      skipped: 0,
      total: 3,
    });
    const states = await database.query<{
      id: string;
      lifecycle_state: string;
      prompt: string;
    }>(
      `
        select q.id, qvc.lifecycle_state, qvc.prompt
        from questions q
        join app_question_version_content qvc
          on qvc.question_version_id = q.working_version_id
        where q.id = any($1::text[])
        order by q.id
      `,
      [[approved.id, rejected.id, edited.id]],
    );
    const stateById = new Map(states.rows.map((row) => [row.id, row]));

    expect(stateById.get(approved.id)?.lifecycle_state).toBe("approved");
    expect(stateById.get(rejected.id)?.lifecycle_state).toBe("rejected");
    expect(stateById.get(edited.id)?.prompt).toBe(
      "Professor-edited wording that must be preserved.",
    );
  }, 30_000);

  it("checks the complete plan without writing", async () => {
    const database = await migratedDatabase();
    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());

    const report = await importPublicReviewCandidates({
      client: importClient(database),
      dryRun: true,
      fixtures,
      target: "test",
    });

    expect(report).toMatchObject({
      candidates: { inserted: 264, total: 264 },
      committed: false,
      mode: "check",
      topics: { inserted: 11, total: 11 },
    });
    const counts = await database.query<{ questions: number; topics: number }>(`
      select
        (select count(*)::int from questions) as questions,
        (select count(*)::int from topics) as topics
    `);
    expect(counts.rows[0]).toEqual({ questions: 0, topics: 0 });
  });
});

function expectValidationFailure(
  fixtures: PublicReviewCandidateFixtures,
  message: RegExp,
) {
  try {
    validatePublicReviewCandidateFixtures(fixtures);
    throw new Error("Expected fixture validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewCandidateImportValidationError);
    expect(
      (error as ReviewCandidateImportValidationError).issues.join("\n"),
    ).toMatch(message);
  }
}

async function migratedDatabase() {
  const database = new PGlite();
  openDatabases.push(database);
  await database.waitReady;
  for (const migration of migrationFiles) {
    await database.exec(
      readFileSync(path.join(migrationDirectory, migration), "utf8"),
    );
  }
  return database;
}

function importClient(database: PGlite): ImportClient {
  return {
    async query(sql, params = []) {
      return database.query(sql, params as never[]);
    },
  };
}

function queryExecutor(database: PGlite | Transaction): DatabaseQueryExecutor {
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query<Record<string, unknown>>(
      sql,
      params as never[],
    );
    return result.rows;
  };
  if (database instanceof PGlite) {
    query.transaction = (work) =>
      database.transaction((transaction) => work(queryExecutor(transaction)));
  }
  return query;
}

async function createProfessor(database: PGlite) {
  await database.exec(`
    insert into users (
      id,
      identity_provider,
      external_subject,
      email,
      display_name,
      user_type,
      status
    )
    values (
      'user:import-test-professor',
      'clerk',
      'clerk_import_test_professor',
      'professor@example.invalid',
      'Import Test Professor',
      'human',
      'active'
    );
    insert into user_roles (user_id, role_id, granted_by_user_id)
    values (
      'user:import-test-professor',
      'professor',
      'system:schema-migration'
    );
  `);
}

async function transition(
  database: PGlite,
  questionId: string,
  action: "approve" | "publish" | "reject",
  reasonCode?: string,
) {
  await database.query(
    `
      select *
      from app_transition_question_version(
        $1,
        null,
        $2,
        'user:import-test-professor',
        'Import Test Professor',
        $4,
        $3,
        null,
        null,
        null,
        '{}'::jsonb
      )
    `,
    [
      questionId,
      action,
      reasonCode ?? null,
      action === "publish" ? "approved" : "needs_review",
    ],
  );
}
