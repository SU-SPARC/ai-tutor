import { createHash } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import path from "node:path"

export const CONTENT_IMPORT_ADVISORY_LOCK_ID = 7_241_903_194

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const GIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const ID_PATTERN = /^[a-z0-9][a-z0-9:_-]{0,127}$/
const RELEASE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/
const DIFFICULTIES = new Set(["foundational", "intermediate", "challenge"])
const ORIGINS = new Set([
  "professor_original",
  "generated_original",
  "pattern_derived_original",
])
const TARGETS = new Set(["test", "staging", "production"])
const PRIVATE_TEXT_PATTERN =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only/i
const UNSAFE_SIGNER_PATTERN = /^(?:professor|system:schema-migration)$/i
const PRODUCTION_SOURCE_PREFIX = "data/production/approved/"
const OPERATIONAL_TABLES = [
  "tutor_sessions",
  "attempts",
  "student_progress",
  "ai_usage",
  "ai_response_cache",
  "ai_llm_reservations",
  "retrieval_chunks",
  "audit_events",
  "feedback_reports",
]

const ROOT_KEYS = [
  "schemaVersion",
  "releaseId",
  "sourceGitSha",
  "sourceFiles",
  "approval",
  "expectedTopicOrder",
  "approvedGeneratedQuestionIds",
  "expectedCounts",
  "contentHashes",
  "topics",
  "patterns",
  "questions",
]

export async function loadApprovedContentManifest(
  manifestPath,
  { now = new Date(), repositoryRoot } = {},
) {
  if (!repositoryRoot) {
    throw new ContentImportValidationError([
      issue("repository_root_required", "repositoryRoot is required."),
    ])
  }

  let raw
  try {
    raw = JSON.parse(await readFile(manifestPath, "utf8"))
  } catch (error) {
    throw new ContentImportValidationError([
      issue(
        "manifest_read_failed",
        `Manifest could not be read as JSON: ${errorMessage(error)}.`,
      ),
    ])
  }

  const validated = validateApprovedContentManifest(raw, { now })
  await verifySourceFiles(validated.manifest.sourceFiles, repositoryRoot)
  return { ...validated, sourceFilesVerified: true }
}

export function validateApprovedContentManifest(
  raw,
  { now = new Date() } = {},
) {
  const issues = []
  const manifest = normalizeManifest(raw, issues)

  validateManifestRelationships(manifest, issues)
  validateDeclaredContentHashes(manifest, issues)

  const approvalHash = computeManifestApprovalHash(manifest)
  if (manifest.approval.contentSha256 !== approvalHash) {
    issues.push(
      issue(
        "approval_hash_mismatch",
        `approval.contentSha256 does not match the canonical approved content hash ${approvalHash}.`,
      ),
    )
  }

  const signedAt = Date.parse(manifest.approval.signedAt)
  if (Number.isFinite(signedAt) && signedAt > now.getTime()) {
    issues.push(
      issue("future_approval", "approval.signedAt must not be in the future."),
    )
  }

  if (issues.length > 0) {
    throw new ContentImportValidationError(issues)
  }

  return {
    contentHashes: computeContentHashes(manifest),
    manifest,
    manifestHash: approvalHash,
    sourceFilesVerified: false,
  }
}
export function computeManifestApprovalHash(manifest) {
  const approval = isPlainObject(manifest?.approval) ? manifest.approval : {}
  return sha256(
    canonicalJson({
      ...manifest,
      approval: {
        changeTicket: approval.changeTicket,
        signedAt: approval.signedAt,
        signedByUserId: approval.signedByUserId,
        status: approval.status,
      },
    }),
  )
}

export function computeContentHashes(manifest) {
  return {
    patterns: Object.fromEntries(
      (manifest.patterns ?? []).map((pattern) => [
        pattern.id,
        sha256(canonicalJson(pattern)),
      ]),
    ),
    questions: Object.fromEntries(
      (manifest.questions ?? []).map((question) => [
        question.id,
        sha256(canonicalJson(question)),
      ]),
    ),
    topics: Object.fromEntries(
      (manifest.topics ?? []).map((topic) => [
        topic.id,
        sha256(canonicalJson(topic)),
      ]),
    ),
  }
}

