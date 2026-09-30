import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

import {
  CANONICAL_COURSE_IDS,
  loadAllCanonicalSyllabusTopics,
  loadCanonicalSyllabusTopics,
  validateCanonicalSyllabusTopics,
} from "../scripts/lib/canonical-syllabus-topics.mjs"
import {
  inspectDatabaseTopics,
  inspectRepositoryTopicMappings,
  synchronizeDatabaseTopics,
} from "../scripts/lib/syllabus-topic-sync.mjs"

describe("canonical syllabus topic synchronization", () => {
  it("rejects duplicate normalized slugs and order values", () => {
    const base = {
      active: true,
      description: "Description",
      keywords: ["topic"],
      moduleRef: "Week 1",
      title: "Topic",
      weekNumber: 1,
    }
    const errors = validateCanonicalSyllabusTopics([
      { ...base, id: "topic-one", order: 1 },
      { ...base, id: "topic one", order: 1 },
    ])

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("normalized lowercase slug"),
        expect.stringContaining("duplicate normalized slug"),
        expect.stringContaining("duplicates order 1"),
      ]),
    )
  })

  it("reports stale mappings in dry-run repository inspection", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "syllabus-sync-"))
    await mkdir(path.join(root, "data/demo"), { recursive: true })
    await writeFile(
      path.join(root, "data/demo/questions.json"),
      JSON.stringify([{ id: "q-1", topicId: "retired-topic" }]),
    )
    const topics = await loadCanonicalSyllabusTopics(process.cwd())
    await writeFile(
      path.join(root, "data/demo/out-of-order.json"),
      JSON.stringify([
        { id: "q-2", topicId: topics[1].id },
        { id: "q-3", topicId: topics[0].id },
      ]),
    )
    const report = await inspectRepositoryTopicMappings(root, topics)

    expect(report.staleMappings).toEqual([
      expect.objectContaining({
        file: "data/demo/questions.json",
        topicId: "retired-topic",
      }),
    ])
    expect(report.syllabusChangesRequiringHumanReview).toEqual([
      expect.objectContaining({
        file: "data/demo/out-of-order.json",
        reason: expect.stringContaining("canonical syllabus order"),
      }),
    ])
  })

  it("updates and inserts transactionally without deleting extra topics", async () => {
    const database = new PGlite()
    await database.exec(`
      create table topics (
        id text primary key,
        course_id text not null default 'probability-statistics',
        title text not null,
        description text not null,
        sort_order integer not null,
        week_number integer not null,
        module_ref text not null,
        is_active boolean not null,
        updated_at timestamptz not null default now(),
        unique (course_id, sort_order)
      );
      insert into topics
        (id, title, description, sort_order, week_number, module_ref, is_active)
      values
        ('topic-one', 'Old title', 'Old description', 2, 1, 'Old', true),
        ('retired-topic', 'Retired', 'Retained', 99, 99, 'Legacy', false);
    `)
    const topics = [
      {
        active: true,
        description: "First description",
        id: "topic-one",
        keywords: ["topic one"],
        moduleRef: "Week 1",
        order: 1,
        title: "Topic One",
        weekNumber: 1,
      },
      {
        active: true,
        description: "Second description",
        id: "topic-two",
        keywords: ["topic two"],
        moduleRef: "Week 2",
        order: 2,
        title: "Topic Two",
        weekNumber: 2,
      },
    ]

    const inspection = await inspectDatabaseTopics(database, topics)
    expect(inspection.missingTopics.map(({ id }) => id)).toEqual(["topic-two"])
    expect(inspection.extraTopics.map(({ id }) => id)).toEqual([
      "retired-topic",
    ])

    await synchronizeDatabaseTopics(database, topics, inspection)
    const result = await database.query<{ id: string; sort_order: number }>(
      "select id, sort_order from topics order by sort_order",
    )
    expect(result.rows).toEqual([
      { id: "topic-one", sort_order: 1 },
      { id: "topic-two", sort_order: 2 },
      { id: "retired-topic", sort_order: 99 },
    ])
  })
})

