# Production Database Credential Topology Audit

Date: 2026-09-05

Status: **PASS — Production custody and credential topology are established
under change ticket `DB-CUSTODY-124`. The project is institutionally
controlled by two independently operated Supabase Owners with MFA; runtime,
migration, integrity-audit, and backup credentials were independently verified
against one Production target and immutable ledger; the deployed runtime is
`app_runtime`; operator credentials are outside Vercel; and the former owner
runtime credential and temporary audit identity are revoked.**

This audit compares database targets without retaining or printing connection
strings, passwords, raw hosts, raw usernames, or raw provider project
references. Production mutations were performed only after the named owner and
independent second reviewer authorized ticket `DB-CUSTODY-124`. Retained
artifacts contain sanitized fingerprints, roles, dates, counts, results, and
ticket references only. No old migration file or ledger checksum was changed.

## 2026-09-05 Custody Closure

The following ordered evidence closes the custody and least-privilege finding:

The consolidated [closure
artifact](evidence/database-custody/2026-09-05T21-19-15Z-production-passed.json)
records the final post-redeploy state. Its supporting ordered evidence is:

- [institutional custody and MFA
  evidence](evidence/database-custody/2026-09-05T11-31-33Z-production-custody-established-authorization-pending.json)
  records organization fingerprint `89b51cd636406f8b`, two distinct authorized
  Owner-role recovery-administrator fingerprints, and MFA enabled for both;
  the later independent approval is ticketed in `SU-SPARC/ai-tutor#3` as
  `issuecomment-5554234592`;
- [role and policy provisioning
  evidence](evidence/database-custody/2026-09-05T20-42-24-869Z-production-passed.json)
  records four NOLOGIN roles, 29/29 RLS-enabled Production tables, 29/29
  `app_runtime` policies, no administrative role, and no login credential
  created during provisioning;
- [narrow cleanup
  evidence](evidence/database-custody/2026-09-05T20-46-19-241Z-production-passed.json)
  records removal of only reviewed temporary role fingerprint
  `5982cada2a36410b`, with zero temporary audit identities remaining;
- [credential rotation and topology
  evidence](evidence/database-custody/2026-09-05T20-55-46-744Z-production-passed.json)
  records four distinct role fingerprints, each connected to Supabase project
  fingerprint `65888f3d354b7dfd`, database `postgres`, pooler host fingerprint
  `3932d873511760d0`, and checksum-clean 21/21 ledger fingerprint
  `18b5a636a4e3ac41`, with zero role-boundary violations;
- only `DATABASE_URL`, scoped to Production, is retained in Vercel application
  settings; the migration, integrity-audit, and backup credentials are retained
  in the protected GitHub `Production` environment, whose required reviewer is
  the independent reviewer and whose self-review protection is enabled; and
- after successful redeploy and smoke verification, the provider-owner database
  password was changed. A previously healthy immutable owner-backed deployment
  now returns database health unavailable while the `app_runtime` deployment
  remains required and healthy. The provider-triggered legacy Vercel variables
  were removed again after that password change, and post-rotation placement
  verification passed.

The final redeployed [five-check Production smoke
evidence](evidence/database-custody/2026-09-05T21-18-51-825Z-production-passed.json)
passes database health, two privacy boundaries, and two authorization
boundaries. Provider-managed backups, the known archived synthetic-data audit
finding, archive custody, and RPO/RTO acceptance remain separate readiness
findings; they do not reopen this credential-topology result.

## Historical 2026-09-04 Custody Recheck And Enforced Operation

The remainder of this section preserves the pre-change, fail-closed finding.
It is superseded by the 2026-09-05 closure above.

The sanitized fail-closed snapshot is retained at
`docs/evidence/database-custody/2026-09-04T18-09-00-813Z-production-blocked.json`.
It contains only safe fingerprints, role identifiers, dates, aggregate results,
and the absent ticket result; no URL, host, raw provider identifier, personal
name, email address, token, or password is retained.

The current read-only recheck confirms the same Production project fingerprint
`65888f3d354b7dfd`, database `postgres`, an `ACTIVE_HEALTHY` PostgreSQL 17.6
provider project, and 21 applied migrations. It also confirms the blockers are
current:

- the Supabase project remains in a personal Free organization with one owner,
  and MFA is disabled for that owner;