export function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value)
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON does not support non-finite numbers.")
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`
  }

  throw new TypeError("Canonical JSON supports only JSON values.")
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

export async function importApprovedContent({
  actor,
  changeTicket,
  client,
  confirmProduction = false,
  sourceGitSha,
  dryRun = false,
  lockTimeoutMs = 5_000,
  statementTimeoutMs = 60_000,
  target,
  validatedManifest,
}) {
  validateExecution({
    actor,
    changeTicket,
    confirmProduction,
    sourceGitSha,
    dryRun,
    target,
    validatedManifest,
  })

  await client.query(
    dryRun
      ? "begin isolation level repeatable read read only"
      : "begin isolation level serializable",
  )

  try {
    await client.query("select pg_advisory_xact_lock($1::bigint)", [
      CONTENT_IMPORT_ADVISORY_LOCK_ID,
    ])
    await client.query(
      `set local lock_timeout = '${validateTimeout(lockTimeoutMs)}ms'`,
    )
    await client.query(
      `set local statement_timeout = '${validateTimeout(statementTimeoutMs)}ms'`,
    )

    const plan = await buildImportPlan(client, validatedManifest, target)
    if (plan.issues.length > 0) {
      throw new ContentImportConflictError(plan.issues, plan.report)
    }

    if (dryRun) {
      await client.query("rollback")
      return {
        ...plan.report,
        committed: false,
        mode: "dry-run",
        status:
          plan.report.summary.importRecords.noOp === 1 ? "no-op" : "ready",
      }
    }

    await client.query("select set_config('app.current_user_id', $1, true)", [
      validatedManifest.manifest.approval.signedByUserId,
    ])
    await applyImportPlan(client, validatedManifest, plan, {
      actor,
      changeTicket,
      target,
    })

    const verification = await buildImportPlan(
      client,
      validatedManifest,
      target,
    )
    if (verification.issues.length > 0) {
      throw new ContentImportConflictError(
        verification.issues,
        verification.report,
      )
    }

    await client.query("commit")
    return {
      ...plan.report,
      committed: true,
      mode: "apply",
      status:
        plan.report.summary.importRecords.noOp === 1 ? "no-op" : "applied",
    }
  } catch (error) {
    await rollbackQuietly(client)
    throw error
  }
}

async function buildImportPlan(client, validatedManifest, target) {
  const { manifest, manifestHash } = validatedManifest
  const issues = []
  await assertImportSchema(client, issues)

  if (issues.length > 0) {
    return rejectedPlan(manifest, manifestHash, issues, target)
  }

  const [signerResult, operationalCounts, databaseState, importsResult] =
    await Promise.all([
      client.query(
        `
          select
            u.id,
            u.status,
            u.user_type,
            exists (
              select 1
              from user_roles ur
              where ur.user_id = u.id
                and ur.role_id = 'professor'
                and ur.revoked_at is null
                and (ur.expires_at is null or ur.expires_at > now())
            ) as is_professor
          from users u
          where u.id = $1
        `,
        [manifest.approval.signedByUserId],
      ),
      readOperationalCounts(client),
      readContentState(client),
      client.query(`
        select
          release_id,
          manifest_sha256,
          source_git_sha,
          signed_by_user_id,
          signed_at,
          target,
          change_ticket,
          summary_json
        from approved_content_imports
        order by release_id
      `),
    ])

  const signer = signerResult.rows[0]
  if (
    !signer ||
    signer.status !== "active" ||
    signer.user_type !== "human" ||
    signer.is_professor !== true
  ) {
    issues.push(
      issue(
        "invalid_professor_signer",
        "The manifest signer must be an active institutional human with an active professor role.",
      ),
    )
  }

  if (target === "production") {
    for (const [table, count] of Object.entries(operationalCounts)) {
      if (count !== 0) {
        issues.push(
          issue(
            "production_not_empty",
            `Production bootstrap requires ${table} to contain zero rows; found ${count}.`,
          ),
        )
      }
    }

    const studentRoles = await client.query(`
      select count(*)::int as count
      from user_roles
      where role_id = 'student' and revoked_at is null
    `)
    if (Number(studentRoles.rows[0]?.count ?? 0) !== 0) {
      issues.push(
        issue(
          "production_student_identity_present",
          "Production bootstrap requires zero active student role assignments.",
        ),
      )
    }
  }

  const manifestTopicIds = new Set(manifest.topics.map((topic) => topic.id))
  const manifestPatternIds = new Set(
    manifest.patterns.map((pattern) => pattern.id),
  )
  const manifestQuestionIds = new Set(
    manifest.questions.map((question) => question.id),
  )

  rejectUnexpectedTargetIds(
    databaseState.topics,
    manifestTopicIds,
    "topic",
    issues,
  )
  rejectUnexpectedTargetIds(
    databaseState.patterns,
    manifestPatternIds,
    "pattern",
    issues,
  )
  rejectUnexpectedTargetIds(
    databaseState.questions,
    manifestQuestionIds,
    "question",
    issues,
  )

  const summary = emptySummary()
  const inserts = { patterns: [], questions: [], topics: [] }

  planEntities({
    approval: manifest.approval,
    existing: databaseState.topics,
    inserts: inserts.topics,
    issues,
    kind: "topics",
    manifestItems: manifest.topics,
    summary: summary.topics,
  })
  planEntities({
    approval: manifest.approval,
    existing: databaseState.patterns,
    inserts: inserts.patterns,
    issues,
    kind: "patterns",
    manifestItems: manifest.patterns,
    summary: summary.patterns,
  })
  planEntities({
    approval: manifest.approval,
    existing: databaseState.questions,
    inserts: inserts.questions,
    issues,
    kind: "questions",
    manifestItems: manifest.questions,
    summary: summary.questions,
  })

  for (const question of manifest.questions) {
    const destination = databaseState.questions.has(question.id)
      ? "noOp"
      : "inserted"
    summary.hints[destination] += question.hints.length
    summary.solutionSteps[destination] += question.solutionSteps.length
    summary.misconceptions[destination] += question.misconceptions.length
    summary.approvals[destination] += 1
  }

  const imports = importsResult.rows.map((row) => ({
    changeTicket: String(row.change_ticket),
    manifestHash: String(row.manifest_sha256),
    releaseId: String(row.release_id),
    signedAt: isoTimestamp(row.signed_at),
    signedByUserId: String(row.signed_by_user_id),
    sourceGitSha: String(row.source_git_sha),
    summary: jsonObject(row.summary_json),
    target: String(row.target),
  }))
  const sameRelease = imports.find(
    (entry) => entry.releaseId === manifest.releaseId,
  )
  const sameHash = imports.find((entry) => entry.manifestHash === manifestHash)

  if (sameRelease && sameRelease.manifestHash !== manifestHash) {
    issues.push(
      issue(
        "release_id_conflict",
        `Release ${manifest.releaseId} is already recorded with a different manifest hash.`,
      ),
    )
  } else if (
    sameRelease &&
    (sameRelease.changeTicket !== manifest.approval.changeTicket ||
      sameRelease.signedAt !== manifest.approval.signedAt ||
      sameRelease.signedByUserId !== manifest.approval.signedByUserId ||
      sameRelease.sourceGitSha !== manifest.sourceGitSha ||
      sameRelease.target !== target ||
      canonicalJson(sameRelease.summary) !==
        canonicalJson({ expectedCounts: manifest.expectedCounts }))
  ) {
    issues.push(
      issue(
        "import_ledger_conflict",
        `Release ${manifest.releaseId} has inconsistent immutable import evidence.`,
      ),
    )
  } else if (sameHash && sameHash.releaseId !== manifest.releaseId) {
    issues.push(
      issue(
        "manifest_hash_reused",
        `Manifest hash is already recorded under release ${sameHash.releaseId}.`,
      ),
    )
  } else if (sameRelease) {
    summary.importRecords.noOp = 1
  } else {
    summary.importRecords.inserted = 1
  }

  return {
    inserts,
    issues,
    report: {
      committed: false,
      manifestHash,
      mode: "plan",
      operationalCounts,
      releaseId: manifest.releaseId,
      signerUserId: manifest.approval.signedByUserId,
      status: issues.length === 0 ? "valid" : "rejected",
      summary: finalizeSummary(summary),
      target,
      validations: validationResults(issues),
    },
  }
}

async function applyImportPlan(
  client,
  validatedManifest,
  plan,
  { actor, changeTicket, target },
) {
  const { manifest, manifestHash } = validatedManifest
  const signedAt = manifest.approval.signedAt
  const signer = manifest.approval.signedByUserId

  for (const topic of plan.inserts.topics) {
    await client.query(
      `
        insert into topics (
          id,
          title,
          description,
          sort_order,
          week_number,
          module_ref,
          is_active
        )
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        topic.id,
        topic.title,
        topic.description,
        topic.sortOrder,
        topic.weekNumber,
        topic.moduleRef,
        topic.isActive,
      ],
    )
  }

  for (const pattern of plan.inserts.patterns) {
    await client.query(
      `
        insert into question_patterns (
          id,
          topic_id,
          title,
          description,
          difficulty,
          concept_tags_json,
          misconception_tags_json,
          reviewed_by_user_id,
          reviewed_at,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $9)
      `,
      [
        pattern.id,
        pattern.topicId,
        pattern.title,
        pattern.description,
        pattern.difficulty,
        JSON.stringify(pattern.conceptTags),
        JSON.stringify(pattern.misconceptionTags),
        signer,
        signedAt,
      ],
    )
  }

  for (const question of plan.inserts.questions) {
    const sourceType = sourceTypeForOrigin(question.origin)
    const initialTrustLevel =
      question.origin === "professor_original"
        ? "professor_approved"
        : "generated_unverified"

    await client.query(
      `select
         set_config('app.current_creation_method', 'imported', true),
         set_config('app.suppress_question_version', 'true', true)`,
    )

    await client.query(
      `
        insert into questions (
          id,
          topic_id,
          pattern_id,
          title,
          prompt,
          difficulty,
          accepted_answers_json,
          numeric_value,
          tolerance,
          answer_explanation,
          source_type,
          trust_level,
          review_status,
          visibility,
          originality_note,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12,
          'needs_review', 'public', $13, $14, $14
        )
      `,
      [
        question.id,
        question.topicId,
        question.patternId,
        question.title,
        question.prompt,
        question.difficulty,
        JSON.stringify(question.acceptedAnswers),
        question.numericValue,
        question.tolerance,
        question.answerExplanation,
        sourceType,
        initialTrustLevel,
        question.originalityNote,
        signedAt,
      ],
    )

    for (const hint of question.hints) {
      await client.query(
        `insert into hints (question_id, hint_order, body, created_at, updated_at)
         values ($1, $2, $3, $4, $4)`,
        [question.id, hint.order, hint.body, signedAt],
      )
    }

    for (const step of question.solutionSteps) {
      await client.query(
        `insert into solution_steps (question_id, step_order, body, created_at, updated_at)
         values ($1, $2, $3, $4, $4)`,
        [question.id, step.order, step.body, signedAt],
      )
    }

    for (const misconception of question.misconceptions) {
      await client.query(
        `
          insert into misconceptions (
            id,
            question_id,
            feedback,
            match_terms_json,
            metadata_json,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $6)
        `,
        [
          misconception.id,
          question.id,
          misconception.feedback,
          JSON.stringify(misconception.matchTerms),
          JSON.stringify(misconception.metadata),
          signedAt,
        ],
      )
    }

    await client.query(
      "select set_config('app.suppress_question_version', 'false', true)",
    )
    await client.query("select app_record_question_version($1)", [question.id])
    await client.query(
      "select set_config('app.suppress_question_version', 'true', true)",
    )

    await client.query(
      `
        update questions
        set trust_level = 'professor_approved',
            review_status = 'approved',
            reviewed_by = null,
            reviewed_by_user_id = $2,
            reviewed_at = $3
        where id = $1
      `,
      [question.id, signer, signedAt],
    )

    await client.query(
      "select set_config('app.suppress_question_version', 'false', true)",
    )
  }

  if (plan.report.summary.importRecords.inserted === 1) {
    await client.query(
      `
        insert into approved_content_imports (
          release_id,
          manifest_sha256,
          source_git_sha,
          signed_by_user_id,
          signed_at,
          applied_by,
          target,
          change_ticket,
          summary_json
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `,
      [
        manifest.releaseId,
        manifestHash,
        manifest.sourceGitSha,
        signer,
        signedAt,
        actor,
        target,
        changeTicket,
        JSON.stringify({ expectedCounts: manifest.expectedCounts }),
      ],
    )
  }
}

