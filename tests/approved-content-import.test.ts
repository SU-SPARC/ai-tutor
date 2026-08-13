import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { afterEach, describe, expect, it } from "vitest"

import {
  ContentImportValidationError,
  computeContentHashes,
  computeManifestApprovalHash,
  importApprovedContent,
  loadApprovedContentManifest,
  sha256,
  validateCanonicalTopicProjection,
  validateApprovedContentManifest,
  type ApprovedContentManifest,
  type ContentImportClient,
} from "../scripts/lib/approved-content-import.mjs"
import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs"

const migrationsDirectory = path.join(process.cwd(), "db/migrations")
const openDatabases: PGlite[] = []
const temporaryDirectories: string[] = []
const sourceContents = '{"release":"approved-source-v1"}\n'

afterEach(async () => {
  await Promise.all(openDatabases.splice(0).map((database) => database.close()))
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe("approved-content Production importer", () => {
  it("requires production manifests to match the canonical syllabus projection", () => {
    const manifest = validateApprovedContentManifest(signedManifest()).manifest
    const canonicalTopics = manifest.topics.map((topic) => ({
      active: topic.isActive,
      description: topic.description,
      id: topic.id,
      moduleRef: topic.moduleRef,
      order: topic.sortOrder,
      title: topic.title,
      weekNumber: topic.weekNumber,
    }))

    expect(() =>
      validateCanonicalTopicProjection(manifest, canonicalTopics),
    ).not.toThrow()
    expect(() =>
      validateCanonicalTopicProjection(manifest, [
        { ...canonicalTopics[0], order: canonicalTopics[0].order + 100 },
        ...canonicalTopics.slice(1),
      ]),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "canonical_syllabus_mismatch" }),
        ]),
      }),
    )
  })

  it("validates exact approved content, hashes, IDs, and syllabus order", () => {
    const manifest = signedManifest()
    const validated = validateApprovedContentManifest(manifest, {
      now: new Date("2026-07-02T00:00:00.000Z"),
    })

    expect(validated.manifestHash).toBe(manifest.approval.contentSha256)
    expect(validated.contentHashes).toEqual(manifest.contentHashes)
    expect(validated.manifest.expectedTopicOrder).toEqual([
      { id: "probability-foundations", sortOrder: 1 },
      { id: "conditional-probability", sortOrder: 3 },
    ])

    const duplicated = structuredClone(manifest)
    duplicated.questions.push(structuredClone(duplicated.questions[0]))
    expectValidationCode(duplicated, "duplicate_id")

    const badOrder = structuredClone(manifest)
    badOrder.questions[0].hints[1].order = 3
    resign(badOrder)
    expectValidationCode(badOrder, "invalid_child_order")

    const duplicateTopicOrder = structuredClone(manifest)
    duplicateTopicOrder.topics[1].sortOrder = 1
    resign(duplicateTopicOrder)
    expectValidationCode(duplicateTopicOrder, "duplicate_id")

    const duplicateMisconception = structuredClone(manifest)
    duplicateMisconception.questions[0].misconceptions.push(
      structuredClone(duplicateMisconception.questions[0].misconceptions[0]),
    )
    resign(duplicateMisconception)
    expectValidationCode(duplicateMisconception, "duplicate_id")

    const generatedNotAllowlisted = structuredClone(manifest)
    generatedNotAllowlisted.approvedGeneratedQuestionIds = []
    resign(generatedNotAllowlisted)
    expectValidationCode(
      generatedNotAllowlisted,
      "generated_approval_allowlist_mismatch",
    )
  })

  it("rejects raw, private, draft, fixture, and unapproved manifest shapes", async () => {
    const withRetrieval = {
      ...signedManifest(),
      retrievalChunks: [{ id: "raw-chunk", text: "raw" }],
    }
    expectValidationCode(withRetrieval, "unexpected_field")

    const withDraftState = structuredClone(signedManifest())
    const draftQuestion = withDraftState.questions[1] as unknown as Record<
      string,
      unknown
    >
    draftQuestion.reviewStatus = "needs_review"
    expectValidationCode(withDraftState, "unexpected_field")

    const privateSignal = structuredClone(signedManifest())
    privateSignal.questions[0].prompt = "Use the source page to answer."
    resign(privateSignal)
    expectValidationCode(privateSignal, "private_source_signal")

    const { manifestPath, repositoryRoot } = writeManifestFiles()
    const fixtureSource = JSON.parse(readFileSync(manifestPath, "utf8"))
    fixtureSource.sourceFiles[0].path = "tests/fixtures/questions.json"
    fixtureSource.approval.contentSha256 =
      computeManifestApprovalHash(fixtureSource)
    writeFileSync(manifestPath, `${JSON.stringify(fixtureSource, null, 2)}\n`)

    await expect(
      loadApprovedContentManifest(manifestPath, { repositoryRoot }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "unsafe_source_path" }),
      ]),
    })
  })

  it("verifies every approved source file hash before database access", async () => {
    const { manifestPath, repositoryRoot, sourcePath } = writeManifestFiles()

    const validated = await loadApprovedContentManifest(manifestPath, {
      repositoryRoot,
    })
    expect(validated.manifest.releaseId).toBe("probability-course-2026-v1")
    expect(validated.sourceFilesVerified).toBe(true)

    writeFileSync(sourcePath, "tampered\n")
    await expect(
      loadApprovedContentManifest(manifestPath, { repositoryRoot }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "source_file_hash_mismatch" }),
      ]),
    })
  })

  it("produces a read-only dry-run report without inserting any row", async () => {
    const database = await importReadyDatabase()
    const validated = {
      ...validateApprovedContentManifest(signedManifest()),
      sourceFilesVerified: true,
    }

    const report = await runImport(database, validated, { dryRun: true })

    expect(report).toMatchObject({
      committed: false,
      mode: "dry-run",
      status: "ready",
      summary: {
        hints: { inserted: 3, noOp: 0, total: 3 },
        patterns: { inserted: 1, noOp: 0, total: 1 },
        questions: { inserted: 2, noOp: 0, total: 2 },
        solutionSteps: { inserted: 3, noOp: 0, total: 3 },
        topics: { inserted: 2, noOp: 0, total: 2 },
      },
    })
    expect(report.validations.every((entry) => entry.status === "passed")).toBe(
      true,
    )

    const counts = await contentCounts(database)
    expect(counts).toEqual({
      approvals: 0,
      imports: 0,
      patterns: 0,
      questions: 0,
      topics: 0,
    })
  })

  it("applies once, preserves IDs and order, then replays as an exact no-op", async () => {
    const database = await importReadyDatabase()
    const validated = validateApprovedContentManifest(signedManifest())

    const first = await runImport(database, validated)
    expect(first.status).toBe("applied")
    expect(first.committed).toBe(true)
    expect(first.summary.questions).toEqual({ inserted: 2, noOp: 0, total: 2 })

    const stored = await database.query<{
      approval_user: string
      import_actor: string
      question_ids: string[]
      topic_orders: number[]
    }>(`
      select
        array(select id from questions order by id) as question_ids,
        array(select sort_order from topics order by sort_order) as topic_orders,
        (select reviewed_by_user_id from questions where id = 'approved-generated-q') as approval_user,
        (select applied_by from approved_content_imports where release_id = 'probability-course-2026-v1') as import_actor
    `)
    expect(stored.rows[0]).toEqual({
      approval_user: "user:primary-professor",
      import_actor: "job:approved-content-import",
      question_ids: ["approved-generated-q", "approved-original-q"],
      topic_orders: [1, 3],
    })

    const orderedChildren = await database.query<{
      hints: string[]
      steps: string[]
    }>(`
      select
        array(
          select body from hints
          where question_id = 'approved-original-q'
          order by hint_order
        ) as hints,
        array(
          select body from solution_steps
          where question_id = 'approved-original-q'
          order by step_order
        ) as steps
    `)
    expect(orderedChildren.rows[0]).toEqual({
      hints: [
        "Count all equally likely outcomes.",
        "Count the target outcomes.",
      ],
      steps: ["There are four outcomes.", "One outcome is selected."],
    })

    const latestVersion = await database.query<{
      snapshot_json: {
        hints: unknown[]
        misconceptions: unknown[]
        solutionSteps: unknown[]
      }
    }>(`
      select snapshot_json
      from question_versions
      where question_id = 'approved-original-q'
      order by version_number desc
      limit 1
    `)
    expect(latestVersion.rows[0]?.snapshot_json).toMatchObject({
      hints: expect.arrayContaining([expect.objectContaining({ order: 1 })]),
      misconceptions: expect.arrayContaining([
        expect.objectContaining({ id: "denominator-confusion" }),
      ]),
      solutionSteps: expect.arrayContaining([
        expect.objectContaining({ order: 2 }),
      ]),
    })

    const approval = await database.query<{
      decided_at: Date
      is_latest: boolean
      reviewer_user_id: string
    }>(`
      select
        qah.reviewer_user_id,
        qah.decided_at,
        qah.question_version_id = latest.id as is_latest
      from question_approval_history qah
      join lateral (
        select qv.id
        from question_versions qv
        where qv.question_id = qah.question_id
        order by qv.version_number desc
        limit 1
      ) latest on true
      where qah.question_id = 'approved-original-q'
    `)
    expect(approval.rows).toHaveLength(1)
    expect(approval.rows[0]).toMatchObject({
      is_latest: true,
      reviewer_user_id: "user:primary-professor",
    })
    expect(new Date(approval.rows[0]!.decided_at).toISOString()).toBe(
      "2026-07-01T12:00:00.000Z",
    )

    const second = await runImport(database, validated)
    expect(second.status).toBe("no-op")
    expect(second.summary.questions).toEqual({
      inserted: 0,
      noOp: 2,
      total: 2,
    })
    expect(await contentCounts(database)).toEqual({
      approvals: 2,
      imports: 1,
      patterns: 1,
      questions: 2,
      topics: 2,
    })

    await expect(
      database.exec(`
        update approved_content_imports
        set applied_by = 'rewritten'
        where release_id = 'probability-course-2026-v1'
      `),
    ).rejects.toThrow(/append-only/)
    await expect(
      database.exec(`
        update question_patterns
        set title = 'Rewritten pattern'
        where id = 'pattern-restricted-sample'
      `),
    ).rejects.toThrow(/append-only/)
  })

  it("fails closed on same-ID content drift and preserves the applied release", async () => {
    const database = await importReadyDatabase()
    const original = validateApprovedContentManifest(signedManifest())
    await runImport(database, original)

    const changed = structuredClone(signedManifest())
    changed.releaseId = "probability-course-2026-v2"
    changed.questions[0].prompt = "How many of four outcomes are selected?"
    resign(changed)
    const changedValidated = validateApprovedContentManifest(changed)

    await expect(runImport(database, changedValidated)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "stable_id_conflict" }),
      ]),
    })

    const preserved = await database.query<{
      imports: number
      prompt: string
    }>(`
      select
        (select count(*)::int from approved_content_imports) as imports,
        (select prompt from questions where id = 'approved-original-q') as prompt
    `)
    expect(preserved.rows[0]).toEqual({
      imports: 1,
      prompt:
        "One of four equally likely outcomes is selected. What is the probability of the first outcome?",
    })
  })

  it("rejects stale child rows without deleting or rewriting them", async () => {
    const database = await importReadyDatabase()
    const validated = validateApprovedContentManifest(signedManifest())
    await runImport(database, validated)

    await database.exec(`
      set app.current_user_id = 'user:primary-professor';
      insert into hints (question_id, hint_order, body)
      values ('approved-original-q', 3, 'Unexpected stale hint.');
    `)

    await expect(
      runImport(database, validated, { dryRun: true }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "stable_id_conflict" }),
      ]),
    })

    const hints = await database.query<{ count: number }>(`
      select count(*)::int as count
      from hints
      where question_id = 'approved-original-q'
    `)
    expect(hints.rows[0]?.count).toBe(3)
  })

  it("rolls back every content row when a child insert fails", async () => {
    const database = await importReadyDatabase()
    const validated = validateApprovedContentManifest(signedManifest())
    const failingClient: ContentImportClient = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
      ) {
        if (/insert into solution_steps/i.test(sql)) {
          throw new Error("injected solution-step failure")
        }
        return database.query<T>(sql, params)
      },
    }

    await expect(runImport(failingClient, validated)).rejects.toThrow(
      /injected solution-step failure/,
    )
    expect(await contentCounts(database)).toEqual({
      approvals: 0,
      imports: 0,
      patterns: 0,
      questions: 0,
      topics: 0,
    })
  })

  it("blocks a Production bootstrap containing student or operational data", async () => {
    const database = await importReadyDatabase()
    await database.exec(`
      insert into users (
        id,
        identity_provider,
        external_subject,
        email,
        display_name
      )
      values (
        'user:test-student',
        'institutional-sso',
        'test-student-subject',
        'test-student@example.edu',
        'Test Student'
      );

      insert into user_roles (user_id, role_id, granted_by_user_id)
      values ('user:test-student', 'student', 'system:schema-migration');

      insert into audit_events (
        actor_subject, action, entity_type, entity_id, outcome
      ) values (
        'test-bootstrap', 'test.bootstrap', 'database', 'production', 'success'
      );
    `)
    const validated = {
      ...validateApprovedContentManifest(signedManifest()),
      sourceFilesVerified: true,
    }

    await expect(
      runImport(database, validated, { dryRun: true, target: "production" }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "production_not_empty" }),
        expect.objectContaining({
          code: "production_student_identity_present",
        }),
      ]),
    })
    expect(await contentCounts(database)).toEqual({
      approvals: 0,
      imports: 0,
      patterns: 0,
      questions: 0,
      topics: 0,
    })
  })

  it("requires explicit Production apply confirmation and documents the safe CLI", async () => {
    const database = await importReadyDatabase()
    const unverified = validateApprovedContentManifest(signedManifest())
    await expect(
      runImport(database, unverified, { dryRun: true, target: "staging" }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "source_file_verification_required",
        }),
      ]),
    })

    const validated = {
      ...validateApprovedContentManifest(signedManifest()),
      sourceFilesVerified: true,
    }

    const dryRun = await runImport(database, validated, {
      dryRun: true,
      target: "production",
    })
    expect(dryRun.status).toBe("ready")

    await expect(
      importApprovedContent({
        actor: "job:approved-content-import",
        changeTicket: "CHANGE-APPROVED-100",
        client: database,
        sourceGitSha: "abcdef1234567890abcdef1234567890abcdef12",
        target: "production",
        validatedManifest: validated,
      }),
    ).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "production_confirmation_required",
        }),
      ]),
    })

    const applied = await runImport(database, validated, {
      target: "production",
    })
    expect(applied.status).toBe("applied")

    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    )
    expect(packageJson.scripts["db:import:approved"]).toBe(
      "node scripts/import-approved-content.mjs",
    )
    expect(packageJson.scripts["test:migrations"]).toContain(
      "tests/approved-content-import.test.ts",
    )

    const cli = readFileSync(
      path.join(process.cwd(), "scripts/import-approved-content.mjs"),
      "utf8",
    )
    expect(cli).toContain("CONTENT_IMPORT_DATABASE_URL")
    expect(cli).toContain("--confirm-production")
    expect(cli).not.toMatch(/process\.env\.DATABASE_URL/)

    const documentation = readFileSync(
      path.join(process.cwd(), "docs/approved-content-import.md"),
      "utf8",
    )
    expect(documentation).toContain("--dry-run")
    expect(documentation).toContain("--apply")
    expect(documentation).toMatch(/idempotent no-op/i)
    expect(documentation).toMatch(/rolls back the entire release/i)

    const workflow = readFileSync(
      path.join(process.cwd(), ".github/workflows/database-migrations.yml"),
      "utf8",
    )
    expect(workflow).toContain("tests/approved-content-import.test.ts")
    expect(workflow).not.toMatch(
      /CONTENT_IMPORT_DATABASE_URL|MIGRATION_DATABASE_URL|DATABASE_URL/,
    )
  })
})

