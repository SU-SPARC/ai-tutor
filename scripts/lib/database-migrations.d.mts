export type MigrationTarget = "development" | "production" | "staging" | "test"

export type Migration = {
  checksum: string
  destructive: boolean
  destructiveDirective: boolean
  destructiveReasons: string[]
  filename: string
  sql: string
  version: number
}

export type MigrationMetadata = Pick<
  Migration,
  "checksum" | "destructive" | "destructiveReasons" | "filename" | "version"
>

export type AppliedMigration = {
  actor: string
  appliedAt: string
  changeTicket: string | null
  checksum: string
  deploymentSha: string
  destructiveApprovedBy: string | null
  executionMs: number
  filename: string
  target: MigrationTarget
  version: number
}

export type MigrationIssue = {
  code:
    | "checksum_mismatch"
    | "filename_mismatch"
    | "out_of_order_history"
    | "unknown_applied_migration"
  message: string
  version: number
}

export type MigrationStatus = {
  applied: AppliedMigration[]
  issues: MigrationIssue[]
  ledgerExists: boolean
  pending: MigrationMetadata[]
  state: "current" | "drift" | "pending"
  total: number
}

export type MigrationClient = {
  exec?(sql: string): Promise<unknown>
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>
}

export const SUPPORTED_MIGRATION_COMMANDS: readonly ["status", "check", "up"]
export const MIGRATION_ADVISORY_LOCK_ID: number

export function loadMigrations(directory: string): Promise<Migration[]>
export function migrationFromSql(filename: string, sql: string): Migration
export function validateMigrationHistory(migrations: Migration[]): Migration[]
export function detectDestructiveStatements(sql: string): string[]
export function getMigrationStatus(
  client: MigrationClient,
  migrations: Migration[],
): Promise<MigrationStatus>
export function deploymentCheckExitCode(status: MigrationStatus): 0 | 1 | 2
export function normalizeMigrationDatabaseUrl(databaseUrl: string): string
export function runPendingMigrations(options: {
  actor?: string
  allowDestructive?: boolean
  changeTicket?: string
  client: MigrationClient
  confirmProduction?: boolean
  deploymentSha?: string
  destructiveApprovedBy?: string
  lockTimeoutMs?: number
  migrations: Migration[]
  statementTimeoutMs?: number
  target: MigrationTarget
}): Promise<{
  applied: Array<MigrationMetadata & { executionMs: number }>
  status: MigrationStatus
}>

export class MigrationWorkflowError extends Error {}
export class MigrationDriftError extends MigrationWorkflowError {
  issues: MigrationIssue[]
}
export class MigrationApplicationError extends MigrationWorkflowError {
  filename: string
}
