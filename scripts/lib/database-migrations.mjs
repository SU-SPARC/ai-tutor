import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"

export const SUPPORTED_MIGRATION_COMMANDS = Object.freeze([
  "status",
  "check",
  "up",
])

export const MIGRATION_ADVISORY_LOCK_ID = 7_241_903_151

const MIGRATION_FILE_PATTERN = /^(\d{3})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/
const DESTRUCTIVE_DIRECTIVE =
  /^\s*--\s*migration-safety\s*:\s*destructive\s*$/im
const TARGETS = new Set(["development", "staging", "production", "test"])
const DESTRUCTIVE_PATTERNS = [
  ["DROP DATABASE", /\bdrop\s+database\b/i],
  ["DROP SCHEMA", /\bdrop\s+schema\b/i],
  ["DROP TABLE", /\bdrop\s+table\b/i],
  ["DROP TYPE", /\bdrop\s+type\b/i],
  ["TRUNCATE", /\btruncate(?:\s+table)?\b/i],
  ["DELETE FROM", /\bdelete\s+from\b/i],
  ["DROP COLUMN", /\balter\s+table\b[\s\S]{0,500}?\bdrop\s+column\b/i],
  [
    "ALTER COLUMN TYPE",
    /\balter\s+table\b[\s\S]{0,500}?\balter\s+column\b[\s\S]{0,200}?\btype\b/i,
  ],
]

const LEDGER_SQL = `
  create table if not exists schema_migrations (
    version integer primary key check (version > 0),
    filename text not null unique check (
      filename ~ '^[0-9]{3}_[a-z0-9]+(_[a-z0-9]+)*[.]sql$'
    ),
    checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz not null default now(),
    actor text not null check (btrim(actor) <> ''),
    deployment_sha text not null check (btrim(deployment_sha) <> ''),
    target text not null check (
      target in ('development', 'test', 'staging', 'production')
    ),
    change_ticket text,
    destructive_approved_by text,
    execution_ms integer not null check (execution_ms >= 0)
  );

  create or replace function app_reject_schema_migration_mutation()
  returns trigger
  language plpgsql
  as $$
  begin
    raise exception 'schema_migrations is append-only; % is not allowed', tg_op;
  end;
  $$;

  do $$
  begin
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'schema_migrations_immutable'
        and tgrelid = 'schema_migrations'::regclass
        and not tgisinternal
    ) then
      create trigger schema_migrations_immutable
      before update or delete on schema_migrations
      for each row execute function app_reject_schema_migration_mutation();
    end if;
  end;
  $$
`

export async function loadMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true })
  const sqlEntries = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".sql"),
  )

  if (sqlEntries.length === 0) {
    throw new MigrationWorkflowError(
      `No SQL migrations were found in ${migrationsDirectory}.`,
    )
  }

  const migrations = await Promise.all(
    sqlEntries.map(async (entry) =>
      migrationFromSql(
        entry.name,
        await readFile(path.join(migrationsDirectory, entry.name), "utf8"),
      ),
    ),
  )

  migrations.sort((left, right) => left.version - right.version)
  validateMigrationHistory(migrations)
  return migrations
}

export function migrationFromSql(filename, sql) {
  const match = MIGRATION_FILE_PATTERN.exec(filename)

  if (!match) {
    throw new MigrationWorkflowError(
      `Invalid migration filename ${filename}; expected NNN_lower_snake_case.sql.`,
    )
  }

  const destructiveReasons = detectDestructiveStatements(sql)
  const destructiveDirective = DESTRUCTIVE_DIRECTIVE.test(sql)

  return {
    checksum: createHash("sha256").update(sql).digest("hex"),
    destructive: destructiveDirective || destructiveReasons.length > 0,
    destructiveDirective,
    destructiveReasons,
    filename,
    sql,
    version: Number(match[1]),
  }
}

export function validateMigrationHistory(migrations) {
  if (migrations.length === 0) {
    throw new MigrationWorkflowError("Migration history cannot be empty.")
  }

  const versions = new Set()
  const filenames = new Set()

  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1

    if (migration.version !== expectedVersion) {
      throw new MigrationWorkflowError(
        `Migration history must be contiguous from 001; expected ${formatVersion(
          expectedVersion,
        )} but found ${formatVersion(migration.version)}.`,
      )
    }

    if (versions.has(migration.version) || filenames.has(migration.filename)) {
      throw new MigrationWorkflowError(
        `Duplicate migration version or filename: ${migration.filename}.`,
      )
    }

    if (
      migration.destructiveReasons.length > 0 &&
      !migration.destructiveDirective
    ) {
      throw new MigrationWorkflowError(
        `${migration.filename} contains destructive SQL (${migration.destructiveReasons.join(
          ", ",
        )}) but is missing "-- migration-safety: destructive".`,
      )
    }

    versions.add(migration.version)
    filenames.add(migration.filename)
  }

  return migrations
}

