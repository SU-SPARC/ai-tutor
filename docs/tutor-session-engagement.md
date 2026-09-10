# Tutor session creation and meaningful practice

## Decision and root cause

Keep eager session creation (Option A). A technical session is needed for the
existing tutoring protocol. Its existence was incorrectly treated as practice:
the student dashboard created an in-progress question accumulator for every
retained session, and professor/export queries counted every non-professor
session owner. Neither required a persisted tutoring action.

In `practice-workspace.tsx`, the selected-question effect calls
`createOrResumeTutorSession` once initial recovery has resolved. It first tries
an explicit or locally stored session ID, then posts to `/api/tutor/session`
with a creation idempotency key. No answer or hint is required. Tutor controls
wait for that session, and every `/api/tutor/respond` event uses its ID,
revision, ownership, pinned version, and event idempotency key.

## What creation protects

| Concern | Existing behavior retained |
| --- | --- |
| Content and version | Published creation checks approved, currently servable content. Database lifecycle guards choose/validate the immutable published question version. Reserve creation supplies its approved version explicitly. Responses use that snapshot. |
| Ownership | Creation authorizes an authenticated or signed anonymous owner. Reads and transitions check the same owner; database identity constraints require exactly one owner. |
| Availability | Creation checks the allowed published/Reserve context; serving and responding recheck current availability. A pinned snapshot is not indefinite authorization after withdrawal. |
| Recovery | Local session continuity, explicit resume links, creation idempotency, event replay, and optimistic revision recovery require the durable session. Operational reads still return technical-only sessions. |
| Disclosure | Recovery DTOs and responses expose only previously earned/allowed hints and solutions. A technical session does not disclose the answer. |
| Reserve | The similar-practice endpoint validates an owned completed origin, ranks eligible same-topic candidates, and creates an idempotent Reserve child before navigating. The database guards require eligible Reserve content and the owned completed origin. Withdrawal and disallow checks remain intact. |
| Anonymous claim | Claim transfers all retained technical and meaningful sessions atomically and extends retention. Claim counts are operational transfer counts, now labeled saved tutor sessions in the UI. Practice is classified after transfer with the same rule. |
| Retention | Session expiry, cleanup, backups, and historical rows are unchanged. No rows are deleted to correct analytics. |

Deferring creation (Option B) would require changing tutor-control readiness,
version binding, anonymous identity initialization, event/recovery flows, and
Reserve authorization. The existing protocol does not demonstrate that such a
change is safer. A new engagement flag/event (Option C) would duplicate evidence
already persisted and require historical synchronization. Neither is needed.
Migration 023 and all other migrations are unchanged.

## Shared definition

`src/lib/tutor/session-engagement.ts` owns `isMeaningfulTutorSession` and the
matching `MEANINGFUL_TUTOR_SESSION_SQL` fragment. SQL and record parity are
regression tested. A session is meaningful when **any** of these are true:

- An `attempts` row exists for that session. Despite the table name, these rows
  represent `check`, `hint`, `solution`, and `full_solution` requests. Historical
  rows with a missing mode count too. Rule, retrieval, LLM, cache and persisted
  blocked responses all demonstrate a tutoring request. AI help uses these same
  modes; there is no separate help/session-open mode.
- `attempt_count > 0` or `wrong_attempt_count > 0`.
- `revealed_hints > 0` or `revealed_steps > 0`.
- `solved = true` or `status = 'completed'`.

The durable counters and completion evidence preserve historical practice when
interaction rows are absent. Creation, initial reading, resume lookup, passive
`last_seen_at`, revision, and AI accounting flags alone do not qualify. Requests
rejected before an interaction is persisted do not qualify either. A blocked
request is evidence of attempted use, not successful help, mastery or learning.

Engagement does not change answer counting. SQL answer totals still require
`mode = 'check'`; the dashboard preserves its legacy omitted-mode answer
compatibility. Hints and either solution mode do not become answer attempts.

## Consumers and boundaries

- The student dashboard requests `engagedOnly` listing and applies the record
  predicate before question/topic aggregation, recent practice, and optional
  Reserve counts. Opening a question leaves no question in progress and starts
  no topic; an incorrect check, hint or reveal starts practice, and a correct
  check completes it.
