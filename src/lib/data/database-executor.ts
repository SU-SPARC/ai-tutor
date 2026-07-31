import "server-only"

export type DatabaseQueryValue =
  | boolean
  | Date
  | null
  | number
  | string
  | string[]

export type DatabaseTransactionOptions = {
  retryOnConflict?: boolean
}

export type DatabaseQueryExecutor = {
  (
    sql: string,
    params?: DatabaseQueryValue[],
  ): Promise<Record<string, unknown>[]>
  read?: DatabaseQueryExecutor
  transaction?: <T>(
    work: (query: DatabaseQueryExecutor) => Promise<T>,
    options?: DatabaseTransactionOptions,
  ) => Promise<T>
}

export function readDatabaseRows(
  query: DatabaseQueryExecutor,
  sql: string,
  params: DatabaseQueryValue[] = [],
) {
  return (query.read ?? query)(sql, params)
}

export function runDatabaseTransaction<T>(
  query: DatabaseQueryExecutor,
  work: (transactionQuery: DatabaseQueryExecutor) => Promise<T>,
  options: DatabaseTransactionOptions = {},
) {
  if (query.transaction) {
    return query.transaction(work, options)
  }

  // Injected test/demo executors predate transaction support. Production always
  // uses queryPostgres, which supplies a real, single-client transaction.
  return work(query)
}
