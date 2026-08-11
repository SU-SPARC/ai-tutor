import "server-only"

import { performance } from "node:perf_hooks"

import { Pool, type PoolClient } from "pg"

import type {
  DatabaseQueryExecutor,
  DatabaseQueryValue,
  DatabaseTransactionOptions,
} from "@/lib/data/database-executor"
import { getServerEnv } from "@/lib/env/server"

export const POSTGRES_RUNTIME_DEFAULTS = Object.freeze({
  connectionTimeoutMs: 5_000,
  healthTimeoutMs: 2_000,
  idleInTransactionTimeoutMs: 10_000,
  idleTimeoutMs: 10_000,
  lockTimeoutMs: 2_000,
  maxConnectionsPerInstance: 4,
  maxConnectionLifetimeSeconds: 300,
  queryTimeoutMs: 8_000,
  safeReadAttempts: 2,
  statementTimeoutMs: 7_000,
  transactionConflictAttempts: 3,
})

export type DatabaseErrorCategory =
  | "concurrency"
  | "constraint"
  | "timeout"
  | "unavailable"
  | "unknown"

export class DatabaseOperationError extends Error {
  readonly category: DatabaseErrorCategory
  readonly code = "DATABASE_OPERATION_FAILED"
  readonly retryable: boolean
  readonly sqlState?: string

  constructor(
    category: DatabaseErrorCategory,
    options: { retryable: boolean; sqlState?: string },
  ) {
    super(databaseMessage(category))
    this.name = "DatabaseOperationError"
    this.category = category
    this.retryable = options.retryable
    this.sqlState = options.sqlState
  }
}

export type DatabaseHealth =
  | {
      latencyMs: number
      status: "healthy"
    }
  | {
      category: DatabaseErrorCategory
      status: "unavailable"
    }

type PostgresErrorShape = {
  code?: unknown
  message?: unknown
  name?: unknown
}

type PostgresFailureKind =
  | "authentication"
  | "network"
  | "prepared-statement"
  | "startup-parameter"
  | "timeout"
  | "tls"
  | "unknown"

type PostgresGlobal = typeof globalThis & {
  __aiTutorPostgresPool?: Pool
}

const postgresGlobal = globalThis as PostgresGlobal

export function getPostgresPool() {
  const databaseUrl = getServerEnv().DATABASE_URL

  if (!databaseUrl) {
    throw new DatabaseOperationError("unavailable", { retryable: false })
  }

  if (!postgresGlobal.__aiTutorPostgresPool) {
    const nextPool = new Pool({
      allowExitOnIdle: true,
      application_name: "ai-tutor-runtime",
      connectionString: normalizePostgresRuntimeUrl(databaseUrl),
      connectionTimeoutMillis: POSTGRES_RUNTIME_DEFAULTS.connectionTimeoutMs,
      idleTimeoutMillis: POSTGRES_RUNTIME_DEFAULTS.idleTimeoutMs,
      idle_in_transaction_session_timeout:
        POSTGRES_RUNTIME_DEFAULTS.idleInTransactionTimeoutMs,
      lock_timeout: POSTGRES_RUNTIME_DEFAULTS.lockTimeoutMs,
      max: POSTGRES_RUNTIME_DEFAULTS.maxConnectionsPerInstance,
      maxLifetimeSeconds:
        POSTGRES_RUNTIME_DEFAULTS.maxConnectionLifetimeSeconds,
      query_timeout: POSTGRES_RUNTIME_DEFAULTS.queryTimeoutMs,
      statement_timeout: POSTGRES_RUNTIME_DEFAULTS.statementTimeoutMs,
    })

    // pg emits idle-client errors on the pool. Consuming the event prevents an
    // unhandled process error; request paths receive their own classified error.
    nextPool.on("error", () => undefined)
    postgresGlobal.__aiTutorPostgresPool = nextPool
  }

  return postgresGlobal.__aiTutorPostgresPool
}

