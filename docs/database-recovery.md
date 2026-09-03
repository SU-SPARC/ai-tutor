# Database Backup And Recovery Runbook

> **Evidence status (2026-09-03): the repository backup, restore, validation,
> and evidence tooling is exercised end to end on a local disposable restore
> that passed a clean 18/18 integrity audit. Provider verification of the
> Production project completed with a critical finding: the provider lists no
> daily backup and point-in-time recovery is disabled, so Production has no
> provider-managed backup. Retention and ownership are not provider-verified,
> and the Production disposable restore is blocked until a dedicated read-only
> backup credential exists.** Do not state that Production
> backups exist or that Production recovery is proven. Backup existence alone
> never establishes recovery readiness; only a successful disposable restore of
> a Production backup does.

This runbook defines named ownership, the backup policy, the provider
verification command, the logical export command, the disposable restore-test
procedure, validation, rollback, retirement of the disposable target, and the
retained evidence. It does not provision a database, authorize a Production
restore, or run any command automatically.

## Operational Ownership

Every role below is a separate accountable person. A vacancy is a launch
blocker, not a formality.

| Role                                   | Named owner                                                                                    | Backup / second person                                | Responsibilities                                                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engineering owner of recovery tooling  | Kanan Guliyev (repository maintainer; Vercel `ai-tutor` project owner)                         | To be named by the project owner                      | Maintains `db:backup:verify`, `db:backup:export`, `db:recovery:test`, their tests, this runbook, and the retained evidence; executes rehearsal drills   |
| Academic / service owner (professor)   | **Vacant — must be named in the ownership ticket before pilot start**                          | —                                                     | Authorizes any recovery of student or course data, accepts the recovery point, and signs the RPO/RTO objectives                                        |
| Provider owner / recovery administrator | **Vacant — institutional Supabase organization owners (minimum two) must be recorded**         | Second institutional owner                            | Holds Supabase organization ownership, backup/PITR settings, billing, and the provider access token used by `db:backup:verify`                          |
| Backup operator                        | **Vacant — University IT**                                                                     | Second IT operator                                    | Confirms provider backup status, runs the weekly logical export with `BACKUP_DATABASE_URL`, stores archives in the approved encrypted location          |
| Restore executor                       | **Vacant — University IT**                                                                     | Second reviewer confirms target fingerprint          | Creates the disposable target, runs `db:recovery:test`, attaches evidence, and retires the target under two-person confirmation                       |
| Change / incident approver             | Professor plus University IT lead                                                              | —                                                     | Approves a Production restore, the cutover, and the rollback decision                                                                                  |

Until the vacant roles are named, the engineering owner may rehearse the
procedure only on disposable data that contains no real student records, which
is exactly what the retained 2026-09-03 exercise did.

## Backup Policy

The policy below is the baseline the professor and University IT must sign. It
is already enforced by the repository tooling where a command can enforce it.