async function readContentState(client) {
  const [topics, patterns, questions, hints, steps, misconceptions, approvals] =
    await Promise.all([
      client.query(`
        select id, title, description, sort_order, week_number, module_ref, is_active
        from topics
        order by id
      `),
      client.query(`
        select
          id,
          topic_id,
          title,
          description,
          difficulty,
          concept_tags_json,
          misconception_tags_json,
          reviewed_by_user_id,
          reviewed_at
        from question_patterns
        order by id
      `),
      client.query(`
        select
          id,
          topic_id,
          pattern_id,
          title,
          prompt,
          difficulty,
          accepted_answers_json,
          numeric_value,
          tolerance,
          answer_explanation,
          source_type,
          trust_level,
          review_status,
          visibility,
          originality_note,
          reviewed_by,
          reviewed_by_user_id,
          reviewed_at,
          archived_at
        from questions
        order by id
      `),
      client.query(`
        select question_id, hint_order, body
        from hints
        order by question_id, hint_order
      `),
      client.query(`
        select question_id, step_order, body
        from solution_steps
        order by question_id, step_order
      `),
      client.query(`
        select question_id, id, feedback, match_terms_json, metadata_json
        from misconceptions
        order by question_id, id
      `),
      client.query(`
        select
          qah.question_id,
          qah.question_version_id,
          qah.decision,
          qah.reviewer_user_id,
          qah.decided_at,
          latest.id as latest_version_id
        from question_approval_history qah
        join lateral (
          select qv.id
          from question_versions qv
          where qv.question_id = qah.question_id
          order by qv.version_number desc
          limit 1
        ) latest on true
        order by qah.question_id, qah.id
      `),
    ])

  const hintsByQuestion = groupRows(hints.rows, "question_id")
  const stepsByQuestion = groupRows(steps.rows, "question_id")
  const misconceptionsByQuestion = groupRows(misconceptions.rows, "question_id")
  const approvalsByQuestion = groupRows(approvals.rows, "question_id")

  return {
    patterns: new Map(
      patterns.rows.map((row) => [
        String(row.id),
        {
          item: patternFromRow(row),
          policy: {
            reviewedAt: isoTimestamp(row.reviewed_at),
            reviewedByUserId: String(row.reviewed_by_user_id),
          },
        },
      ]),
    ),
    questions: new Map(
      questions.rows.map((row) => [
        String(row.id),
        {
          item: questionFromRows(
            row,
            hintsByQuestion.get(String(row.id)) ?? [],
            stepsByQuestion.get(String(row.id)) ?? [],
            misconceptionsByQuestion.get(String(row.id)) ?? [],
          ),
          policy: {
            approvals: (approvalsByQuestion.get(String(row.id)) ?? []).map(
              (approval) => ({
                decidedAt: isoTimestamp(approval.decided_at),
                decision: String(approval.decision),
                isLatestVersion:
                  Number(approval.question_version_id) ===
                  Number(approval.latest_version_id),
                reviewerUserId: String(approval.reviewer_user_id),
              }),
            ),
            archivedAt: row.archived_at,
            reviewStatus: row.review_status,
            reviewedAt: isoTimestamp(row.reviewed_at),
            reviewedBy: row.reviewed_by,
            reviewedByUserId: row.reviewed_by_user_id,
            trustLevel: row.trust_level,
            visibility: row.visibility,
          },
        },
      ]),
    ),
    topics: new Map(
      topics.rows.map((row) => [String(row.id), { item: topicFromRow(row) }]),
    ),
  }
}

