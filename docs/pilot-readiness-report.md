# Pilot Readiness Report

Date: 2026-09-03

Readiness evidence update: `Prove production backup and recovery` (current
report commit)

Production deployment reviewed: `dpl_6uwBiXu4VjgaXFfZp5rj4XTCoY6w` from
`b1162a2` at `https://ai-tutor-kananguliyevs-projects.vercel.app`

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

**Status: healthy runtime; credential ownership, runtime least privilege,
provider backup verification, and Production recovery acceptance incomplete.**

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
- The [credential-topology audit](database-credential-topology-audit.md)
  identifies the separately stored `MIGRATION_DATABASE_URL` as a local
  Development target, not Production. It connects to database
  `pf_xj_research_dev`; its ledger records target `development`, reports 18 of
  21 migrations, has 019–021 pending, and retains the original 018 checksum
  from commit `49a1336`. The current repository checksum changed in `5961ecb`.
  The inspected ledger was not edited and no migration was applied.
- The active Vercel Production runtime instead resolves the protected
  `POSTGRES_URL`. Safe managed metadata identifies Supabase project hash
  `65888f3d354b7dfd`, database `postgres`, and host hash
  `5b9942ef57aca05a`; the local Development migration target has database
  `pf_xj_research_dev` and host hash `12ca17b49af22894`. The different target is
  misconfigured if treated as the Production migrator, while its Development
  ledger is stale/drifted relative to the repository.
- Vercel Production contains no `MIGRATION_DATABASE_URL`, which preserves the
  application/migration separation. A separate audit credential directly
  verified the Production technical target as Supabase project hash
  `65888f3d354b7dfd`, database `postgres`, pooler host hash
  `3932d873511760d0`, and ledger fingerprint `18b5a636a4e3ac41`. However, the
  Vercel integration-resource listing was empty, no institutional Supabase
  ownership/recovery record or separately controlled Production migrator was
  available, and runtime privileges remain unverified. The correct Production
  migration credential and institutional provider ownership therefore remain
  unverified. The mismatch is **not resolved**.
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
- The runtime least-privilege finding stands: the runtime role hash
  `a942b37ccfaf5a81` is the hash of the literal role name `postgres` on the
  provider's direct host. The probe also showed row-level security enabled on
  all 29 public tables, so the committed `db/roles/app_runtime.sql` now adds
  its policy to every such table dynamically. A leftover
  `integrity_audit_…` login with `BYPASSRLS` and no expiry from the earlier
  audit session was found; the first removal attempt failed on a
  `DROP OWNED` privilege check and rolled back, and the corrected removal
  script awaits the project owner. The short-lived `backup_export_…` role
  from this exercise was dropped (`remaining: 0`).
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

| Gate                                      | Result                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Full Vitest suite                         | PASS — 80 files, 660 tests                                                                         |
| Lint                                      | PASS                                                                                               |
| TypeScript                                | PASS                                                                                               |
| Production build                          | PASS — Next.js 16.3.3, 23 pages generated                                                          |
| AI/retrieval/usage focused suite          | PASS — 8 files, 111 tests                                                                          |
| Migration/integrity focused suite         | PASS — 5 files, 45 tests                                                                           |
| Authorization focused suite               | PASS — 7 files, 91 tests                                                                           |
| Lifecycle/publication focused suite       | PASS — 7 files, 52 tests                                                                           |
| Student/professor workflow focused suite  | PASS — 7 files, 44 tests                                                                           |
| Release-candidate read-only smoke         | PASS — 5 checks                                                                                    |
| Current Production read-only smoke        | PASS — 5 checks; 9 published questions                                                             |
| Production database health                | PASS — HTTP 200, required and healthy                                                              |
| Production environment/runtime mode       | PASS — strict config parses; database-backed, demo not active                                      |
| Production deployment migration check     | PASS — current, 21/21, no drift                                                                    |
| Production credential topology audit      | **FAIL CLOSED** — stored migrator is Development; Production ownership/correct migrator unverified |
| Separate stored migration credential      | Development target — 18/21, pending 019–021, original 018 checksum                                 |
| Production error logs, post-deploy scan   | No error-level entries returned                                                                    |
| Production dependency audit               | PASS — 0 vulnerabilities after patch upgrade                                                       |
| Production Clerk test identities          | PASS — isolated student and professor roles marked `pilotTest`                                     |
| Controlled Production student E2E         | PASS — onboarding, tutor hierarchy, recovery, dashboard, feedback                                  |
| Controlled Production professor E2E       | PASS — auth, inspect, approve, publish, visibility, analytics, feedback                            |
| Controlled live AI fallback               | PASS — opt-in, bounded, no accepted-answer/provider leakage                                        |
| Controlled live approved retrieval        | PASS — related approved context precedes opt-in AI synthesis                                       |
| Controlled live rate/request boundaries   | PASS — friendly 429 on request 21; oversized request gets 413                                      |
| Public retrieval/private-content boundary | PASS — professor endpoint 401; public list metadata-only                                           |
| Production integrity audit                | **FINDING** — 17/18 pass; one archived, non-visible synthetic-marked question; sanitized evidence  |
| Production runtime least privilege        | **FINDING** — Vercel runtime credential is the provider owner role `postgres` on the direct host   |
| Recovery tooling focused suite            | PASS — 4 files, 22 tests                                                                           |
| Disposable restore drill (local, synthetic) | PASS — export, restore, validation, clean 18/18 audit, evidence retained, target retired         |
| Provider backup verification              | **CRITICAL FINDING** — no daily backup, PITR disabled, retention/ownership unverified              |
| Production backup/restore exercise        | PASS — logical export, isolated restore, clean validation, 17/18 audit (known finding), retired   |
| Institutional archive custody             | **NOT PROVEN** — no weekly logical copy under IT custody; provider holds no backup                 |
| Accessibility acceptance                  | **NOT PROVEN**                                                                                     |

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
- Institutional Production credential ownership, a clean integrity result,
  provider backup evidence, and a Production restore exercise remain absent;
  only a local synthetic tooling drill is retained, and the deployed runtime
  currently uses the provider owner database role.
