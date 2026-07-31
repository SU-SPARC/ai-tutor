# Database Migration Operations

This runbook defines the only supported workflow for applying the repository's
PostgreSQL schema history. Development, Staging, and Production all consume the
same ordered SQL files from `db/migrations/`; there are no environment-specific
migration branches or directories.

The commands in this document never generate SQL from a live database. Schema
changes are authored and reviewed as new repository files. Do not introspect
Production to create a migration, and never edit a migration recorded in
`schema_migrations`.

## Safety Model

The runner provides these safeguards:

- filenames must follow `NNN_lower_snake_case.sql` with a contiguous sequence
  beginning at `001`;
- every file receives a SHA-256 checksum;
- an append-only `schema_migrations` ledger records version, filename,
  checksum, application time, actor, deployment SHA, target, change ticket,
  destructive approver, and execution duration;
- changed, renamed, missing, unknown, duplicated, gapped, or out-of-order
  migrations fail closed;
- one PostgreSQL advisory lock permits only one migration job at a time;
- each migration runs in its own transaction with bounded lock and statement
  timeouts;
- failed migrations roll back and receive no ledger row;
- only `MIGRATION_DATABASE_URL` can apply migrations; the runtime
  `DATABASE_URL` is accepted only by read-only status/check commands;
- every application requires an actor, deployment SHA, and named target; and
- Production and destructive changes require additional explicit gates.

The runner supports only `status`, `check`, and `up`. It intentionally has no
schema-diff, generate, down, reset, repair, baseline, or mark-applied command.

## Credentials And Variables

Inject secrets from the approved institutional secret store. Never commit them
to Git, `.env` files, tickets, shell transcripts, or documentation.

| Variable                            | Required for                   | Purpose                                                                                                          |
| ----------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `MIGRATION_DATABASE_URL`            | `up`; preferred for status     | `app_migrator` PostgreSQL credential. It must not be available to the deployed application.                      |
| `DATABASE_URL`                      | Optional status fallback       | Read-only/runtime connection accepted by `status` and `check`; never accepted by `up`.                           |
| `MIGRATION_ACTOR`                   | `up`                           | Named human or CI job identity recorded in the ledger.                                                           |
| `MIGRATION_DEPLOYMENT_SHA`          | `up`                           | Exact Git commit being migrated. `GITHUB_SHA` or `VERCEL_GIT_COMMIT_SHA` is used only when this value is absent. |
| `MIGRATION_CHANGE_TICKET`           | Production or destructive `up` | Approved institutional change-ticket identifier.                                                                 |
| `MIGRATION_DESTRUCTIVE_APPROVED_BY` | Destructive `up`               | Named professor/IT approver recorded with the change evidence.                                                   |

The migration job must use the `app_migrator` database role. The application
must use `app_runtime`; it must not receive `MIGRATION_DATABASE_URL` or schema
DDL privileges.

## Commands

### Inspect status

```bash
npm run db:migrate:status
npm run db:migrate:status -- --json
```

`status` is read-only. On an empty database it reports every repository
migration as pending and does not create the ledger.

### Deployment pending-migration gate

```bash
npm run db:migrate:check
npm run db:migrate:check -- --json
```

Exit codes are stable for deployment automation:

| Exit code | Meaning                                            | Deployment action                                          |
| --------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `0`       | Database matches the repository                    | Continue                                                   |
| `1`       | Checksum/history drift or command/database failure | Stop and investigate                                       |
| `2`       | One or more migrations are pending                 | Stop application promotion; run the approved migration job |

### Apply Development or Test migrations

After injecting the required variables:

```bash
npm run db:migrate -- --target development
npm run db:migrate -- --target test
```

### Apply Staging migrations

```bash
npm run db:migrate:status
npm run db:migrate -- --target staging
npm run db:migrate:check
```

Attach the before/apply/after output to the change ticket. Re-run `up` to prove
it is an idempotent no-op before approving the Production window.

### Apply Production migrations

Production execution is permitted only from the institution-controlled change
job after backup and approval gates pass:

```bash
npm run db:migrate:status -- --json
npm run db:migrate -- --target production --confirm-production
npm run db:migrate:check -- --json
```

Production requires `MIGRATION_CHANGE_TICKET` even when every pending migration
is non-destructive. Machine-readable status includes filenames and checksums;
the runner never prints a connection string.