async function readOperationalCounts(client) {
  const selections = OPERATIONAL_TABLES.map(
    (table) => `(select count(*)::int from ${table}) as ${table}`,
  ).join(",\n")
  const result = await client.query(`select ${selections}`)
  return Object.fromEntries(
    OPERATIONAL_TABLES.map((table) => [
      table,
      Number(result.rows[0]?.[table] ?? 0),
    ]),
  )
}

function planEntities({
  approval,
  existing,
  inserts,
  issues,
  kind,
  manifestItems,
  summary,
}) {
  for (const item of manifestItems) {
    const found = existing.get(item.id)
    if (!found) {
      inserts.push(item)
      summary.inserted += 1
      continue
    }

    const expectedHash = sha256(canonicalJson(item))
    const actualHash = sha256(canonicalJson(found.item))
    const policyIssues = policyMismatches(kind, found.policy, approval)

    if (expectedHash !== actualHash || policyIssues.length > 0) {
      issues.push(
        issue(
          "stable_id_conflict",
          `${kind} ID ${item.id} already exists with different content or approval state.`,
        ),
      )
      continue
    }

    summary.noOp += 1
  }
}

function policyMismatches(kind, policy, approval) {
  if (kind === "patterns") {
    return policy.reviewedByUserId === approval.signedByUserId &&
      policy.reviewedAt === approval.signedAt
      ? []
      : ["approval"]
  }

  if (kind !== "questions") {
    return []
  }

  return policy.visibility === "public" &&
    policy.reviewStatus === "approved" &&
    policy.trustLevel === "professor_approved" &&
    policy.reviewedBy === null &&
    policy.reviewedByUserId === approval.signedByUserId &&
    policy.reviewedAt === approval.signedAt &&
    policy.approvals.length === 1 &&
    policy.approvals[0].decision === "approved" &&
    policy.approvals[0].reviewerUserId === approval.signedByUserId &&
    policy.approvals[0].decidedAt === approval.signedAt &&
    policy.approvals[0].isLatestVersion === true &&
    policy.archivedAt === null
    ? []
    : ["publication"]
}

function rejectUnexpectedTargetIds(existing, manifestIds, kind, issues) {
  for (const id of existing.keys()) {
    if (!manifestIds.has(id)) {
      issues.push(
        issue(
          "unexpected_target_content",
          `Target contains ${kind} ID ${id}, which is absent from the complete approved manifest.`,
        ),
      )
    }
  }
}

async function assertImportSchema(client, issues) {
  const result = await client.query(`
    select
      to_regclass('public.question_patterns')::text as patterns,
      to_regclass('public.approved_content_imports')::text as imports,
      to_regclass('public.question_approval_history')::text as approvals
  `)
  const row = result.rows[0] ?? {}
  if (!row.patterns || !row.imports || !row.approvals) {
    issues.push(
      issue(
        "import_schema_missing",
        "Approved-content import schema is missing; apply all database migrations first.",
      ),
    )
  }
}

function normalizeManifest(raw, issues) {
  const root = objectValue(raw, "manifest", ROOT_KEYS, issues)
  const sourceFiles = arrayValue(root.sourceFiles, "sourceFiles", issues).map(
    (entry, index) => {
      const label = `sourceFiles[${index}]`
      const value = objectValue(entry, label, ["path", "sha256"], issues)
      return {
        path: stringValue(value.path, `${label}.path`, issues),
        sha256: hashValue(value.sha256, `${label}.sha256`, issues),
      }
    },
  )
  const approvalValue = objectValue(
    root.approval,
    "approval",
    ["status", "signedByUserId", "signedAt", "changeTicket", "contentSha256"],
    issues,
  )
  const expectedOrder = arrayValue(
    root.expectedTopicOrder,
    "expectedTopicOrder",
    issues,
  ).map((entry, index) => {
    const label = `expectedTopicOrder[${index}]`
    const value = objectValue(entry, label, ["id", "sortOrder"], issues)
    return {
      id: idValue(value.id, `${label}.id`, issues),
      sortOrder: positiveInteger(value.sortOrder, `${label}.sortOrder`, issues),
    }
  })
  const topics = arrayValue(root.topics, "topics", issues).map((entry, index) =>
    normalizeTopic(entry, `topics[${index}]`, issues),
  )
  const patterns = arrayValue(root.patterns, "patterns", issues).map(
    (entry, index) => normalizePattern(entry, `patterns[${index}]`, issues),
  )
  const questions = arrayValue(root.questions, "questions", issues).map(
    (entry, index) => normalizeQuestion(entry, `questions[${index}]`, issues),
  )

  return {
    approval: {
      changeTicket: stringValue(
        approvalValue.changeTicket,
        "approval.changeTicket",
        issues,
      ),
      contentSha256: hashValue(
        approvalValue.contentSha256,
        "approval.contentSha256",
        issues,
      ),
      signedAt: timestampValue(
        approvalValue.signedAt,
        "approval.signedAt",
        issues,
      ),
      signedByUserId: idValue(
        approvalValue.signedByUserId,
        "approval.signedByUserId",
        issues,
      ),
      status: stringValue(approvalValue.status, "approval.status", issues),
    },
    approvedGeneratedQuestionIds: stringArray(
      root.approvedGeneratedQuestionIds,
      "approvedGeneratedQuestionIds",
      issues,
      { ids: true },
    ),
    contentHashes: normalizeContentHashes(root.contentHashes, issues),
    expectedCounts: normalizeExpectedCounts(root.expectedCounts, issues),
    expectedTopicOrder: expectedOrder,
    patterns,
    questions,
    releaseId: releaseValue(root.releaseId, "releaseId", issues),
    schemaVersion: integerValue(root.schemaVersion, "schemaVersion", issues),
    sourceFiles,
    sourceGitSha: gitShaValue(root.sourceGitSha, "sourceGitSha", issues),
    topics,
  }
}

function normalizeTopic(raw, label, issues) {
  const value = objectValue(
    raw,
    label,
    [
      "id",
      "title",
      "description",
      "sortOrder",
      "weekNumber",
      "moduleRef",
      "isActive",
    ],
    issues,
  )
  return {
    description: stringValue(value.description, `${label}.description`, issues),
    id: idValue(value.id, `${label}.id`, issues),
    isActive: booleanValue(value.isActive, `${label}.isActive`, issues),
    moduleRef: stringValue(value.moduleRef, `${label}.moduleRef`, issues),
    sortOrder: positiveInteger(value.sortOrder, `${label}.sortOrder`, issues),
    title: stringValue(value.title, `${label}.title`, issues),
    weekNumber: positiveInteger(
      value.weekNumber,
      `${label}.weekNumber`,
      issues,
    ),
  }
}

