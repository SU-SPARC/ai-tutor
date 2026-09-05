# Pilot Readiness Report

Date: 2026-09-05

Readiness evidence update: `Establish production database custody` (current
report commit)

Production deployment reviewed: READY at the canonical alias
`https://ai-tutor-kananguliyevs-projects.vercel.app`.

Database-custody closure: ticket `DB-CUSTODY-124` is complete. Two independently
controlled institutional Supabase Owners have MFA, the named owner and second
reviewer authorized the change, four distinct least-privilege identities target
the same Production project/database and checksum-clean 21/21 ledger, and all
29 Production tables have RLS plus the reviewed `app_runtime` application
policy. Vercel Production now contains only the `app_runtime` `DATABASE_URL`;
migration, audit, and backup credentials are outside all Vercel application
environments. The exact temporary audit identity and former runtime owner
credential were revoked. The redeployed application is READY, required database
health passes, the five-check smoke passes, and its error-log scan is clean.
The consolidated sanitized [custody closure
artifact](evidence/database-custody/2026-09-05T21-19-15Z-production-passed.json)
contains fingerprints, roles, dates, counts, results, and the change-ticket
reference only.

This is an engineering readiness record, not a legal, institutional, privacy,
security, or accessibility approval.

## 1. Student experience status

**Status: live controlled student flow passes.**

The release candidate has automated coverage for authentication boundaries,
onboarding acknowledgement, topics, published-question selection, attempts,
deterministic and misconception feedback, incremental hints, retrieval, opt-in
AI fallback, durable recovery, dashboard progress, and question feedback.

Production now contains the server-enforced disclosure boundary: public pages
receive metadata and counts only, while an owned session receives only hints
and steps already revealed by the server. The post-deployment Production smoke
test passes all five checks, including the published-question detail boundary.

A dedicated synthetic student identity marked `pilotTest` completed password
sign-in and Clerk new-device verification without touching a real student
record. The live walkthrough verified every required onboarding notice point
and the minimal acknowledgement, topics, a published question, deterministic
incorrect and correct results, known-misconception feedback, all three hints,
explicit AI opt-in, generated guidance without a premature answer, session
recovery after reload/reselection, one completed and two resumable dashboard
records, and a protected question-feedback receipt.

Three initial controlled stuck requests exposed active-question chunks occupying
the two-result limit before the existing self-source filter ran. The deployed
fix now excludes the active question before ranking and limiting. A fresh
Production session returned a related approved club-membership union question
for the first explicit stuck request; only the second explicit request used AI
to synthesize next-step guidance. Neither response disclosed the accepted
answer or provider details.

## 2. Professor experience status

**Status: controlled live professor flow passes.**

A Production professor account explicitly supplied by the project owner
completed password sign-in, Clerk new-device verification, and server-enforced
professor authorization. The controlled mutation used only a clearly labeled
synthetic spinner question. AI analysis created an editable preview; all four
answer/solution/first-hint/topic consistency checks passed, duplicate review
found no match, and saving created a non-public immutable draft.

The professor submitted the draft for review, inspected the exact working
version, confirmed valid generated creation and professor-provided source
provenance, approved it, reviewed the exact publication change summary, and
published it. The public catalog and signed-in synthetic student UI both showed
the new question while continuing to hide answer fields. After visibility was
confirmed, the professor unpublished and archived only that synthetic record
with a cleanup reason. The public catalog returned to nine questions, while the
archived immutable record and attributable history remained available.

## 3. Database status

**Status: healthy least-privilege runtime; institutional database custody and
credential topology pass. Provider backup verification, archive custody, and
Production recovery acceptance remain incomplete.**

The repository now includes a gated custody operation and four-credential
read-only verifier. `db:custody:apply` cannot mutate Production without the
exact project fingerprint, a checksum-clean 21/21 ledger, institutional
ownership, at least two MFA recovery administrators, distinct named owner and
second-reviewer confirmations, a matching ticket, and explicit Production
confirmation. The two administrators and institutional organization are
retained only as safe fingerprints. `db:custody:verify` requires four distinct
least-privilege roles, identical target and ledger fingerprints, complete
RLS/application-policy
coverage, Data API lockout, and names-and-scopes-only proof that operator
credentials are absent from every Vercel application environment. The
post-rotation phase additionally requires legacy owner credentials to be absent
and `DATABASE_URL` to be Production-only. Ticket `DB-CUSTODY-124` satisfied
those controls and the required external authorization.

