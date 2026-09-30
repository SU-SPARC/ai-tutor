import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { requireProfessorReview } from "@/lib/auth/authorization";
import { createDatabaseContentAvailabilityRepository } from "@/lib/data/content-availability-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import {
  getContentAvailabilityDashboard,
  setContentAvailabilityRepositoryForTests,
  setContentRepositoryForTests,
} from "@/lib/data/data-store";
import { demoContentRepository } from "@/lib/data/demo-repository";
import { mockPrincipal, resetAuthMocks, TEST_PROFESSOR } from "./auth-test-helpers";

const PS_COURSE = "probability-statistics";
const CALCULUS_COURSE = "calculus-1";
const PS_TOPIC = "introduction-probability-venn-diagrams";
const PS_QUESTION = "demo-basic-probability-colored-tickets";
// Test-only rows. They exist in this throwaway database to prove isolation and
// are not course content.
const CALC_TEST_TOPIC = "test-only-calculus-topic";
const CALC_TEST_QUESTION = "test-only-calculus-question";
const PS_CHUNK = "course-test-ps-chunk";
const CALC_CHUNK = "course-test-calculus-chunk";
const SEED_PROFESSOR = "user:development-seed-professor";

const openDatabases: PGlite[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  setContentAvailabilityRepositoryForTests(undefined);
  setContentRepositoryForTests(undefined);
  resetAuthMocks();
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("course-scoped content (database)", () => {
  it("lists the registered courses in display order", async () => {
    const { repository } = await seededRepository();

    expect(await repository.listCourses()).toEqual([
      {
        active: true,
        code: "MATH-255",
        id: PS_COURSE,
        order: 1,
        title: "Probability & Statistics",
      },
      {
        active: true,
        code: null,
        id: CALCULUS_COURSE,
        order: 2,
        title: "Calculus I",
      },
    ]);
  });

  it("scopes topics to a course and keeps Probability & Statistics intact", async () => {
    const { repository } = await seededRepository();

    const probability = await repository.listTopics({ courseId: PS_COURSE });
    const calculus = await repository.listTopics({ courseId: CALCULUS_COURSE });
    const everything = await repository.listTopics();

    expect(probability).toHaveLength(11);
    expect(probability.every((topic) => topic.courseId === PS_COURSE)).toBe(true);
    expect(calculus.map((topic) => topic.id)).toEqual([CALC_TEST_TOPIC]);
    expect(everything).toHaveLength(12);
    // Probability & Statistics comes first across courses.
    expect(everything.at(-1)?.id).toBe(CALC_TEST_TOPIC);
  });

  it("scopes published questions and counts to a course", async () => {
    const { repository } = await seededRepository();

    const probability = await repository.listQuestions({ courseId: PS_COURSE });
    const calculus = await repository.listQuestions({
      courseId: CALCULUS_COURSE,
    });
    const probabilityCounts = await repository.getQuestionCounts({
      courseId: PS_COURSE,
    });
    const calculusCounts = await repository.getQuestionCounts({
      courseId: CALCULUS_COURSE,
    });

    expect(probability.map((question) => question.id)).toContain(PS_QUESTION);
    expect(probability.map((question) => question.id)).not.toContain(
      CALC_TEST_QUESTION,
    );
    expect(calculus.map((question) => question.id)).toEqual([
      CALC_TEST_QUESTION,
    ]);
    expect(probabilityCounts.byTopic[CALC_TEST_TOPIC]).toBeUndefined();
    expect(calculusCounts).toEqual({
      byTopic: { [CALC_TEST_TOPIC]: 1 },
      total: 1,
    });
    expect((await repository.listQuestions()).length).toBe(
      probability.length + 1,
    );
  });

  it("resolves a direct question link without naming a course", async () => {
    const { repository } = await seededRepository();

    const question = await repository.getQuestionById(CALC_TEST_QUESTION);
    const topicCourses = await repository.listTopicCourses();

    expect(question?.topicId).toBe(CALC_TEST_TOPIC);
    expect(
      topicCourses.find((entry) => entry.topicId === question?.topicId)
        ?.courseId,
    ).toBe(CALCULUS_COURSE);
    expect(
      (await repository.getQuestionById(PS_QUESTION))?.topicId,
    ).toBe(PS_TOPIC);
  });

  it("never returns another course's retrieval chunks", async () => {
    const { repository } = await seededRepository();

    const probability = await repository.getRetrievalChunks({
      courseId: PS_COURSE,
    });
    const calculus = await repository.getRetrievalChunks({
      courseId: CALCULUS_COURSE,
    });

    expect(probability.map((chunk) => chunk.id)).toContain(PS_CHUNK);
    expect(probability.map((chunk) => chunk.id)).not.toContain(CALC_CHUNK);
    expect(calculus.map((chunk) => chunk.id)).toEqual([CALC_CHUNK]);
    expect(
      (await repository.getRetrievalChunks()).map((chunk) => chunk.id),
    ).toEqual(expect.arrayContaining([PS_CHUNK, CALC_CHUNK]));
  });

  it("filters the professor question and review lists by course", async () => {
    const { repository } = await seededRepository();
    mockPrincipal(TEST_PROFESSOR);
    const authorization = await requireProfessorReview();

    const probabilityQuestions = await repository.getAdminQuestions(
      authorization,
      { courseId: PS_COURSE },
    );
    const calculusQuestions = await repository.getAdminQuestions(
      authorization,
      { courseId: CALCULUS_COURSE },
    );
    const calculusQueue = await repository.getReviewQueue(authorization, {
      courseId: CALCULUS_COURSE,
    });

    expect(probabilityQuestions.map((question) => question.id)).toContain(
      PS_QUESTION,
    );
    expect(probabilityQuestions.map((question) => question.id)).not.toContain(
      CALC_TEST_QUESTION,
    );
    expect(calculusQuestions.map((question) => question.id)).toEqual([
      CALC_TEST_QUESTION,
    ]);
    // The Calculus test question is approved, so nothing waits for review.
    expect(calculusQueue).toEqual([]);
  });

  it("scopes the professor availability dashboard by course", async () => {
    const { query, repository } = await seededRepository();
    setContentRepositoryForTests(repository);
    setContentAvailabilityRepositoryForTests(
      createDatabaseContentAvailabilityRepository(query),
    );
    mockPrincipal(TEST_PROFESSOR);
    const authorization = await requireProfessorReview();

    const probability = await getContentAvailabilityDashboard(authorization, {
      courseId: PS_COURSE,
    });
    const calculus = await getContentAvailabilityDashboard(authorization, {
      courseId: CALCULUS_COURSE,
    });
    const everything = await getContentAvailabilityDashboard(authorization);

    expect(probability.topics.map((topic) => topic.id)).not.toContain(
      CALC_TEST_TOPIC,
    );
    expect(probability.questions.map((question) => question.id)).toContain(
      PS_QUESTION,
    );
    expect(calculus.topics.map((topic) => topic.id)).toEqual([CALC_TEST_TOPIC]);
    expect(calculus.questions.map((question) => question.id)).toEqual([
      CALC_TEST_QUESTION,
    ]);
    expect(everything.topics.length).toBe(probability.topics.length + 1);
  });
});

describe("course-scoped content (demo data)", () => {
  it("shows Probability & Statistics only under its course and nothing under Calculus I", async () => {
    const probabilityTopics = await demoContentRepository.listTopics({
      courseId: PS_COURSE,
    });
    const calculusTopics = await demoContentRepository.listTopics({
      courseId: CALCULUS_COURSE,
    });
    const probabilityQuestions = await demoContentRepository.listQuestions({
      courseId: PS_COURSE,
    });
    const calculusQuestions = await demoContentRepository.listQuestions({
      courseId: CALCULUS_COURSE,
    });

    expect(probabilityTopics).toHaveLength(11);
    expect(probabilityQuestions.length).toBeGreaterThan(0);
    expect(calculusTopics).toEqual([]);
    expect(calculusQuestions).toEqual([]);
    expect(
      await demoContentRepository.getQuestionCounts({
        courseId: CALCULUS_COURSE,
      }),
    ).toEqual({ byTopic: {}, total: 0 });
    // Unscoped reads are unchanged: every existing Probability & Statistics
    // question is still there.
    expect(await demoContentRepository.listQuestions()).toHaveLength(
      probabilityQuestions.length,
    );
  });

  it("does not offer Probability & Statistics retrieval under Calculus I", async () => {
    const probability = await demoContentRepository.getRetrievalChunks({
      courseId: PS_COURSE,
    });
    const calculus = await demoContentRepository.getRetrievalChunks({
      courseId: CALCULUS_COURSE,
    });

    expect(probability.length).toBeGreaterThan(0);
    expect(calculus).toEqual([]);
  });

  it("reports no practice for an empty course", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const authorization = await requireProfessorReview();
    const analytics = await demoContentRepository.getProfessorPracticeAnalytics(
      authorization,
      { courseId: CALCULUS_COURSE },
    );

    expect(analytics.questions).toEqual([]);
    expect(analytics.summary.totalTutorSessions).toBe(0);
  });
});

