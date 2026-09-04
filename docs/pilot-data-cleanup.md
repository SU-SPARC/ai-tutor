# Production Pilot Data Cleanup

Date: 2026-09-04

Status: **REHEARSED AND GATED — the exact Production cleanup passed against a
disposable restore of a fresh verified backup and produced a clean 18/18
integrity audit on that copy. Production execution has not run because the
four named approvals have not been recorded.**

This runbook defines the only supported way to remove pre-pilot synthetic and
trial records from the Production database. It never deletes by pattern,
range, wildcard, or free-form predicate: every removed row is addressed by its
complete primary key from a reviewed manifest, and the transaction rolls back
if any count, catalog, ledger, trigger, or retained-history check differs from
that manifest.

## What the read-only inspection found (2026-09-04)

The inventory ran as owner SQL through the project owner's authenticated
Supabase CLI in a single read-only `SELECT`; the sanitized artifact is
`docs/evidence/pilot-data-cleanup/2026-09-04T21-46-37-542Z-production-inspected.json`.
Identifiers, names, and addresses stay in the protected manifest and never
enter evidence.

| Class                                          | Production state                                                                                                                                                             | Disposition                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Archived synthetic-marked question             | One archived, private, professor-provided question with an explicit `[SYNTHETIC PILOT]` marker; 1 immutable version, 1 lifecycle row, 6 lifecycle events, 1 inspection, 4 hints, 6 solution steps, 1 misconception, 1 `content_unpublished` session | Remove the complete graph                                  |
| `pilotTest` account                            | One human student account whose display name carries the Clerk `pilotTest` metadata; 5 sessions, 18 attempts, 4 AI reservations, 1 resolved feedback report, 1 account-created audit row; no academic history | Remove the account, its role, and its activity             |
| Synthetic tutor sessions and attempts          | 38 sessions and 126 attempts in total; all owned by the `pilotTest` account or by three staff accounts (project owner, course professor, one collaborator); zero anonymous sessions, zero claims, zero progress rows | Remove all 38 sessions and 126 attempts; retain the staff accounts |
| Synthetic feedback reports                     | One report, linked to a `pilotTest` session, with test-only text                                                                                                             | Remove                                                     |
| Demo/test analytics records                    | 44 AI usage counters (global, session, student, student-question scopes) and 10 AI response-cache rows, all dated 2026-08-25 to 2026-09-01; every student-scope key maps to a staff or `pilotTest` session through the reservation ledger | Remove by composite key                                    |
| Temporary database identities                  | One leftover `integrity_audit_*` login (`LOGIN`, `BYPASSRLS`, no expiry, no sessions, no owned objects); the provider-managed `cli_login_postgres` and `supabase_privileged_role` are not ours | Remove the leftover login; leave provider roles            |
| Unexpected unpublished or unapproved content   | 222 generated and 12 pattern-derived review candidates in `needs_review`, plus the one archived synthetic question; the candidates are the expected professor review queue    | Retain the review queue; only the synthetic question is unexpected |
| Professor-approved catalog                     | 9 published questions                                                                                                                                                        | Must remain byte-for-byte identical                        |

## Retention decision (requires approval)

`retain-audit-events-remove-synthetic-graph`:

- **Retained unchanged:** all 551 `audit_events` rows (append-only general
  audit log), the 21-row migration ledger, the 234 review-candidate questions
  with their 461 immutable versions and 954 lifecycle events, all topics, the
  9 published questions, and the six non-`pilotTest` user accounts. The five
  audit rows about the synthetic question and the `pilotTest` account-created
  row stay; PostgreSQL only clears the removed account's foreign-key pointer on
  that one row while its `actor_subject` snapshot remains.
- **Removed:** the synthetic question's own immutable history (version,
  lifecycle state, six lifecycle events, one inspection) because it is
  synthetic readiness evidence with no academic value and the integrity finding
  cannot close while it exists; the `pilotTest` identity; every pre-pilot
  session, attempt, reservation, feedback report, usage counter, and cache row.