- The public, non-cached Production database health endpoint returned HTTP 200
  with `status: healthy`, `database.required: true`, and database status
  `healthy` (22 ms observed latency). Its only fields are aggregate status and
  latency, and its response is marked `Cache-Control: no-store`.
- Because the live health route resolves the strict server environment before
  reporting `database.required: true`, the active Production runtime is
  database-backed rather than demo-backed and its required environment schema
  parses successfully.
- The active Production deployment build ran `db:migrate:check` successfully
  and reported `current`, with 21 of 21 migrations applied and no checksum
  drift.
- The [credential-topology audit](database-credential-topology-audit.md) now
  closes the former Development/Production mismatch. Fresh, distinct
  `app_runtime`, `app_migrator`, `integrity_audit`, and `backup_export`
  credentials each connected independently to project fingerprint
  `65888f3d354b7dfd`, database `postgres`, pooler host fingerprint
  `3932d873511760d0`, and ledger fingerprint `18b5a636a4e3ac41`. The unrelated
  local Development database and its ledger were not changed or promoted.
- The Production runtime role has no superuser, role, database, replication,
  schema-create, object ownership, security-definer, or RLS-bypass capability.
  It has only the reviewed table/sequence/routine access. The migrator owns the
  34 application relations and 31 routines but has no provider administration;
  the audit and backup roles are default-read-only and have no write or DDL
  privilege. All four role inspections reported zero violations.
- Migration, integrity-audit, and backup credentials are retained only in the
  protected GitHub Production operator environment. Vercel contains none of
  them and retains only the Production-scoped runtime `DATABASE_URL`. The old
  owner-backed variables were removed, the provider-owner password was changed,
  and an old immutable deployment can no longer reach the database.
- The repeatable Production integrity command now requires the expected
  provider/project/database fingerprint, proves the login has no effective
  write/DDL/admin privileges, verifies the checksum ledger, rolls back its
  read-only snapshot, hashes every sampled record reference, and covers 18
  integrity classes including foreign keys, required owners, immutable version
  links, sessions, feedback, AI accounting, idempotency, publication state, and
  cross-student ownership.
- The first audit attempt had no dedicated credential, exited `3` without a
  connection, and retained the historical sanitized
  [`not_run` evidence](evidence/database-integrity/2026-09-03T16-23-10-760Z-production-not_run.json).
  A later explicitly authorized short-lived audit login matched the expected
  Production fingerprint, attested default-read-only and zero persistent
  write/admin capabilities, read the complete 21/21 checksum-clean ledger, and
  ran all 18 checks in a rolled-back repeatable-read transaction. The sanitized
  [`findings artifact`](evidence/database-integrity/2026-09-03T17-12-56-535Z-production-findings.json)
  reports 17 passed checks and one critical finding: one archived,
  non-student-visible professor-provided question with an explicit
  synthetic/test marker. The audit is complete but **not clean**.
- The initial live run falsely classified nine published generated questions
  by reading legacy base-row metadata. Read-only comparison showed the
  canonical student-facing lifecycle view marks all nine `published`,
  `approved`, and `professor_approved`. The corrected check reads that view, a
  regression test covers the distinction, and the rerun reports zero
  student-visible generated drafts.
- Migration/integrity workflow tests passed: 45 tests across five files.
- The application runtime credential is not used as an operator migration or
  integrity credential. Neither the runtime `POSTGRES_URL` nor the drifted
  Development migrator was substituted for the missing audit credential.