- Student account lifecycle and support processes depend on Clerk operations;
  password and new-device verification pass, but recovery and revocation are
  not yet accepted.

## 13. Remaining blockers

1. Complete the owner steps in the
   [credential-topology audit](database-credential-topology-audit.md): establish
   institutional Supabase ownership, independently match runtime and migrator
   to the same Production project/database/ledger, and prove least privilege.
   Do not use or overwrite the inspected Development credential for
   Production.
2. Resolve the one archived synthetic-marker finding under a named
   data-governance/change ticket. Verify its exact scope in a read-only query;
   obtain professor/data-owner, retention/privacy, IT-operator, and
   second-reviewer approval; rehearse either a narrow explicit exception or a
   complete graph cleanup on a disposable restore; execute only with the
   separate approved change credential; then rerun
   `npm run db:integrity:audit:production` and require a clean 18/18 artifact.
3. Prove Production backup and recovery: first move the Supabase project to a
   plan with daily backups or enable point-in-time recovery under an
   institutionally owned organization, because the provider currently holds
   no backup of Production at all; record two institutional organization
   owners; run `npm run db:backup:verify -- --via-cli` until it exits `0`;
   until then take a `db:backup:export` archive daily; create a dedicated read-only
   `BACKUP_DATABASE_URL` login with `BYPASSRLS`; run
   `npm run db:backup:export -- --target production`; restore the archive into
   an isolated disposable target with `npm run db:recovery:test -- --restore
   --evidence-dir docs/evidence/database-recovery`; complete the operator
   comparisons; retire the target; and record measured RPO/RTO in the runbook.
   Replace the runtime credential with a least-privilege `app_runtime` role as
   part of the same change.
4. Record named privacy, security, accessibility, authentication, AI-provider,
   retention/deletion, incident-response, support, and pilot approvals.
5. Establish external monitoring/alerts and provider billing limits/alerts.
6. Complete accessibility acceptance and broader browser E2E in an isolated staging
   environment before Production promotion.

## 14. Deployment status

The active Production deployment `dpl_6uwBiXu4VjgaXFfZp5rj4XTCoY6w` is READY
at the hosting layer, serves the canonical alias, and was built from release
candidate `b1162a2`. Its build passed the 21/21 migration check with no drift,
the required Production database is healthy, the post-deployment five-check
smoke passes, and the reviewed post-deploy error-log scans returned no entries.

The build check used the Production `POSTGRES_URL` fallback because neither
`MIGRATION_DATABASE_URL` nor `DATABASE_URL` is scoped to Vercel Production. It
proves the active runtime ledger was current at build time; it does not prove
provider ownership, runtime least privilege, or that a separately controlled
Production migration credential targets the same database.

Hosting `READY` and a passing smoke test do not by themselves mean pilot-ready.

## 15. Explicit recommendation

**NOT READY**

Do not invite real students yet. The controlled student and professor flows,
publication gates, retrieval hierarchy, and usage controls pass in Production,
but Production database ownership and operator-credential topology are not
accepted. The stored migration credential is demonstrably a drifted
Development target, and no independently verified Production replacement is
available. The direct integrity audit completed but is not clean because one
archived synthetic-marker finding remains. A Production logical export was
restored into an isolated database, validated, and audited, which proves the
recovery path, but provider verification shows that Production has no daily
backup and no point-in-time recovery, no institutional custody of an archive
exists, and the deployed runtime uses the provider owner role. Accessibility
acceptance, monitoring, and external approvals also remain open.
Re-run this gate after every blocker in section 13 is closed; passing
application and deployment checks alone are insufficient.
