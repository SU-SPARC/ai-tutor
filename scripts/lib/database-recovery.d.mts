export const CRITICAL_RECOVERY_TABLES: readonly string[]
export const REBUILDABLE_RECOVERY_TABLES: readonly string[]
export const REQUIRED_RECOVERY_VIEWS: readonly string[]

export class RecoverySafetyError extends Error {}
export class RecoveryValidationError extends Error {
  issues: Array<Record<string, unknown>>
  report: Record<string, unknown>
}

export type RecoveryTarget = {
  database: string
  fingerprint: string
  host: string
  port: string
}

export type QueryClient = {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>
}

export type RecoveryValidationReport = {
  criticalRowCounts: Record<string, number>
  deferredConstraints: string[]
  issues: Array<Record<string, unknown>>
  migrationState: string
  schemaMigrationCount: number
  status: "invalid" | "valid"
  validations: {
    criticalTables: number
    integrityChecks: number
    rebuildableTables: number
    requiredViews: number
  }
}

export function recoveryTargetFromUrl(databaseUrl: string): RecoveryTarget
export function assertRecoveryExecutionAuthorization(options: {
  actor?: string
  changeTicket?: string
  confirmation?: string
  target: RecoveryTarget
}): void
export function resolveRecoveryArchive(archivePath: string): Promise<{
  path: string
  sha256: string
  sizeBytes: number
}>
export function assertEmptyDisposableDatabase(
  client: QueryClient,
): Promise<void>
export function assertConnectedRecoveryTarget(
  client: QueryClient,
  target: RecoveryTarget,
): Promise<void>
export function runPgRestore(options: {
  archive: { path: string; sha256: string; sizeBytes: number }
  databaseUrl: string
  inheritedEnvironment?: NodeJS.ProcessEnv
  spawnSyncImpl?: (...args: unknown[]) => {
    error?: Error
    status: number | null
    stderr?: string
    stdout?: string
  }
}): {
  archiveSha256: string
  archiveSizeBytes: number
  restoreTool: string
}
export function validateRestoredDatabase(options: {
  client: QueryClient
  migrations: Array<Record<string, unknown>>
}): Promise<RecoveryValidationReport>