- The [backup and recovery runbook](database-recovery.md) now has named
  engineering ownership, explicit vacancies for the professor, provider owner,
  backup operator, and restore executor roles, a rollback procedure, retirement
  steps, and three commands: `db:backup:verify` (provider configuration through
  the Supabase Management API), `db:backup:export` (read-only custom-format
  export with a sanitized manifest and recovery point), and `db:recovery:test`
  (disposable restore, ledger/table/constraint/referential/sequence validation,
  the full 18-check integrity audit, RPO/RTO measurement, and evidence). The
  recovery-tooling suite passes: 4 files, 22 tests.
- A disposable restore drill ran on 2026-09-03 against a local, migration-built
  database seeded with public-safe content and synthetic student state only.
  The export took 91 ms, the `pg_restore` into an empty disposable target took
  143 ms, validation took 30 ms, the integrity audit on the restored copy was
  clean 18/18, and the whole automated exercise took 219 ms, within the 24 h
  RPO and RTO objectives. The retained
  [export manifest](evidence/database-recovery/2026-09-03T17-55-32-486Z-test-exported.json)
  and [restore evidence](evidence/database-recovery/2026-09-03T17-55-32-911Z-test-passed.json)
  contain hashes, counts, and durations only. Both drill databases and archives
  were deleted afterwards.
- Provider backup verification first recorded a sanitized
  [`not_run` artifact](evidence/database-backups/2026-09-03T17-51-58-450Z-production-not_run.json)
  because no access token existed. After the project owner authenticated the
  Supabase CLI, `db:backup:verify --via-cli` matched the listed project to the
  expected fingerprint and read its backup listing without the token entering
  the process. The retained
  [findings artifact](evidence/database-backups/2026-09-03T18-53-14-816Z-production-findings.json)
  shows the project healthy in `us-east-1` on PostgreSQL 17.6, but with **no
  daily provider backup listed, point-in-time recovery disabled, and no
  physical recovery point**. The organization plan and membership are not
  readable through the CLI, so retention and institutional ownership remain
  unverified. **Production has no provider-managed backup today**; the only
  recoverable copy would be a logical export, and none has been taken.
- A **Production disposable restore passed** on 2026-09-03. With no stored
  database password (the Vercel-pulled file holds only `[SENSITIVE]`
  placeholders), owner SQL ran through the project owner's authenticated
  Supabase CLI to create a two-hour SELECT-only backup role, the repository
  export took an 826 KB custom-format archive through the session pooler in
  6.1 s (ledger `current` 21/21, fingerprint `18b5a636a4e3ac41`), the role was
  dropped, and the archive was restored into an empty local PostgreSQL 17.11
  database in 178 ms. Validation passed (identical ledger fingerprint, 21
  critical tables, referential and sequence checks clean) and the 18-check
  integrity audit on the restored copy reproduced exactly the one known
  archived synthetic-marker finding. The whole automated exercise took 254 ms
  with a recovery-point age of 148 s; the target and archive were retired and
  the evidence hashes cross-checked. Retained:
  [export manifest](evidence/database-recovery/2026-09-03T19-45-58-772Z-production-exported.json)
  and [restore evidence](evidence/database-recovery/2026-09-03T19-48-20-975Z-production-passed.json).
  Production row counts on the restored copy: 235 questions, 462 immutable
  versions, 38 tutor sessions, 126 attempts, 7 users, 551 audit events.
- The former runtime owner role finding is closed: Production uses role hash
  `dd2b2aae3ec674b6` (`app_runtime`) and the legacy owner password is revoked.
  The exact reviewed temporary audit role fingerprint `5982cada2a36410b` was
  removed in a narrow operation after proving zero sessions, owned objects,
  owned databases, and unexpected memberships; zero temporary audit identities
  remain. All 29 public tables have RLS and the application policy.
- The pre-pilot data cleanup was prepared on 2026-09-04 without touching
  Production data: a single read-only owner `SELECT` inventoried one archived
  synthetic-marked question, one `pilotTest` student account, 38 staff and
  synthetic sessions with 126 attempts, 44 AI usage counters, 10 cache rows,
  one test feedback report, and the leftover temporary audit login; every
  session owner is a known staff or synthetic identity and no anonymous
  session, claim, or real student record exists. The plan enumerates 259
  records by primary key, a fresh Production export was restored and
  validated locally, and the exact cleanup SQL ran on that copy in 21 ms
  leaving the nine published questions, all 551 audit rows, and every review
  candidate intact with a clean 18/18 audit. Production execution waits for
  the four named approvals; see [pilot-data-cleanup.md](pilot-data-cleanup.md).
