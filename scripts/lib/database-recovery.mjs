import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { createReadStream } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import path from "node:path"

import { getMigrationStatus } from "./database-migrations.mjs"

export const CRITICAL_RECOVERY_TABLES = Object.freeze([
  "schema_migrations",
  "topics",
  "questions",
  "hints",
  "solution_steps",
  "misconceptions",
  "question_patterns",
  "question_versions",
  "question_approval_history",
  "approved_content_imports",
  "retrieval_chunks",
  "users",
  "roles",
  "user_roles",
  "tutor_sessions",
  "attempts",
  "student_progress",
  "ai_usage",
  "ai_llm_reservations",
  "audit_events",
  "feedback_reports",
])

export const REBUILDABLE_RECOVERY_TABLES = Object.freeze(["ai_response_cache"])

export const REQUIRED_RECOVERY_VIEWS = Object.freeze([
  "app_public_questions",
  "app_review_queue_questions",
  "app_student_retrieval_chunks",
  "app_admin_retrieval_chunks",
])

const DISPOSABLE_TARGET_PATTERN =
  /(?:^|[._/-])(disposable|recovery|restore|sandbox|scratch|test)(?:[._/-]|$)/i
const KNOWN_DEFERRED_CONSTRAINTS = new Set(["questions_pattern_id_fkey"])

export class RecoverySafetyError extends Error {
  constructor(message) {
    super(message)
    this.name = "RecoverySafetyError"
  }
}

export class RecoveryValidationError extends Error {
  constructor(issues, report) {
    super(`Restored database validation failed with ${issues.length} issue(s).`)
    this.name = "RecoveryValidationError"
    this.issues = issues
    this.report = report
  }
}

export function recoveryTargetFromUrl(databaseUrl) {
  let parsed

  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new RecoverySafetyError(
      "RECOVERY_TEST_DATABASE_URL must be a valid PostgreSQL URL.",
    )
  }

  if (!new Set(["postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new RecoverySafetyError(
      "RECOVERY_TEST_DATABASE_URL must use postgres:// or postgresql://.",
    )
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""))
  if (!parsed.hostname || !database) {
    throw new RecoverySafetyError(
      "Recovery target URL must include a hostname and database name.",
    )
  }

  const markerInput = `${parsed.hostname}/${database}`
  if (!DISPOSABLE_TARGET_PATTERN.test(markerInput)) {
    throw new RecoverySafetyError(
      "Recovery target hostname or database name must contain an explicit disposable marker such as restore, recovery, sandbox, scratch, or test.",
    )
  }

  const identity = [
    parsed.protocol,
    parsed.hostname.toLowerCase(),
    parsed.port || "5432",
    database,
    decodeURIComponent(parsed.username || "unknown-user"),
  ].join("|")

  return {
    database,
    fingerprint: createHash("sha256").update(identity).digest("hex"),
    host: parsed.hostname.toLowerCase(),
    port: parsed.port || "5432",
  }
}

export function assertRecoveryExecutionAuthorization({
  actor,
  changeTicket,
  confirmation,
  target,
}) {
  if (!actor?.trim()) {
    throw new RecoverySafetyError("RECOVERY_TEST_ACTOR is required.")
  }
  if (!changeTicket?.trim()) {
    throw new RecoverySafetyError("RECOVERY_TEST_CHANGE_TICKET is required.")
  }
  if (!confirmation || confirmation !== target.fingerprint) {
    throw new RecoverySafetyError(
      "--confirm-target must exactly match the disposable target fingerprint printed by --plan.",
    )
  }
}

export async function resolveRecoveryArchive(archivePath) {
  if (!archivePath?.trim()) {
    throw new RecoverySafetyError("--archive is required for restore mode.")
  }

  const resolvedPath = await realpath(path.resolve(archivePath))
  const details = await stat(resolvedPath)
  if (!details.isFile() || details.size === 0) {
    throw new RecoverySafetyError(
      "Recovery archive must be a non-empty regular file.",
    )
  }

  return {
    path: resolvedPath,
    sha256: await sha256File(resolvedPath),
    sizeBytes: details.size,
  }
}

export async function assertEmptyDisposableDatabase(client) {
  const result = await client.query(`
    select count(*)::int as object_count
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
  `)
  const objectCount = Number(result.rows[0]?.object_count ?? 0)

  if (objectCount !== 0) {
    throw new RecoverySafetyError(
      `Restore mode requires a newly created empty disposable database; found ${objectCount} public table(s). Use --validate-only for a provider-restored clone.`,
    )
  }
}

