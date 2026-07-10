import "server-only"

import { Pool } from "pg"

import { getServerEnv } from "@/lib/env/server"

type QueryValue = boolean | Date | null | number | string | string[]

let pool: Pool | undefined

export function getPostgresPool() {
  const databaseUrl = getServerEnv().DATABASE_URL

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for Postgres-backed tutor data.")
  }

  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl })
  }

  return pool
}

export async function queryPostgres(sql: string, params: QueryValue[] = []) {
  const result = await getPostgresPool().query(sql, params)
  return result.rows as Record<string, unknown>[]
}