- Backup custody was established on 2026-09-04 as far as engineering can take
  it: a dedicated read-only `backup_export` identity now exists in Production
  (`NOLOGIN` at rest, `SELECT`-only, `BYPASSRLS`, read-only default, login
  enabled only for a run with a two-hour password); `db:backup:daily` produced
  an encrypted logical export (X25519/AES-256-GCM envelope to a recovery key
  the backup host cannot use) into an append-only custody ledger;
  `db:backup:status` automatically detects stale, missing, failed, corrupted,
  mis-keyed, unowned, or unpruned exports and inactive provider backups; the
  archive was decrypted with the recovery key and restored into an isolated
  disposable target with valid migrations, tables, constraints, references,
  sequences, and the complete integrity audit (17/18, known finding); the
  target and every plaintext copy were retired. Provider verification was
  rerun and still shows **no provider-managed backup**, the archive custody
  store is an interim workstation location, and a named backup operator and
  RPO/RTO acceptance are still unrecorded; see
  [database-recovery.md](database-recovery.md).
- Recovery readiness for Production is therefore **partially proven**: the
  logical export path restores and validates, but the provider holds no
  backup, no institutional custody of a weekly archive exists yet, and the
  operator comparisons and RPO/RTO acceptance are not signed. Those remain
  launch blockers.

## 4. Question/publication status

**Status: automated and controlled live lifecycle gates pass.**

Automated tests prove that `needs_review`, rejected, approved-but-unpublished,
inactive-topic, untrusted, and invalid generated questions remain hidden;
publication requires the active immutable version and provenance/readiness
gates; generated content keeps its generated provenance; and reviewer actions
remain attributable.

The public Production list returns nine published questions with safe summary
fields. The deployed detail endpoint omits `answer`, hint bodies,
`solutionSteps`, and `misconceptions`; the post-deployment smoke test verifies
that boundary. The controlled synthetic lifecycle proved draft and approved
states remained hidden, exact-version inspection and provenance preceded
approval, publication required a separate preview/confirmation, and archival
removed student visibility without deleting immutable history.

## 5. Authentication status

**Status: controlled student and professor authentication accepted.**

Signed-out dashboard access redirects to sign-in, signed-out professor API
access is denied, student-owned resources are owner-scoped, and professor pages
and APIs enforce the professor role. A signed-in Production professor session
worked across the reviewed professor pages. Credentials and secrets remain in
Clerk/Vercel server configuration rather than application responses.

Production Clerk now has separate synthetic student and professor identities
marked with `pilotTest` metadata and the appropriate role. The student password
flow completed Clerk's new-device verification at a masked
administrator-owned alias. A project-owner-supplied professor account also
completed password and new-device verification and reached professor-only
pages and mutations. No identity details or credentials are retained in this
report, and no institutional approval of the Production Clerk configuration is
asserted.

## 6. AI/retrieval status

**Status: controlled live hierarchy passes.**

The tutor hierarchy remains deterministic tutor, approved retrieval, then
explicitly opted-in LLM fallback. Retrieval relevance/topic/source boundaries,
private safe-summary handling, prompt budgets, structured output, provider
timeouts/retries, guardrails, generic outage behavior, and deterministic
fallbacks passed the focused AI suite. Raw private source material and accepted
answers are excluded from pre-disclosure prompts and student DTOs.

The configured provider and model were not changed. Controlled live opt-in AI
calls returned concise conceptual guidance, did not reveal the accepted answer,
and did not expose provider, billing, or token-accounting details. The UI did
not enter the LLM path until deterministic hints were exhausted and a retrieval
attempt had occurred. The failed retrieval cases exposed a top-result starvation
defect: the active question's own chunks consumed the result limit before
self-source exclusion. The deployed release now performs that exclusion before
ranking/limiting and preserves approved retrieval guidance if the provider then
fails. A fresh Production session confirmed deterministic hints, approved
retrieval, then opt-in AI in that order. No institutional provider/data-processing
approval is asserted.

