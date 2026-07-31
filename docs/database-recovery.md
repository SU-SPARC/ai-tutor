# Database Backup And Recovery Process

> **Evidence status: proposed and testable, not provider-verified.** No active
> Production PostgreSQL provider, backup schedule, recovery point, retention
> setting, or successful provider restore is evidenced in this repository. Do
> not state that Production backups exist until University IT attaches provider
> evidence and a successful restore report.

This runbook defines the ownership decisions, backup policy proposal, restore
checklist, validation checklist, and disposable recovery exercise for the
PostgreSQL database. It does not access Production credentials, provision a
database, create a backup, or authorize a Production restore.

## Proposed Backup Policy

The professor is the academic/service owner and authorizes recovery of student
or course data. University IT is the backup operator, credential-recovery
administrator, and restore executor. Engineering may maintain and test the
repository tooling but must not receive Production provider-owner credentials.

| Control                  | Proposed baseline pending owner/IT approval                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provider-native recovery | Continuous point-in-time recovery when offered, plus one provider-native snapshot per day                                                                                                                    |
| Native retention         | 30 days, or the shorter period required by the approved student-data retention policy                                                                                                                        |
| Logical recovery copy    | Weekly PostgreSQL custom-format archive retained eight weeks, plus a checkpoint immediately before a schema change or approved-content import                                                                |
| Staging                  | Daily backup retained seven days; synthetic data only                                                                                                                                                        |
| Recovery point objective | No more than 24 hours of committed Production data loss; owner must decide whether pilot operations require a shorter objective                                                                              |
| Recovery time objective  | Service restored or an approved status issued within one business day; owner must decide whether class schedules require a shorter objective                                                                 |
| Encryption               | Provider-managed encryption at rest and in transit; logical archives encrypted in an institution-approved store with keys recoverable by IT                                                                  |
| Region                   | Approved institutional region; backup replicas must not silently move data to an unapproved region                                                                                                           |
| Access                   | Named University IT operators using institutional SSO/MFA; no personal accounts or shared passwords                                                                                                          |
| Restore exercise         | Before pilot, after material provider/schema changes, and at least quarterly during an active pilot                                                                                                          |
| Evidence                 | Backup ID/type, database fingerprint, start/completion times, recovery point, retention expiry, encryption/region, archive SHA-256 when applicable, restore ticket, validation report, and deletion evidence |

Provider-native backup and a logical archive are complementary. Native recovery
is usually the fastest way to meet RTO and PITR; a custom-format archive offers
provider-independent recovery evidence. Neither replaces institutional copies
of provider configuration, application secrets, DNS, database-role grants, or
the Git migration history.

Backup jobs must fail visibly and alert University IT. A dashboard setting or a
successful dump command is not enough: a backup is considered verified only
after its provider status is successful, its retention/region/encryption are
recorded, and a disposable restore passes this runbook.

## Project-Owner RPO And RTO Questions

The professor/project owner and University IT must answer and sign these before
the pilot. Until then, the proposed 24-hour RPO and one-business-day RTO are
planning assumptions, not accepted objectives.

- [ ] What is the maximum acceptable loss of student attempts, progress, and feedback: 24 hours, four hours, one hour, or less?
- [ ] Is losing a professor approval or approved-content import ever acceptable, or must those events have a near-zero RPO?
- [ ] Does the RPO apply continuously, only during scheduled classes, or only while the pilot is open?
- [ ] How quickly must read-only course content return, and how quickly must student write capability return?
- [ ] What is the maximum outage during a class, assignment deadline, evening, weekend, and university holiday?
- [ ] May the service return in read-only mode while student writes remain unavailable?
- [ ] Who may declare a disaster, enter maintenance mode, authorize a restore, and declare recovery complete?
- [ ] Who decides between point-in-time recovery, latest snapshot, logical archive, and forward repair?
- [ ] Which known-bad events must be excluded from the chosen recovery point, such as accidental deletion, corrupted import, or compromised credentials?
- [ ] How will a restore reconcile writes accepted after the chosen recovery point?
- [ ] Does the approved deletion/retention policy require expired or deleted student data to age out of backups sooner than the proposed retention?
- [ ] Are legal holds possible, and who documents an exception to normal backup expiry?
- [ ] What evidence and notification timeline are required for students, the professor, privacy staff, security staff, and provider support?
- [ ] Which class dates or deadlines require a stricter temporary recovery posture?