| Control                  | Baseline                                                                                                                                                                                                                                      | Enforced by                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Provider-native recovery | Supabase point-in-time recovery when the plan offers it, plus the provider's daily backup                                                                                                                                                     | `db:backup:verify` reports `pitr_enabled`, daily backup status and age |
| Native retention         | At least 7 days (Supabase Pro default); 30 days or the approved student-data retention period when the plan allows it                                                                                                                         | `db:backup:verify` finding `retention_below_policy` / `retention_unverified` |
| Freshness                | Newest successful provider recovery point no older than 36 hours                                                                                                                                                                              | `db:backup:verify` finding `latest_backup_stale`                       |
| Logical recovery copy    | Weekly `pg_dump` custom-format archive of the `public` schema, retained eight weeks, plus a checkpoint immediately before a schema change, approved-content import, data repair, or restore                                                     | `db:backup:export` manifest with SHA-256 and recovery point            |
| Recovery point objective | No more than 24 hours of committed Production data loss (`RECOVERY_TEST_RPO_HOURS`)                                                                                                                                                           | `db:recovery:test` evidence `recoveryPoint.withinObjective`            |
| Recovery time objective  | Service restored or an approved status issued within one business day, 24 hours (`RECOVERY_TEST_RTO_HOURS`)                                                                                                                                   | `db:recovery:test` evidence `recoveryTime.withinObjective`             |
| Ownership                | At least two institutional organization owners, all members with multi-factor authentication                                                                                                                                                   | `db:backup:verify` findings `insufficient_recovery_administrators`, `mfa_not_enforced` |
| Encryption and region    | Provider-managed encryption at rest and in transit; archives stored only in the institution-approved encrypted location in the approved region                                                                                                | Operator checklist; `db:backup:verify` records the provider region      |
| Access                   | Named operators with institutional SSO/MFA; separate credentials for runtime, migration, integrity, backup, and disposable restore                                                                                                              | [Credential-topology audit](database-credential-topology-audit.md)     |
| Restore exercise         | Before pilot, after material provider or schema changes, and at least quarterly during an active pilot                                                                                                                                         | Retained evidence under `docs/evidence/database-recovery/`             |
| Evidence                 | Sanitized JSON artifacts only: safe hashes, timestamps, counts, durations, archive SHA-256, and redacted references. Never a URL, host, username, password, provider reference, student identity, answer, or feedback text                      | All three commands write with `wx` and mode `0600`                     |

Backup jobs must fail visibly and alert University IT. A dashboard setting or a
successful dump command is not enough: a backup is verified only after its
provider status is successful, its retention, region, and ownership are
recorded, and a disposable restore of it passes this runbook.

## Recovery Point And Recovery Time Expectations

Objectives are defaults in the tooling and can be tightened per exercise with
`RECOVERY_TEST_RPO_HOURS` and `RECOVERY_TEST_RTO_HOURS`.

| Measure                              | Objective       | Measured on 2026-09-03 (local disposable drill)                     | Expectation for Production                                                                                                                              |
| ------------------------------------ | --------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery point objective (RPO)       | ≤ 24 hours      | Recovery point age at exercise: 6.4 minutes; backup captured every committed record | Provider daily backup gives ≤ 24 h; PITR gives minutes. The declared recovery point is the provider backup timestamp or the export snapshot time |
| Logical export                       | —               | 571 ms for a 251 KB archive (21 migrations, 8 questions, synthetic student rows) | Seconds to low minutes for the pilot dataset (nine published questions plus pilot-scale student rows)                                          |
| Restore into a disposable target     | —               | 142 ms (`pg_restore`, 364 restored entries, 2 provider-independent schema entries skipped) | Seconds to low minutes                                                                                                                       |
| Automated validation and audit       | —               | 31 ms validation plus a clean 18/18 read-only integrity audit        | Under one minute                                                                                                                                       |
| Recovery time objective (RTO)        | ≤ 24 hours      | Whole automated exercise 212 ms                                     | Dominated by people, not tooling: detection and authorization (≤ 2 h), provider or logical restore (≤ 1 h), validation review (≤ 1 h), cutover and smoke (≤ 1 h) |

Rows for Production remain expectations until the Production disposable
restore in the "Production Exercise Status" section is completed and its
artifact is retained.

## Project-Owner RPO And RTO Questions

The professor/project owner and University IT must answer and sign these before
the pilot. Until then, the 24-hour objectives are planning assumptions, not
accepted objectives.

- [ ] What is the maximum acceptable loss of student attempts, hints, sessions, and feedback, in hours?
- [ ] How quickly must the service be restored or an official status issued to students?
- [ ] Which known-bad events must be excluded from the chosen recovery point, such as accidental deletion, corrupted import, or compromised credentials?
- [ ] How will a restore reconcile writes accepted after the chosen recovery point?
- [ ] Does the approved deletion/retention policy require expired or deleted student data to age out of backups sooner than the retention window?
- [ ] Are legal holds possible, and who documents an exception to normal backup expiry?
- [ ] What evidence and notification timeline are required for students, the professor, privacy staff, security staff, and provider support?
- [ ] Which class dates or deadlines require a stricter temporary recovery posture?