## 7. AI cost-control status

**Status: durable application controls pass; provider financial controls not proven.**

The 111-test focused AI suite covers per-student accounting, per-session and
per-student/question limits, optional daily allowance, atomic reservation and
settlement, one pending generation per session, input/output bounds, burst rate
limits, cache isolation/expiry, kill switch behavior, retries, concurrency, and
friendly unavailable/exhausted responses. Production lists the required
server-only AI usage secret, timeout, model/provider, output-token limit, kill
switch, and general rate-limit configuration names. Sensitive values were not
read or logged.

A bounded, write-free Production probe reached the application limiter on
request 21 and received HTTP 429 with `TUTOR_RATE_LIMITED`, a friendly message,
and `Retry-After`; a separate oversized synthetic request was rejected with
HTTP 413 and `TUTOR_REQUEST_TOO_LARGE` before processing. These live checks
confirm the deployed general tutor rate and request-size boundaries.

The daily allowance is optional and was not listed as configured; durable
session/question and burst defaults therefore remain the enforced allowance
controls. Provider billing reconciliation, a monetary ceiling, and billing
alerts are not evidenced.

## 8. Privacy/data-minimization status

**Status: code and deployed disclosure controls pass; governance incomplete.**

Owner-isolation tests cover tutor sessions, progress, feedback, and professor
endpoints. Onboarding stores only the first acknowledgement timestamp. Feedback
omits reporter identity from professor DTOs. Analytics/export uses pseudonymous
participant keys and minimum necessary aggregate fields. Logs and AI usage use
redacted or HMAC-scoped identifiers, and tests reject prompt, answer, provider,
private-context, and secret leakage.

The deployed release closes the pre-disclosure browser leak and includes the
privacy-minimized analytics export. Approved retention/deletion policy, data
inventory, third-party processing decisions, and production backup evidence
remain external blockers.

The public question list returned nine metadata-only records with no answer,
hint, solution, misconception, raw-text, or source-title fields and no private
source signals. The direct retrieval-search endpoint returned HTTP 401 without
a professor session.

## 9. Feedback workflow status

**Status: controlled live student and professor workflow passes.**

Student and professor tests cover all report categories, owned session and
question-version linkage, minimal receipt, abuse limits, professor-only queue,
status/resolution notes, reporter redaction, and the rule that feedback never
automatically edits published content. The receipt acknowledges submission
without promising an outcome.

A synthetic student submitted a `technical_problem` report linked to the active
question/session with a clearly labeled test-only note and no personal data.
Production returned “Report received. Thank you for flagging it.” without
promising an outcome. The professor queue showed one protected report tied to
the exact tutor session and immutable question version, without reporter
identity. The professor recorded a test-only resolution note and changed the
status to resolved; a reload confirmed zero open and one resolved report. No
question content or publication state changed.

## 10. Analytics status

**Status: controlled live student and professor analytics pass.**

Student dashboard, professor class analytics, pseudonymous student drill-down,
and privacy-conscious CSV export tests pass and are present in the Production
deployment. The live synthetic dashboard showed one completed question, two
in-progress questions, twelve hints, two retry items, two topics started, and
resumable recent sessions. The professor student list exposed stable
pseudonyms—not names, email addresses, or device identifiers—and the synthetic
student detail reconciled to four sessions, eleven attempts, one correct
answer, twelve hints, and two topic rows. Aggregate class analytics loaded from
the database and separated rule, retrieval, LLM, and blocked tutor paths without
student identifiers.

## 11. Test results