## Recoverable Data Inventory

All tables are included in a full database recovery copy. The classifications
below determine validation priority, not whether `pg_dump` may omit a table.

| Recovery class                | Tables/content                                                                                              | Requirement                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Schema evidence               | `schema_migrations`                                                                                         | Must match the immutable checksums in the exact Git release; never reconstruct or edit ledger rows during recovery |
| Approved academic content     | `topics`, `questions`, `hints`, `solution_steps`, `misconceptions`, `question_patterns`, `retrieval_chunks` | Preserve IDs, topic/hint/step order, content, hashes, review state, visibility, and references                     |
| Immutable academic evidence   | `question_versions`, `question_approval_history`, `approved_content_imports`                                | Must remain append-only and retain reviewer/signer identity and timestamps                                         |
| Institutional identity/access | `users`, `roles`, `user_roles`                                                                              | Restore application identities and role history; reconcile active access with the identity provider before traffic |
| Student state                 | `tutor_sessions`, `attempts`, `student_progress`                                                            | Preserve ownership, timestamps, question versions, counters, verdicts, and approved retention/deletion state       |
| AI accounting                 | `ai_usage`, `ai_llm_reservations`                                                                           | Preserve usage/budget evidence; release or reconcile expired pending reservations before traffic                   |
| Operational evidence          | `audit_events`, `feedback_reports`                                                                          | Preserve audit chronology, actor snapshots, feedback status, and privacy-safe reporter identifiers                 |
| Rebuildable cache             | `ai_response_cache`                                                                                         | Included in a full backup but may be emptied after authorization; it must never be treated as the source of record |

`retrieval_chunks` can be regenerated from approved course content, but the
restored copy should still be counted and reference-validated. If regenerated,
record the source release and compare derived hashes before replacing it.

Database login roles (`app_runtime`, `app_migrator`, optional read-only, and
break-glass), provider users, connection-pool settings, backup policies,
encryption keys, domains, and application secrets are not rows in these tables.
University IT must retain their definitions and recovery owners separately in
the approved platform configuration system. Do not put passwords in a backup
manifest or this repository.

## Logical Archive Creation Requirements

If the approved provider permits logical export, University IT runs `pg_dump`
from the institution-controlled backup job with a dedicated read-only backup
credential. Use custom format, include pre-data/data/post-data, and suppress
ownership and ACL replay. The conceptual command is:

```bash
pg_dump --format=custom --no-owner --no-acl --file <protected-output.dump>
```

The actual connection must be injected through the backup job's protected
PostgreSQL environment/service configuration, not a command argument. It
must not appear in a ticket, shell history, CI configuration, or this
repository. Do not use `--data-only`, `--schema-only`, or table exclusions: the
archive must contain every source-of-record and rebuildable table, functions,
triggers, constraints, sequences, and views. Record the `pg_dump` client/server
major versions, consistent-snapshot completion, byte size, SHA-256, encryption
object/key identifiers, and retention expiry. Encrypt and transfer the archive
into approved storage before removing temporary plaintext. A successful dump
still does not prove restorability; only the disposable restore exercise does.

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
- Retain role/grant definitions and provider configuration outside the data
  archive; the repository migrations intentionally do not contain credentials.

After a full physical/native or custom-format restore, first run the code release
that is compatible with the restored `schema_migrations` ledger. Compare that
ledger with the corresponding Git migration set. Only then apply reviewed,
forward-only pending migrations through the normal migration job. Never restore
only the ledger or apply newer migrations merely to hide a checksum mismatch.

## Restore Authorization And Preparation Checklist

