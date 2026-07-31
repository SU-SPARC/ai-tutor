# Production Data Integrity Checks

This runbook defines the repository's read-only PostgreSQL integrity audit and
its narrowly scoped, explicitly authorized repair workflow. It does not connect
to a database during application startup, provision infrastructure, schedule a
job, or run a repair automatically.

The command requires the complete, checksum-clean migration history and checks
that the requested target exactly matches the target recorded in the immutable
`schema_migrations` ledger. This prevents an operator from labeling a Production
database as Test to bypass the Production confirmation gate.

## What The Audit Checks

| Check                                       | Finding rule                                                                                                                                                                       | Automated repair                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Broken question-topic relationships         | A question's `topic_id` has no topic                                                                                                                                               | None; a professor must identify the correct topic                 |
| Missing solution steps                      | An active, approved public question has no nonblank, positive-order solution step                                                                                                  | Quarantine is available                                           |
| Duplicate question IDs                      | More than one question row has the same ID, including after primary-key drift                                                                                                      | None; preserve evidence and investigate constraint loss           |
| Invalid publication states                  | Review identity/time, visibility, approval, trust, archive state, or generated-content state disagree                                                                              | Quarantine is available                                           |
| Approved questions without reviewer history | No immutable approval event matches the question's reviewer and review timestamp                                                                                                   | Quarantine is available; history is never fabricated              |
| Generated drafts student-visible            | An unapproved/untrusted generated question or retrieval chunk is actually returned by a student-facing view                                                                        | None; treat as view/schema drift and forward-fix it               |
| Topic-order conflicts                       | `sort_order` is negative or shared by multiple topics                                                                                                                              | None; a professor must choose syllabus order                      |
| Orphaned tutor sessions                     | A session lacks exactly one valid identity or has no valid question                                                                                                                | None; retention and student-data ownership decisions are required |
| Impossible usage counts                     | Negative counters, inconsistent token totals, reveals beyond available hints/steps, or invalid reservation state                                                                   | Only consistent token totals can be reconciled                    |
| Test/demo records in Production-shaped data | Production contains a non-Production migration/import ledger, explicit demo/test/fake/fixture/synthetic identity marker, schema-migration-reviewed question, or marked audit actor | None; do not guess whether Production student data may be deleted |

“Student-visible” means the row is returned by `app_public_questions` or
`app_student_retrieval_chunks`, not merely that its raw `visibility` column is
`public`. Generated review drafts intentionally use publication metadata that
the views must filter. If one leaks through a view, changing one row would not
prove that the access boundary is fixed.

The test/demo detector is deliberately conservative and reports explicit word
markers only. It does not search answer text or return student content. The
human report shows counts and at most 20 record IDs per check; `--json` provides
the same bounded evidence for a ticket. Findings are evidence to review, not
deletion authorization.

## Read-Only Audit

Use a dedicated PostgreSQL login with `CONNECT`, `USAGE`, and `SELECT` only. It
must not have table-write, DDL, role-management, backup, or provider-owner
privileges. Inject its URL from the approved institutional secret store as
`INTEGRITY_DATABASE_URL`; do not put the URL in a local environment file,
ticket, command argument, or shell transcript.

```bash
INTEGRITY_DATABASE_URL=<read-only credential> \
  npm run db:integrity -- audit --target staging

INTEGRITY_DATABASE_URL=<read-only credential> \
  npm run db:integrity -- audit --target production --json
```

`audit` is the default, so the first command may also omit the word `audit`.
The command opens a `REPEATABLE READ READ ONLY` transaction, sets a 60-second
statement timeout, runs only `SELECT` statements, and commits the read-only
snapshot. Errors roll it back. It never reads `DATABASE_URL`,
`MIGRATION_DATABASE_URL`, `CONTENT_IMPORT_DATABASE_URL`, or the repair URL.

Exit codes are stable:

| Exit code | Meaning                                                                       | Action                                                       |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `0`       | All checks passed                                                             | Attach the report to the change/pilot ticket                 |
| `1`       | Configuration, credential, migration drift, target mismatch, or query failure | Stop and investigate; no clean attestation exists            |
| `2`       | Audit completed with one or more findings                                     | Keep traffic blocked or follow the approved incident process |

Run the audit after a Staging import, immediately before first Production
traffic, after a restore, after an approved data repair, and during incident
investigation. A scheduler may run the read-only audit only after University IT
reviews credential and alert handling. Never schedule the repair command.