function signedManifest() {
  const manifest: ApprovedContentManifest = {
    approval: {
      changeTicket: "CHANGE-APPROVED-100",
      contentSha256: "0".repeat(64),
      signedAt: "2026-07-01T12:00:00.000Z",
      signedByUserId: "user:primary-professor",
      status: "professor_approved",
    },
    approvedGeneratedQuestionIds: ["approved-generated-q"],
    contentHashes: { patterns: {}, questions: {}, topics: {} },
    expectedCounts: {
      hints: 3,
      misconceptions: 1,
      patterns: 1,
      questions: 2,
      solutionSteps: 3,
      topics: 2,
    },
    expectedTopicOrder: [
      { id: "probability-foundations", sortOrder: 1 },
      { id: "conditional-probability", sortOrder: 3 },
    ],
    patterns: [
      {
        conceptTags: ["conditional probability"],
        description: "A safe abstract pattern for a restricted sample space.",
        difficulty: "intermediate",
        id: "pattern-restricted-sample",
        misconceptionTags: ["full sample space"],
        title: "Restricted sample-space pattern",
        topicId: "conditional-probability",
      },
    ],
    questions: [
      {
        acceptedAnswers: ["1/4", "0.25"],
        answerExplanation:
          "One favorable outcome divided by four total outcomes is 1/4.",
        difficulty: "foundational",
        hints: [
          { body: "Count all equally likely outcomes.", order: 1 },
          { body: "Count the target outcomes.", order: 2 },
        ],
        id: "approved-original-q",
        misconceptions: [
          {
            feedback:
              "Use the total number of equally likely outcomes as the denominator.",
            id: "denominator-confusion",
            matchTerms: ["1/3"],
            metadata: { conceptTags: ["sample space"] },
          },
        ],
        numericValue: 0.25,
        originalityNote: "Original question approved for the course release.",
        origin: "professor_original",
        patternId: null,
        prompt:
          "One of four equally likely outcomes is selected. What is the probability of the first outcome?",
        solutionSteps: [
          { body: "There are four outcomes.", order: 1 },
          { body: "One outcome is selected.", order: 2 },
        ],
        title: "One of Four Outcomes",
        tolerance: 0.001,
        topicId: "probability-foundations",
      },
      {
        acceptedAnswers: ["1/2", "0.5"],
        answerExplanation:
          "Two of four conditioned outcomes satisfy the event.",
        difficulty: "intermediate",
        hints: [{ body: "Restrict the outcome list first.", order: 1 }],
        id: "approved-generated-q",
        misconceptions: [],
        numericValue: 0.5,
        originalityNote:
          "Original generated question reviewed and approved by the professor.",
        origin: "generated_original",
        patternId: "pattern-restricted-sample",
        prompt:
          "After conditioning, four outcomes remain and two are favorable. What is the conditional probability?",
        solutionSteps: [
          {
            body: "Divide two favorable outcomes by four conditioned outcomes.",
            order: 1,
          },
        ],
        title: "Conditioned Outcome Count",
        tolerance: 0.001,
        topicId: "conditional-probability",
      },
    ],
    releaseId: "probability-course-2026-v1",
    schemaVersion: 1,
    sourceFiles: [
      {
        path: "data/production/approved/probability-course-source.json",
        sha256: sha256(sourceContents),
      },
    ],
    sourceGitSha: "abcdef1234567890abcdef1234567890abcdef12",
    topics: [
      {
        description: "Foundational finite probability models.",
        id: "probability-foundations",
        isActive: true,
        moduleRef: "Week 1",
        sortOrder: 1,
        title: "Probability Foundations",
        weekNumber: 1,
      },
      {
        description: "Conditional probability and restricted sample spaces.",
        id: "conditional-probability",
        isActive: true,
        moduleRef: "Week 3",
        sortOrder: 3,
        title: "Conditional Probability",
        weekNumber: 3,
      },
    ],
  }
  resign(manifest)
  return manifest
}

