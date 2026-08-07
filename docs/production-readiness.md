# Production Readiness

> **Current decision: not production-ready.**
>
> The application is a well-tested demo foundation. A production or real-student
> pilot must not begin until the critical acceptance criteria in this document
> are satisfied and the required institutional decisions are recorded.

Last audited: 2026-07-31

Maintainer: project engineering team

Audit baseline: `e310048`

## How To Maintain This Document

- Update the audit date, task table, and checklist when a production-transition
  prompt is completed.
- Link the change, migration, test evidence, operational runbook, or
  institutional decision that proves a task is complete.
- Use these task statuses:
  - **Complete**: implemented and verified with durable evidence.
  - **In progress**: actively being implemented but not yet accepted.
  - **Planned**: approach is known and work has not started.
  - **Decision required**: implementation depends on an institutional choice.
  - **Blocked**: a named external dependency prevents progress.
- Do not mark the application production-ready based only on code completion.
  Production acceptance also requires environment, security, privacy,
  accessibility, backup, rollback, and operational evidence.

## Current Architecture

### Application And Routes

- Next.js App Router, React, and TypeScript provide the student and professor
  interfaces.
- Student pages cover topic browsing, question practice, tutor interaction,
  anonymous session continuity, and progress summaries.
- Professor pages cover generated-question review, upload previews,
  deterministic regeneration, and aggregate analytics.
- Route handlers expose question reads, tutor sessions and responses, progress,
  retrieval search, review mutations, uploads, usage, and analytics.
- There are no production authentication, user-management, health/readiness,
  audit-log, feedback, deletion, or export routes.

### Content And Data

- `src/lib/data` provides a repository boundary with public demo JSON and
  Postgres implementations.
- Postgres migrations define topics, questions, hints, solution steps,
  misconceptions, tutor sessions, attempts, retrieval chunks, AI usage,
  response caching, and professor review metadata.
- Student-facing reads require approved, public, trusted content and active
  syllabus topics.
- Canonical topic fixtures preserve syllabus order.
- The public seed generator prepares reviewable SQL from safe demo content and,
  when explicitly requested, approved generated content.

### Tutor And AI

- The tutor is rule-first and uses saved hints, solution steps, and
  misconception feedback before retrieval or LLM fallback.
- Retrieval supports keyword search and optional embeddings, with audience
  filtering and server-side private-reference summaries.
- LLM fallback is server-side, opt-in, limited to probability/statistics help,
  guarded against unsafe output, and disabled when durable usage controls are
  unavailable outside demo mode.
- Usage controls include input/output limits, session and daily call limits,
  token reservations, per-student/per-question scopes, and response caching.

### Identity And Operations

- Clerk provides managed email/password authentication while application roles
  remain in PostgreSQL. Approved Clerk Dashboard configuration and Production
  keys are still required; institutional SSO is deferred.
- Optional anonymous practice uses a signed, HTTP-only server cookie and
  ownership-aware repository queries; it remains continuity, not affiliation.
- Local demo mode uses committed fixtures and in-memory state. Deployed
  database modes now fail closed instead of substituting either source.
- Typed configuration now distinguishes Development, Test, Preview, Staging,
  and Production and fails strict environments when required server
  configuration is missing. External resource isolation, an institution-owned
  production database, CI/CD gates, monitoring, backups, and rollback
  procedures remain unverified.

See [Tutoring App Foundation](foundation.md),
[Database Schema And Migrations](database.md), and
[Anonymous Student Sessions](anonymous-students.md) for the current design.

## Completed Capabilities

The following capabilities are complete for the current demo scope, but do not
by themselves establish production readiness:

- [x] Student topic catalog follows canonical syllabus order.
- [x] Student-facing content filters out unapproved and untrusted questions.
- [x] Rule-based answer checking, incremental hints, solution steps, and
      misconception feedback are implemented.
- [x] Anonymous tutor sessions and aggregate progress have Postgres repository
      implementations and an explicitly non-durable demo implementation.