function normalizePattern(raw, label, issues) {
  const value = objectValue(
    raw,
    label,
    [
      "id",
      "topicId",
      "title",
      "description",
      "difficulty",
      "conceptTags",
      "misconceptionTags",
    ],
    issues,
  )
  return {
    conceptTags: stringArray(value.conceptTags, `${label}.conceptTags`, issues),
    description: stringValue(value.description, `${label}.description`, issues),
    difficulty: enumValue(
      value.difficulty,
      `${label}.difficulty`,
      DIFFICULTIES,
      issues,
    ),
    id: idValue(value.id, `${label}.id`, issues),
    misconceptionTags: stringArray(
      value.misconceptionTags,
      `${label}.misconceptionTags`,
      issues,
    ),
    title: stringValue(value.title, `${label}.title`, issues),
    topicId: idValue(value.topicId, `${label}.topicId`, issues),
  }
}

function normalizeQuestion(raw, label, issues) {
  const value = objectValue(
    raw,
    label,
    [
      "id",
      "topicId",
      "patternId",
      "origin",
      "title",
      "prompt",
      "difficulty",
      "acceptedAnswers",
      "numericValue",
      "tolerance",
      "answerExplanation",
      "originalityNote",
      "hints",
      "solutionSteps",
      "misconceptions",
    ],
    issues,
  )
  return {
    acceptedAnswers: stringArray(
      value.acceptedAnswers,
      `${label}.acceptedAnswers`,
      issues,
      { nonempty: true },
    ),
    answerExplanation: stringValue(
      value.answerExplanation,
      `${label}.answerExplanation`,
      issues,
    ),
    difficulty: enumValue(
      value.difficulty,
      `${label}.difficulty`,
      DIFFICULTIES,
      issues,
    ),
    hints: normalizeOrderedBodies(value.hints, `${label}.hints`, issues),
    id: idValue(value.id, `${label}.id`, issues),
    misconceptions: arrayValue(
      value.misconceptions,
      `${label}.misconceptions`,
      issues,
    ).map((entry, index) =>
      normalizeMisconception(
        entry,
        `${label}.misconceptions[${index}]`,
        issues,
      ),
    ),
    numericValue: nullableNumber(
      value.numericValue,
      `${label}.numericValue`,
      issues,
    ),
    originalityNote: stringValue(
      value.originalityNote,
      `${label}.originalityNote`,
      issues,
    ),
    origin: enumValue(value.origin, `${label}.origin`, ORIGINS, issues),
    patternId:
      value.patternId === null
        ? null
        : idValue(value.patternId, `${label}.patternId`, issues),
    prompt: stringValue(value.prompt, `${label}.prompt`, issues),
    solutionSteps: normalizeOrderedBodies(
      value.solutionSteps,
      `${label}.solutionSteps`,
      issues,
    ),
    title: stringValue(value.title, `${label}.title`, issues),
    tolerance: nullableNonnegativeNumber(
      value.tolerance,
      `${label}.tolerance`,
      issues,
    ),
    topicId: idValue(value.topicId, `${label}.topicId`, issues),
  }
}

function normalizeOrderedBodies(raw, label, issues) {
  return arrayValue(raw, label, issues).map((entry, index) => {
    const itemLabel = `${label}[${index}]`
    const value = objectValue(entry, itemLabel, ["order", "body"], issues)
    return {
      body: stringValue(value.body, `${itemLabel}.body`, issues),
      order: positiveInteger(value.order, `${itemLabel}.order`, issues),
    }
  })
}

function normalizeMisconception(raw, label, issues) {
  const value = objectValue(
    raw,
    label,
    ["id", "feedback", "matchTerms", "metadata"],
    issues,
  )
  const metadata = objectValue(
    value.metadata,
    `${label}.metadata`,
    ["conceptTags"],
    issues,
  )
  return {
    feedback: stringValue(value.feedback, `${label}.feedback`, issues),
    id: idValue(value.id, `${label}.id`, issues),
    matchTerms: stringArray(value.matchTerms, `${label}.matchTerms`, issues),
    metadata: {
      conceptTags: stringArray(
        metadata.conceptTags,
        `${label}.metadata.conceptTags`,
        issues,
      ),
    },
  }
}

function normalizeExpectedCounts(raw, issues) {
  const keys = [
    "topics",
    "patterns",
    "questions",
    "hints",
    "solutionSteps",
    "misconceptions",
  ]
  const value = objectValue(raw, "expectedCounts", keys, issues)
  return Object.fromEntries(
    keys.map((key) => [
      key,
      nonnegativeInteger(value[key], `expectedCounts.${key}`, issues),
    ]),
  )
}

function normalizeContentHashes(raw, issues) {
  const value = objectValue(
    raw,
    "contentHashes",
    ["topics", "patterns", "questions"],
    issues,
  )
  return {
    patterns: hashMap(value.patterns, "contentHashes.patterns", issues),
    questions: hashMap(value.questions, "contentHashes.questions", issues),
    topics: hashMap(value.topics, "contentHashes.topics", issues),
  }
}