- [ ] Incident/recovery ticket names the professor owner, IT executor, second reviewer, reason, and desired recovery point.
- [ ] Owner confirms the approved RPO/RTO and whether the exercise or incident contains real student data.
- [ ] Provider console evidence identifies the source backup/snapshot as successful; repository tooling cannot establish this fact.
- [ ] IT records the source database fingerprint, backup ID/type, recovery timestamp, region, encryption, retention expiry, and provider support case.
- [ ] Exact compatible application Git SHA and immutable migration files are available independently of the backup.
- [ ] Target is a newly created, Production-controlled disposable database/branch with no application traffic, integrations, or general Staging access.
- [ ] Target name or hostname contains `restore`, `recovery`, `disposable`, `sandbox`, `scratch`, or `test`.
- [ ] Target uses a short-lived recovery credential, distinct encryption/backup identifiers, network restrictions, and the smallest sufficient privileges.
- [ ] `RECOVERY_TEST_DATABASE_URL` is injected only from the approved recovery secret store. `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `CONTENT_IMPORT_DATABASE_URL` are not supplied to the command.
- [ ] Logical restore host has a compatible `pg_restore` version and enough encrypted temporary storage; the archive never enters Git or a developer laptop.
- [ ] Monitoring/logging for the exercise is restricted because restored data may be Production student data.
- [ ] Cleanup owner and deletion deadline are recorded before restoration begins.

## Disposable Restore-Test Procedure

The repository wrapper supports PostgreSQL providers that either permit direct
`pg_restore` into a separate empty database or can create a provider-native
restored clone that accepts a normal PostgreSQL connection. Provider support is
not currently verified.

### 1. Prepare the target and variables

University IT creates the disposable target. Inject only:

```text
RECOVERY_TEST_DATABASE_URL=<disposable target URL from the approved secret store>
RECOVERY_TEST_ACTOR=<named operator or institutional job>
RECOVERY_TEST_CHANGE_TICKET=<ticket/evidence ID>
```

The wrapper does not read runtime, migration, content-import, or Production
connection variables.

### 2. Plan and confirm the exact target

```bash
npm run db:recovery:test -- --plan --json
```

Record the SHA-256 target fingerprint. Have the second reviewer compare the
non-secret provider target identity with the ticket. Copy only the fingerprint,
not the URL, into `--confirm-target`.

### 3A. Restore a PostgreSQL custom-format archive

The target must have zero public tables. The wrapper inspects the archive with
`pg_restore --list`, then restores with `--exit-on-error`,
`--single-transaction`, `--no-owner`, and `--no-privileges`. It never uses
`--create`, `--clean`, `DROP DATABASE`, or a Production credential.

```bash
npm run db:recovery:test -- \
  --restore \
  --archive /approved/encrypted-workspace/backup.dump \
  --confirm-target <fingerprint> \
  --json
```

The command passes connection values to `pg_restore` through a minimal child
environment so the credential does not appear in command arguments. The report
records archive size and SHA-256, not its credential or source data.

### 3B. Validate a provider-native restored clone

After University IT completes the provider-native restore into the disposable
target, run:

```bash
npm run db:recovery:test -- \
  --validate-only \
  --confirm-target <fingerprint> \
  --json
