import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import {
  REVIEW_CANDIDATE_FILES,
  ReviewCandidateImportValidationError,
  importPublicReviewCandidates,
  loadPublicReviewCandidateFixtures,
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
  "axioms-probability-counting-methods": 22,
  "binomial-models": 24,
  "central-limit-theorem": 20,
  "chebyshev-law-large-numbers": 20,
  "conditional-probability": 24,
  "continuous-random-variables": 20,
  "independent-random-variables-sums-correlation": 20,
  "introduction-probability-venn-diagrams": 20,
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
  it("loads all canonical topics and more than 200 unique public-safe drafts", async () => {
    const fixtures = await loadPublicReviewCandidateFixtures(process.cwd());

    expect(fixtures.topics).toHaveLength(11);
    expect(fixtures.candidates).toHaveLength(234);
    expect(REVIEW_CANDIDATE_FILES).toHaveLength(5);
    expect(
      REVIEW_CANDIDATE_FILES.every(
        (sourceFile) =>
          sourceFile.startsWith("data/demo/") &&
          !sourceFile.includes("private"),
      ),
    ).toBe(true);
    expect(
      new Set(fixtures.candidates.map(({ candidate }) => candidate.id)).size,
    ).toBe(234);
    expect(
      fixtures.candidates.every(
        ({ candidate }) =>
          candidate.review.status === "needs_review" &&
          candidate.source.trustLevel === "generated_unverified" &&
          candidate.source.visibility === "public",
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
  });
});

describe("production-safe review-candidate database import", () => {
  it("imports topics and 234 drafts idempotently for professors while students see none", async () => {
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
        inserted: 234,
        preservedProfessorReviewed: 0,
        skipped: 0,
        total: 234,
      },
      committed: true,
      topics: { inserted: 11, skipped: 0, total: 11, updated: 0 },
    });
    expect(second).toMatchObject({
      candidates: {
        inserted: 0,
        preservedProfessorReviewed: 0,
        skipped: 234,
        total: 234,
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
    ).toBe(234);
    expect(
      Object.fromEntries(
        topicSummaries.map((topic) => [topic.topicId, topic.needsReview]),
      ),
    ).toEqual(EXPECTED_COUNTS_BY_TOPIC);
    expect(firstTopicCandidates).toHaveLength(20);

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
      candidate_count: 234,
      private_metadata_count: 0,
      published_count: 0,
    });
  }, 30_000);

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
      candidates: { inserted: 234, total: 234 },
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
  action: "approve" | "reject",
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
        'needs_review',
        $3,
        null,
        null,
        null,
        '{}'::jsonb
      )
    `,
    [questionId, action, reasonCode ?? null],
  );
}