- [x] Generated questions default to `needs_review`,
      `generated_unverified`, and original generated source types.
- [x] Professor review, question editing, rejection, approval, upload preview,
      and deterministic regeneration foundations exist.
- [x] Private course files and derived private artifacts are ignored by Git.
- [x] Private-reference retrieval requires approved safe summaries; raw private
      chunks are not returned through student APIs.
- [x] Server-side LLM fallback has response guardrails, caching, and token/call
      controls.
- [x] Aggregate professor analytics and AI usage dashboards exist.
- [x] Explicit operating modes prevent Preview database mode, Staging, and
      Production from falling back to demo content or in-memory sessions.
- [x] Lint, TypeScript, unit/API tests, and the production build pass at the
      audit baseline.

Relevant safety and workflow documentation:

- [Course Material Safety](course-material-safety.md)
- [Content Ingestion](content-ingestion.md)
- [Original Question Generation Workflow](question-generation.md)
- [Local Setup](local-setup.md)

## Remaining Gaps And Task Ownership

Owners below identify the role accountable for closure. A named individual or
team should replace each role before a pilot is scheduled.

| ID    | Severity | Major task                                                                                                                          | Status            | Accountable owner                             | Completion evidence                                                                                                                                                                                                                                                                                                         |
| ----- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-01 | Critical | Maintain this readiness record and link evidence from later production prompts.                                                     | In progress       | Project engineering                           | This document is reviewed and updated for every production-transition change.                                                                                                                                                                                                                                               |
| PR-02 | Critical | Complete the data-flow, privacy, retention, and deletion inventory.                                                                 | Planned           | Privacy owner + engineering                   | Approved inventory covers identifiers, answers, tutor messages, AI inputs/outputs, logs, caches, analytics, and third parties.                                                                                                                                                                                              |
| PR-03 | Critical | Record production architecture and environment decisions.                                                                           | Decision required | Project owner + university IT                 | Approved architecture decision record names environment, database, auth, AI, logging, backup, deployment, and rollback choices.                                                                                                                                                                                             |
| PR-04 | Critical | Separate Development, Preview/Staging, Test, and Production configuration and data.                                                 | In progress       | Platform engineering                          | [Typed environment validation](environment-configuration.md) and automated tests cover configuration; deployed resource isolation remains to be proven.                                                                                                                                                                     |
| PR-05 | Critical | Remove production demo and in-memory fallbacks.                                                                                     | Complete          | Application engineering                       | [Operating-mode policy](operating-modes.md) and production-mode tests prove database failures return controlled errors and never read or mutate demo state.                                                                                                                                                                 |
| PR-06 | Critical | Establish production database ownership, billing, credentials, backup, deletion, and incident responsibilities.                     | Decision required | University IT + project owner                 | Written ownership handoff and separate staging/production database evidence.                                                                                                                                                                                                                                                |
| PR-07 | Critical | Approve the integrated Clerk authentication for students and professors.                                                            | Decision required | University IT + security + engineering        | Approved Clerk configuration, server sessions, account lifecycle, test identities, and recovery procedure.                                                                                                                                                                                                                  |
| PR-08 | Critical | Centralize deny-by-default authorization and enforce ownership on every route and repository operation.                             | Complete          | Application engineering                       | Authorization matrix tests cover anonymous, student, professor, and student-owned records.                                                                                                                                                                                                                                  |
| PR-09 | Critical | Protect all professor pages and reads; replace the shared secret and record the authenticated reviewer.                             | Complete          | Application engineering                       | [Authenticated professor authorization](authentication-authorization.md#server-side-enforcement) and API regressions prove anonymous/student access is denied, review history records the real reviewer, and no secret is entered or stored in browser UI.                                                                   |
| PR-10 | High     | Add a migration ledger, migration status command, CI migration test, safety gates, and recovery instructions.                       | Complete          | Database engineering                          | The [database operations runbook](database-operations.md), checksum-ledger runner, deployment check, destructive/Production gates, and executable empty/upgrade tests provide the required evidence.                                                                                                                        |
| PR-11 | High     | Harden the production schema for users, roles, review history, audit events, feedback, constraints, indexes, and deletion behavior. | Complete          | Database engineering + privacy owner          | [Migration 007](../db/migrations/007_production_schema_hardening.sql), the [schema documentation](database.md#production-schema-hardening), and [executable migration tests](../tests/production-schema-migration.test.ts) prove fresh/upgrade safety, integrity, indexes, history, and deletion behavior without row loss. |
| PR-12 | High     | Make multi-record imports, edits, regeneration, and review actions transactional and concurrency-safe.                              | Planned           | Database engineering                          | Failure and simultaneous-review tests prove atomicity and conflict handling.                                                                                                                                                                                                                                                |
| PR-13 | High     | Add an idempotent, dry-run production importer for approved content only.                                                           | Complete          | Content engineering + professor               | The [approved-content importer](approved-content-import.md), immutable import ledger, and executable tests prove stable IDs/order, exact no-op replay, transactional rollback, and exclusion of private, draft, retrieval, test, student, and session data.                                                                 |
| PR-14 | High     | Configure serverless-safe database pooling, timeouts, safe retries, error classification, and health checks.                        | Planned           | Platform + database engineering               | Load/failure tests and health checks prove bounded, non-leaking behavior.                                                                                                                                                                                                                                                   |
| PR-15 | High     | Define and test backup, restore, RPO, RTO, and rollback procedures.                                                                 | Decision required | University IT + database engineering          | Provider backup evidence and a successful disposable restore exercise.                                                                                                                                                                                                                                                      |
| PR-16 | High     | Add read-only integrity checks and explicitly gated repair tools.                                                                   | Planned           | Database + content engineering                | Reports detect invalid publication states, broken relations, duplicate IDs, orphan sessions, and demo/test data.                                                                                                                                                                                                            |
| PR-17 | High     | Replace runtime local-file private upload storage with approved private processing and storage.                                     | Decision required | Security + platform engineering               | Threat-reviewed storage, malware/content handling, retention, deletion, and serverless deployment evidence.                                                                                                                                                                                                                 |
| PR-18 | High     | Decide whether answer previews are necessary; implement retention, consent, and deletion accordingly.                               | Decision required | Privacy owner + professor                     | Approved collection purpose and tested retention/deletion behavior.                                                                                                                                                                                                                                                         |
| PR-19 | High     | Prevent public delivery of accepted answers and complete solution steps before the tutor reveals them.                              | Planned           | Application engineering + professor           | Browser/API tests prove progression is server-enforced.                                                                                                                                                                                                                                                                     |
| PR-20 | High     | Add structured privacy-safe logs, audit events, error tracking, alerts, and request correlation.                                    | Planned           | Platform engineering + security               | Staging evidence demonstrates useful diagnostics without secrets, raw private content, or student answers.                                                                                                                                                                                                                  |
| PR-21 | High     | Add real Postgres integration, migration, concurrency, authorization, browser E2E, accessibility, and deployment smoke tests.       | Planned           | Quality engineering                           | CI blocks deployment when any production gate fails.                                                                                                                                                                                                                                                                        |
| PR-22 | Medium   | Add LLM timeouts, retry policy, reservation reconciliation, monetary budgets, and provider billing alerts.                          | Decision required | AI engineering + project owner                | Failure tests and provider budget alerts prove spend remains bounded.                                                                                                                                                                                                                                                       |
| PR-23 | Medium   | Add rate limits and abuse controls for session creation and public APIs.                                                            | Planned           | Security + application engineering            | Tests cover identity rotation, bursts, oversized requests, and controlled throttling.                                                                                                                                                                                                                                       |
| PR-24 | Medium   | Correct analytics semantics and document metric definitions.                                                                        | Planned           | Data/analytics owner + professor              | Validated metrics distinguish detected misconceptions from general missed attempts.                                                                                                                                                                                                                                         |
| PR-25 | Medium   | Complete accessibility verification and remediation.                                                                                | Planned           | Frontend engineering + accessibility reviewer | WCAG acceptance review, keyboard/screen-reader checks, and automated tests pass.                                                                                                                                                                                                                                            |
| PR-26 | Medium   | Add global failure UI, operational status behavior, and recoverable retry paths.                                                    | Planned           | Application + platform engineering            | Browser tests cover database, network, provider, and expired-session failures.                                                                                                                                                                                                                                              |
| PR-27 | High     | Add deployment configuration, security headers, staging promotion, smoke checks, and rollback automation.                           | Planned           | Platform engineering                          | Staging-to-production runbook and successful rollback exercise.                                                                                                                                                                                                                                                             |
| PR-28 | Critical | Complete institutional privacy, security, accessibility, and pilot approval.                                                        | Decision required | Project owner + university approvers          | Written approvals and named incident/support contacts.                                                                                                                                                                                                                                                                      |

## External Dependencies

| Dependency                                                | Required for                                                      | Current evidence                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Suffolk-approved Clerk configuration                      | Student/professor authentication and account recovery             | Clerk integration exists; institutional approval/configuration is outstanding |
| Institution- or project-owned Postgres                    | Durable content, sessions, progress, usage, roles, and audit data | Repository support exists; production ownership is unverified                 |
| Approved LLM and embedding provider                       | Limited AI fallback and optional vector retrieval                 | OpenAI-compatible implementation exists; institutional approval is unverified |
| Private object storage or approved processing environment | Durable private uploads and derived artifacts                     | Current implementation uses ignored local files                               |
| Error tracking and log platform                           | Production diagnosis, security monitoring, and alerts             | Not configured                                                                |
| Backup provider/process                                   | Database recovery                                                 | Not verified                                                                  |
| CI/CD and hosting project                                 | Environment isolation, deployment gates, promotion, and rollback  | Not represented in the repository                                             |
| Privacy, security, accessibility, and legal review        | Real-student pilot authorization                                  | No approval evidence in the repository                                        |

## Institutional Decisions Required

The project must not invent or assume answers to these questions:

1. Which Suffolk-approved identity provider and tenant will be used?
2. May the pilot allow anonymous students, or must all progress be attached to
   institutional accounts?
3. Which project owner may assign professor metadata in Clerk Dashboard, and who reviews those changes?
4. Who owns and pays for Development, Staging, and Production databases?
5. What regions, retention periods, deletion rules, RPO, and RTO apply?
6. Should student answer previews, tutor messages, and AI prompts be collected?
7. May approved private-reference summaries be sent to an external AI provider?
8. Which provider/model/data-processing terms are institutionally approved?
9. Who has authority to approve content for student publication?
10. Which logging, analytics, error-reporting, and feedback data may be
    collected during the pilot?
11. What accessibility review and sign-off are required?
12. Who owns incident response, student support, rollback, and pilot shutdown?

Record each decision in a maintained architecture/privacy decision document and
link it from the corresponding task above.

## Security And Privacy Considerations

### Existing Safeguards

- Secrets are server environment variables and `.env*` files are ignored.
- Private course materials and derived artifacts stay under ignored paths.
- Student content requires approved review status, public visibility, and an
  allowed trust level.
- Raw private chunks are excluded from student retrieval; only reviewed safe
  summaries may be used.
- Copied-source indicators are screened by ingestion, database constraints,
  retrieval, uploads, and LLM output guardrails.
- LLM usage keys are HMAC-derived, and production LLM spending fails closed
  without durable usage configuration.

### Unresolved Risks

- Anonymous identifiers and session IDs are not authenticated ownership proof.
- Clerk instance ownership, production keys, and institutional approval remain
  external prerequisites.
- Accepted answers and solution steps are delivered to the browser before
  progression requires them.
- Attempt answer previews are retained without an approved retention/deletion
  policy.
- Runtime upload processing depends on local disk, Git, and `pdftotext`.
- There is no structured security audit log, incident alerting, or verified
  backup/restore path.
- No repository evidence establishes data-processing approval for an LLM,
  embedding, analytics, logging, or error-tracking provider.

Do not claim FERPA compliance, security certification, institutional approval,
or production readiness solely because these safeguards exist.

## Production Acceptance Criteria

Production acceptance requires evidence for every item below.

### Governance And Data

- [ ] A named project owner accepts the production architecture.
- [ ] Privacy/security owners approve the data inventory, collection purpose,
      retention, deletion, incident response, and third-party processors.
- [ ] Accessibility review requirements and the responsible approver are named.
- [ ] Production content authority and review-history requirements are defined.
- [ ] No real student data, fake students, demo sessions, or development logs
      are present at production launch.

### Environments And Deployment

- [ ] Development, automated test, Preview/Staging, and Production use isolated
      configuration, credentials, data, and external resources.
- [ ] Production fails startup when database, auth, application URL, usage
      secret, logging, or other required configuration is missing.
- [x] Production cannot silently use demo fixtures or in-memory persistence.
- [ ] CI runs lint, typecheck, tests, migration tests, accessibility checks, and
      a production build.
- [ ] Deployment includes health checks, migration status, staged promotion,
      smoke tests, rollback instructions, and security headers.
- [ ] Resolve the current Production dependency audit findings in Next.js,
      PostCSS, and Sharp; npm reports that the available fix requires a
      separately tested Next.js upgrade outside the current pinned version.

### Authentication And Authorization

- [ ] The service/privacy owners have approved and provisioned the Clerk
      Production instance, domains, email verification, and recovery settings.
- [x] Clerk manages authentication credentials; the application stores no
      passwords or password hashes.
- [ ] Production Clerk cookie/session policy and operator session-revocation
      procedures are configured and verified in the deployed environment.
- [x] Server-side authorization denies access by default.
- [x] The [server authorization permission matrix](authorization-permission-matrix.md)
      inventories every page and Route Handler method; direct
      handler tests cover anonymous and lower-role denial.
- [x] Students can read and mutate only their own sessions and progress.
- [x] Professor pages, reads, writes, analytics, uploads, and retrieval enforce
      the professor role.
- [x] Role assignment is owner-controlled through Clerk public metadata; there
      is no in-app role-management surface.
- [x] Review actions record the authenticated reviewer user ID.
- [x] Production rejects and does not depend on a shared `ADMIN_SECRET`.

### Database And Recovery

- [x] One versioned migration history applies cleanly to empty and upgraded
      disposable databases through the [checksum-ledger workflow](database-operations.md).
- [x] [Schema constraints, indexes, foreign keys, deletion rules, timestamps,
      roles, review history, audit events, and publication states](database.md#production-schema-hardening)
      are verified.
- [x] [Approved-content import](approved-content-import.md) is idempotent,
      transactional, dry-runnable, and excludes private/draft/demo/test records.
- [ ] Database pooling, timeouts, safe retries, concurrency, and controlled
      errors are load/failure tested.
- [ ] Integrity checks pass on production-shaped data.
- [ ] Backup existence is verified and a restore succeeds in a disposable
      environment.

### AI, Retrieval, And Cost

- [ ] The institution approves the AI and embedding provider boundary.
- [ ] Only allowed approved content or reviewed safe summaries enter prompts.
- [ ] Provider timeouts, retry limits, output guardrails, and failure fallbacks
      are tested.
- [ ] Session, student, question, global, token, and monetary budgets are
      durable and resistant to identity rotation and concurrency.
- [ ] Provider usage is reconciled and billing alerts are active.

### Operations And Quality

- [ ] Structured logs, audit events, error tracking, request IDs, dashboards,
      and alerts are active without exposing secrets, private sources, or student
      answers.
- [ ] Browser E2E tests cover student, professor, recovery, and
      authorization flows in Staging.
- [ ] Keyboard, screen-reader, contrast, responsive, and automated accessibility
      checks meet the approved standard.
- [ ] Failure exercises cover database outage, AI outage, expired sessions,
      failed deployment, rollback, backup restore, and pilot shutdown.
- [ ] Owners complete and sign the launch checklist below.

## Maintained Production Checklist

Update this section as later production prompts are completed. A checked item
must link to its evidence in the task table or accompanying documentation.

### Audit And Decisions

- [x] Prompt 84 — Repository production-readiness audit completed.
- [x] Prompt 85 — Maintained production-readiness document created.
- [ ] Prompt 86 — Data-flow and privacy inventory approved.
- [ ] Prompt 87 — Production architecture decision record approved.

### Runtime Environments

- [x] Prompt 88 — Runtime configuration separated and validated; external resource isolation remains tracked by PR-04.
- [x] Prompt 89 — Unsafe production demo fallbacks removed.

### Database And Data Ownership

- [ ] Prompt 90 — Production database ownership plan approved.
- [ ] Prompt 91 — Production database migration plan approved.
- [x] Prompt 92 — [Production schema hardened](database.md#production-schema-hardening)
      through migration 007 and executable fresh/upgrade tests.
- [x] Prompt 93 — [Safe migration workflow operational](database-operations.md)
      with status, pending-deployment, safety-gate, and empty-database CI tests.
- [x] Prompt 94 — [Approved-content production importer verified](approved-content-import.md)
      with manifest, duplicate, dry-run, rollback, no-op, order, and contamination tests.
- [ ] Prompt 95 — Database runtime reliability verified.
- [ ] Prompt 96 — Backup and restore process exercised.
- [ ] Prompt 97 — Data integrity and cleanup tools verified.

### Authentication And Authorization

- [ ] Prompt 98 — Authentication architecture approved.
- [ ] Prompt 99 — Authentication provider integration verified.
- [ ] Prompt 100 — Student authentication and onboarding verified.
- [ ] Prompt 101 — Professor authentication verified.
- [ ] Prompt 102 — Central authorization layer enforced.
- [x] Prompt 103 — [Shared admin-secret review input removed](authentication-authorization.md#configuration-and-local-behavior).

### Later Production Prompts

The supplied production master context currently defines Prompts 85–103 only.
Add Prompts 104–143 here by title when their specifications are available.
Do not invent their scope or mark them complete without implementation and
verification evidence.

- [ ] Prompts 104–143 — Definitions and acceptance evidence pending.

## Internal Documentation Index

- [README](../README.md)
- [Tutoring App Foundation](foundation.md)
- [Local Setup](local-setup.md)
- [Database Schema And Migrations](database.md)
- [Anonymous Student Sessions](anonymous-students.md)
- [Authentication and Authorization](authentication-authorization.md)
- [Course Material Safety](course-material-safety.md)
- [Content Ingestion](content-ingestion.md)
- [Original Question Generation Workflow](question-generation.md)
- [Initial Schema](../db/migrations/001_initial_schema.sql)
- [Tutor Session Progress Migration](../db/migrations/002_tutor_session_progress.sql)
- [Retrieval Chunks Migration](../db/migrations/003_retrieval_chunks.sql)
- [LLM Usage Controls Migration](../db/migrations/004_llm_usage_controls.sql)
- [Professor/Admin Workflow Migration](../db/migrations/005_professor_admin_workflow.sql)
- [Syllabus Topic Order Migration](../db/migrations/006_syllabus_topic_order.sql)
- [Production Schema Hardening Migration](../db/migrations/007_production_schema_hardening.sql)
- [Approved Content Import Migration](../db/migrations/008_approved_content_import.sql)
- [Authentication and Authorization Migration](../db/migrations/009_authentication_authorization.sql)
- [Database Migration Operations](database-operations.md)
- [Approved Content Production Import](approved-content-import.md)