## Recoverable Data Inventory

All `public` tables are included in a logical archive. The classifications
below determine validation priority.

| Recovery class                | Tables/content                                                                                              | Requirement                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Schema evidence               | `schema_migrations`                                                                                         | Must match the immutable checksums in the exact Git release; never reconstruct or edit ledger rows during recovery |
| Approved academic content     | `topics`, `questions`, `hints`, `solution_steps`, `misconceptions`, `question_patterns`, `retrieval_chunks` | Preserve IDs, topic/hint/step order, content, hashes, review state, visibility, and references                     |
| Immutable academic evidence   | `question_versions`, `question_approval_history`, `approved_content_imports`                                | Must remain append-only and retain reviewer/signer identity and timestamps                                         |
| Institutional identity/access | `users`, `roles`, `user_roles`                                                                              | Restore identities and the derived student/professor projection; reconcile it from Clerk before traffic             |
| Student state                 | `tutor_sessions`, `attempts`, `student_progress`                                                            | Preserve ownership, timestamps, question versions, counters, verdicts, and approved retention/deletion state       |
| AI accounting                 | `ai_usage`, `ai_llm_reservations`                                                                           | Preserve usage/budget evidence; release or reconcile expired pending reservations before traffic                   |
| Operational evidence          | `audit_events`, `feedback_reports`                                                                          | Preserve audit chronology, actor snapshots, feedback status, and privacy-safe reporter identifiers                 |
| Rebuildable cache             | `ai_response_cache`                                                                                         | Included in a full backup but may be emptied after authorization; it must never be treated as the source of record |

Database login roles, provider users, connection-pool settings, backup
policies, encryption keys, domains, and application secrets are not rows in
these tables. University IT must retain their definitions and recovery owners
separately in the approved platform configuration system. Do not put passwords
in a manifest or this repository.

## Command 1: Verify Provider Backups

```bash
SUPABASE_ACCESS_TOKEN=<institutional provider token from the approved secret store> \
BACKUP_PROVIDER_PROJECT_REF=<Supabase project reference> \
BACKUP_EXPECTED_PROVIDER=supabase \
BACKUP_EXPECTED_PROJECT_HASH=65888f3d354b7dfd \
BACKUP_EXPECTED_DATABASE_NAME=postgres \
  npm run db:backup:verify
```

The command performs read-only `GET` requests against the Supabase Management
API for the project, its backup listing, the organization plan, and the
organization membership. It refuses to run unless the project reference hashes
to the expected Production project fingerprint from the
[credential-topology audit](database-credential-topology-audit.md). The token
and reference are never printed; the evidence records only safe hashes.

When the operator has already run `supabase login`, add `--via-cli` and omit
the token and reference. The command then drives the authenticated CLI
(`projects list`, `backups list`, `orgs list`), selects the project whose safe
hash matches `BACKUP_EXPECTED_PROJECT_HASH`, and keeps the token in the
operating-system keychain. The CLI does not expose the organization plan or
membership, so retention and ownership are reported as unverified findings
until an owner confirms them in the console or the Management API path is
used. The artifact records `accessMethod` as `management_api` or
`supabase_cli`.

The artifact under `docs/evidence/database-backups/` records: provider region,
project status and PostgreSQL version, PITR and WAL archiving flags, daily
backup count and latest successful timestamp, earliest and latest physical
recovery points, recovery-point age, retention derived from the organization
plan, and organization owner, administrator, and MFA counts.

| Exit code | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `0`       | Verified: no findings                                              |
| `1`       | Token invalid, provider unreachable, or project mismatch           |
| `2`       | Completed with findings (listed below)                             |
| `3`       | Not run: token, reference, or expected target missing; artifact retained |