```

Validation-only performs no restore or mutation. It is the required path when
the provider exposes snapshots/PITR only through its console or API.

### 4. Attach evidence and destroy the target

- [ ] Attach the wrapper's JSON report and provider restore completion evidence to the ticket.
- [ ] Record restore start, database-available, application-validated, and exercise-complete times; compare them to RTO.
- [ ] Record source backup timestamp and the latest recovered committed record; compare them to RPO.
- [ ] University IT deletes the disposable database/branch and short-lived credential using two-person confirmation.
- [ ] Record provider deletion ID/time and the expiry of any temporary provider backup created for the exercise.
- [ ] Confirm no archive, unredacted output, or restored student data remains on runner disks, tickets, chat, or general Staging.

The wrapper deliberately does not delete the target. Automated deletion in a
provider-neutral script would be less safe than the institution's reviewed,
provider-specific deletion workflow.

## Data Validation Checklist

The wrapper verifies migration checksums/status, required tables and views,
validated foreign/check constraints, critical row counts, and cross-table
references. Operators must complete the evidence checks that require an
expected backup manifest or provider knowledge.

### Automated checks

- [ ] Migration state is `current`; no checksum mismatch, unknown migration, gap, or pending migration exists for the selected release.
- [ ] Every critical and rebuildable table and every application view exists.
- [ ] No unexpected public foreign-key or check constraint is left `NOT VALID`; the known deferred `questions_pattern_id_fkey` is reported and its existing rows pass an explicit orphan check.
- [ ] Questions reference topics; question children reference questions.
- [ ] Versions/approval history reference the correct question and reviewer identity.
- [ ] Application roles reference existing users and roles.
- [ ] Sessions, attempts, and progress reference valid identities, questions, topics, and immutable question versions.
- [ ] Retrieval chunks reference the matching topic/question.
- [ ] Question patterns and approved imports reference valid topics and signer/reviewer identities.
- [ ] LLM reservations reference existing sessions.
- [ ] Row counts are emitted for every critical table.

### Operator comparisons

- [ ] Archive SHA-256, provider backup ID, recovery timestamp, and expected release match the ticket.
- [ ] Critical table counts match the pre-backup manifest or explain expected post-recovery differences.
- [ ] `topics.sort_order`, `hints.hint_order`, and `solution_steps.step_order` values and gaps match the approved content manifest.
- [ ] Approved question/content hashes and `approved_content_imports` hashes match signed release evidence.
- [ ] Latest `question_versions` and approval-history decisions match their parent questions.
- [ ] The two named professors and named operator have the expected active roles; disabled/deleted users and revoked/expired grants remain disabled/revoked/expired.
- [ ] Sample student sessions, attempts, progress, answer-preview retention, and deletion state match the selected recovery point without exposing them in the ticket.
- [ ] `ai_usage` totals and reservation state are internally consistent; expired pending reservations are handled through an approved forward action.
- [ ] Audit chronology and feedback status/timestamps are plausible through the recovery point.
- [ ] Sequences backing `bigserial` IDs are ahead of table maxima; verify by read-only sequence inspection, not by inserting test rows into the recovered copy.
- [ ] Application runtime role can perform required DML but cannot run DDL, manage roles, change backups, or access provider administration.
- [ ] Read-only API smoke checks return approved course content. Do not create a fake student, session, or attempt in the recovered Production copy.
- [ ] No raw private PDFs, extracted text, answer keys, embeddings, development logs, demo identities, or test rows appear.

## Production Restore Checklist

Use this only for an authorized incident after the disposable procedure has
passed. The repository wrapper does not execute a Production restore.

- [ ] Professor/IT authorize the exact recovery point and record expected data loss against RPO.
- [ ] Put the application in maintenance mode and block all writes before restore/cutover.
- [ ] Preserve the failed database and logs under incident retention; do not overwrite or delete evidence.
- [ ] Restore into a new Production-controlled database/branch whenever the provider supports it; avoid in-place destructive restore.
- [ ] Run the complete validation checklist with read-only credentials and compare against backup/change manifests.
- [ ] Deploy the last database-compatible application SHA; apply only approved forward migrations after checksum verification.
- [ ] Rotate runtime, migration, import, recovery, and break-glass credentials before traffic if compromise is possible.
- [ ] Switch the application connection/alias only after professor and IT acceptance.
- [ ] Monitor database errors, student writes, authorization, usage accounting, and provider health during the agreed observation window.
- [ ] Reconcile or communicate writes lost after the recovery point; never merge student records ad hoc.
- [ ] Record actual RPO/RTO, approvals, validation report, provider IDs, deployment SHA, and follow-up actions.
- [ ] Delete or quarantine the failed/temporary database only after evidence retention and two-person authorization.

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

Until every applicable line has evidence, status remains **backup process
proposed; provider backup and restore capability unverified**.