export function detectDestructiveStatements(sql) {
  const executableSql = stripSqlComments(sql)

  return DESTRUCTIVE_PATTERNS.filter(([, pattern]) =>
    pattern.test(executableSql),
  ).map(([label]) => label)
}

export async function getMigrationStatus(client, migrations) {
  validateMigrationHistory(migrations)

  const ledgerResult = await client.query(`
    select to_regclass('public.schema_migrations')::text as ledger
  `)
  const ledgerExists = Boolean(ledgerResult.rows[0]?.ledger)
  const appliedRows = ledgerExists
    ? (
        await client.query(`
          select
            version,
            filename,
            checksum,
            applied_at,
            actor,
            deployment_sha,
            target,
            change_ticket,
            destructive_approved_by,
            execution_ms
          from schema_migrations
          order by version
        `)
      ).rows.map(normalizeLedgerRow)
    : []

  const localByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  )
  const appliedByVersion = new Map(
    appliedRows.map((migration) => [migration.version, migration]),
  )
  const issues = []

  for (const applied of appliedRows) {
    const local = localByVersion.get(applied.version)

    if (!local) {
      issues.push({
        code: "unknown_applied_migration",
        message: `Database contains unknown applied migration ${formatVersion(
          applied.version,
        )} (${applied.filename}).`,
        version: applied.version,
      })
      continue
    }

    if (applied.filename !== local.filename) {
      issues.push({
        code: "filename_mismatch",
        message: `Applied migration ${formatVersion(
          applied.version,
        )} filename differs from the repository.`,
        version: applied.version,
      })
    }

    if (applied.checksum !== local.checksum) {
      issues.push({
        code: "checksum_mismatch",
        message: `Applied migration ${local.filename} was modified after application.`,
        version: applied.version,
      })
    }
  }

  let pendingSeen = false
  for (const migration of migrations) {
    const applied = appliedByVersion.has(migration.version)

    if (!applied) {
      pendingSeen = true
    } else if (pendingSeen) {
      issues.push({
        code: "out_of_order_history",
        message: `Migration ${migration.filename} is applied after a missing earlier migration.`,
        version: migration.version,
      })
    }
  }

  const pending = migrations
    .filter((migration) => !appliedByVersion.has(migration.version))
    .map(publicMigrationMetadata)
  const state =
    issues.length > 0 ? "drift" : pending.length > 0 ? "pending" : "current"

  return {
    applied: appliedRows,
    issues,
    ledgerExists,
    pending,
    state,
    total: migrations.length,
  }
}

export function deploymentCheckExitCode(status) {
  if (status.issues.length > 0) {
    return 1
  }

  return status.pending.length > 0 ? 2 : 0
}