| Finding code                          | Severity | Meaning                                                            |
| ------------------------------------- | -------- | ------------------------------------------------------------------ |
| `no_successful_provider_backup`       | critical | Neither a completed daily backup nor a physical recovery point exists |
| `latest_backup_stale`                 | critical | Newest recovery point is older than 36 hours                       |
| `retention_below_policy`              | critical | Plan retains fewer than seven days                                 |
| `retention_unverified`                | high     | Plan did not map to a documented retention window                  |
| `project_not_healthy`                 | high     | Provider project status is not `ACTIVE_HEALTHY`                    |
| `ownership_unverified`                | high     | Organization membership could not be read                          |
| `insufficient_recovery_administrators`| high     | Fewer than two organization owners                                 |
| `mfa_not_enforced`                    | high     | A member without multi-factor authentication can administer backups |

Retention is derived from the provider's published plan defaults and must be
confirmed in the provider console by the recovery administrator.

## Command 2: Export A Logical Backup

```bash
BACKUP_DATABASE_URL=<dedicated read-only backup credential> \
BACKUP_ACTOR=<named operator or institutional job> \
BACKUP_CHANGE_TICKET=<ticket/evidence ID> \
BACKUP_SOURCE_LABEL="weekly logical copy" \
  npm run db:backup:export -- \
    --output /approved/encrypted-workspace/<date>-production.dump \
    --target production \
    --manifest-dir docs/evidence/database-recovery
```

Requirements:

- `BACKUP_DATABASE_URL` is a dedicated login with `CONNECT`, `USAGE` on
  `public`, `SELECT` on every `public` table and sequence, and `BYPASSRLS` so
  the three row-level-security tables are exported completely. It must not be
  the runtime, migration, import, integrity, or restore credential.
- The `pg_dump` client major version must be at least the server major
  version. On the audit workstation, Homebrew `libpq` provides
  `/opt/homebrew/opt/libpq/bin/pg_dump` (18.6); pass it with `--pg-dump` or
  `PG_DUMP_COMMAND`.
- The archive path must end in `.dump`, must be outside the repository, and
  must not already exist. Archives never enter Git.
- The command opens a read-only transaction first, records the server snapshot
  time as the recovery point, verifies the ledger target matches `--target`,
  summarizes the migration ledger, then runs
  `pg_dump --format=custom --compress=6 --no-owner --no-acl --schema=public`
  with the credential injected only through the child environment and
  `default_transaction_read_only=on`.
- The manifest records the source safe fingerprint, server version, snapshot
  time, ledger summary, archive SHA-256 and size, and export duration. It never
  records the archive path, URL, host, user, or password.

Only the `public` schema is exported. Every application table, view, function,
trigger, constraint, and sequence lives there; provider-managed schemas are not
restorable into an ordinary PostgreSQL target and are not application data.

## Schema Migrations Must Be Retained Separately

Data backups do not replace migration source control, even when an archive
contains schema definitions.

- Keep every `db/migrations/NNN_*.sql` file in Git permanently after use.
- Preserve the exact application Git SHA/tag and release artifact associated
  with each Production backup or recovery point.
- Export a redacted `db:migrate:status -- --json` report with filenames and
  checksums to the change/recovery ticket; never export its connection URL.
- Retain CI results proving the migration set can build an empty database and
  upgrade the supported prior state.
- Never edit a migration whose checksum appears in any environment, delete or
  manufacture a `schema_migrations` row, or use a backup to redefine history.

After a restore, first run the code release compatible with the restored
`schema_migrations` ledger, compare that ledger with the Git migration set, and
only then apply reviewed forward-only pending migrations through the normal
migration job.

## Restore Authorization And Preparation Checklist