export async function assertConnectedRecoveryTarget(client, target) {
  const result = await client.query(
    "select current_database()::text as database_name",
  )
  const actualDatabase = String(result.rows[0]?.database_name ?? "")
  if (actualDatabase !== target.database) {
    throw new RecoverySafetyError(
      "Connected database identity does not match RECOVERY_TEST_DATABASE_URL.",
    )
  }
}

export function runPgRestore({
  archive,
  databaseUrl,
  spawnSyncImpl,
  inheritedEnvironment = process.env,
}) {
  const pgRestore = spawnSyncImpl ?? spawnSync
  const inspection = pgRestore("pg_restore", ["--list", archive.path], {
    encoding: "utf8",
    env: minimalPostgresEnvironment(inheritedEnvironment),
    stdio: "pipe",
  })
  assertSpawnSucceeded(inspection, "inspect the PostgreSQL recovery archive")

  const restored = pgRestore(
    "pg_restore",
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "--dbname",
      recoveryTargetFromUrl(databaseUrl).database,
      archive.path,
    ],
    {
      encoding: "utf8",
      env: {
        ...minimalPostgresEnvironment(inheritedEnvironment),
        ...postgresEnvironmentFromUrl(databaseUrl),
        PGCONNECT_TIMEOUT: "10",
      },
      stdio: "pipe",
    },
  )
  assertSpawnSucceeded(restored, "restore the PostgreSQL recovery archive")

  return {
    archiveSha256: archive.sha256,
    archiveSizeBytes: archive.sizeBytes,
    restoreTool: "pg_restore",
  }
}

export async function validateRestoredDatabase({ client, migrations }) {
  const issues = []
  const migrationStatus = await getMigrationStatus(client, migrations)
  if (migrationStatus.state !== "current") {
    issues.push({
      code: "migration_history_not_current",
      detail: migrationStatus.state,
    })
  }

  const objects = await client.query(`
    select table_name as name, 'table' as kind
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
    union all
    select table_name as name, 'view' as kind
    from information_schema.views
    where table_schema = 'public'
  `)
  const tables = new Set(
    objects.rows
      .filter((row) => row.kind === "table")
      .map((row) => String(row.name)),
  )
  const views = new Set(
    objects.rows
      .filter((row) => row.kind === "view")
      .map((row) => String(row.name)),
  )

  const missingTables = []
  for (const table of [
    ...CRITICAL_RECOVERY_TABLES,
    ...REBUILDABLE_RECOVERY_TABLES,
  ]) {
    if (!tables.has(table)) {
      missingTables.push(table)
      issues.push({ code: "missing_table", detail: table })
    }
  }
  for (const view of REQUIRED_RECOVERY_VIEWS) {
    if (!views.has(view)) {
      issues.push({ code: "missing_view", detail: view })
    }
  }

  const unvalidatedConstraints = await client.query(`
    select conname
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.contype in ('c', 'f')
      and c.convalidated = false
    order by conname
  `)
  const deferredConstraints = []
  for (const constraint of unvalidatedConstraints.rows) {
    const name = String(constraint.conname)
    if (KNOWN_DEFERRED_CONSTRAINTS.has(name)) {
      deferredConstraints.push(name)
      continue
    }
    issues.push({
      code: "unvalidated_constraint",
      detail: name,
    })
  }

  const integrityChecks =
    missingTables.length === 0 ? await runIntegrityChecks(client) : []
  issues.push(
    ...integrityChecks
      .filter((check) => check.violations > 0)
      .map((check) => ({
        code: "referential_integrity_violation",
        detail: check.code,
        violations: check.violations,
      })),
  )

  const rowCounts = {}
  for (const table of CRITICAL_RECOVERY_TABLES) {
    if (!tables.has(table)) {
      continue
    }
    const count = await client.query(
      `select count(*)::bigint as row_count from "${table}"`,
    )
    rowCounts[table] = Number(count.rows[0]?.row_count ?? 0)
  }

  const report = {
    criticalRowCounts: rowCounts,
    deferredConstraints,
    issues,
    migrationState: migrationStatus.state,
    schemaMigrationCount: migrationStatus.applied.length,
    status: issues.length === 0 ? "valid" : "invalid",
    validations: {
      criticalTables: CRITICAL_RECOVERY_TABLES.length,
      integrityChecks: integrityChecks.length,
      rebuildableTables: REBUILDABLE_RECOVERY_TABLES.length,
      requiredViews: REQUIRED_RECOVERY_VIEWS.length,
    },
  }

  if (issues.length > 0) {
    throw new RecoveryValidationError(issues, report)
  }

  return report
}