function validateManifestRelationships(manifest, issues) {
  if (manifest.schemaVersion !== 1) {
    issues.push(
      issue("unsupported_schema_version", "schemaVersion must equal 1."),
    )
  }
  if (manifest.approval.status !== "professor_approved") {
    issues.push(
      issue(
        "manifest_not_approved",
        "approval.status must equal professor_approved.",
      ),
    )
  }
  if (UNSAFE_SIGNER_PATTERN.test(manifest.approval.signedByUserId)) {
    issues.push(
      issue(
        "generic_signer_forbidden",
        "approval.signedByUserId must be an immutable institutional user ID, not a role label or migration actor.",
      ),
    )
  }
  if (manifest.sourceFiles.length === 0) {
    issues.push(
      issue(
        "source_files_required",
        "At least one approved source-file hash is required.",
      ),
    )
  }
  if (manifest.topics.length === 0 || manifest.questions.length === 0) {
    issues.push(
      issue(
        "content_required",
        "The approved manifest must contain at least one topic and one question.",
      ),
    )
  }

  rejectDuplicates(
    manifest.sourceFiles.map((entry) => entry.path),
    "source file path",
    issues,
  )
  rejectDuplicates(
    manifest.topics.map((entry) => entry.id),
    "topic ID",
    issues,
  )
  rejectDuplicates(
    manifest.topics.map((entry) => entry.sortOrder),
    "topic sort order",
    issues,
  )
  rejectDuplicates(
    manifest.patterns.map((entry) => entry.id),
    "pattern ID",
    issues,
  )
  rejectDuplicates(
    manifest.questions.map((entry) => entry.id),
    "question ID",
    issues,
  )
  rejectDuplicates(
    manifest.approvedGeneratedQuestionIds,
    "approved generated question ID",
    issues,
  )

  const allStableIds = [
    ...manifest.topics.map((entry) => entry.id),
    ...manifest.patterns.map((entry) => entry.id),
    ...manifest.questions.map((entry) => entry.id),
  ]
  rejectDuplicates(
    allStableIds,
    "stable content ID across entity types",
    issues,
  )

  const sortedTopics = [...manifest.topics].sort(
    (left, right) => left.sortOrder - right.sortOrder,
  )
  for (let index = 1; index < sortedTopics.length; index += 1) {
    if (sortedTopics[index].sortOrder <= sortedTopics[index - 1].sortOrder) {
      issues.push(
        issue(
          "invalid_topic_order",
          "Topic sort order must be unique and strictly increasing; gaps are preserved.",
        ),
      )
      break
    }
  }
  if (
    canonicalJson(manifest.expectedTopicOrder) !==
    canonicalJson(
      sortedTopics.map((topic) => ({
        id: topic.id,
        sortOrder: topic.sortOrder,
      })),
    )
  ) {
    issues.push(
      issue(
        "topic_order_mismatch",
        "expectedTopicOrder must exactly match topics sorted by sortOrder.",
      ),
    )
  }

  const topicIds = new Set(manifest.topics.map((topic) => topic.id))
  const patterns = new Map(
    manifest.patterns.map((pattern) => [pattern.id, pattern]),
  )
  const referencedPatterns = new Set()
  const generatedIds = []

  for (const pattern of manifest.patterns) {
    if (!topicIds.has(pattern.topicId)) {
      issues.push(
        issue(
          "unknown_pattern_topic",
          `Pattern ${pattern.id} references unknown topic ${pattern.topicId}.`,
        ),
      )
    }
  }

  for (const question of manifest.questions) {
    if (!topicIds.has(question.topicId)) {
      issues.push(
        issue(
          "unknown_question_topic",
          `Question ${question.id} references unknown topic ${question.topicId}.`,
        ),
      )
    }
    validateOrderedChildren(question.id, "hint", question.hints, issues)
    validateOrderedChildren(
      question.id,
      "solution step",
      question.solutionSteps,
      issues,
    )
    rejectDuplicates(
      question.misconceptions.map((entry) => entry.id),
      `misconception ID for question ${question.id}`,
      issues,
    )

    if (question.origin !== "professor_original") {
      generatedIds.push(question.id)
      if (!question.patternId) {
        issues.push(
          issue(
            "generated_pattern_required",
            `Generated question ${question.id} must reference approved pattern metadata.`,
          ),
        )
      }
    }

    if (question.patternId) {
      const pattern = patterns.get(question.patternId)
      referencedPatterns.add(question.patternId)
      if (!pattern) {
        issues.push(
          issue(
            "unknown_question_pattern",
            `Question ${question.id} references unknown pattern ${question.patternId}.`,
          ),
        )
      } else if (pattern.topicId !== question.topicId) {
        issues.push(
          issue(
            "pattern_topic_mismatch",
            `Question ${question.id} and pattern ${pattern.id} must reference the same topic.`,
          ),
        )
      }
    }

    if ((question.numericValue === null) !== (question.tolerance === null)) {
      issues.push(
        issue(
          "numeric_tolerance_pair",
          `Question ${question.id} must provide both numericValue and tolerance or neither.`,
        ),
      )
    }
  }

  for (const pattern of manifest.patterns) {
    if (!referencedPatterns.has(pattern.id)) {
      issues.push(
        issue(
          "unused_pattern_metadata",
          `Pattern ${pattern.id} is not required by any approved question.`,
        ),
      )
    }
  }

  if (
    canonicalJson([...generatedIds].sort()) !==
    canonicalJson([...manifest.approvedGeneratedQuestionIds].sort())
  ) {
    issues.push(
      issue(
        "generated_approval_allowlist_mismatch",
        "approvedGeneratedQuestionIds must exactly match generated questions in the manifest.",
      ),
    )
  }

  const actualCounts = {
    hints: manifest.questions.reduce(
      (total, question) => total + question.hints.length,
      0,
    ),
    misconceptions: manifest.questions.reduce(
      (total, question) => total + question.misconceptions.length,
      0,
    ),
    patterns: manifest.patterns.length,
    questions: manifest.questions.length,
    solutionSteps: manifest.questions.reduce(
      (total, question) => total + question.solutionSteps.length,
      0,
    ),
    topics: manifest.topics.length,
  }
  if (canonicalJson(actualCounts) !== canonicalJson(manifest.expectedCounts)) {
    issues.push(
      issue(
        "expected_count_mismatch",
        "expectedCounts does not match the exact manifest content.",
      ),
    )
  }

  if (PRIVATE_TEXT_PATTERN.test(canonicalJson(manifest))) {
    issues.push(
      issue(
        "private_source_signal",
        "Manifest contains a private-source, copied-text, retrieval, or embedding signal.",
      ),
    )
  }
}

function validateDeclaredContentHashes(manifest, issues) {
  const calculated = computeContentHashes(manifest)
  for (const kind of ["topics", "patterns", "questions"]) {
    const declared = manifest.contentHashes[kind]
    const expectedIds = Object.keys(calculated[kind]).sort()
    const declaredIds = Object.keys(declared).sort()
    if (canonicalJson(expectedIds) !== canonicalJson(declaredIds)) {
      issues.push(
        issue(
          "content_hash_id_mismatch",
          `contentHashes.${kind} must contain exactly the approved ${kind} IDs.`,
        ),
      )
      continue
    }
    for (const id of expectedIds) {
      if (declared[id] !== calculated[kind][id]) {
        issues.push(
          issue(
            "content_hash_mismatch",
            `contentHashes.${kind}.${id} does not match canonical content.`,
          ),
        )
      }
    }
  }
}

