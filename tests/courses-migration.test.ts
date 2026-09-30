import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS_DIRECTORY = path.join(process.cwd(), "db/migrations");
const COURSES_MIGRATION = "028_courses.sql";
const openDatabases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
});

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

/** Applies every migration before the courses migration, then stops. */
async function databaseBeforeCourses() {
  const database = new PGlite();
  openDatabases.push(database);
  for (const file of migrationFiles()) {
    if (file === COURSES_MIGRATION) {
      break;
    }
    await database.exec(
      readFileSync(path.join(MIGRATIONS_DIRECTORY, file), "utf8"),
    );
  }
  return database;
}

async function applyCoursesMigration(database: PGlite) {
  await database.exec(
    readFileSync(path.join(MIGRATIONS_DIRECTORY, COURSES_MIGRATION), "utf8"),
  );
}

async function migratedDatabase() {
  const database = await databaseBeforeCourses();
  await applyCoursesMigration(database);
  return database;
}

async function insertTopic(
  database: PGlite,
  id: string,
  sortOrder: number,
  courseId?: string,
) {
  if (courseId === undefined) {
    await database.query(
      `insert into topics (id, title, description, sort_order)
       values ($1, $1, 'Test topic', $2)`,
      [id, sortOrder],
    );
    return;
  }
  await database.query(
    `insert into topics (id, title, description, sort_order, course_id)
     values ($1, $1, 'Test topic', $2, $3)`,
    [id, sortOrder, courseId],
  );
}

async function insertQuestion(database: PGlite, id: string, topicId: string) {
  await database.query(
    `insert into questions (
       id, topic_id, title, prompt, difficulty, accepted_answers_json,
       answer_explanation, source_type, trust_level, review_status, visibility
     ) values ($1, $2, 'Test question', 'Test prompt', 'foundational',
       '["1"]'::jsonb, 'Test explanation.', 'original_demo', 'public_original',
       'needs_review', 'public')`,
    [id, topicId],
  );
}

describe("courses migration", () => {
  it("registers Probability & Statistics and an empty Calculus I", async () => {
    const database = await migratedDatabase();
    const courses = await database.query<{
      code: string | null;
      id: string;
      is_active: boolean;
      sort_order: number;
      title: string;
    }>(`select id, code, title, is_active, sort_order from courses order by sort_order`);

    expect(courses.rows).toEqual([
      {
        code: "MATH-255",
        id: "probability-statistics",
        is_active: true,
        sort_order: 1,
        title: "Probability & Statistics",
      },
      {
        code: null,
        id: "calculus-1",
        is_active: true,
        sort_order: 2,
        title: "Calculus I",
      },
    ]);

    const calculusContent = await database.query<{ topics: number }>(
      `select count(*)::int as topics from topics where course_id = 'calculus-1'`,
    );
    expect(calculusContent.rows[0].topics).toBe(0);
  });

  it("backfills every existing topic to Probability & Statistics", async () => {
    const database = await databaseBeforeCourses();
    await insertTopic(database, "legacy-one", 1);
    await insertTopic(database, "legacy-two", 2);
    await insertQuestion(database, "legacy-question", "legacy-one");

    await applyCoursesMigration(database);

    const topics = await database.query<{ course_id: string; id: string }>(
      `select id, course_id from topics order by id`,
    );
    expect(topics.rows).toEqual([
      { course_id: "probability-statistics", id: "legacy-one" },
      { course_id: "probability-statistics", id: "legacy-two" },
    ]);
    const question = await database.query<{ topic_id: string }>(
      `select topic_id from questions where id = 'legacy-question'`,
    );
    expect(question.rows[0].topic_id).toBe("legacy-one");
  });

  it("keeps Probability & Statistics as the default for topics inserted without a course", async () => {
    const database = await migratedDatabase();
    await insertTopic(database, "default-course-topic", 1);

    const topic = await database.query<{ course_id: string }>(
      `select course_id from topics where id = 'default-course-topic'`,
    );
    expect(topic.rows[0].course_id).toBe("probability-statistics");
  });

  it("requires every topic to belong to a registered course", async () => {
    const database = await migratedDatabase();

    await expect(
      insertTopic(database, "orphan-topic", 1, "no-such-course"),
    ).rejects.toThrow(/foreign key|violates/i);
    await expect(
      database.query(
        `insert into topics (id, title, description, sort_order, course_id)
         values ('null-course-topic', 't', 'd', 1, null)`,
      ),
    ).rejects.toThrow(/null value|not-null/i);
  });

  it("orders topics per course, not globally", async () => {
    const database = await migratedDatabase();
    await insertTopic(database, "ps-topic", 1, "probability-statistics");
    // Another course may start its own sequence at 1.
    await insertTopic(database, "calc-topic", 1, "calculus-1");

    await expect(
      insertTopic(database, "ps-duplicate-order", 1, "probability-statistics"),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("does not let a topic change course once content depends on it", async () => {
    const database = await migratedDatabase();
    await insertTopic(database, "free-topic", 1);
    await insertTopic(database, "used-topic", 2);
    await insertQuestion(database, "dependent-question", "used-topic");

    await database.query(
      `update topics set course_id = 'calculus-1' where id = 'free-topic'`,
    );
    const moved = await database.query<{ course_id: string }>(
      `select course_id from topics where id = 'free-topic'`,
    );
    expect(moved.rows[0].course_id).toBe("calculus-1");

    await expect(
      database.query(
        `update topics set course_id = 'calculus-1' where id = 'used-topic'`,
      ),
    ).rejects.toThrow(/cannot move to another course/i);
    const unchanged = await database.query<{ course_id: string }>(
      `select course_id from topics where id = 'used-topic'`,
    );
    expect(unchanged.rows[0].course_id).toBe("probability-statistics");
  });

  it("does not let a question move to a topic in another course", async () => {
    const database = await migratedDatabase();
    await insertTopic(database, "ps-topic-a", 1, "probability-statistics");
    await insertTopic(database, "ps-topic-b", 2, "probability-statistics");
    await insertTopic(database, "calc-topic-a", 1, "calculus-1");
    await insertQuestion(database, "movable-question", "ps-topic-a");

    await database.query(
      `update questions set topic_id = 'ps-topic-b' where id = 'movable-question'`,
    );
    await expect(
      database.query(
        `update questions set topic_id = 'calc-topic-a' where id = 'movable-question'`,
      ),
    ).rejects.toThrow(/cannot move from course/i);
  });

  it("exposes the derived course on the public, review, reserve, and retrieval views", async () => {
    const database = await migratedDatabase();
    const views = [
      "app_question_version_content",
      "app_public_questions",
      "app_review_queue_questions",
      "app_reserve_practice_questions",
      "app_student_retrieval_chunks",
      "app_admin_retrieval_chunks",
    ];
    const columns = await database.query<{ table_name: string }>(
      `select table_name
       from information_schema.columns
       where table_schema = 'public'
         and column_name = 'course_id'
         and table_name = any($1::text[])`,
      [views],
    );

    expect(columns.rows.map((row) => row.table_name).sort()).toEqual(
      [...views].sort(),
    );
  });
});
