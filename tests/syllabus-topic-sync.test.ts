import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { describe, expect, it } from "vitest"

import {
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
        title text not null,
        description text not null,
        sort_order integer not null unique,
        week_number integer not null,
        module_ref text not null,
        is_active boolean not null,
        updated_at timestamptz not null default now()
      );
      insert into topics values
        ('topic-one', 'Old title', 'Old description', 2, 1, 'Old', true, now()),
        ('retired-topic', 'Retired', 'Retained', 99, 99, 'Legacy', false, now());
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