function resign(manifest: ApprovedContentManifest) {
  manifest.contentHashes = computeContentHashes(manifest)
  manifest.approval.contentSha256 = computeManifestApprovalHash(manifest)
}

function expectValidationCode(raw: unknown, code: string) {
  try {
    validateApprovedContentManifest(raw, {
      now: new Date("2026-07-02T00:00:00.000Z"),
    })
    throw new Error("Expected manifest validation to fail.")
  } catch (error) {
    expect(error).toBeInstanceOf(ContentImportValidationError)
    expect((error as ContentImportValidationError).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    )
  }
}

function writeManifestFiles() {
  const repositoryRoot = mkdtempSync(
    path.join(tmpdir(), "approved-content-import-"),
  )
  temporaryDirectories.push(repositoryRoot)
  const approvedDirectory = path.join(
    repositoryRoot,
    "data/production/approved",
  )
  const manifestsDirectory = path.join(
    repositoryRoot,
    "data/production/manifests",
  )
  mkdirSync(approvedDirectory, { recursive: true })
  mkdirSync(manifestsDirectory, { recursive: true })
  const sourcePath = path.join(
    approvedDirectory,
    "probability-course-source.json",
  )
  const manifestPath = path.join(manifestsDirectory, "release.json")
  writeFileSync(sourcePath, sourceContents)
  writeFileSync(manifestPath, `${JSON.stringify(signedManifest(), null, 2)}\n`)
  return { manifestPath, repositoryRoot, sourcePath }
}