async function verifySourceFiles(sourceFiles, repositoryRoot) {
  const issues = []
  const approvedRoot = path.resolve(repositoryRoot, PRODUCTION_SOURCE_PREFIX)
  let repositoryRootReal
  let approvedRootReal
  try {
    repositoryRootReal = await realpath(repositoryRoot)
    approvedRootReal = await realpath(approvedRoot)
  } catch {
    throw new ContentImportValidationError([
      issue(
        "approved_source_root_missing",
        `${PRODUCTION_SOURCE_PREFIX} must exist before a manifest can be imported.`,
      ),
    ])
  }

  if (!isInside(approvedRootReal, repositoryRootReal)) {
    throw new ContentImportValidationError([
      issue(
        "unsafe_source_root",
        `${PRODUCTION_SOURCE_PREFIX} must resolve inside the repository.`,
      ),
    ])
  }

  for (const source of sourceFiles) {
    if (
      !source.path.startsWith(PRODUCTION_SOURCE_PREFIX) ||
      path.isAbsolute(source.path) ||
      source.path.includes("..")
    ) {
      issues.push(
        issue(
          "unsafe_source_path",
          `Approved source path ${source.path} must stay under ${PRODUCTION_SOURCE_PREFIX}.`,
        ),
      )
      continue
    }

    const candidate = path.resolve(repositoryRoot, source.path)
    try {
      const candidateReal = await realpath(candidate)
      if (!isInside(candidateReal, approvedRootReal)) {
        issues.push(
          issue(
            "unsafe_source_path",
            `Approved source path ${source.path} escapes ${PRODUCTION_SOURCE_PREFIX}.`,
          ),
        )
        continue
      }
      const actualHash = sha256(await readFile(candidateReal))
      if (actualHash !== source.sha256) {
        issues.push(
          issue(
            "source_file_hash_mismatch",
            `Approved source file ${source.path} does not match its declared SHA-256 hash.`,
          ),
        )
      }
    } catch (error) {
      issues.push(
        issue(
          "source_file_read_failed",
          `Approved source file ${source.path} could not be verified: ${errorMessage(error)}.`,
        ),
      )
    }
  }

  if (issues.length > 0) {
    throw new ContentImportValidationError(issues)
  }
}

function validateExecution({
  actor,
  changeTicket,
  confirmProduction,
  sourceGitSha,
  dryRun,
  target,
  validatedManifest,
}) {
  if (!validatedManifest?.manifest || !validatedManifest?.manifestHash) {
    throw new ContentImportValidationError([
      issue("validated_manifest_required", "A validated manifest is required."),
    ])
  }
  requireNonblank(actor, "CONTENT_IMPORT_ACTOR")
  requireNonblank(changeTicket, "CONTENT_IMPORT_CHANGE_TICKET")
  requireNonblank(sourceGitSha, "CONTENT_IMPORT_SOURCE_GIT_SHA")
  if (!TARGETS.has(target)) {
    throw new ContentImportValidationError([
      issue(
        "invalid_target",
        "Import target must be test, staging, or production.",
      ),
    ])
  }
  if (target !== "test" && validatedManifest.sourceFilesVerified !== true) {
    throw new ContentImportValidationError([
      issue(
        "source_file_verification_required",
        "Staging and Production require a manifest loaded with verified approved source files.",
      ),
    ])
  }
  if (changeTicket !== validatedManifest.manifest.approval.changeTicket) {
    throw new ContentImportValidationError([
      issue(
        "change_ticket_mismatch",
        "CONTENT_IMPORT_CHANGE_TICKET must match the professor-approved manifest.",
      ),
    ])
  }
  if (sourceGitSha !== validatedManifest.manifest.sourceGitSha) {
    throw new ContentImportValidationError([
      issue(
        "deployment_sha_mismatch",
        "CONTENT_IMPORT_SOURCE_GIT_SHA must match manifest.sourceGitSha.",
      ),
    ])
  }
  if (target === "production" && !dryRun && !confirmProduction) {
    throw new ContentImportValidationError([
      issue(
        "production_confirmation_required",
        "Production apply requires --confirm-production.",
      ),
    ])
  }
}

function topicFromRow(row) {
  return {
    description: String(row.description),
    id: String(row.id),
    isActive: row.is_active === true,
    moduleRef: String(row.module_ref),
    sortOrder: Number(row.sort_order),
    title: String(row.title),
    weekNumber: Number(row.week_number),
  }
}

function patternFromRow(row) {
  return {
    conceptTags: jsonArray(row.concept_tags_json),
    description: String(row.description),
    difficulty: String(row.difficulty),
    id: String(row.id),
    misconceptionTags: jsonArray(row.misconception_tags_json),
    title: String(row.title),
    topicId: String(row.topic_id),
  }
}

function questionFromRows(row, hints, steps, misconceptions) {
  return {
    acceptedAnswers: jsonArray(row.accepted_answers_json),
    answerExplanation: String(row.answer_explanation),
    difficulty: String(row.difficulty),
    hints: hints.map((hint) => ({
      body: String(hint.body),
      order: Number(hint.hint_order),
    })),
    id: String(row.id),
    misconceptions: misconceptions.map((misconception) => ({
      feedback: String(misconception.feedback),
      id: String(misconception.id),
      matchTerms: jsonArray(misconception.match_terms_json),
      metadata: jsonObject(misconception.metadata_json),
    })),
    numericValue: row.numeric_value === null ? null : Number(row.numeric_value),
    originalityNote: String(row.originality_note),
    origin: originForSourceType(String(row.source_type)),
    patternId: row.pattern_id === null ? null : String(row.pattern_id),
    prompt: String(row.prompt),
    solutionSteps: steps.map((step) => ({
      body: String(step.body),
      order: Number(step.step_order),
    })),
    title: String(row.title),
    tolerance: row.tolerance === null ? null : Number(row.tolerance),
    topicId: String(row.topic_id),
  }
}

function sourceTypeForOrigin(origin) {
  return origin === "professor_original" ? "professor_provided" : origin
}

function originForSourceType(sourceType) {
  return sourceType === "professor_provided" ? "professor_original" : sourceType
}

function groupRows(rows, key) {
  const grouped = new Map()
  for (const row of rows) {
    const value = String(row[key])
    const items = grouped.get(value) ?? []
    items.push(row)
    grouped.set(value, items)
  }
  return grouped
}

function emptySummary() {
  return Object.fromEntries(
    [
      "topics",
      "patterns",
      "questions",
      "hints",
      "solutionSteps",
      "misconceptions",
      "approvals",
      "importRecords",
    ].map((key) => [key, { inserted: 0, noOp: 0 }]),
  )
}

function finalizeSummary(summary) {
  return Object.fromEntries(
    Object.entries(summary).map(([key, counts]) => [
      key,
      { ...counts, total: counts.inserted + counts.noOp },
    ]),
  )
}

function rejectedPlan(manifest, manifestHash, issues, target) {
  return {
    inserts: { patterns: [], questions: [], topics: [] },
    issues,
    report: {
      committed: false,
      manifestHash,
      mode: "plan",
      operationalCounts: {},
      releaseId: manifest.releaseId,
      signerUserId: manifest.approval.signedByUserId,
      status: "rejected",
      summary: finalizeSummary(emptySummary()),
      target,
      validations: validationResults(issues),
    },
  }
}

function validationResults(issues) {
  return issues.length === 0
    ? [
        { code: "manifest_and_target", status: "passed" },
        { code: "approved_content_only", status: "passed" },
        { code: "stable_ids_and_order", status: "passed" },
      ]
    : issues.map((entry) => ({ code: entry.code, status: "failed" }))
}