## Explicit Repair Mode

Repair is optional and intentionally separate. It requires all of the following:

- the literal `repair` command;
- at least one named `--action`;
- `--confirm-repair`;
- a separate `INTEGRITY_REPAIR_DATABASE_URL` credential;
- `INTEGRITY_REPAIR_ACTOR_USER_ID` naming an active human application user with
  an unexpired `professor` or `admin` role;
- `INTEGRITY_REPAIR_CHANGE_TICKET` naming the approved ticket; and
- `--confirm-production` when the ledger target is Production.

Example for Staging rehearsal:

```bash
INTEGRITY_REPAIR_DATABASE_URL=<controlled repair credential> \
INTEGRITY_REPAIR_ACTOR_USER_ID=<institutional user ID> \
INTEGRITY_REPAIR_CHANGE_TICKET=<approved ticket ID> \
  npm run db:integrity -- repair \
    --target staging \
    --action quarantine-unsafe-questions \
    --action reconcile-usage-totals \
    --confirm-repair \
    --json
```

Production additionally requires `--confirm-production`. Copying that example
does not authorize a Production repair. The professor/data owner and University
IT must first approve the finding disposition, backup checkpoint, maintenance
window, operator, and rollback decision in the named ticket.

The supported repair actions are:

- `quarantine-unsafe-questions`: for uniquely identified questions with missing
  solution steps, invalid publication metadata, or missing matching approval
  history, set `visibility=private` and `review_status=needs_edit`; assign the
  named repair actor and timestamp; append the ticket to review notes; and make
  generated trust unverified. It never deletes content, invents an approval, or
  chooses a topic/order/duplicate winner.
- `reconcile-usage-totals`: recompute AI-usage, tutor-session, and settled
  reservation total-token fields only when their component counters are
  nonnegative. Negative components, impossible reveal counts, and invalid
  reservation states remain findings for human investigation.

Each invocation uses a single transaction, a dedicated advisory lock, bounded
lock/statement timeouts, and rollback-on-error. It performs a before audit,
applies only the selected actions, writes one `database_integrity_repair`
`audit_events` row per action with the actor/ticket/count, performs an after
audit, then commits. A duplicate question ID is excluded from quarantine so the
tool cannot update an ambiguous record. Repair may return
`repaired_with_remaining_findings`; that is not a successful Production gate.

No package script, migration, deployment hook, application startup path, CI
workflow, or audit invocation calls repair mode. The library also requires an
explicit confirmation value, so bypassing the CLI parser does not make repair
implicit.

## Production Procedure

1. Put the pilot in the approved no-write/maintenance state if real-student
   traffic has begun.
2. Record the database fingerprint, current Git SHA, migration status, incident
   or change ticket, professor/data-owner authorization, IT operator, and a
   recent validated recovery point.
3. Run the JSON read-only audit with the institution-controlled read-only
   credential. Preserve the complete output; do not copy database URLs.
4. Classify every finding. Broken relationships, duplicates, view leakage,
   topic order, orphan sessions, and test/demo data require a reviewed migration
   or data-disposition plan—not this repair mode.
5. Rehearse any selected repair against an isolated Production-controlled
   restore. Confirm expected row IDs/counts and rerun the read-only audit.
6. If approved, inject the short-lived repair credential and run exactly the
   reviewed actions with both confirmation flags. Attach before/after output and
   `audit_events` evidence to the ticket.
7. Run a fresh audit with the read-only credential. Production may proceed only
   when it reports zero findings and all other launch gates pass.
8. Revoke or rotate the repair credential. Keep it unavailable to the deployed
   application and ordinary CI.

If repair fails, its transaction rolls back. Preserve the error and audit the
database again. Do not retry blindly, delete rows, disable constraints, edit
immutable history, or restore Production merely to clear a finding. Use the
approved backup/recovery process and a forward migration where required.

## Test Evidence

`tests/database-integrity.test.ts` uses isolated embedded PostgreSQL databases
to prove all ten finding classes, bounded human reporting, read-only behavior,
target binding, CLI and library confirmation gates, selected repairs, audit-event
evidence, rollback when evidence recording fails, and compatibility with the
complete migration chain and its immutable review/version triggers.

Run:

```bash
npx vitest run tests/database-integrity.test.ts
npm test
npm run typecheck
npm run lint
```

These tests contain synthetic records only and never connect to an external
database.