async function runIntegrityChecks(client) {
  const checks = [
    [
      "questions_topics",
      `select count(*)::int as violations
       from questions q left join topics t on t.id = q.topic_id
       where t.id is null`,
    ],
    [
      "question_children",
      `select count(*)::int as violations from (
         select h.question_id from hints h left join questions q on q.id = h.question_id where q.id is null
         union all
         select s.question_id from solution_steps s left join questions q on q.id = s.question_id where q.id is null
         union all
         select m.question_id from misconceptions m left join questions q on q.id = m.question_id where q.id is null
       ) orphaned_children`,
    ],
    [
      "question_history",
      `select count(*)::int as violations from (
         select qv.question_id
         from question_versions qv
         left join questions q on q.id = qv.question_id
         left join users u on u.id = qv.created_by_user_id
         where q.id is null or u.id is null
         union all
         select qah.question_id
         from question_approval_history qah
         left join questions q on q.id = qah.question_id
         left join question_versions qv
           on qv.id = qah.question_version_id and qv.question_id = qah.question_id
         left join users u on u.id = qah.reviewer_user_id
         where q.id is null or qv.id is null or u.id is null
       ) orphaned_history`,
    ],
    [
      "identity_roles",
      `select count(*)::int as violations
       from user_roles ur
       left join users u on u.id = ur.user_id
       left join roles r on r.id = ur.role_id
       where u.id is null or r.id is null`,
    ],
    [
      "student_activity",
      `select count(*)::int as violations from (
         select s.id::text
         from tutor_sessions s
         left join users u on u.id = s.user_id
         left join questions q on q.id = s.question_id
         where (s.user_id is not null and u.id is null)
            or (s.question_id is not null and q.id is null)
         union all
         select a.id::text
         from attempts a
         left join tutor_sessions s on s.id = a.session_id
         left join questions q on q.id = a.question_id
         left join topics t on t.id = a.topic_id
         left join question_versions qv
           on qv.id = a.question_version_id and qv.question_id = a.question_id
         where s.id is null or q.id is null or t.id is null or qv.id is null
         union all
         select sp.id::text
         from student_progress sp
         left join users u on u.id = sp.user_id
         left join questions q on q.id = sp.question_id and q.topic_id = sp.topic_id
         left join question_versions qv
           on qv.id = sp.question_version_id and qv.question_id = sp.question_id
         where u.id is null or q.id is null or qv.id is null
       ) orphaned_activity`,
    ],
    [
      "retrieval_content",
      `select count(*)::int as violations
       from retrieval_chunks rc
       left join topics t on t.id = rc.topic_id
       left join questions q on q.id = rc.question_id and q.topic_id = rc.topic_id
       where t.id is null or (rc.question_id is not null and q.id is null)`,
    ],
    [
      "approved_content_evidence",
      `select count(*)::int as violations from (
         select q.id
         from questions q
         left join question_patterns qp on qp.id = q.pattern_id
         where q.pattern_id is not null and qp.id is null
         union all
         select qp.id
         from question_patterns qp
         left join topics t on t.id = qp.topic_id
         left join users u on u.id = qp.reviewed_by_user_id
         where t.id is null or u.id is null
         union all
         select aci.release_id
         from approved_content_imports aci
         left join users u on u.id = aci.signed_by_user_id
         where u.id is null
       ) orphaned_approved_content`,
    ],
    [
      "llm_reservations",
      `select count(*)::int as violations
       from ai_llm_reservations r
       left join tutor_sessions s on s.id = r.session_id
       where s.id is null`,
    ],
  ]

  const results = []
  for (const [code, sql] of checks) {
    const result = await client.query(sql)
    results.push({
      code,
      violations: Number(result.rows[0]?.violations ?? 0),
    })
  }
  return results
}

function minimalPostgresEnvironment(environment) {
  return Object.fromEntries(
    ["LANG", "LC_ALL", "PATH", "SYSTEMROOT", "TMPDIR"].flatMap((name) =>
      environment[name] ? [[name, environment[name]]] : [],
    ),
  )
}

function postgresEnvironmentFromUrl(databaseUrl) {
  const parsed = new URL(databaseUrl)
  const environment = {
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
  }

  if (parsed.username) {
    environment.PGUSER = decodeURIComponent(parsed.username)
  }
  if (parsed.password) {
    environment.PGPASSWORD = decodeURIComponent(parsed.password)
  }

  const parameterMap = {
    application_name: "PGAPPNAME",
    channel_binding: "PGCHANNELBINDING",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
  }
  for (const [parameter, environmentName] of Object.entries(parameterMap)) {
    const value = parsed.searchParams.get(parameter)
    if (value) {
      environment[environmentName] = value
    }
  }

  return environment
}

function assertSpawnSucceeded(result, action) {
  if (result?.error) {
    throw new RecoverySafetyError(`Unable to ${action}: command unavailable.`)
  }
  if (result?.status !== 0) {
    throw new RecoverySafetyError(`Unable to ${action}; pg_restore failed.`)
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest("hex")
}