- [ ] Incident/recovery ticket names the professor owner, IT executor, second reviewer, reason, and desired recovery point.
- [ ] Owner confirms the approved RPO/RTO and whether the exercise or incident contains real student data.
- [ ] Provider console evidence, or a `db:backup:verify` artifact with exit `0`, identifies the source backup as successful.
- [ ] IT records the source database fingerprint, backup ID/type, recovery timestamp, region, encryption, retention expiry, and provider support case.
- [ ] Exact compatible application Git SHA and immutable migration files are available independently of the backup.
- [ ] Target is a newly created, empty, isolated disposable database with no application traffic, integrations, or general Staging access. **Never restore over Production.**
- [ ] Target host or database name contains `restore`, `recovery`, `disposable`, `sandbox`, `scratch`, or `test`; the wrapper refuses anything else.
- [ ] Target uses a short-lived recovery credential and the smallest sufficient privileges.
- [ ] `RECOVERY_TEST_DATABASE_URL` is injected only from the approved recovery secret store. No runtime, migration, import, backup, or integrity URL is supplied to the command.
- [ ] Restore host has a `pg_restore` client at least as new as the archive's server major version (`--pg-restore` or `PG_RESTORE_COMMAND`).
- [ ] Monitoring/logging for the exercise is restricted because restored data may be Production student data.
- [ ] Cleanup owner and deletion deadline are recorded before restoration begins.

## Disposable Restore-Test Procedure

Supabase's console "Restore" actions for daily backups and PITR are in-place
operations on the Production project. They must never be used for an
exercise. A disposable exercise uses one of two sources:

- **A** the logical archive from `db:backup:export`, restored with the wrapper;
- **B** the provider's downloadable daily backup (plain SQL), loaded into the
  empty disposable target with `psql --single-transaction --set ON_ERROR_STOP=1
  -f <file>` by University IT, then validated with `--validate-only`.

### 1. Prepare the target and variables

```text
RECOVERY_TEST_DATABASE_URL=<disposable target URL from the approved secret store>
RECOVERY_TEST_ACTOR=<named operator or institutional job>
RECOVERY_TEST_CHANGE_TICKET=<ticket/evidence ID>
```

### 2. Plan and confirm the exact target

```bash
npm run db:recovery:test -- --plan --json
```

Record the SHA-256 target fingerprint and the reported disposable marker. The
second reviewer compares the non-secret provider target identity with the
ticket. Copy only the fingerprint, not the URL, into `--confirm-target`.

### 3A. Restore a custom-format archive

```bash
npm run db:recovery:test -- \
  --restore \
  --archive /approved/encrypted-workspace/<date>-production.dump \
  --confirm-target <fingerprint> \
  --recovery-point <recoveryPoint.at from the export manifest> \
  --source-label "weekly logical copy" \
  --evidence-dir docs/evidence/database-recovery \
  --json
```

The wrapper requires zero public tables in the target, inspects the archive
with `pg_restore --list`, skips only the `CREATE SCHEMA public` entry that
every new database already contains, refuses an empty entry list, and restores
with `--exit-on-error --single-transaction --no-owner --no-privileges` through
a `--use-list` file. It never uses `--create`, `--clean`, `DROP DATABASE`, or a
Production credential. The credential reaches `pg_restore` only through the
child environment.

### 3B. Validate a provider-restored or SQL-loaded clone

```bash
npm run db:recovery:test -- \
  --validate-only \
  --confirm-target <fingerprint> \
  --recovery-point <provider backup timestamp> \
  --source-label "provider daily backup" \
  --evidence-dir docs/evidence/database-recovery \
  --json
```

### 4. What the wrapper validates and records

Automated, read-only, inside a repeatable-read transaction:

- migration ledger state is `current` with no checksum mismatch, unknown
  migration, gap, or pending migration for the release;
- every critical and rebuildable table and every application view exists;
- no unexpected `NOT VALID` constraint; the known deferred
  `questions_pattern_id_fkey` is reported separately;
- eight cross-table referential checks (questions/topics, question children,
  versions and approval history, identity roles, sessions/attempts/progress,
  retrieval chunks, patterns and approved imports, LLM reservations);
- every `bigserial` sequence is ahead of its table maximum;
- row counts for all 21 critical tables and the latest committed record
  timestamp (aggregate only; expiry deadlines are ignored);