export function normalizePostgresRuntimeUrl(databaseUrl: string) {
  const parsed = new URL(databaseUrl)

  // Supabase's managed connection strings use libpq's sslmode=require
  // semantics: encryption is mandatory, while its self-signed CA is not in
  // Vercel's trust store. pg 8 treats require as verify-full unless this
  // compatibility flag is explicit, which rejects the managed certificate.
  if (
    parsed.searchParams.get("sslmode") === "require" &&
    !parsed.searchParams.has("uselibpqcompat")
  ) {
    parsed.searchParams.set("uselibpqcompat", "true")
  }

  return parsed.toString()
}

export function setPostgresPoolForTests(nextPool: Pool | undefined) {
  postgresGlobal.__aiTutorPostgresPool = nextPool
}

const executePostgresQuery: DatabaseQueryExecutor = async (
  sql,
  params = [],
) => {
  try {
    const result = await getPostgresPool().query(sql, params)
    return result.rows as Record<string, unknown>[]
  } catch (cause) {
    throw classifyPostgresError(cause)
  }
}

const executeSafePostgresRead: DatabaseQueryExecutor = async (
  sql,
  params = [],
) =>
  retrySafePostgresOperation(
    () => executePostgresQuery(sql, params),
    POSTGRES_RUNTIME_DEFAULTS.safeReadAttempts,
  )

export const queryPostgres: DatabaseQueryExecutor = Object.assign(
  executePostgresQuery,
  {
    read: executeSafePostgresRead,
    transaction: withPostgresTransaction,
  },
)

export async function checkPostgresHealth(): Promise<DatabaseHealth> {
  const startedAt = performance.now()
  let client: PoolClient | undefined
  let destroyClient = false

  try {
    client = await getPostgresPool().connect()
    await client.query("begin")
    await client.query(
      `set local statement_timeout = '${POSTGRES_RUNTIME_DEFAULTS.healthTimeoutMs}ms'`,
    )
    // Supabase's transaction pooler does not preserve prepared statements
    // between transactions. Keep the health probe as an unnamed query.
    await client.query("select 1 as healthy")
    await client.query("rollback")

    return {
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      status: "healthy",
    }
  } catch (cause) {
    logPostgresHealthFailure(cause)
    const error = classifyPostgresError(cause)

    if (client) {
      try {
        await client.query("rollback")
      } catch {
        destroyClient = true
      }
    }

    if (error.category === "unavailable") {
      destroyClient = true
    }

    return {
      category: error.category,
      status: "unavailable",
    }
  } finally {
    client?.release(destroyClient)
  }
}

function logPostgresHealthFailure(cause: unknown) {
  const error = isPostgresErrorShape(cause) ? cause : {}
  const code = typeof error.code === "string" ? error.code : undefined
  const name = typeof error.name === "string" ? error.name : undefined

  console.error("Postgres health check failed.", {
    code,
    kind: classifyPostgresFailureKind(error.message),
    name,
  })
}

function classifyPostgresFailureKind(message: unknown): PostgresFailureKind {
  if (typeof message !== "string") {
    return "unknown"
  }

  const normalized = message.toLowerCase()

  if (/password authentication|tenant or user|sasl|authentication/.test(normalized)) {
    return "authentication"
  }

  if (/certificate|self signed|tls|ssl|unable to verify/.test(normalized)) {
    return "tls"
  }

  if (/prepared statement/.test(normalized)) {
    return "prepared-statement"
  }

  if (/startup parameter|unsupported parameter/.test(normalized)) {
    return "startup-parameter"
  }

  if (/timeout|timed out/.test(normalized)) {
    return "timeout"
  }

  if (/getaddrinfo|enotfound|econn|network/.test(normalized)) {
    return "network"
  }

  return "unknown"
}

