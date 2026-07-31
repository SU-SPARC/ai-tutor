# Database Schema And Migrations

Database migrations live in `db/migrations/` and are intended for Postgres.
Local development remains safe without a database: `APP_DEMO_MODE=true` uses
committed public demo fixtures. Development/Test database modes retain a
documented demo fallback when database access fails. Preview database mode,
Staging, and Production fail closed and never substitute demo data.

See [Operating Modes And Demo Isolation](operating-modes.md) for the complete
mode and failure matrix.

## Initial Schema

`001_initial_schema.sql` creates these public-safe tutoring tables:

- `topics`
- `questions`
- `solution_steps`
- `hints`
- `misconceptions`
- `tutor_sessions`
- `attempts`
- `ai_usage`
- `ai_response_cache`

The `questions` table includes `review_status`, `trust_level`, `source_type`,
and `visibility`. Student-facing views require public visibility, approved
review status, and trusted public/course/professor trust levels.

`006_syllabus_topic_order.sql` adds week/module metadata and active status to
`topics`. Student reads filter to active topics and order by `sort_order` with
stable title/id tie-breakers. The public seed reads the canonical catalog from
`data/demo/topics.json` and validates unique, strictly increasing syllabus
positions before writing SQL.

`003_retrieval_chunks.sql` adds server-side retrieval chunk storage and safe
student/admin views. Student retrieval reads only approved public trusted chunks
or approved private reference summaries; raw private book text must remain
outside public APIs.

## Production Schema Hardening

`007_production_schema_hardening.sql` is a forward-only migration that adds the
production integrity layer without deleting existing rows:

| Area                         | Production invariant                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Institutional identity       | `users`, `roles`, and `user_roles` separate identity-provider subjects from application roles; active professor/admin membership is required for a review decision  |
| Topics                       | IDs/titles are nonblank and `sort_order` is globally unique, nonnegative, and indexed with stable title/ID tie-breakers                                             |
| Questions                    | Content fields and answer JSON are validated; approved public rows require an immutable reviewer user ID, timestamp, approved trust level, and no archive timestamp |
| Versions and approvals       | Every question/content-child mutation snapshots the full question into append-only `question_versions`; review transitions append to `question_approval_history`    |
| Hints, steps, misconceptions | One-based child ordering is unique per question; bodies/IDs are nonblank; misconception terms are arrays and metadata is an object                                  |
| Sessions and attempts        | Each session has exactly one authenticated or anonymous identity; attempts require a matching question, topic, and immutable question version                       |
| Progress                     | `student_progress` has one row per student/question with matching topic/version foreign keys and nonnegative counters                                               |
| AI state                     | Usage/token counters are nonnegative and internally consistent; reservations require a session; cache question/topic pairs must match                               |
| Operations                   | Append-only `audit_events` retain an actor snapshot; `feedback_reports` support triage, assignment, resolution, and anonymization-safe reporter hashes              |

The migration backfills existing review decisions to
`system:schema-migration`, a non-human system actor. It does not convert legacy
reviewer labels into professor accounts. New non-pending review decisions must
use an active `professor` or `admin` user ID; the legacy `reviewed_by` label is
retained only for compatibility and display.

Question-version `content_hash` values are deterministic internal MD5
fingerprints used to suppress duplicate snapshots. They are not signatures and
do not replace the signed manifest's SHA-256 file/content hashes.

Deletion behavior is explicit:

- retiring content is a state change; immutable question versions and approval
  history prevent physical question deletion;
- topics referenced by questions cannot be deleted;
- deleting a student cascades their sessions, attempts, role membership, and
  progress, while feedback remains with its opaque reporter hash;
- content children and derived cache/retrieval rows cascade only when their
  owning content can legally be removed; and
- reviewer identities referenced by immutable academic history cannot be
  physically deleted and must instead be disabled or soft-deleted.

`tests/production-schema-migration.test.ts` executes migrations `001`–`007`
against an embedded PostgreSQL runtime. It covers a fresh database, an upgrade
with legacy content/activity, the development seed, publication and role
constraints, append-only history, snapshot completeness, and deletion rules.

Tutor sessions store an opaque `anonymous_user_id`; no name or email is
required. Attempts belong to that identity through their `session_id` foreign
key. See `docs/anonymous-students.md` for browser persistence and the future
authentication upgrade path.

The student progress dashboard aggregates these sessions and attempts into
question, correctness, hint, step, topic, and recent-session totals. Its API
returns approved question/topic metadata and counts only; it does not return
the anonymous ID, session IDs, or attempt answer previews. If Postgres is
unavailable, only Development/Test database mode may use the explicitly
non-durable in-memory fallback. Deployed database modes return a controlled
service-unavailable response.

## Content Safety

Do not store raw private PDFs, extracted textbook text, private chunks,
embeddings, answer keys, source locators, or professor-only materials in these
tables. Private extraction and review artifacts must stay under ignored
`data/private/` paths.

Generate reviewable public seed SQL with:

```bash
npm run db:seed
```

By default this seeds original demo questions only. To also seed approved
original generated questions from `data/processed/approved-generated-questions.json`,
run:

```bash
npm run db:seed -- --include-approved-generated
```

The seed script refuses private-looking fields, generated-unverified drafts,
copied-source signals, and private review candidates before producing SQL.
Approved development fixtures are attributed to the non-human migration actor;
this seed is not the professor-signed Production importer.