- `analytics-population.ts` combines the SQL predicate with the existing
  effective-professor-role exclusion. Cohort, student list/detail, question
  analytics and pilot export all consume that common population. Pseudonymous
  owner hashing and answer/hint/solution counts are unchanged.
- Published practice remains separate from Reserve practice. An opened Reserve
  child is recoverable but adds no optional-practice count. A meaningful child
  adds optional practice and may appear in student recent activity, while
  published completion and pilot export remain unaffected.
- Default operational session listing remains unfiltered. In particular,
  Reserve candidate selection retains its existing session-history behavior.
- Pilot export version 2 names the changed practice/participation definition;
  version 1 counted opened technical sessions. No raw session total is exported.
  Global AI usage and feedback reports retain separate operational definitions.

## Query cost and limitations

Classification runs in SQL for analytics and database dashboard listing. The
correlated `EXISTS` can stop at the first matching interaction and use the
existing `attempts_session_idx`, `attempts_session_idempotency_idx`, or
`attempts_session_recovery_idx` session-ID prefixes. Existing owner/activity
indexes support student selection. The dashboard still uses two batched reads:
qualifying sessions, then their attempts. It does not fetch all cohort attempts
into application memory, add N+1 queries, or require an index/migration/backfill.
Actual Production query plans have not been measured for this local change.

Lifetime classification does not introduce an engagement timestamp. Existing
first/last-active timestamps remain retained session timestamps, not exact
first/last tutoring-event times. Counter-only legacy practice cannot reconstruct
missing interaction history. Student retention/availability and professor
retained-history scopes remain as before, so their historical totals need not
match even though they now share the same definition of meaningful practice.

## Validation for this change

- `npm run typecheck`: passed, exit 0.
- `npm run lint`: passed, exit 0, no warnings or errors.
- `npx vitest run`: 96 files passed; 802 tests passed; no failures (53.04s).
- `npx vitest run tests/pilot-smoke-evidence.test.ts tests/student-dashboard-ui.test.ts`:
  2 files passed; 15 tests passed (448ms). This runs the local smoke contract
  and rendered dashboard regression suite; HTTP smoke responses are mocked.
- Initial focused engagement/analytics/export run: 6 files, 60 tests passed.
- Migrated-schema instructor/Reserve/claim run: 2 files, 23 tests passed.
- `git diff --check`: passed. React review: wording-only component changes;
  no hooks, fetching, authentication, rendering structure or dependencies changed.

The change adds 24 regression cases, including 17 SQL/record parity cases,
five dashboard cases and two migrated-schema scenarios. The latter cover three
browsing-only questions, answer-only and hint-only participants, professor
exclusion, export parity, retained historical rows, anonymous claim, Reserve
version/origin preservation, recovery ownership, and optional-practice counts.
The full suite also exercises existing creation APIs, availability/withdrawal,
idempotency/recovery, disclosure boundaries, and Reserve guards.

No live authenticated browser or deployed database smoke was run. No deployment,
push, Production write, migration, backfill, or historical-row deletion occurred.

## Files changed

Domain and data access:

- `src/lib/tutor/session-engagement.ts` (new)
- `src/lib/data/analytics-population.ts`
- `src/lib/data/instructor-student-repository.ts`
- `src/lib/data/student-progress.ts`
- `src/lib/data/tutor-session-repository.ts`
- `src/lib/analytics/pilot-export.ts`

User-facing terminology:

- `src/components/auth/anonymous-import-panel.tsx`
- `src/components/professor/instructor-cohort-panel.tsx`
- `src/components/professor/instructor-student-detail.tsx`
- `src/components/professor/instructor-student-table.tsx`
- `src/components/student/progress-dashboard.tsx`

Regression coverage:

- `tests/tutor-session-engagement.test.ts` (new)
- `tests/student-progress.test.ts`
- `tests/instructor-student-analytics-database.test.ts`
- `tests/reserve-practice-anonymous-claim-database.test.ts`
- `tests/pilot-analytics-export-api.test.ts`
- `tests/pilot-analytics-export-database.test.ts`
- `tests/student-dashboard-ui.test.ts`

Documentation:

- `docs/tutor-session-engagement.md` (new; this audit)
- `docs/instructor-student-analytics.md`
- `docs/pilot-analytics-export.md`