async function importReadyDatabase() {
  const database = new PGlite()
  openDatabases.push(database)
  const migrations = await loadMigrations(migrationsDirectory)
  await runPendingMigrations({
    actor: "ci:approved-content-test",
    allowDestructive: true,
    changeTicket: "TEST-ROLE-SIMPLIFICATION",
    client: database,
    deploymentSha: "abcdef1234567890",
    destructiveApprovedBy: "ci:independent-test-approver",
    migrations,
    target: "test",
  })
  await database.exec(`
    insert into users (
      id,
      identity_provider,
      external_subject,
      email,
      display_name
    )
    values (
      'user:primary-professor',
      'institutional-sso',
      'primary-professor-subject',
      'primary-professor@example.edu',
      'Primary Professor'
    );

    insert into user_roles (user_id, role_id, granted_by_user_id)
    values (
      'user:primary-professor',
      'professor',
      'system:schema-migration'
    );
  `)
  return database
}

function runImport(
  client: ContentImportClient,
  validatedManifest: ReturnType<typeof validateApprovedContentManifest>,
  options: { dryRun?: boolean; target?: string } = {},
) {
  return importApprovedContent({
    actor: "job:approved-content-import",
    changeTicket: "CHANGE-APPROVED-100",
    client,
    confirmProduction: true,
    sourceGitSha: "abcdef1234567890abcdef1234567890abcdef12",
    dryRun: options.dryRun,
    target: options.target ?? "test",
    validatedManifest,
  })
}

async function contentCounts(database: PGlite) {
  const result = await database.query<{
    approvals: number
    imports: number
    patterns: number
    questions: number
    topics: number
  }>(`
    select
      (select count(*)::int from topics) as topics,
      (select count(*)::int from question_patterns) as patterns,
      (select count(*)::int from questions) as questions,
      (select count(*)::int from question_approval_history) as approvals,
      (select count(*)::int from approved_content_imports) as imports
  `)
  return result.rows[0]
}
