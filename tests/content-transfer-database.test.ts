import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { requireProfessorReview } from "@/lib/auth/authorization";
import type { ContentTransferDocument } from "@/lib/content-transfer/types";
import { activeCanonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseQuestionLifecycleRepository } from "@/lib/data/question-lifecycle-repository";
import type { QuestionVersionState } from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";
import { validDocument, validQuestion } from "./content-transfer-test-helpers";

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
  resetAuthMocks();
});

describe("question content-transfer database import", () => {
  it("imports full aggregates and attributed review states without publishing", async () => {
    const database = await migratedDatabase();
    await seedProfessorAndTopics(database, 1);
    const authorization = await professorAuthorization();
    const repository = createDatabaseQuestionLifecycleRepository(
      pgliteQuery(database),
    );
    const states: QuestionVersionState[] = [
      "draft",
      "needs_review",
      "revision_requested",
      "approved",
      "rejected",
    ];
    const document = validDocument({
      questions: states.map((state, index) => importQuestion(index + 1, state)),
    });

    const result = await repository.importContentTransfer(authorization, {
      document,
      requestId: "request:successful-content-import",
    });

    expect(result.importedIds).toHaveLength(5);
    expect(result.importedStates).toEqual({
      approved: 1,
      draft: 1,
      needs_review: 1,
      rejected: 1,
      revision_requested: 1,
    });
    const lifecycleRows = await database.query<{
      id: string;
      published_version_id: number | null;
      state: string;
    }>(`
      select q.id, q.published_version_id, qvl.state
      from questions q
      join question_version_lifecycle qvl
        on qvl.question_version_id = q.working_version_id
      where q.id like 'imported-question-%'
      order by q.id
    `);
    expect(lifecycleRows.rows.map((row) => row.state)).toEqual([
      "draft",
      "needs_review",
      "revision_requested",
      "approved",
      "rejected",
    ]);
    expect(
      lifecycleRows.rows.every((row) => row.published_version_id === null),
    ).toBe(true);
    const aggregateCounts = await database.query<{
      hints: number;
      misconceptions: number;
      public_questions: number;
      solution_steps: number;
    }>(`
      select
        (select count(*)::int from hints where question_id like 'imported-question-%') as hints,
        (select count(*)::int from solution_steps where question_id like 'imported-question-%') as solution_steps,
        (select count(*)::int from misconceptions where question_id like 'imported-question-%') as misconceptions,
        (select count(*)::int from app_public_questions where id like 'imported-question-%') as public_questions
    `);
    expect(aggregateCounts.rows[0]).toEqual({
      hints: 5,
      misconceptions: 5,
      public_questions: 0,
      solution_steps: 5,
    });

    const attribution = await database.query<{
      actor_count: number;
      event_count: number;
      timestamp_count: number;
    }>(`
      select
        count(*)::int as event_count,
        count(*) filter (where actor_user_id = 'user:test-professor')::int as actor_count,
        count(occurred_at)::int as timestamp_count
      from question_lifecycle_events
      where question_id like 'imported-question-%'
    `);
    expect(attribution.rows[0].event_count).toBeGreaterThanOrEqual(9);
    expect(attribution.rows[0].actor_count).toBe(
      attribution.rows[0].event_count,
    );
    expect(attribution.rows[0].timestamp_count).toBe(
      attribution.rows[0].event_count,
    );

    const audit = await database.query<{
      action: string;
      actor_user_id: string;
      metadata_json: Record<string, unknown>;
      outcome: string;
      request_id: string;
    }>(
      `
      select action, actor_user_id, metadata_json, outcome, request_id
      from audit_events
      where id = $1
    `,
      [result.auditEventId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "content_transfer.import",
      actor_user_id: "user:test-professor",
      metadata_json: {
        importedCount: 5,
        schemaVersion: 1,
      },
      outcome: "success",
      request_id: "request:successful-content-import",
    });
    expect(JSON.stringify(audit.rows[0].metadata_json)).not.toMatch(
      /prompt|answer|hint|student|source/i,
    );

    const duplicateContent = importQuestion(6, "draft");
    duplicateContent.prompt = importQuestion(1, "draft").prompt;
    await expect(
      repository.importContentTransfer(authorization, {
        document: validDocument({ questions: [duplicateContent] }),
        requestId: "request:duplicate-content-import",
      }),
    ).rejects.toThrow(/content already exists/i);
    const afterDuplicate = await database.query<{ count: number }>(`
      select count(*)::int as count
      from questions
      where id like 'imported-question-%'
    `);
    expect(afterDuplicate.rows[0].count).toBe(5);
  });

  it("rolls back every row and the success audit when a later topic fails", async () => {
    const database = await migratedDatabase();
    await seedProfessorAndTopics(database, 1);
    const authorization = await professorAuthorization();
    const repository = createDatabaseQuestionLifecycleRepository(
      pgliteQuery(database),
    );
    const unavailableTopic = activeCanonicalSyllabusTopics[1];
    const document: ContentTransferDocument = validDocument({
      questions: [
        importQuestion(1, "draft"),
        importQuestion(2, "approved", unavailableTopic.id),
      ],
      topics: activeCanonicalSyllabusTopics.slice(0, 2).map((topic) => ({
        id: topic.id,
        order: topic.order,
        title: topic.title,
      })),
    });

    await expect(
      repository.importContentTransfer(authorization, {
        document,
        requestId: "request:rolled-back-content-import",
      }),
    ).rejects.toThrow(/syllabus topic is unavailable/i);

    const counts = await database.query<{
      audit_count: number;
      event_count: number;
      question_count: number;
    }>(`
      select
        (select count(*)::int from questions where id like 'imported-question-%') as question_count,
        (select count(*)::int from question_lifecycle_events where question_id like 'imported-question-%') as event_count,
        (select count(*)::int from audit_events where request_id = 'request:rolled-back-content-import') as audit_count
    `);
    expect(counts.rows[0]).toEqual({
      audit_count: 0,
      event_count: 0,
      question_count: 0,
    });
  });
});

function importQuestion(
  index: number,
  reviewState: QuestionVersionState,
  topicId = activeCanonicalSyllabusTopics[0].id,
) {
  if (reviewState === "published" || reviewState === "unpublished") {
    throw new Error("Published states are not importable.");
  }
  return validQuestion({
    misconceptions: [
      {
        feedback: "Use favorable outcomes divided by total outcomes.",
        id: `import-misconception-${index}`,
        matchTerms: ["2"],
      },
    ],
    reviewState,
    prompt: `${index} of ${index * 2} equally likely outcomes are favorable. What is the probability?`,
    stableId: `imported-question-${index}`,
    title: `Imported question ${index}`,
    topicId,
  });
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

async function seedProfessorAndTopics(database: PGlite, topicCount: number) {
  await database.query(
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values ($1, 'test', 'content-transfer-professor', $2, $3, 'active')`,
    [TEST_PROFESSOR.userId, TEST_PROFESSOR.email, TEST_PROFESSOR.displayName],
  );
  await database.query(
    "insert into user_roles (user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  for (const topic of activeCanonicalSyllabusTopics.slice(0, topicCount)) {
    await database.query(
      `insert into topics (
         id, title, description, sort_order, week_number, module_ref, is_active
       ) values ($1, $2, '', $3, $4, $5, true)`,
      [topic.id, topic.title, topic.order, topic.weekNumber, topic.moduleRef],
    );
  }
}

async function professorAuthorization() {
  mockPrincipal(TEST_PROFESSOR);
  return requireProfessorReview();
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