export function classifyPostgresError(cause: unknown) {
  if (cause instanceof DatabaseOperationError) {
    return cause
  }

  const error = isPostgresErrorShape(cause) ? cause : {}
  const rawCode = typeof error.code === "string" ? error.code : undefined
  const sqlState =
    rawCode && /^[0-9A-Z]{5}$/.test(rawCode) ? rawCode : undefined

  if (sqlState === "40001" || sqlState === "40P01" || sqlState === "55P03") {
    return new DatabaseOperationError("concurrency", {
      retryable: true,
      sqlState,
    })
  }

  if (sqlState === "57014" || rawCode === "ETIMEDOUT") {
    return new DatabaseOperationError("timeout", {
      retryable: true,
      sqlState,
    })
  }

  if (sqlState?.startsWith("23")) {
    return new DatabaseOperationError("constraint", {
      retryable: false,
      sqlState,
    })
  }

  if (
    sqlState?.startsWith("08") ||
    ["53300", "57P01", "57P02", "57P03"].includes(sqlState ?? "") ||
    [
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETUNREACH",
      "ENOTFOUND",
      "EPIPE",
    ].includes(rawCode ?? "")
  ) {
    return new DatabaseOperationError("unavailable", {
      retryable: true,
      sqlState,
    })
  }

  return new DatabaseOperationError("unknown", {
    retryable: false,
    sqlState,
  })
}

async function withPostgresTransaction<T>(
  work: (query: DatabaseQueryExecutor) => Promise<T>,
  options: DatabaseTransactionOptions = {},
) {
  const attempts = options.retryOnConflict
    ? POSTGRES_RUNTIME_DEFAULTS.transactionConflictAttempts
    : 1

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runSingleTransaction(work)
    } catch (cause) {
      const error = classifyPostgresError(cause)
      const canRetry =
        options.retryOnConflict &&
        error.category === "concurrency" &&
        attempt < attempts

      if (!canRetry) {
        throw error
      }

      await retryDelay(attempt)
    }
  }

  throw new DatabaseOperationError("unknown", { retryable: false })
}

async function runSingleTransaction<T>(
  work: (query: DatabaseQueryExecutor) => Promise<T>,
) {
  let client: PoolClient | undefined
  let destroyClient = false

  try {
    client = await getPostgresPool().connect()
    await client.query("begin")

    const transactionQuery: DatabaseQueryExecutor = async (
      sql: string,
      params: DatabaseQueryValue[] = [],
    ) => {
      try {
        const result = await client!.query(sql, params)
        return result.rows as Record<string, unknown>[]
      } catch (cause) {
        throw classifyPostgresError(cause)
      }
    }
    transactionQuery.read = transactionQuery

    const result = await work(transactionQuery)
    await client.query("commit")
    return result
  } catch (cause) {
    const error = classifyPostgresError(cause)

    if (client) {
      try {
        await client.query("rollback")
      } catch {
        destroyClient = true
      }
    }

    if (error.category === "unavailable") {
      destroyClient = true
    }

    throw error
  } finally {
    client?.release(destroyClient)
  }
}

export async function retrySafePostgresOperation<T>(
  operation: () => Promise<T>,
  attempts = POSTGRES_RUNTIME_DEFAULTS.safeReadAttempts,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation()
    } catch (cause) {
      const error = classifyPostgresError(cause)

      if (!error.retryable || attempt >= attempts) {
        throw error
      }

      await retryDelay(attempt)
    }
  }

  throw new DatabaseOperationError("unknown", { retryable: false })
}

function retryDelay(attempt: number) {
  const delayMs = 25 * 2 ** Math.max(0, attempt - 1)
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function databaseMessage(category: DatabaseErrorCategory) {
  if (category === "constraint") {
    return "The database rejected conflicting or invalid data."
  }

  if (category === "concurrency") {
    return "The database could not complete the concurrent operation."
  }

  if (category === "timeout") {
    return "The database operation timed out."
  }

  return "The database operation could not be completed."
}

function isPostgresErrorShape(value: unknown): value is PostgresErrorShape {
  return Boolean(value) && typeof value === "object"
}