- the complete 18-check read-only integrity audit from
  [database-integrity.md](database-integrity.md) when the restored ledger
  declares exactly one auditable target, covering immutable question-version
  references, tutor-session ownership, feedback linkage, AI reservation and
  usage accounting, idempotency keys, cross-student ownership, publication
  state, and test/demo markers. Sample references are HMAC-redacted per run.

The evidence artifact records the target fingerprint, archive SHA-256 and
size, restore start/end/duration, restored and skipped entry counts, validation
duration, ledger summary, row counts, the declared recovery point, the latest
committed record, recovery-point age versus RPO, whole-exercise duration versus
RTO, and the integrity audit summary and checks. It never contains a URL, host,
username, password, student content, answer, or feedback text.

Exit codes: `0` passed, `1` refused or failed (a failed validation still writes
a `failed` artifact when `--evidence-dir` is set), `2` passed with integrity
findings.

### 5. Operator comparisons

- [ ] Archive SHA-256, provider backup ID, recovery timestamp, and expected release match the ticket and manifest.
- [ ] Critical table counts match the pre-backup manifest or explain expected differences.
- [ ] `topics.sort_order`, `hints.hint_order`, and `solution_steps.step_order` match the approved content manifest.
- [ ] Approved question/content hashes and `approved_content_imports` hashes match signed release evidence.
- [ ] Named professors have `publicMetadata.role = "professor"` in the matching Clerk instance and the restored projection agrees.
- [ ] Sample student sessions, attempts, progress, and deletion state match the recovery point without exposing them in the ticket.
- [ ] `ai_usage` totals and reservation state are internally consistent; expired pending reservations are handled through an approved forward action.
- [ ] Read-only API smoke checks return approved course content. Do not create a fake student, session, or attempt in a recovered Production copy.
- [ ] No raw private PDFs, extracted text, answer keys, embeddings, development logs, demo identities, or test rows appear.

## Data Validation Checklist

Use the automated list in step 4 and the operator comparisons in step 5. A
restore is accepted only when the artifact status is `passed`, the integrity
audit is `clean` or its findings are already known and ticketed, and every
operator comparison is signed by the second reviewer.

## Rollback Procedure

Rollback exists at three levels. In every case the pre-change state is
preserved, never overwritten.

1. **Disposable exercise.** Rollback is retirement: drop the disposable
   database and delete the archive copy after evidence is retained (next
   section). Nothing else changed.
2. **Failed Production change (migration, import, repair).** Before the change,
   the operator takes a checkpoint: a `db:backup:export` archive plus the
   provider's latest recovery point, both recorded in the ticket. If the change
   fails or validation finds damage, put the application in maintenance mode,
   restore the checkpoint into a **new** Production-controlled database using
   the disposable procedure, validate it, and switch the application
   connection to the validated copy. Never edit `schema_migrations`, never
   "roll back" a migration by hand, and never restore in place.
3. **Failed Production restore or cutover.** The original Production database
   is preserved during a restore because the restore targets a new database.
   Rollback is to switch the application connection variable back to the
   preserved original (or, if the original was lost, to the most recent
   validated restored copy), rerun `db:migrate:check` (`current`, no drift),
   the database health endpoint, and the read-only pilot smoke, then lift
   maintenance mode. Record the rollback time against RTO and the resulting
   data-loss window against RPO.

The application reads a single connection variable, so cutover and rollback are
configuration changes, not data operations. Rotate any credential that was
exposed during the incident before traffic resumes.

## Production Restore Checklist

Use this only for an authorized incident after the disposable procedure has
passed. The repository wrapper does not execute a Production restore.