function validateOrderedChildren(questionId, kind, entries, issues) {
  for (const [index, entry] of entries.entries()) {
    if (entry.order !== index + 1) {
      issues.push(
        issue(
          "invalid_child_order",
          `Question ${questionId} ${kind} orders must be unique, contiguous, and one-based.`,
        ),
      )
      return
    }
  }
}

function rejectDuplicates(values, label, issues) {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) {
      issues.push(issue("duplicate_id", `Duplicate ${label}: ${value}.`))
    }
    seen.add(value)
  }
}

function objectValue(raw, label, allowedKeys, issues) {
  if (!isPlainObject(raw)) {
    issues.push(issue("invalid_type", `${label} must be an object.`))
    return {}
  }
  const keys = Object.keys(raw)
  for (const key of keys) {
    if (!allowedKeys.includes(key)) {
      issues.push(
        issue("unexpected_field", `${label} contains forbidden field ${key}.`),
      )
    }
  }
  for (const key of allowedKeys) {
    if (!Object.hasOwn(raw, key)) {
      issues.push(issue("missing_field", `${label}.${key} is required.`))
    }
  }
  return raw
}

function arrayValue(value, label, issues) {
  if (!Array.isArray(value)) {
    issues.push(issue("invalid_type", `${label} must be an array.`))
    return []
  }
  return value
}

function stringValue(value, label, issues) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    issues.push(
      issue(
        "invalid_string",
        `${label} must be a non-empty string without outer whitespace.`,
      ),
    )
    return typeof value === "string" ? value.trim() : ""
  }
  return value
}

function idValue(value, label, issues) {
  const normalized = stringValue(value, label, issues)
  if (!ID_PATTERN.test(normalized)) {
    issues.push(issue("invalid_id", `${label} has an invalid stable ID.`))
  }
  return normalized
}

function releaseValue(value, label, issues) {
  const normalized = stringValue(value, label, issues)
  if (!RELEASE_PATTERN.test(normalized)) {
    issues.push(issue("invalid_release_id", `${label} is invalid.`))
  }
  return normalized
}

function hashValue(value, label, issues) {
  const normalized = stringValue(value, label, issues)
  if (!SHA256_PATTERN.test(normalized)) {
    issues.push(issue("invalid_sha256", `${label} must be a SHA-256 hash.`))
  }
  return normalized
}

function gitShaValue(value, label, issues) {
  const normalized = stringValue(value, label, issues)
  if (!GIT_SHA_PATTERN.test(normalized)) {
    issues.push(
      issue("invalid_git_sha", `${label} must be a hexadecimal Git SHA.`),
    )
  }
  return normalized
}

function timestampValue(value, label, issues) {
  const normalized = stringValue(value, label, issues)
  const parsed = Date.parse(normalized)
  if (
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== normalized
  ) {
    issues.push(
      issue(
        "invalid_timestamp",
        `${label} must be a canonical ISO-8601 UTC timestamp.`,
      ),
    )
  }
  return normalized
}

function booleanValue(value, label, issues) {
  if (typeof value !== "boolean") {
    issues.push(issue("invalid_type", `${label} must be a boolean.`))
    return false
  }
  return value
}

function integerValue(value, label, issues) {
  if (!Number.isInteger(value)) {
    issues.push(issue("invalid_integer", `${label} must be an integer.`))
    return 0
  }
  return value
}

function nonnegativeInteger(value, label, issues) {
  const normalized = integerValue(value, label, issues)
  if (normalized < 0) {
    issues.push(issue("invalid_integer", `${label} must be zero or greater.`))
  }
  return normalized
}

function positiveInteger(value, label, issues) {
  const normalized = integerValue(value, label, issues)
  if (normalized < 1) {
    issues.push(issue("invalid_integer", `${label} must be positive.`))
  }
  return normalized
}

function nullableNumber(value, label, issues) {
  if (value === null) return null
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(issue("invalid_number", `${label} must be null or finite.`))
    return null
  }
  return value
}

function nullableNonnegativeNumber(value, label, issues) {
  const normalized = nullableNumber(value, label, issues)
  if (normalized !== null && normalized < 0) {
    issues.push(
      issue("invalid_number", `${label} must be null or nonnegative.`),
    )
  }
  return normalized
}

function enumValue(value, label, values, issues) {
  const normalized = stringValue(value, label, issues)
  if (!values.has(normalized)) {
    issues.push(
      issue(
        "invalid_enum",
        `${label} must be one of: ${[...values].join(", ")}.`,
      ),
    )
  }
  return normalized
}

function stringArray(
  value,
  label,
  issues,
  { ids = false, nonempty = false } = {},
) {
  const entries = arrayValue(value, label, issues).map((entry, index) =>
    ids
      ? idValue(entry, `${label}[${index}]`, issues)
      : stringValue(entry, `${label}[${index}]`, issues),
  )
  if (nonempty && entries.length === 0) {
    issues.push(issue("empty_array", `${label} must not be empty.`))
  }
  rejectDuplicates(entries, `${label} value`, issues)
  return entries
}

function hashMap(value, label, issues) {
  if (!isPlainObject(value)) {
    issues.push(issue("invalid_type", `${label} must be an object.`))
    return {}
  }
  return Object.fromEntries(
    Object.entries(value).map(([id, hash]) => [
      idValue(id, `${label} key`, issues),
      hashValue(hash, `${label}.${id}`, issues),
    ]),
  )
}

function jsonArray(value) {
  return Array.isArray(value) ? value : JSON.parse(String(value))
}

function jsonObject(value) {
  return isPlainObject(value) ? value : JSON.parse(String(value))
}

function isoTimestamp(value) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString()
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  )
}

function requireNonblank(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ContentImportValidationError([
      issue("execution_value_required", `${label} is required.`),
    ])
  }
}

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < 1 || value > 900_000) {
    throw new ContentImportValidationError([
      issue(
        "invalid_timeout",
        "Import timeouts must be integers between 1 and 900000 milliseconds.",
      ),
    ])
  }
  return value
}

async function rollbackQuietly(client) {
  try {
    await client.query("rollback")
  } catch {
    // Preserve the original import error.
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function issue(code, message) {
  return { code, message }
}

export class ContentImportValidationError extends Error {
  constructor(issues) {
    super(issues.map((entry) => entry.message).join(" "))
    this.name = "ContentImportValidationError"
    this.issues = issues
  }
}

export class ContentImportConflictError extends Error {
  constructor(issues, report) {
    super(issues.map((entry) => entry.message).join(" "))
    this.name = "ContentImportConflictError"
    this.issues = issues
    this.report = report
  }
}