- **Added:** exactly one `production_pilot_data_cleanup` audit row naming the
  ticket, retention decision, manifest and catalog fingerprints, and per-table
  removal counts, attributed to the active human professor recorded as actor.

Append-only guards on `question_versions`, `question_lifecycle_events`,
`question_version_inspections`, and `audit_events`, the lifecycle delete guard,
and the three version-recording triggers on question children are suspended
only inside the cleanup transaction, re-enabled before the post-conditions run,
and verified re-enabled before commit. Foreign-key enforcement is never
touched.

## Commands

All phases write sanitized evidence under `docs/evidence/pilot-data-cleanup/`
and read the expected Production fingerprint from `CUSTODY_EXPECTED_PROVIDER`,
`CUSTODY_EXPECTED_PROJECT_HASH`, and `CUSTODY_EXPECTED_DATABASE_NAME`. `plan`,
`rehearse`, and `execute` also require `PILOT_CLEANUP_CHANGE_TICKET`,
`PILOT_CLEANUP_RETENTION_DECISION`, and `PILOT_CLEANUP_ACTOR_USER_ID`.

1. **Inspect (read-only):** `npm run db:pilot-cleanup:inspect`.
2. **Plan (read-only):** `npm run db:pilot-cleanup:plan -- --manifest <path
   outside the repository> --synthetic-question-id <id>
   --pilot-test-user-id <id> --staff-trial-user-id <id> ...
   --temporary-role-hash <safe hash>`. The plan fails closed unless every
   synthetic question is archived, private, hidden from `app_public_questions`,
   and still marker-matching; every `pilotTest` account is human with zero
   academic, import, availability, claim, or grant references; every tutor
   session belongs to a listed identity; no anonymous session or claim exists;
   every student-scope usage key maps to a listed session owner; the actor is
   an active human professor who is not being removed; and every temporary
   role is fingerprint-matched, inactive, unowned, and non-administrative. It
   writes the explicit-identifier manifest with mode `0600` and prints its
   SHA-256 and the SHA-256 of the generated SQL.
3. **Backup and verify:** take `db:backup:daily` (or `db:backup:export`) for `production`, decrypt with the recovery key where applicable, and
   restore it with `db:recovery:test --restore` into an empty disposable
   target (see `database-recovery.md`). The restore evidence must be younger
   than 24 hours when the cleanup runs.
4. **Rehearse:** `PILOT_CLEANUP_REHEARSAL_DATABASE_URL=<disposable restore>
   npm run db:pilot-cleanup:rehearse -- --manifest <path>
   --confirm-manifest-sha256 <sha256> --backup-evidence <restore evidence>`.
   The rehearsal target must carry a disposable marker and can never be a
   provider-hosted database. The identical SQL runs statement by statement,
   the before/after inventories are compared with the manifest, and the full
   18-check integrity audit must be clean.
5. **Approve:** record four different named people with `true` attestations:
   `PILOT_CLEANUP_DATA_OWNER`, `PILOT_CLEANUP_PRIVACY_REVIEWER`,
   `PILOT_CLEANUP_IT_OPERATOR`, `PILOT_CLEANUP_SECOND_REVIEWER`, each with
   `<NAME>_APPROVED=true`. Only their safe fingerprints enter evidence.
6. **Execute:** `npm run db:pilot-cleanup:execute -- --manifest <path>
   --confirm-manifest-sha256 <sha256> --backup-evidence <restore evidence>
   --rehearsal-evidence <passed rehearsal> --confirm-production
   --confirm-project-hash <safe hash> --change-ticket <ticket>`. Execution
   refuses to start unless the rehearsal evidence names this manifest, this
   SQL hash, and the archive from the fresh backup; the live before-inventory
   must still equal the planned snapshot. The temporary role is removed in a
   second owner transaction only after the data transaction verified.
7. **Audit:** run `npm run db:integrity:audit:production` with a dedicated
   SELECT-only credential and require a clean 18/18 artifact under
   `docs/evidence/database-integrity/`.
8. **Retire:** drop the disposable target, securely delete the workstation
   archive copy after the post-cleanup audit passes, and record the deletion.