- [ ] Professor/IT authorize the exact recovery point and record expected data loss against RPO.
- [ ] Put the application in maintenance mode and block all writes before restore/cutover.
- [ ] Preserve the failed database and logs under incident retention; do not overwrite or delete evidence.
- [ ] Restore into a new Production-controlled database whenever the provider supports it; avoid in-place destructive restore.
- [ ] Run the complete validation checklist with read-only credentials and compare against backup/change manifests.
- [ ] Deploy the last database-compatible application SHA; apply only approved forward migrations after checksum verification.
- [ ] Rotate runtime, migration, import, recovery, and break-glass credentials before traffic if compromise is possible.
- [ ] Switch the application connection only after professor and IT acceptance.
- [ ] Monitor database errors, student writes, authorization, usage accounting, and provider health during the agreed observation window.
- [ ] Reconcile or communicate writes lost after the recovery point; never merge student records ad hoc.
- [ ] Record actual RPO/RTO, approvals, validation report, provider IDs, deployment SHA, and follow-up actions.
- [ ] Delete or quarantine the failed/temporary database only after evidence retention and two-person authorization.

## Retire The Disposable Target

The wrapper deliberately does not delete anything. Retirement is a reviewed
step with its own record.

1. Confirm the evidence artifact exists in `docs/evidence/database-recovery/`
   and its `archive.sha256` matches the export manifest.
2. Drop the disposable database (`dropdb <name>` for a workstation or
   institutional PostgreSQL target; the provider's deletion workflow with
   two-person confirmation for a provider-hosted target).
3. Delete the archive copy from the restore host using the approved secure
   deletion method; the retained archive stays only in the approved encrypted
   store until its retention expiry.
4. Revoke the short-lived recovery credential.
5. Verify the database no longer exists and record the deletion time, the
   verifier, and the credential revocation in the ticket and in the exercise
   log below.

## Disposable Restore Exercise Log

### 2026-09-03 — Local disposable drill (tooling proof, no Production data)

Executor: Kanan Guliyev (engineering). Ticket label: `RECOVERY-DRILL-2026-09-03`.
Environment: workstation PostgreSQL 16.15, `pg_dump`/`pg_restore` 16.15. No
Production credential, provider backup, or real student record was used.

| Step                                                            | Time (UTC)              | Result                                                                                                          |
| --------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Create disposable source database and apply migrations 001–021  | 17:31–17:36             | `current`, 21/21, ledger target `test`                                                                          |
| Seed public-safe content and synthetic student state             | 17:44                   | 8 questions, 11 topics, 2 tutor sessions, 4 attempts, 1 progress row, 4 usage rows, 1 reservation, 1 feedback, 1 audit event |
| `db:backup:export --target test`                                | 17:55:32.389 (snapshot) | 91 ms; archive 251,269 bytes; SHA-256 `8605aa5489af54edcabfeb6bef46e99cb7361bcf8b7a558759a8bc492b9f6463`      |
| Create empty disposable target, `--plan`, second-look fingerprint | 17:55                 | fingerprint `b8570ce5…e6190cd`, marker `test`                                                                   |
| `db:recovery:test --restore` into the empty target              | 17:55:32.7–17:55:32.9   | `pg_restore` 143 ms; 366 archive entries, 364 restored, 2 schema entries skipped                                |
| Automated validation                                            | 17:55:32.9              | 30 ms; ledger `current` 21/21; 21 critical tables counted; 8 referential checks and 11 sequence checks clean    |
| Read-only integrity audit on the restored copy                  | 17:55:32.9              | clean, 18/18 checks, ledger target `test`                                                                       |
| Whole automated exercise                                        | —                       | 219 ms; recovery-point age 0.5 s at exercise; within the 24 h RPO and 24 h RTO objectives                       |
| Retire: drop target and source databases, delete both archives  | 17:56:28                | Verified no disposable database remains on the workstation                                                      |

Retained evidence:

- export manifest `docs/evidence/database-recovery/2026-09-03T17-55-32-486Z-test-exported.json`
- restore evidence `docs/evidence/database-recovery/2026-09-03T17-55-32-911Z-test-passed.json`
- provider verification, first attempt without a token
  `docs/evidence/database-backups/2026-09-03T17-51-58-450Z-production-not_run.json`
- provider verification through the authenticated CLI
  `docs/evidence/database-backups/2026-09-03T18-53-14-816Z-production-findings.json`