## Authoring A Migration

1. Synchronize the branch and inspect the highest checked-in version.
2. Add exactly one next-numbered file such as
   `db/migrations/008_add_example_constraint.sql`.
3. Write forward SQL by hand from the reviewed application/schema requirement.
   Do not generate it from Development, Staging, or Production.
4. Do not include `BEGIN`, `COMMIT`, a down migration, secrets, environment
   checks, or data copied from Production. The runner owns the transaction.
5. Make upgrades data-preserving. Backfill before adding a stricter constraint;
   abort on unsafe legacy state instead of deleting or truncating rows.
6. Run `npm run test:migrations`, then the complete validation suite.
7. Review the SQL, tests, checksum behavior, locks, expected duration, backup
   checkpoint, and forward-fix plan in the pull request.

After any environment records the migration checksum, never amend that file.
Create the next migration for every correction.

## Destructive-Change Gate

The runner detects `DROP DATABASE`, `DROP SCHEMA`, `DROP TABLE`, `DROP TYPE`,
`DROP COLUMN`, `TRUNCATE`, `DELETE FROM`, and column type changes. A detected
operation is invalid unless the migration contains this explicit declaration:

```sql
-- migration-safety: destructive
```

The declaration alone does not authorize execution. The change job must also
provide `MIGRATION_CHANGE_TICKET`, provide
`MIGRATION_DESTRUCTIVE_APPROVED_BY`, and pass:

```bash
npm run db:migrate -- --target staging --allow-destructive
```

Production additionally requires `--target production` and
`--confirm-production`. Before approval, document affected rows/objects, export
or backup requirements, lock/downtime estimates, restore validation, and the
reason a non-destructive expand/migrate/contract approach is unavailable.

Never use the flag merely to bypass a detector. University IT and the data
owner must reject destructive execution without two-person review and a tested
recovery point.

## Deployment Sequence

1. CI applies the complete history to an empty embedded PostgreSQL database.
2. Apply and verify the same commit in isolated Staging.
3. Take the required Production backup/restore checkpoint.
4. Run `db:migrate:check` against Production. Drift is an incident; pending is
   expected only inside the approved change window.
5. Run `db:migrate` once with the `app_migrator` credential.
6. Run `db:migrate:check` again. It must return `0` before application traffic.
7. Deploy only the application build identified by the recorded deployment SHA.
8. Run read-only smoke checks and retain the ledger/status output with the
   change ticket.

The application deployment must not run migrations automatically at startup.
Migration and application promotion are separate jobs so failure cannot cause
multiple server instances to race schema changes.

## Failure, Rollback, And Forward Fix

If a migration statement fails, its transaction rolls back and the runner does
not record that version. Preserve the error, database fingerprint, deployment
SHA, and change ticket; correct the SQL in a new commit before retrying. If the
failed file has never been applied anywhere, amend it through normal review. If
any environment recorded it, create a new migration.

There are no destructive down-migrations:

- before the first real-student write, application traffic may return to the
  last database-compatible deployment while the failed database is preserved;
- after any real-student write, enter maintenance mode, deploy the last
  database-compatible application, and forward-fix with a new migration;
- restore a database only with professor/University IT authorization and the
  approved RPO/RTO procedure; and
- never delete ledger rows, change checksums, manually mark a migration
  applied, or restore one table ad hoc to make `check` pass.

For expand/contract changes, first add backward-compatible objects, migrate
data in bounded batches outside request traffic, deploy code using the new
shape, verify it, and remove obsolete objects only in a later explicitly gated
migration.

## CI Evidence

`.github/workflows/database-migrations.yml` runs `npm run test:migrations`
without any database secret. The tests use an isolated embedded PostgreSQL
runtime and prove:

- fresh application of the complete repository history;
- legacy upgrade preservation and seed compatibility;
- status and pending-deployment exit behavior;
- checksum/unknown-history drift detection;
- append-only ledger evidence and idempotent replay;
- per-migration rollback after interruption;
- Production confirmation and destructive approval gates; and
- final production-schema constraints, indexes, history, and deletion rules.

Passing CI is necessary but does not replace the Staging rehearsal, backup
restore exercise, institutional approvals, or Production change ticket.