describe("per-course canonical syllabi", () => {
  it("keeps one canonical file per registered course", async () => {
    expect(CANONICAL_COURSE_IDS).toEqual(["probability-statistics", "calculus-1"])

    const probability = await loadCanonicalSyllabusTopics(process.cwd())
    const calculus = await loadCanonicalSyllabusTopics(process.cwd(), "calculus-1")
    const everything = await loadAllCanonicalSyllabusTopics(process.cwd())

    expect(probability).toHaveLength(11)
    expect(probability.every((topic) => topic.courseId === "probability-statistics")).toBe(true)
    // Calculus I's syllabus has not been provided, so nothing is invented.
    expect(calculus).toEqual([])
    expect(everything).toHaveLength(11)
    await expect(
      loadCanonicalSyllabusTopics(process.cwd(), "no-such-course"),
    ).rejects.toThrow(/Unknown course/)
  })

  it("does not treat another course's topics as extra, conflicting, or stale", async () => {
    const database = new PGlite()
    await database.exec(`
      create table topics (
        id text primary key,
        course_id text not null default 'probability-statistics',
        title text not null,
        description text not null,
        sort_order integer not null,
        week_number integer not null,
        module_ref text not null,
        is_active boolean not null,
        updated_at timestamptz not null default now(),
        unique (course_id, sort_order)
      );
      insert into topics
        (id, course_id, title, description, sort_order, week_number, module_ref, is_active)
      values
        ('ps-topic', 'probability-statistics', 'PS', 'PS topic', 1, 1, 'Week 1', true),
        ('calc-topic', 'calculus-1', 'Calc', 'Calc topic', 1, 1, 'Week 1', true);
    `)
    const probabilityTopics = [
      {
        active: true,
        courseId: "probability-statistics",
        description: "PS topic",
        id: "ps-topic",
        keywords: ["ps"],
        moduleRef: "Week 1",
        order: 1,
        title: "PS",
        weekNumber: 1,
      },
    ]

    const inspection = await inspectDatabaseTopics(
      database,
      probabilityTopics,
      "probability-statistics",
    )
    expect(inspection.extraTopics).toEqual([])
    expect(inspection.blockingOrderConflicts).toEqual([])
    expect(inspection.duplicateOrderValues).toEqual([])
    expect(inspection.missingTopics).toEqual([])

    // An empty Calculus I syllabus leaves the database alone.
    const calculus = await inspectDatabaseTopics(database, [], "calculus-1")
    expect(calculus.extraTopics.map(({ id }) => id)).toEqual(["calc-topic"])
    await synchronizeDatabaseTopics(database, [], calculus, "calculus-1")
    const rows = await database.query<{ course_id: string; id: string }>(
      "select id, course_id from topics order by id",
    )
    expect(rows.rows).toEqual([
      { course_id: "calculus-1", id: "calc-topic" },
      { course_id: "probability-statistics", id: "ps-topic" },
    ])
  })

  it("inserts a course's topics under that course and refuses to move another course's id", async () => {
    const database = new PGlite()
    await database.exec(`
      create table topics (
        id text primary key,
        course_id text not null default 'probability-statistics',
        title text not null,
        description text not null,
        sort_order integer not null,
        week_number integer not null,
        module_ref text not null,
        is_active boolean not null,
        updated_at timestamptz not null default now(),
        unique (course_id, sort_order)
      );
      insert into topics
        (id, course_id, title, description, sort_order, week_number, module_ref, is_active)
      values ('shared-id', 'probability-statistics', 'PS', 'PS topic', 1, 1, 'Week 1', true);
    `)
    const topic = (id: string, order: number) => ({
      active: true,
      courseId: "calculus-1",
      description: "Test-only topic.",
      id,
      keywords: ["test"],
      moduleRef: "Week 1",
      order,
      title: id,
      weekNumber: 1,
    })

    // The same order number is fine in a different course.
    const fresh = [topic("test-only-calc-topic", 1)]
    const inspection = await inspectDatabaseTopics(database, fresh, "calculus-1")
    await synchronizeDatabaseTopics(database, fresh, inspection, "calculus-1")
    const inserted = await database.query<{ course_id: string }>(
      "select course_id from topics where id = 'test-only-calc-topic'",
    )
    expect(inserted.rows[0].course_id).toBe("calculus-1")

    // An id already owned by Probability & Statistics is never moved.
    const clash = [topic("shared-id", 2)]
    const clashInspection = await inspectDatabaseTopics(database, clash, "calculus-1")
    expect(clashInspection.courseConflicts).toEqual([
      { ownedByCourse: "probability-statistics", topicId: "shared-id" },
    ])
    await expect(
      synchronizeDatabaseTopics(database, clash, clashInspection, "calculus-1"),
    ).rejects.toThrow(/owned by another course|blocked/)
  })
})