The first restore attempt failed because the archive carried the
`CREATE SCHEMA public` entry that a new database already contains; the wrapper
now skips only that entry through a `--use-list` file, refuses an empty list,
and reports restored/skipped counts. Both drill databases and archives were
deleted after the artifacts were written, and the `archive.sha256` in the
restore evidence matches the export manifest.

This exercise proves the repository tooling end to end on the real schema with
synthetic data. It does not prove Production backups, Production restore
duration, or Production data fidelity.

## Production Exercise Status

### Provider verification — 2026-09-03, FINDINGS

After the project owner authenticated the Supabase CLI, `db:backup:verify
--via-cli` matched the listed project to the expected fingerprint
`65888f3d354b7dfd` and read its backup listing. The retained artifact is
`docs/evidence/database-backups/2026-09-03T18-53-14-816Z-production-findings.json`.

| Control                         | Provider state                                                                                   | Verdict                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Project                         | `ACTIVE_HEALTHY`, region `us-east-1`, PostgreSQL 17.6, release channel `ga`                       | Healthy                                    |
| Daily provider backups          | None listed (`backups: null`)                                                                    | **Critical: no successful provider backup** |
| Point-in-time recovery          | Disabled; WAL archiving flag on but no physical recovery point available                         | **Critical**                               |
| Most recent successful backup   | None                                                                                             | **Critical**                               |
| Retention window                | Unknown: the CLI does not expose the organization plan; the project lives in the organization the Vercel integration created for the personal account | High: unverified               |
| Ownership                       | Organization membership not readable through the CLI; no institutional owner recorded            | High: unverified                           |

Interpretation: **Production currently has no provider-managed backup at
all.** The only recoverable copy of the Production database is a logical
export taken with `db:backup:export`, and none has been taken yet. This is a
launch blocker independent of the restore exercise.

Required owner actions, in order:

1. Move the project to a Supabase plan with daily backups (Pro or higher) or
   enable point-in-time recovery, under an institutionally owned organization
   with at least two owners and MFA. Record the plan and retention in the
   Provider Verification Record.
2. Rerun `db:backup:verify --via-cli` (or the Management API path) and require
   exit `0`.
3. Until step 1 is complete, take a `db:backup:export --target production`
   archive at least daily and before every change, store it in the approved
   encrypted location, and treat its `recoveryPoint.at` as the effective
   recovery point.

### Production disposable restore — blocked on 2026-09-03

No dedicated read-only `BACKUP_DATABASE_URL` exists for the Production
project. The only Production credential on the audit workstation is the
Vercel-managed runtime secret, which is the provider `postgres` owner role.
Policy forbids using the runtime or owner credential for backup jobs, and the
workstation's command permission layer refused every connection attempt with
it, including a read-only probe. A prepared orchestrator (short-lived
SELECT-only backup role, export, restore into a local disposable PostgreSQL 17
target, validation, retirement) is ready to run the moment a permitted
credential path exists.

To close this section University IT must: create the `BACKUP_DATABASE_URL`
login (SELECT on public tables and sequences, `BYPASSRLS`, short expiry); run
`db:backup:export --target production`; create an isolated disposable target;
run `db:recovery:test --restore` with `--evidence-dir`; complete the operator
comparisons; retire the target; and record the measured RPO/RTO in the table
above.

## Provider Verification Record

University IT must complete this record before anyone says backups exist:

- [ ] Provider and institutional tenant/project/database IDs (no secrets):
- [ ] Region and backup-storage region:
- [ ] Backup/PITR feature and service tier:
- [ ] First successful backup ID and timestamp:
- [ ] Earliest/latest available recovery points:
- [ ] Retention and deletion behavior, including account/database deletion:
- [ ] Encryption and key-recovery owner:
- [ ] Primary/secondary restore operators and provider escalation route:
- [ ] Successful disposable restore ticket/report/date:
- [ ] Measured RPO and RTO:
- [ ] Professor acceptance and University IT acceptance:

Until every applicable line has evidence, status remains **repository
tooling exercised; provider backup and Production restore capability
unverified**.
