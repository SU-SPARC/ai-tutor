# Pilot Readiness Report

Date: 2026-09-01

Release candidate: `Complete real student pilot readiness` (current report
commit)

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

**Status: healthy runtime; recovery acceptance incomplete.**

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
- The repository's separately stored `MIGRATION_DATABASE_URL` does not target
  the same current ledger: it reports 18 of 21 migrations, three pending files,
  and checksum drift for migration 018. That credential must not be used for
  Production operations until its target and ownership are reconciled. No
  migration was applied during this review.
- Migration workflow tests passed: 36 tests across four files.
- The application runtime credential is not used as an operator migration or
  integrity credential. A separately controlled `INTEGRITY_DATABASE_URL` was
  not available, so a direct read-only Production integrity audit was not run.
- Provider backup existence and a disposable restore exercise have no retained
  evidence. This is a launch blocker.

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

| Gate                                     | Result                                                         |
| ---------------------------------------- | -------------------------------------------------------------- |
| Full Vitest suite                        | PASS — 76 files, 634 tests                                     |
| Lint                                     | PASS                                                           |
| TypeScript                               | PASS                                                           |
| Production build                         | PASS — Next.js 16.3.3, 23 pages generated                      |
| AI/retrieval/usage focused suite         | PASS — 8 files, 111 tests                                      |
| Migration focused suite                  | PASS — 4 files, 36 tests                                       |
| Authorization focused suite              | PASS — 7 files, 91 tests                                       |
| Lifecycle/publication focused suite      | PASS — 7 files, 52 tests                                       |
| Student/professor workflow focused suite | PASS — 7 files, 44 tests                                       |
| Release-candidate read-only smoke        | PASS — 5 checks                                                |
| Current Production read-only smoke       | PASS — 5 checks; 9 published questions                         |
| Production database health               | PASS — HTTP 200, required and healthy                          |
| Production environment/runtime mode      | PASS — strict config parses; database-backed, demo not active  |
| Production deployment migration check    | PASS — current, 21/21, no drift                                |
| Separate maintenance credential check    | **FAIL** — 18/21 and migration 018 checksum drift              |
| Production error logs, post-deploy scan  | No error-level entries returned                                |
| Production dependency audit              | PASS — 0 vulnerabilities after patch upgrade                   |
| Production Clerk test identities         | PASS — isolated student and professor roles marked `pilotTest` |
| Controlled Production student E2E        | PASS — onboarding, tutor hierarchy, recovery, dashboard, feedback |
| Controlled Production professor E2E      | PASS — auth, inspect, approve, publish, visibility, analytics, feedback |
| Controlled live AI fallback              | PASS — opt-in, bounded, no accepted-answer/provider leakage    |
| Controlled live approved retrieval       | PASS — related approved context precedes opt-in AI synthesis   |
| Controlled live rate/request boundaries  | PASS — friendly 429 on request 21; oversized request gets 413  |
| Public retrieval/private-content boundary | PASS — professor endpoint 401; public list metadata-only       |
| Production integrity audit               | **NOT RUN** — separate read-only audit credential unavailable  |
| Backup/restore exercise                  | **NOT PROVEN**                                                 |
| Accessibility acceptance                 | **NOT PROVEN**                                                 |

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
- Direct Production integrity, backup, and restore evidence is absent.
- Student account lifecycle and support processes depend on Clerk operations;
  password and new-device verification pass, but recovery and revocation are
  not yet accepted.

## 13. Remaining blockers

1. Run the separately credentialed read-only Production integrity audit.
2. Verify provider backups and complete a disposable restore/rollback exercise.
3. Record named privacy, security, accessibility, authentication, AI-provider,
   retention/deletion, incident-response, support, and pilot approvals.
4. Establish external monitoring/alerts and provider billing limits/alerts.
5. Complete accessibility acceptance and broader browser E2E in an isolated staging
   environment before Production promotion.

## 14. Deployment status

The active Production deployment `dpl_6uwBiXu4VjgaXFfZp5rj4XTCoY6w` is READY
at the hosting layer, serves the canonical alias, and was built from release
candidate `b1162a2`. Its build passed the 21/21 migration check with no drift,
the required Production database is healthy, the post-deployment five-check
smoke passes, and the reviewed post-deploy error-log scans returned no entries.

Hosting `READY` and a passing smoke test do not by themselves mean pilot-ready.

## 15. Explicit recommendation

**NOT READY**

Do not invite real students yet. The controlled student and professor flows,
publication gates, retrieval hierarchy, and usage controls pass in Production,
but the direct integrity audit, backup/restore evidence, accessibility
acceptance, monitoring, and external approvals remain open. In particular,
backup and restore evidence is required before accepting data-loss risk. Re-run
this gate after every blocker in section 13 is closed; passing application and
deployment checks alone are insufficient.
