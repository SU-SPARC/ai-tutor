# Production database runtime reliability

This document describes the application-side controls for PostgreSQL access. It
does not provision a database, change provider settings, or prove production
readiness.

## Connection model

- Vercel routes that use PostgreSQL run in the Node.js runtime.
- A warm function instance reuses one module-global `pg` pool instead of opening
  a connection per request.
- Each instance is limited to four database connections. Production must use the
  managed provider's serverless/pooler connection endpoint; the application-side
  limit alone cannot cap connections across every autoscaled instance.
- Idle connections expire after 10 seconds and all connections are recycled
  after five minutes.
- Connection acquisition is limited to five seconds. Queries have an eight-second
  client timeout and a seven-second PostgreSQL statement timeout. Lock waits are
  limited to two seconds, and idle transactions to ten seconds.
- Runtime credentials are used only by the application pool. Migration
  credentials remain outside the deployed application.

## Transactions and retries

- Multi-statement content imports, question edits/regeneration, review actions,
  attempts, outcomes, hint reveals, and step reveals execute on one checked-out
  client with `BEGIN`, `COMMIT`, and rollback-on-error.
- Review and tutor transactions may retry only after PostgreSQL confirms a
  serialization failure, deadlock, or lock-unavailable conflict. A lost
  connection during or after commit is never retried because commit status may
  be unknown.
- Only explicitly marked read operations retry transient connection/time-out
  failures, with two bounded attempts and short exponential backoff. General
  writes are never automatically retried.
- Database-selected writes never fall back to fixtures or process memory. A
  failure returns `DATA_SERVICE_UNAVAILABLE`, preventing an apparent success
  that disappears on the next serverless invocation.

## Concurrency behavior

- Review decisions update only unresolved generated candidates. The update
  returns the IDs it actually changed, so simultaneous decisions cannot both be
  reported as successful. Priority approval is enforced in the same SQL update,
  not only by a preceding route read.
- Detailed question edits and deterministic regeneration lock the question row
  and keep parent/child changes in one transaction.
- Attempt and outcome writes lock their tutor session for the duration of the
  transaction. This prevents two outcome requests from settling the same pending
  attempt.
- Hint and step counters use atomic increments and return the updated row. Session
  listing loads attempts in one batched query instead of issuing one query per
  session.

## Errors and health checks

Database failures are classified as `unavailable`, `timeout`, `concurrency`,
`constraint`, or `unknown`. Public errors contain only stable application codes
and messages. The original SQL, parameter values, database URL, host, username,
and password are not retained in application-facing errors.

`GET /api/health/database` is the non-cached readiness check:

- database mode returns HTTP 200 only after a bounded `SELECT 1` succeeds;
- a connection or query failure returns HTTP 503 and a safe category;
- explicit demo mode returns HTTP 200 with database status `disabled` and does
  not attempt a connection.

The endpoint never returns a database identifier or connection string. Provider
monitoring should alert on repeated 503 responses and correlate them with
institution-controlled PostgreSQL and Vercel telemetry.