export async function runPendingMigrations({
  actor,
  allowDestructive = false,
  changeTicket,
  client,
  confirmProduction = false,
  deploymentSha,
  destructiveApprovedBy,
  lockTimeoutMs = 5_000,
  migrations,
  statementTimeoutMs = 60_000,
  target,
}) {
  validateMigrationHistory(migrations)
  validateExecutionIdentity({
    actor,
    changeTicket,
    confirmProduction,
    deploymentSha,
    target,
  })
  validateTimeout("lock timeout", lockTimeoutMs)
  validateTimeout("statement timeout", statementTimeoutMs)

  await client.query("select pg_advisory_lock($1::bigint)", [
    MIGRATION_ADVISORY_LOCK_ID,
  ])

  try {
    await executeSql(client, LEDGER_SQL)
    const before = await getMigrationStatus(client, migrations)

    if (before.issues.length > 0) {
      throw new MigrationDriftError(before.issues)
    }

    const localByVersion = new Map(
      migrations.map((migration) => [migration.version, migration]),
    )
    const applied = []

    for (const pending of before.pending) {
      const migration = localByVersion.get(pending.version)

      if (!migration) {
        throw new MigrationWorkflowError(
          `Pending migration ${pending.filename} is unavailable locally.`,
        )
      }

      validateDestructiveAuthorization(migration, {
        actor,
        allowDestructive,
        changeTicket,
        destructiveApprovedBy,
      })

      const startedAt = Date.now()
      await client.query("begin")

      try {
        await client.query(
          `set local lock_timeout = '${Math.trunc(lockTimeoutMs)}ms'`,
        )
        await client.query(
          `set local statement_timeout = '${Math.trunc(statementTimeoutMs)}ms'`,
        )
        await executeSql(client, migration.sql)

        const executionMs = Math.max(0, Date.now() - startedAt)
        await client.query(
          `
            insert into schema_migrations (
              version,
              filename,
              checksum,
              actor,
              deployment_sha,
              target,
              change_ticket,
              destructive_approved_by,
              execution_ms
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            migration.version,
            migration.filename,
            migration.checksum,
            actor,
            deploymentSha,
            target,
            changeTicket ?? null,
            migration.destructive ? destructiveApprovedBy : null,
            executionMs,
          ],
        )
        await client.query("commit")
        applied.push({
          ...publicMigrationMetadata(migration),
          executionMs,
        })
      } catch (error) {
        await rollbackQuietly(client)
        throw new MigrationApplicationError(migration.filename, error)
      }
    }

    return {
      applied,
      status: await getMigrationStatus(client, migrations),
    }
  } finally {
    await client.query("select pg_advisory_unlock($1::bigint)", [
      MIGRATION_ADVISORY_LOCK_ID,
    ])
  }
}

function validateExecutionIdentity({
  actor,
  changeTicket,
  confirmProduction,
  deploymentSha,
  target,
}) {
  requireNonblank("MIGRATION_ACTOR", actor)
  requireNonblank("deployment SHA", deploymentSha)

  if (!TARGETS.has(target)) {
    throw new MigrationWorkflowError(
      "Migration target must be development, test, staging, or production.",
    )
  }

  if (target === "production") {
    if (!confirmProduction) {
      throw new MigrationWorkflowError(
        "Production migration requires --confirm-production.",
      )
    }
    requireNonblank("MIGRATION_CHANGE_TICKET", changeTicket)
  }
}

function validateDestructiveAuthorization(
  migration,
  { actor, allowDestructive, changeTicket, destructiveApprovedBy },
) {
  if (!migration.destructive) {
    return
  }

  if (!migration.destructiveDirective) {
    throw new MigrationWorkflowError(
      `${migration.filename} must declare "-- migration-safety: destructive".`,
    )
  }

  if (!allowDestructive) {
    throw new MigrationWorkflowError(
      `${migration.filename} is destructive and requires --allow-destructive.`,
    )
  }

  requireNonblank("MIGRATION_DESTRUCTIVE_APPROVED_BY", destructiveApprovedBy)
  requireNonblank("MIGRATION_CHANGE_TICKET", changeTicket)

  if (destructiveApprovedBy.trim() === actor.trim()) {
    throw new MigrationWorkflowError(
      "Destructive migration approver must differ from MIGRATION_ACTOR.",
    )
  }
}

function validateTimeout(label, value) {
  if (!Number.isInteger(value) || value < 1 || value > 900_000) {
    throw new MigrationWorkflowError(
      `${label} must be an integer between 1 and 900000 milliseconds.`,
    )
  }
}

function requireNonblank(label, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MigrationWorkflowError(`${label} is required.`)
  }
}

async function executeSql(client, sql) {
  if (typeof client.exec === "function") {
    return client.exec(sql)
  }

  return client.query(sql)
}

async function rollbackQuietly(client) {
  try {
    await client.query("rollback")
  } catch {
    // Preserve the original migration error.
  }
}

function normalizeLedgerRow(row) {
  return {
    actor: String(row.actor),
    appliedAt:
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : String(row.applied_at),
    checksum: String(row.checksum),
    changeTicket:
      row.change_ticket === null || row.change_ticket === undefined
        ? null
        : String(row.change_ticket),
    deploymentSha: String(row.deployment_sha),
    destructiveApprovedBy:
      row.destructive_approved_by === null ||
      row.destructive_approved_by === undefined
        ? null
        : String(row.destructive_approved_by),
    executionMs: Number(row.execution_ms),
    filename: String(row.filename),
    target: String(row.target),
    version: Number(row.version),
  }
}

function publicMigrationMetadata(migration) {
  return {
    checksum: migration.checksum,
    destructive: migration.destructive,
    destructiveReasons: [...migration.destructiveReasons],
    filename: migration.filename,
    version: migration.version,
  }
}

function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\r\n]*/g, " ")
}

function formatVersion(version) {
  return String(version).padStart(3, "0")
}

export class MigrationWorkflowError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = "MigrationWorkflowError"
  }
}

export class MigrationDriftError extends MigrationWorkflowError {
  constructor(issues) {
    super(
      `Migration history drift detected: ${issues.map((issue) => issue.message).join(" ")}`,
    )
    this.name = "MigrationDriftError"
    this.issues = issues
  }
}

export class MigrationApplicationError extends MigrationWorkflowError {
  constructor(filename, cause) {
    const detail = cause instanceof Error ? ` ${cause.message}` : ""
    super(`Migration ${filename} failed and was rolled back.${detail}`, {
      cause,
    })
    this.name = "MigrationApplicationError"
    this.filename = filename
  }
}