| Gate                                        | Result                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Full Vitest suite                           | PASS — 86 files, 696 tests                                                                         |
| Lint                                        | PASS                                                                                               |
| TypeScript                                  | PASS                                                                                               |
| Production build                            | PASS — Next.js 16.3.3, 23 pages generated                                                          |
| AI/retrieval/usage focused suite            | PASS — 8 files, 111 tests                                                                          |
| Migration/integrity focused suite           | PASS — 7 files, 60 tests                                                                           |
| Authorization focused suite                 | PASS — 7 files, 91 tests                                                                           |
| Lifecycle/publication focused suite         | PASS — 7 files, 52 tests                                                                           |
| Student/professor workflow focused suite    | PASS — 7 files, 44 tests                                                                           |
| Release-candidate read-only smoke           | PASS — 5 checks                                                                                    |
| Current Production read-only smoke          | PASS — 5 checks; 18 published questions                                                            |
| Production database health                  | PASS — HTTP 200, required and healthy                                                              |
| Production environment/runtime mode         | PASS — strict config parses; database-backed, demo not active                                      |
| Production deployment migration check       | PASS — current, 21/21, no drift                                                                    |
| Production credential topology audit        | PASS — four distinct roles, same target and 21/21 ledger, zero violations                           |
| Separate stored operator credentials        | PASS — migration/audit/backup only in protected GitHub Production environment                      |
| Production error logs, post-deploy scan     | No error-level entries returned                                                                    |
| Production dependency audit                 | PASS — 0 vulnerabilities after patch upgrade                                                       |
| Production Clerk test identities            | PASS — isolated student and professor roles marked `pilotTest`                                     |
| Controlled Production student E2E           | PASS — onboarding, tutor hierarchy, recovery, dashboard, feedback                                  |
| Controlled Production professor E2E         | PASS — auth, inspect, approve, publish, visibility, analytics, feedback                            |
| Controlled live AI fallback                 | PASS — opt-in, bounded, no accepted-answer/provider leakage                                        |
| Controlled live approved retrieval          | PASS — related approved context precedes opt-in AI synthesis                                       |
| Controlled live rate/request boundaries     | PASS — friendly 429 on request 21; oversized request gets 413                                      |
| Public retrieval/private-content boundary   | PASS — professor endpoint 401; public list metadata-only                                           |
| Production integrity audit                  | **FINDING** — 17/18 pass; one archived, non-visible synthetic-marked question; sanitized evidence  |
| Pre-pilot data cleanup                      | **REHEARSED** — explicit 259-record plan, fresh verified backup, exact SQL clean 18/18 on restored copy; Production execution gated on four named approvals |
| Production runtime least privilege          | PASS — only Production `DATABASE_URL`, connected role `app_runtime`, owner credential revoked      |
| Recovery tooling focused suite              | PASS — 4 files, 22 tests                                                                           |
| Disposable restore drill (local, synthetic) | PASS — export, restore, validation, clean 18/18 audit, evidence retained, target retired           |
| Provider backup verification                | **CRITICAL FINDING** — no daily backup, PITR disabled, retention/ownership unverified              |
| Production backup/restore exercise          | PASS — logical export, isolated restore, clean validation, 17/18 audit (known finding), retired    |
| Daily encrypted export and custody detection | PASS — dedicated identity, encrypted export, ledger, status findings only for provider/ownership |
| Encrypted archive decrypt and restore       | PASS — recovery-key decrypt, isolated restore, valid ledger/tables/references/sequences, 17/18 audit |
| Institutional archive custody               | **PARTIAL** — two MFA provider owners pass; institutional archive store, operator, and acceptance unrecorded |
| Accessibility acceptance                    | **NOT PROVEN**                                                                                     |

The smoke command is:

```sh
PILOT_BASE_URL=https://example.edu npm run pilot:smoke
```

It is read-only and verifies database health, published list/detail privacy,
signed-out dashboard protection, and signed-out professor API denial. Local
testing may set `PILOT_REQUIRE_DATABASE=false`; Production must not.

## 12. Known limitations

- There is no complete browser E2E suite or automated accessibility suite.
- Production load, multi-region behavior, provider outage exercises, and
  identity-rotation abuse testing are not retained as operational evidence.
- Private upload processing still requires an institution-approved durable
  storage/processing design before that feature is used with private material.
- External error alerting, dashboards, billing alerts, rollback automation, and
  a tested pilot shutdown procedure are not proven.
