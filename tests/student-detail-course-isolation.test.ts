import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { requireAnalyticsAccess } from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseInstructorStudentRepository } from "@/lib/data/instructor-student-repository";
import { mockPrincipal, resetAuthMocks, TEST_PROFESSOR } from "./auth-test-helpers";

const PS_COURSE = "probability-statistics";
const CALCULUS_COURSE = "calculus-1";
// Test-only rows in a throwaway database: one student who practiced in both
// courses, so any mixing shows up as a wrong count.
const STUDENT_KEY = createHash("sha256").update("anon:both-courses").digest("hex");

let database: PGlite;
let repository: ReturnType<typeof createDatabaseInstructorStudentRepository>;

beforeAll(async () => {
  database = new PGlite();
  const directory = path.join(process.cwd(), "db/migrations");
  for (const file of readdirSync(directory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()) {
    await database.exec(readFileSync(path.join(directory, file), "utf8"));
  }
  const query: DatabaseQueryExecutor = async (sql, params = []) =>
    (await database.query(sql, params)).rows as Record<string, unknown>[];
  repository = createDatabaseInstructorStudentRepository(query);

  await database.exec(`
    insert into topics (id, title, description, sort_order, course_id) values
      ('ps-detail-topic', 'PS detail topic', 'Test topic', 1, '${PS_COURSE}'),
      ('calc-detail-topic', 'Calculus detail topic', 'Test topic', 1, '${CALCULUS_COURSE}');
    insert into questions (id, topic_id, title, prompt, difficulty, accepted_answers_json, answer_explanation, source_type, trust_level, review_status, visibility)
    values
      ('ps-detail-question', 'ps-detail-topic', 'PS question', 'Prompt', 'foundational', '["1"]'::jsonb, 'Explanation.', 'original_demo', 'public_original', 'needs_review', 'public'),
      ('calc-detail-question', 'calc-detail-topic', 'Calculus question', 'Prompt', 'foundational', '["1"]'::jsonb, 'Explanation.', 'original_demo', 'public_original', 'needs_review', 'public');
    insert into tutor_sessions (id, anonymous_user_id, question_id, revealed_hints, status, current_state)
    values
      ('ps-detail-1', 'both-courses', 'ps-detail-question', 1, 'content_unpublished', 'working'),
      ('ps-detail-2', 'both-courses', 'ps-detail-question', 0, 'content_unpublished', 'working'),
      ('calc-detail-1', 'both-courses', 'calc-detail-question', 2, 'content_unpublished', 'working');
    insert into attempts (session_id, question_id, topic_id, mode, source, verdict)
    values
      ('ps-detail-1', 'ps-detail-question', 'ps-detail-topic', 'check', 'rule', 'incorrect'),
      ('ps-detail-2', 'ps-detail-question', 'ps-detail-topic', 'check', 'rule', 'correct'),
      ('calc-detail-1', 'calc-detail-question', 'calc-detail-topic', 'check', 'rule', 'incorrect'),
      ('calc-detail-1', 'calc-detail-question', 'calc-detail-topic', 'check', 'rule', 'incorrect'),
      ('calc-detail-1', 'calc-detail-question', 'calc-detail-topic', 'check', 'rule', 'correct');
  `);
}, 60_000);

afterEach(() => {
  resetAuthMocks();
});

afterAll(async () => {
  await database.close();
});

async function authorization() {
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}

describe("student record course isolation", () => {
  it("shows only Probability & Statistics activity in that course", async () => {
    const detail = await repository.getStudentDetail(
      await authorization(),
      STUDENT_KEY,
      { courseId: PS_COURSE },
    );

    expect(detail?.summary).toMatchObject({
      attempts: 2,
      correctAttempts: 1,
      hintsUsed: 1,
      sessions: 2,
      topicsPracticed: 1,
    });
    expect(detail?.topics.map((topic) => topic.topicId)).toEqual([
      "ps-detail-topic",
    ]);
    expect(JSON.stringify(detail)).not.toContain("calc-detail");
  });

  it("shows only Calculus I activity in that course", async () => {
    const detail = await repository.getStudentDetail(
      await authorization(),
      STUDENT_KEY,
      { courseId: CALCULUS_COURSE },
    );

    expect(detail?.summary).toMatchObject({
      attempts: 3,
      correctAttempts: 1,
      hintsUsed: 2,
      sessions: 1,
      topicsPracticed: 1,
    });
    expect(detail?.topics.map((topic) => topic.topicId)).toEqual([
      "calc-detail-topic",
    ]);
    expect(JSON.stringify(detail)).not.toContain("ps-detail");
  });

  it("keeps the combined record when no course is selected", async () => {
    const detail = await repository.getStudentDetail(
      await authorization(),
      STUDENT_KEY,
    );

    expect(detail?.summary).toMatchObject({
      attempts: 5,
      correctAttempts: 2,
      hintsUsed: 3,
      sessions: 3,
      topicsPracticed: 2,
    });
  });

  it("scopes the class list the same way", async () => {
    const list = async (courseId: string) =>
      repository.listStudents(await authorization(), { courseId });

    expect((await list(PS_COURSE)).students[0]).toMatchObject({
      attempts: 2,
      sessions: 2,
    });
    expect((await list(CALCULUS_COURSE)).students[0]).toMatchObject({
      attempts: 3,
      sessions: 1,
    });
  });

  it("reports no practice for a course the student has not used", async () => {
    await database.query(
      `insert into courses (id, title, sort_order) values ('empty-test-course', 'Empty', 9)`,
    );
    const detail = await repository.getStudentDetail(
      await authorization(),
      STUDENT_KEY,
      { courseId: "empty-test-course" },
    );

    // An anonymous student with no practice in that course is not in its class.
    expect(detail).toBeUndefined();
  });
});