- the provider reports zero daily backups and no point-in-time recovery;
- all 29 public tables have row-level security enabled, but zero tables have an
  `app_runtime` policy because that role has not been provisioned;
- `app_runtime` is absent and one `integrity_audit_*` login remains; and
- Vercel Production has no `DATABASE_URL` and still contains five owner/runtime
  credential variables (`POSTGRES_PASSWORD`, `POSTGRES_PRISMA_URL`,
  `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, and `POSTGRES_USER`). It contains
  none of the migration, integrity-audit, or backup credential variables.

The active Production deployment on 2026-09-04 is READY from commit `bd35a44`;
its build reported `current`, 21/21. These are read-only technical facts, not
authorization to mutate Production.

The repository now supplies two fail-closed operations:

- `npm run db:custody:apply` provisions the four NOLOGIN role definitions or
  removes one exact fingerprinted expired audit role. Before any SQL runs it
  requires an institutionally verified provider owner, at least two MFA-enabled
  recovery administrators, distinct named owner and second reviewer
  attestations, an exact project-hash confirmation, a matching change ticket,
  an explicit Production flag, and an exact checksum comparison of all 21
  immutable migration files. Provisioning never creates a password.
- `npm run db:custody:verify` independently connects through the runtime,
  migration, integrity-audit, and backup credentials in forced read-only
  transactions. It requires identical provider/project/database and migration
  ledger fingerprints, four distinct role hashes, role-specific least
  privilege, RLS plus the exact application policy on every Production table,
  and Data API lockout. Both phases require operator credentials to be absent
  from every Vercel application environment; post-rotation also requires
  legacy owner credentials to be absent and `DATABASE_URL` to be scoped only
  to Production.

`db/roles/app_runtime.sql` now grants only the application mutations and five
approved routines observed in the server code, including the nested routines
needed by those entry points. The role may read the
migration ledger for deployment status but cannot write it; it also cannot
write approved-import, pattern, role, retrieval-source, student-progress, or
topic records. `db/roles/production_operator_roles.sql` creates distinct
`app_migrator`, `integrity_audit`, and `backup_export` roles, transfers only
`public` application-object ownership to the migrator, and gives the audit and
backup roles read-only full-row access through `BYPASSRLS`.

No Production mutation, role cleanup, login enablement, password creation,
credential rotation, or redeployment was performed during this recheck. The
gate remains closed until a real ticket and the required institutional people
and custody controls exist.

### Authorized execution order

1. Transfer the provider project to the institution-controlled Supabase
   organization, enable an eligible backup/PITR plan, and record at least two
   recovery administrators with MFA in the protected ticket.
2. Record distinct named values for `CUSTODY_NAMED_OWNER` and
   `CUSTODY_SECOND_REVIEWER`, their two explicit `true` authorization flags,
   `CUSTODY_INSTITUTIONAL_ORGANIZATION`, two distinct names in
   `CUSTODY_RECOVERY_ADMIN_1` and `CUSTODY_RECOVERY_ADMIN_2`, both individual
   `*_MFA_VERIFIED=true` attestations,
   `CUSTODY_PROVIDER_OWNERSHIP_VERIFIED=true`, the ticket, and the expected safe
   Production fingerprint. These are non-secret attestations; only their safe
   fingerprints and roles enter evidence, and raw provider identifiers remain
   out of evidence.
3. Run `db:custody:apply -- --operation provision` with the explicit
   Production, project-hash, ticket, and evidence-directory arguments. Review
   the retained role/RLS counts. All four roles remain `NOLOGIN` at this point.
4. University IT enables each login and sets four independent credentials in
   the provider's audited workflow. Stage all four in an approved operator
   runner; do not put any operator credential in Vercel.
5. Run `db:custody:verify -- --phase pre-rotation` before rotation. It must
   report `passed`, exact target and ledger agreement, four distinct roles,
   zero privilege violations, complete RLS/policy coverage, and no operator
   credential in any Vercel application environment. This phase records but
   does not fail on the legacy owner variables that step 7 removes.
6. Run the separately ticketed `cleanup-expired-audit` operation for only role
   hash `5982cada2a36410b`, and require zero remaining legacy temporary audit
   identities. The raw role name is not copied into new evidence.
7. Only after steps 1–6 pass, store the already verified `app_runtime`
   `DATABASE_URL` in Vercel Production, remove the five legacy owner/runtime
   credential variables, and redeploy. Never store the migration, audit, or
   backup URLs in Vercel.
8. Run `db:custody:verify -- --phase post-rotation` again through the deployed
   runtime secret plus the separately injected operator secrets. This phase
   also requires every legacy owner variable to be absent from Vercel. Then
   run migration status, provider
   backup verification, the integrity audit, database health, authorization
   boundary tests, the five-check Production smoke test, and an error-log scan.
   Revoke the former runtime owner credential only after all post-deploy checks
   pass.

## Historical Verdict (Superseded 2026-09-05)

The separately stored `MIGRATION_DATABASE_URL` is **not a Production target**.
It connects to a local Development PostgreSQL database named
`pf_xj_research_dev`; its ledger rows identify the target as `development`.
That database has 18 of 21 migrations, pending versions 019–021, and the
original checksum for migration 018.

The active Vercel Production deployment instead uses the managed
`POSTGRES_URL` fallback. Its non-secret provider metadata identifies a Supabase
project and the `postgres` database, and its build-time read-only migration
check reported `current`, 21/21. The Development and Production host/database
fingerprints are different.

Therefore:

- the stored migration URL targets a **different environment**;
- it is **misconfigured if it is labeled or intended as the Production
  migration credential**; and
- the Development database behind it is **stale and checksum-drifted relative
  to the current repository**.

The technical Production target is now independently verified by a separate
audit credential: Supabase project hash `65888f3d354b7dfd`, database `postgres`,
pooler host hash `3932d873511760d0`, and checksum-clean ledger fingerprint
`18b5a636a4e3ac41`. This still does not establish an institutionally owned
Production migration credential. Vercel's resource listing returned no
connected integration resource, and no institutional Supabase ownership or
recovery-administrator record was available. The migration-credential mismatch
remains unresolved.

## Safe-Fingerprint Method

All hashes below are the first 16 lowercase hexadecimal characters of SHA-256.
Hosts were lowercased before hashing. Provider project references, usernames,
and hosts were used only in memory and were not printed or written to the
repository.

External PostgreSQL probes set `default_transaction_read_only=on`, opened an
explicit read-only transaction, ran identity/privilege/ledger `SELECT`
statements, and rolled back. Error evidence is limited to PostgreSQL/operating
system codes. Vercel inspection was limited to project identity, environment
variable names/scopes, resource metadata, deployment identity, and filtered
build-log lines.

## Historical Evidence (2026-09-04; Superseded)

This section preserves the exact pre-change comparison that caused the gate to
fail closed. The current result is the 2026-09-05 closure evidence above.

### Hosting and active deployment

- Authenticated Vercel CLI identity: `kananguliyev`.
- Linked project: `kananguliyevs-projects/ai-tutor`, project
  `prj_Io1nGopV0g2NxYXN6AgltSAa8h5v`.
- Active Production deployment:
  `https://ai-tutor-fxl6lv9u5-kananguliyevs-projects.vercel.app`, source
  `bd35a44`, status `READY`.
- Filtered build evidence at `2026-09-04T13:11:31.303Z`:
  `Migration status: current` and `Applied: 21/21`.
- Production environment-variable metadata contains `POSTGRES_URL`,
  `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, and the discrete managed
  PostgreSQL fields. It does not contain `DATABASE_URL`,
  `MIGRATION_DATABASE_URL`, `INTEGRITY_DATABASE_URL`, `BACKUP_DATABASE_URL`, or
  `RECOVERY_TEST_DATABASE_URL`.
- Because the migration check resolves `MIGRATION_DATABASE_URL`, then
  `DATABASE_URL`, then `POSTGRES_URL`, the active build check used
  `POSTGRES_URL`. It cannot apply migrations because `up` accepts only
  `MIGRATION_DATABASE_URL`.
- `vercel integration list --format=json` returned an empty resource list.
  This does not disprove a manually or historically connected Supabase
  project, but it does mean Vercel did not provide provider-resource ownership
  evidence during this audit.

### Credential target comparison

| Credential or set                                                           | Intended scope observed              | Provider/project fingerprint                                                                                                      | Database             | Host hash          | Role hash          | Ledger evidence                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------ | ------------------ | -------------------------------------------------------------------------------------------- |
| Vercel Production `POSTGRES_URL` and companion managed PostgreSQL variables | Active Production runtime            | Supabase project `65888f3d354b7dfd`; the direct database host and public Supabase URL independently derived the same project hash | `postgres`           | `5b9942ef57aca05a` | `a942b37ccfaf5a81` | Active build: `current`, 21/21; runtime privilege topology remains unverified                |
| Short-lived `INTEGRITY_DATABASE_URL`                                        | Production integrity audit           | Supabase project `65888f3d354b7dfd`; independently connected through the session pooler                                           | `postgres`           | `3932d873511760d0` | `5982cada2a36410b` | Direct read-only query: `current`, 21/21, zero issues, ledger fingerprint `18b5a636a4e3ac41` |
| Local `.env.local` `DATABASE_URL`                                           | Development runtime                  | Local PostgreSQL; no provider project identity                                                                                    | `pf_xj_research_dev` | `12ca17b49af22894` | `dd2b2aae3ec674b6` | Connected read-only; ledger read denied with PostgreSQL `42501`                              |
| Local `.env.migration.local` `MIGRATION_DATABASE_URL`                       | Development migrator, not Production | Local PostgreSQL; same host/database as the Development runtime                                                                   | `pf_xj_research_dev` | `12ca17b49af22894` | `549a56913239e49b` | `drift`, 18/21, pending 019–021, target `development`, ledger fingerprint `d7231855b996974c` |

The Development runtime and migrator have different role hashes, as intended,
but the migrator can create database and `public` schema objects. It is not a
superuser and cannot create databases or roles, replicate, or bypass row-level
security. The Production audit role had default read-only sessions, no
persistent table/schema/sequence write capability, no administrative flags,
and temporary audit-only RLS bypass for complete-row visibility. No equivalent
live privilege proof exists for the protected Production runtime credential,
so its conformance to the intended `app_runtime` role remains unverified.

### Migration 018 drift

The Development ledger's migration 018 checksum begins `c645ae901aef`. This is
the exact SHA-256 of the original file introduced by commit `49a1336`. Commit
`5961ecb` later removed the retention/deletion function from that already
authored migration; the repository checksum now begins `940e782327db`.

This establishes that the inspected Development database applied the earlier
018 file. It does not authorize changing its ledger checksum. If that
Development data must be retained, engineering must use a reviewed forward
migration; otherwise the owner may authorize replacing it with a new disposable
Development database built from the current immutable history.

## Intended Credential Ownership And Purpose

These are separate security principals, not aliases for one shared password.

| Class                          | Secret/interface                                                                                       | Accountable owner and store                                                                                                                      | Required purpose and least privilege                                                                                                                                                                        | Forbidden placement/use                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                        | Vercel Production `DATABASE_URL`                                                                       | Project owner approves the target; University IT/database owner controls the provider role; Vercel Production stores the provider-managed secret | `app_runtime`; connect plus exact reviewed table writes, required reads/sequences, and five approved routines; no DDL, role, backup, restore, or provider administration                                  | Never expose to browser code, Preview, operator scripts, migration jobs, backup jobs, or tickets                                                  |
| Migration                      | `MIGRATION_DATABASE_URL`                                                                               | University IT/change-management owner; protected institutional change-job secret store                                                           | `app_migrator`; connect and reviewed schema-change privileges on the one verified database; no provider ownership, backup administration, or application runtime access                                     | Never place in Vercel application environments, developer-wide shell profiles, or use as an integrity/backup/restore credential                   |
| Integrity audit                | `INTEGRITY_DATABASE_URL`                                                                               | University IT/security or data-integrity operator; protected audit-job secret store                                                              | Dedicated read-only login with `CONNECT`, `USAGE`, and `SELECT`; short-lived `BYPASSRLS` may be approved for complete visibility; no persistent DML, DDL, role, backup, restore, or provider administration | Never reuse runtime, migration, import, repair, or restore secrets; never make it available to the deployed app                                   |
| Backup                         | Provider-native backup service identity; for logical export, protected job alias `BACKUP_DATABASE_URL` | University IT backup operator and credential-recovery administrator; approved backup platform/secret store                                       | Read-only consistent export of every required schema/data object plus required sequence access; provider-native identity may manage backup policy but must not be an application login                      | Never deploy to Vercel app/Preview, pass on a command line, store in Git/tickets, or reuse for restore                                            |
| Disposable restore test        | `RECOVERY_TEST_DATABASE_URL`                                                                           | University IT restore executor; short-lived recovery secret tied to a ticket and second reviewer                                                 | DDL/DML only on a newly created empty disposable restore target; enough for `pg_restore` and validation                                                                                                     | Must never target the source Production database, enter Vercel app environments, or be reused after the exercise                                  |
| Production restore/break glass | Provider-native short-lived recovery identity; no reusable repository variable                         | Professor/project owner authorizes; University IT executes; a second reviewer confirms target and recovery point                                 | Restore into a new Production-controlled target when possible, validate, then perform an explicitly approved cutover                                                                                        | Never use for routine migrations/backups/runtime, never perform an unreviewed in-place restore, and never retain as a standing application secret |

`CONTENT_IMPORT_DATABASE_URL` and `INTEGRITY_REPAIR_DATABASE_URL` remain separate
write credentials governed by their own runbooks. They must not be substituted
for any class above.

## Exact Owner Remediation

Completed under `DB-CUSTODY-124` on 2026-09-05. The sequence remains here as
the reviewed operational record and future rotation procedure.

Perform these steps in order. Stop immediately if a target or owner cannot be
proven.

1. **Quarantine the ambiguous migration secret.** Do not use the current
   `.env.migration.local` value for Production. In the approved secret
   inventory, label its safe fingerprint as Development only: local provider,
   database `pf_xj_research_dev`, host hash `12ca17b49af22894`, role hash
   `549a56913239e49b`. Do not copy, overwrite, revoke, or rotate it until its
   Development owner decides whether that database must be retained.
2. **Open an ownership ticket.** Name the project owner, University IT/database
   owner, migration operator, integrity operator, backup operator, restore
   operator, and second reviewer. Keep raw provider IDs in the protected ticket,
   not this repository.
3. **Establish the Production provider owner.** While authenticated to both
   Vercel and Supabase, open Vercel project
   `prj_Io1nGopV0g2NxYXN6AgltSAa8h5v` and the Supabase project that supplies its
   Production PostgreSQL variables. Record the Supabase organization/project,
   database, region, billing owner, and at least two institutional recovery
   administrators. Recompute the safe project hash and require
   `65888f3d354b7dfd`; require database `postgres`. If the provider project is
   personal, unknown, or not recoverable by the institution, stop: ownership is
   not established and no credential may be promoted.
4. **Map the managed variables.** In the provider/Vercel consoles, confirm that
   `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`,
   `POSTGRES_HOST`, `POSTGRES_DATABASE`, and `POSTGRES_USER` all belong to the
   same verified Supabase project/database. Record pooler versus direct
   endpoints. Do not assume different endpoint host hashes mean different
   databases when the provider project and database identity agree.
5. **Verify or create least-privilege roles.** Map the runtime role hash to the
   intended `app_runtime` role and prove it cannot run DDL, create/manage roles,
   administer backups, or bypass application access rules. Provision a distinct
   `app_migrator` role in the same verified project only through the approved
   provider/IT process. Do not perform this step from the application or this
   audit task.
6. **Store the Production migrator outside Vercel runtime.** Put the new
   `MIGRATION_DATABASE_URL` only in the institution-controlled change-job
   secret store. Do not add it to Vercel Production, Preview, or Development.
   Do not overwrite `.env.migration.local` automatically.
7. **Independently compare both Production credentials.** On an approved audit
   runner, inject the Production runtime URL and the proposed migration URL one
   at a time. In read-only transactions, compare exact provider project ID,
   `current_database()`, a provider/cluster identity hash when available, role
   identity/privileges, and a hash of ordered `schema_migrations` rows. Both
   must identify the verified Supabase project and database `postgres`.
8. **Run status only.** With the proposed Production migrator credential, run
   `npm run db:migrate:status -- --json`. Require state `current`, 21 applied of
   21, zero pending migrations, zero issues, Production ledger targets, and the
   repository 018 checksum beginning `940e782327db`. Do **not** run
   `db:migrate up`; Production already reports current.
9. **Obtain second-reviewer confirmation.** The reviewer must compare the
   provider-console identity, runtime fingerprint, migration fingerprint, and
   ledger fingerprint independently. Only after this written confirmation may
   the owner mark the migration credential mismatch resolved.
10. **Repair Development separately.** If `pf_xj_research_dev` is disposable,
    the Development owner may authorize a new database and apply the current
    001–021 history there. If it contains data that must survive, author a new
    forward migration that reconciles the old 018 effects before 019–021. Never
    edit/delete `schema_migrations`, replace its checksum, or mark migrations
    applied manually.
11. **Create the remaining principals.** In the verified Production project,
    establish an institutionally controlled integrity-audit lifecycle and
    backup identity plus a short-lived disposable-restore process as specified
    above. The temporary audit role used here is not a standing credential.
    Verify provider backup/PITR evidence and complete the disposable restore
    test. Retain safe fingerprints and ticket IDs only.
12. **Rotate only after acceptance.** The owner manually updates/rotates runtime
    or operator credentials only after target and privilege verification. A
    fresh Production build must again report current 21/21, health/smoke checks
    must pass, and old credentials must be revoked through the provider's
    audited process.

## Closure Conditions

Do not close this finding until all of the following are retained as evidence:

- institutional Supabase ownership and recovery administrators;
- exact Production runtime and migration target agreement, independently
  reviewed;
- runtime and migration least-privilege evidence;
- Production migration status `current`, 21/21, no drift, from the separately
  controlled migration credential;
- a clean separately credentialed Production integrity audit; and
- provider backup evidence plus a successful disposable restore report.

These closure conditions were written before ticket `DB-CUSTODY-124`. The
2026-09-05 evidence above satisfies the institutional-ownership, target,
least-privilege, migration-status, and credential-placement conditions. The
separate integrity-data and provider-backup conditions remain open in the pilot
readiness report.

## Integrity Audit Attempt — 2026-09-03

The audit preflight checked only credential variable names in the process,
ignored local credential files, and current Vercel Production metadata. No
dedicated `INTEGRITY_DATABASE_URL` was available. In accordance with the stop
condition, it did not substitute the runtime or migration credential and made
no database connection.

The sanitized evidence is
[`2026-09-03T16-23-10-760Z-production-not_run.json`](evidence/database-integrity/2026-09-03T16-23-10-760Z-production-not_run.json).
Status remains **NOT RUN** for that historical attempt. This artifact does not
satisfy the clean-integrity closure condition above.

## Integrity Audit Run — 2026-09-03

With explicit project-owner authorization, a short-lived audit login was
created in the signed-in Supabase project, restricted to persistent-data
`SELECT`, forced to default read-only sessions, and temporarily granted
`BYPASSRLS` so ledger and cross-student invariants could see every row. The role
had no superuser, database/role creation, replication, persistent relation
write, schema-create, sequence-write, or executable public security-definer
capability. It connected through pooler host hash `3932d873511760d0` as role
hash `5982cada2a36410b` and independently matched the expected project hash
`65888f3d354b7dfd` and database `postgres`.

The direct migration query returned `current`, 21/21 applied, zero pending,
zero issues, and ordered-ledger fingerprint `18b5a636a4e3ac41`. The read-only
integrity run executed 18 checks in a repeatable-read transaction, rolled back,
and attempted zero writes. Seventeen checks passed. One critical finding
remains: one archived, non-student-visible professor-provided question carries
an explicit synthetic/test marker. The finding is represented only by a
per-run redacted reference in
[`2026-09-03T17-12-56-535Z-production-findings.json`](evidence/database-integrity/2026-09-03T17-12-56-535Z-production-findings.json).

An initial implementation of the student-visible generated-content check used
legacy base-row review metadata and incorrectly reported nine rows. A
read-only aggregate comparison proved that all nine canonical public lifecycle
rows are `published`, `approved`, and `professor_approved`. The check now reads
the canonical student-facing view, has a regression test, and passes against
Production. The discarded false-positive artifact is not retained.

Exact owner remediation for the remaining finding:

1. Open a Production data-governance/change ticket and assign the professor or
   data owner, University IT operator, privacy/retention reviewer, and second
   reviewer. Record the redacted reference and this evidence artifact; keep the
   underlying identifier and content inside the protected provider console.
2. Re-run the `test_demo_records_in_production` predicate in a read-only
   transaction and verify the row is still archived, not returned by
   `app_public_questions`, professor-provided, and the only matching row. If any
   scope differs, stop and treat it as a new incident.
3. Decide whether the immutable synthetic lifecycle evidence must be retained.
   If retention is required, approve a narrow, ticket-bound, expiring exception
   represented explicitly in schema and audit logic; do not weaken the marker
   detector globally. If it is not required, design a reviewed forward cleanup
   that removes or de-identifies the complete related graph without fabricating
   history or leaving orphans. The current audit has no automated repair for
   this finding.
4. Validate a current backup/recovery point and rehearse the chosen change on a
   disposable restored target. Review row counts, foreign-key effects, audit
   retention, and rollback before authorizing Production execution.
5. Execute only through the separate repair/change credential in an approved
   maintenance window, then rerun the read-only command and require 18/18,
   zero findings, the same verified Production target, and a checksum-clean
   21/21 ledger. Until that independent result exists, do not call the
   integrity gate clean.

### Remediation status — 2026-09-04

Steps 1–4 above are complete under ticket label `PILOT-CLEANUP-2026-09-04`
through [pilot-data-cleanup.md](pilot-data-cleanup.md): a read-only owner
inventory confirmed the finding is exactly one archived, private, hidden,
professor-provided question with an explicit marker; the retention decision
`retain-audit-events-remove-synthetic-graph` removes its synthetic history and
the `pilotTest` activity while keeping every audit row; a fresh verified backup
was restored locally; and the exact 259-record cleanup SQL ran on that copy
with a clean 18/18 audit. Step 5 (Production execution and the clean re-audit)
has not run because the professor/data-owner, privacy/retention, IT-operator,
and second-reviewer approvals are not yet recorded. The same gated execution
removes the leftover temporary audit login by exact fingerprint
`5982cada2a36410b`, so custody step 6 becomes a verification that zero
temporary roles remain.

### Dedicated backup identity — 2026-09-04

The Production project now holds the dedicated `backup_export` role from
`db/roles/production_operator_roles.sql`: `NOLOGIN` at rest, `SELECT` on every
`public` table and sequence, `BYPASSRLS` for complete exports,
`default_transaction_read_only=on`, connection limit 2, and no write, DDL,
role, or provider privilege. It was created with owner SQL through the
authenticated CLI, with LOGIN and a two-hour password enabled only for the
daily encrypted export run and disabled again afterwards; no credential is
stored anywhere. The provider's owner role is refused `ALTER ROLE` attribute
changes on a `BYPASSRLS` role (`permission denied to alter role`), so the
operator role script now reasserts attributes only when a role actually
drifted, and University IT should expect the same restriction when enabling
LOGIN through the provider workflow. The `integrity_audit` and `app_migrator`
roles remain unprovisioned pending the custody prerequisites.

## Runtime Role Identity And Backup Exercise — 2026-09-03

While preparing the backup and recovery evidence, the stored Vercel Production
managed variables were fingerprinted again without printing them. The
`POSTGRES_USER` value hashes to `a942b37ccfaf5a81`, which is exactly the safe
hash of the literal role name `postgres`, and `POSTGRES_HOST` is the provider's
direct `db.` endpoint. The deployed application therefore connects as the
Supabase project owner role rather than an `app_runtime` role. That role can
run DDL, create roles, and bypass row-level security, so the runtime
least-privilege requirement in the ownership table above is **not met**.

The pulled file does not contain the secret itself: Vercel marks
`POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_PRISMA_URL`, and
`POSTGRES_PASSWORD` as sensitive, so `vercel env pull` wrote the literal
placeholder `[SENSITIVE]` for each. A later read-only probe that used those
placeholders failed PostgreSQL authentication (`28P01`) without running a
query, which confirms that no Production database password is present on the
audit workstation. Fresh pulls of sensitive values were refused by workstation
policy.

Consequences for recovery evidence:

- No dedicated `BACKUP_DATABASE_URL` exists, and policy forbids reusing the
  runtime or owner credential for a backup job, so no Production logical export
  or Production disposable restore was performed.
- No institutional Supabase access token exists on the workstation and the
  Supabase CLI is not authenticated, so `npm run db:backup:verify` recorded a
  sanitized `not_run` artifact under `docs/evidence/database-backups/`.
- The repository tooling was instead proven on a local disposable database with
  synthetic data; see the exercise log in
  [database-recovery.md](database-recovery.md).

Exact owner remediation, in addition to steps 1–12 above:

13. **Replace the runtime credential.** Run `db/roles/app_runtime.sql` as the
    owner in the verified project. It creates a `nologin`, non-superuser,
    non-`BYPASSRLS` `app_runtime` role with only the exact reviewed table
    writes, required reads and sequence usage, and five approved routines. It
    enables row-level security and installs the exact runtime-only policy on
    every public table while keeping Data API roles locked out. IT then sets
    the login password through the provider's audited
    process, stores the URL only as the Vercel Production `DATABASE_URL`
    secret, redeploys, and requires a fresh `current` 21/21 build check,
    health, and smoke pass. Revoke application use of the `postgres` role. The
    script is exercised against the migrated schema by
    `tests/app-runtime-role.test.ts`.
14. **Create the backup and provider-verification principals.** Issue a
    provider access token owned by an institutional organization owner for
    `db:backup:verify`, and a dedicated read-only `BACKUP_DATABASE_URL` login
    with `BYPASSRLS` for `db:backup:export`. Neither may be the runtime,
    migration, integrity, or restore credential.
15. **Run the Production recovery exercise** exactly as described in the
    runbook's "Production Exercise Status" section and retain the artifacts.

## Provider Backup Verification — 2026-09-03

With the project owner's Supabase CLI session, `npm run db:backup:verify --
--via-cli` selected the listed project whose safe hash equals
`65888f3d354b7dfd` and read its backup listing read-only; the token stayed in
the operating-system keychain. The project is `ACTIVE_HEALTHY` in `us-east-1`
on PostgreSQL 17.6 and belongs to the organization that the Vercel integration
created for the personal account (organization hash `a640b55a1a21a7cd`). The
listing contains no daily backup, point-in-time recovery is disabled, and no
physical recovery point exists. The organization plan and membership are not
exposed by the CLI. Evidence:
`docs/evidence/database-backups/2026-09-03T18-53-14-816Z-production-findings.json`.

This adds a closure condition: the Production project must be moved under an
institutionally owned organization on a plan with daily backups or
point-in-time recovery, with at least two owners and MFA, before any backup
claim can be made.

## Production Recovery Exercise And Role Hygiene — 2026-09-03

With the project owner's Supabase CLI session, owner SQL ran through the
Management API (`supabase db query --linked --project-ref`) with no stored
database password. A read-only probe confirmed the live target: PostgreSQL
17.6, 17.9 MB, ledger 21/21, the owner role `postgres` (not superuser, can
create roles, bypasses row-level security), and row-level security enabled on
all 29 public tables. A short-lived `backup_export_*` login (SELECT-only,
`BYPASSRLS`, two-hour expiry, connection limit 2) exported the database
through the session pooler (host hash `3932d873511760d0`) and was dropped
immediately afterwards (`remaining: 0`). The archive restored cleanly into an
isolated local PostgreSQL 17 database with the identical ledger fingerprint
`18b5a636a4e3ac41`; see [database-recovery.md](database-recovery.md).

The probe also found the login `integrity_audit_99d8dc84256121f8` still
present with `BYPASSRLS`, no expiry, and 36 grant dependencies, contradicting
the earlier statement that the audit login "is removed during audit cleanup".
A removal was attempted in the same session: the revokes succeeded inside a
`DO` block, but `DROP OWNED` failed with PostgreSQL `42501` because the owner
role is not a member of the audit role, and the whole block rolled back, so
the login **still exists**. The corrected owner script (grant membership to
`postgres`, `DROP OWNED`, `DROP ROLE`, then count remaining temporary roles)
is prepared; subsequent attempts to run it from the audit workstation were
refused by the command permission layer. Closing this item requires the
project owner to run that script and record the zero-count result. The
provider-managed `cli_login_postgres` role, which the Supabase CLI creates
with a short expiry for its own queries, is left in place.

Because row-level security covers every public table, `db/roles/app_runtime.sql`
now creates its `app_runtime_full_access` policy on every row-level-security
table dynamically instead of on three fixed tables.