- A clean integrity result, provider-managed backup evidence, institutional
  archive custody, and signed Production recovery objectives remain absent.
  Database provider custody and the deployed least-privilege runtime are now
  established.
- Student account lifecycle and support processes depend on Clerk operations;
  password and new-device verification pass, but recovery and revocation are
  not yet accepted.

## 13. Remaining blockers

1. Execute the rehearsed pre-pilot data cleanup in
   [pilot-data-cleanup.md](pilot-data-cleanup.md). The read-only inspection,
   the 259-record explicit-identifier plan, a fresh verified backup, and a
   rehearsal of the exact SQL on a disposable restore (clean 18/18 on the
   copy) are complete under ticket label `PILOT-CLEANUP-2026-09-04`. Record
   four different named approvals (professor/data owner, privacy/retention
   reviewer, IT operator, independent second reviewer), take a fresh backup
   if the retained one is older than 24 hours, run
   `npm run db:pilot-cleanup:execute`, then rerun
   `npm run db:integrity:audit:production` with a SELECT-only credential and
   require a clean 18/18 artifact.
2. Close Production backup custody: move the Supabase project to a plan with
   daily backups or point-in-time recovery under an institutionally owned
   organization and rerun `npm run db:backup:verify -- --via-cli` until it
   exits `0`; move the custody store, recovery key, and the scheduled
   `ops/backup/backup-daily.sh` job to University IT with
   `BACKUP_INSTITUTIONAL_OWNER_1/2` and `BACKUP_OPERATOR` recorded so
   `npm run db:backup:status` exits `0`; have University IT issue the
   permanent `backup_export` credential into its secret store; and run
   `npm run db:recovery:accept` with a named professor or IT acceptor against
   the retained passed restore artifact. The tooling, the dedicated identity,
   the daily encrypted export, detection, and the disposable restore are
   already proven; see [database-recovery.md](database-recovery.md). The
   provider project already has two institutional recovery administrators with
   MFA and a separate least-privilege `backup_export` identity.
3. Record named privacy, security, accessibility, authentication, AI-provider,
   retention/deletion, incident-response, support, and pilot approvals.
4. Establish external monitoring/alerts and provider billing limits/alerts.
5. Complete accessibility acceptance and broader browser E2E in an isolated staging
   environment before Production promotion.

## 14. Deployment status

The 2026-09-05 Production custody deployment is READY at the hosting layer and
serves the canonical alias. Its build passed the 21/21 migration check with no
drift, the required Production database is healthy through `app_runtime`, the
post-deployment five-check smoke passes, and the reviewed post-deploy
error-log scan returned no entries.

The build and runtime use only the Production-scoped `DATABASE_URL`.
`MIGRATION_DATABASE_URL`, `INTEGRITY_DATABASE_URL`, and
`BACKUP_DATABASE_URL` are absent from Vercel and retained only in the protected
operator environment. The four direct credential probes independently proved
one Production target and ledger before the former owner credential was
revoked.

Hosting `READY` and a passing smoke test do not by themselves mean pilot-ready.

## 15. Explicit recommendation

**NOT READY**

Do not invite real students yet. The controlled student and professor flows,
publication gates, retrieval hierarchy, and usage controls pass in Production,
and Production database custody, credential separation, and runtime least
privilege now pass. The direct integrity audit completed but is not clean because one
archived synthetic-marker finding remains; its explicit-identifier cleanup is
planned, backed up, and rehearsed cleanly, and waits only for the four named
approvals before Production execution. A Production logical export was
restored into an isolated database, validated, and audited, which proves the
recovery path, and a daily encrypted export under a custody ledger with
automatic staleness detection now runs from a dedicated read-only identity,
but provider verification shows that Production still has no daily backup and
no point-in-time recovery, archive custody remains an interim workstation
location without an accepted operator workflow, and recovery objectives remain
unsigned. Accessibility
acceptance, monitoring, and external approvals also remain open.
Re-run this gate after every blocker in section 13 is closed; passing
application and deployment checks alone are insufficient.