## Safety properties

- The manifest schema admits only complete primary keys with strict character
  classes; predicates, `LIKE`, regular expressions, ranges, and empty lists
  are rejected, and tests assert the generated SQL never contains them.
- One transaction with an advisory lock, bounded lock/statement timeouts, and
  `RAISE EXCEPTION` on any deviation: every table's row count must equal the
  planned snapshot before and the planned result after; every target row must
  exist before and be gone after; the published catalog array must be
  identical before and after; the migration ledger fingerprint must match;
  retained audit history must keep its row count and content hash; no marker
  question, marker user, `pilotTest` identity, or synthetic question may
  remain; every suspended guard must be re-enabled.
- The same manifest yields byte-identical SQL for rehearsal and execution, and
  execution compares the two hashes.
- Running the SQL twice is impossible: the second run fails its snapshot
  preconditions before any delete.
- Evidence contains counts, fingerprints, hashes, durations, and statuses only.

## 2026-09-04 exercise log

| Step                                                     | Result                                                                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read-only inspection                                     | 235 questions (9 published), 462 versions, 7 users, 38 sessions, 126 attempts, 44 usage rows, 10 cache rows, 1 feedback report, 551 audit rows, 1 leftover audit login; one marker question |
| Plan                                                     | 259 explicit records across 16 tables; manifest SHA-256 `d430a1604f92492cb94f966fafa430920fa654470255c6874b17321ffaa2b7c8`; SQL SHA-256 `422922d8f2650b1ba48b17f11012ad4dac1ef9f093b2dd0355bed7a61c712199` |
| Backup (`db:backup:export`, session pooler, short-lived role) | Recovery point `2026-09-04T21:43:27.855Z`; archive 826,300 bytes, SHA-256 `19688c50b9a3314e7133a0cc00ffb9049cae375752898b158c8a06fe40c6ec35`; export role dropped (`remaining: 0`)              |
| Restore into empty local PostgreSQL 17 target            | `pg_restore` 138 ms, 390 of 392 entries; validation valid; ledger `current` 21/21 fingerprint `18b5a636a4e3ac41`; 17/18 audit reproducing the known marker finding                            |
| Rehearsal of the exact SQL on the restored copy          | 21 ms; verification passed; after-state 234 questions, 461 versions, 6 users, 0 sessions, 552 audit rows (one cleanup row), 9 published unchanged; integrity audit **clean 18/18**             |
| Retire rehearsal target                                  | Disposable database dropped; archive retained under `0600` on the workstation as the recovery point until the Production cleanup and its post-audit complete                                   |
| Production execution                                     | **Not run** — awaiting the four named approvals                                                                                                                                              |

Retained evidence:

- `docs/evidence/pilot-data-cleanup/2026-09-04T21-46-37-542Z-production-inspected.json`
- `docs/evidence/pilot-data-cleanup/2026-09-04T21-47-08-661Z-production-planned.json`
- `docs/evidence/database-recovery/2026-09-04T21-43-34-196Z-production-exported.json`
- `docs/evidence/database-recovery/2026-09-04T21-45-09-058Z-production-passed.json`
- `docs/evidence/pilot-data-cleanup/2026-09-04T21-49-18-111Z-rehearsal-passed.json`

## Test evidence

`tests/pilot-data-cleanup.test.ts` builds the complete migration chain in an
embedded PostgreSQL database with a Production-shaped ledger, seeds a published
question, an archived synthetic question that went through the real lifecycle
procedures, a `pilotTest` student, a staff trial account, sessions, attempts,
usage counters, a reservation, a cache row, and a feedback report, then proves
the plan, the generated SQL, the exact counts, the intact catalog, the retained
audit history, the re-enabled guards, a clean 18/18 audit, the refusal to run
twice, the fail-closed plan for a real student session or a visible question,
manifest validation, four-person approvals, command gates, evidence freshness
links, and evidence sanitization.

```bash
npx vitest run tests/pilot-data-cleanup.test.ts
npm run test:migrations
```