async function seededRepository() {
  const database = new PGlite();
  openDatabases.push(database);
  const migrationDirectory = path.join(process.cwd(), "db/migrations");
  for (const file of readdirSync(migrationDirectory)
    .filter((candidate) => candidate.endsWith(".sql"))
    .sort()) {
    await database.exec(
      readFileSync(path.join(migrationDirectory, file), "utf8"),
    );
  }

  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "pf-xj-courses-"));
  temporaryDirectories.push(temporaryDirectory);
  const seedPath = path.join(temporaryDirectory, "seed.sql");
  execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), "scripts/prepare-public-db-seed.mjs"),
      "--output",
      seedPath,
    ],
    { stdio: "pipe" },
  );
  await database.exec(readFileSync(seedPath, "utf8"));

  await database.query(
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values ($1, 'test', $1, $2, $3, 'active')`,
    [TEST_PROFESSOR.userId, TEST_PROFESSOR.email, TEST_PROFESSOR.displayName],
  );
  await database.query(
    `insert into user_roles (user_id, role_id, granted_by_user_id)
     values ($1, 'professor', 'system:schema-migration')`,
    [TEST_PROFESSOR.userId],
  );

  // One Calculus I topic and one approved, published question, created the
  // way the public seed creates content.
  await database.exec(`
    insert into topics (id, title, description, sort_order, week_number, module_ref, course_id)
    values ('${CALC_TEST_TOPIC}', 'Test-only topic', 'Isolation test fixture.', 1, 1, 'Test', '${CALCULUS_COURSE}');

    begin;
    select set_config('app.current_user_id', 'system:schema-migration', true);
    select set_config('app.current_creation_method', 'imported', true);
    select set_config('app.suppress_question_version', 'true', true);
    insert into questions (id, topic_id, title, prompt, difficulty, accepted_answers_json, answer_explanation, source_type, trust_level, visibility, review_status, originality_note, reviewed_by, reviewed_by_user_id, reviewed_at)
    values ('${CALC_TEST_QUESTION}', '${CALC_TEST_TOPIC}', 'Test-only question', 'Isolation test prompt.', 'foundational', '["1"]'::jsonb, 'Isolation test explanation.', 'original_demo', 'public_original', 'public', 'approved', 'Test-only fixture.', 'Development Seed Professor', '${SEED_PROFESSOR}', now());
    insert into hints (question_id, hint_order, body) values ('${CALC_TEST_QUESTION}', 1, 'Test-only hint.');
    insert into solution_steps (question_id, step_order, body) values ('${CALC_TEST_QUESTION}', 1, 'Test-only step.');
    select set_config('app.suppress_question_version', 'false', true);
    select app_record_question_version('${CALC_TEST_QUESTION}');
    insert into question_approval_history (question_id, question_version_id, decision, reviewer_user_id, reviewer_label, decided_at)
    select q.id, q.working_version_id, 'approved', '${SEED_PROFESSOR}', 'Development Seed Professor', q.reviewed_at from questions q where q.id = '${CALC_TEST_QUESTION}';
    commit;
  `);

  await database.query(
    `insert into retrieval_chunks (
       id, topic_id, question_id, chunk_type, title, body,
       source_type, trust_level, review_status, visibility, priority_tier
     )
     select $1, $2, q.id, 'question', 'Probability & Statistics test chunk',
       'Public-safe test retrieval text.', 'original_demo', 'public_original',
       'approved', 'public', 'safe_demo'
     from questions q where q.id = $3`,
    [PS_CHUNK, PS_TOPIC, PS_QUESTION],
  );
  await database.query(
    `insert into retrieval_chunks (
       id, topic_id, question_id, chunk_type, title, body,
       source_type, trust_level, review_status, visibility, priority_tier
     )
     select $1, $2, q.id, 'question', 'Calculus I test chunk',
       'Public-safe test retrieval text.', 'original_demo', 'public_original',
       'approved', 'public', 'safe_demo'
     from questions q where q.id = $3`,
    [CALC_CHUNK, CALC_TEST_TOPIC, CALC_TEST_QUESTION],
  );

  const query = pgliteQuery(database);
  const repository = createDatabaseContentRepository(
    "postgres://unused.example/db",
    query,
  );
  return { database, query, repository };
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
