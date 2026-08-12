# Database Schema And Migrations

Database migrations live in `db/migrations/` and are intended for Postgres.
Local development remains safe without a database: `APP_DEMO_MODE=true` uses
committed public demo fixtures. Development/Test database modes retain a
documented demo fallback when database access fails. Preview database mode,
Staging, and Production fail closed and never substitute demo data.

See [Operating Modes And Demo Isolation](operating-modes.md) for the complete
mode and failure matrix.

See [Database Migration Operations](database-operations.md) for the checked-in
migration commands, checksum/status workflow, safety gates, CI evidence, and
forward-fix procedure.

See [Approved Content Production Import](approved-content-import.md) for the
professor-attested manifest contract, dry-run/apply commands, exact-content
duplicate rules, transactional behavior, and validation report.

See [Production Review-Candidate Import](review-candidate-import.md) for the
separate topic-first command that loads committed public-safe generated drafts
as an unpublished professor review queue.

See [Production Question Content Lifecycle](content-lifecycle.md) for immutable
question aggregates, publication pointers, professor operations, regeneration,
rollback, student takedown, and audit behavior.

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
student/internal-review views. Student retrieval reads only approved public trusted chunks
or approved private reference summaries; raw private book text must remain
outside public APIs.

## Production Schema Hardening

`007_production_schema_hardening.sql` is a forward-only migration that adds the
production integrity layer without deleting existing rows:

| Area                         | Production invariant                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Institutional identity       | `users` maps Clerk subjects; `roles` and `user_roles` hold the Clerk-synchronized student/professor integrity projection required for review decisions              |
| Topics                       | IDs/titles are nonblank and `sort_order` is globally unique, nonnegative, and indexed with stable title/ID tie-breakers                                             |
| Questions                    | Content fields and answer JSON are validated; approved public rows require an immutable reviewer user ID, timestamp, approved trust level, and no archive timestamp |
| Versions and approvals       | Every question/content-child mutation snapshots the full question into append-only `question_versions`; review transitions append to `question_approval_history`    |
| Hints, steps, misconceptions | One-based child ordering is unique per question; bodies/IDs are nonblank; misconception terms are arrays and metadata is an object                                  |
| Approved imports             | Public-safe pattern metadata and release evidence are immutable; new pattern references must resolve to an approved metadata row                                    |
| Sessions and attempts        | Each session has exactly one authenticated or anonymous identity; attempts require a matching question, topic, and immutable question version                       |
| Progress                     | `student_progress` has one row per student/question with matching topic/version foreign keys and nonnegative counters                                               |
| AI state                     | Usage/token counters are nonnegative and internally consistent; reservations require a session; cache question/topic pairs must match                               |
| Operations                   | Append-only `audit_events` retain an actor snapshot; `feedback_reports` support triage, assignment, resolution, and anonymization-safe reporter hashes              |

The migration backfills existing review decisions to
`system:schema-migration`, a non-human system actor. It does not convert legacy
reviewer labels into professor accounts. New non-pending review decisions must
use an active `professor` user ID; the legacy `reviewed_by` label is
retained only for compatibility and display.

Legacy question-version `content_hash` values remain deterministic internal MD5
fingerprints for referential compatibility. Lifecycle versions also carry a
SHA-256 `content_sha256` over content-only fields. Neither is a signature or a
replacement for the signed import manifest.

`008_approved_content_import.sql` adds public-safe `question_patterns` and the
append-only `approved_content_imports` release ledger. New pattern references
must resolve to reviewed metadata; the Production importer accepts only the
minimal pattern fields required by approved generated questions.

`009_authentication_authorization.sql` adds application-session versioning and
the hashed, one-account-only ledger used for anonymous progress claims. Clerk
provider tokens are not stored in the database.

`010_student_professor_roles.sql` removes legacy administrator grants and the
administrator role. Clerk `publicMetadata.role` is authoritative; the remaining
student/professor rows are synchronized projections for database constraints.

`011_question_content_lifecycle.sql` adds version-level workflow state, stable
working/published pointers, SHA-256 content hashes, parent lineage, generation
attribution, the append-only lifecycle ledger, and pinned version IDs for
sessions, retrieval chunks, and response cache. It maps legacy approved public
trusted content to publication without deleting earlier evidence. Student views
resolve only the published pointer; approval by itself is no longer visibility.

`012_professor_question_revisions.sql` preserves explicit manual creation
attribution for professor-edited generated versions. Revision drafts retain
their generated provenance, while the immutable version and lifecycle event
record the professor editor and timestamp.

`013_safe_batch_review_operations.sql` adds append-only professor inspection
evidence for exact immutable question versions. Batch lifecycle operations use
these records as a server-side precondition and execute only after every
selected item passes preflight inside one transaction.

`014_lock_down_data_api.sql` keeps the public schema behind the Next.js server
boundary. All application views use PostgreSQL `security_invoker`, and ambient
`PUBLIC`, Supabase `anon`, and Supabase `authenticated` grants are removed from
the schema, its existing objects, and the current owner's default privileges.
The application does not use Supabase's browser Data API; its server-only
PostgreSQL owner connection retains access. This prevents review drafts,
question versions, and private retrieval rows from bypassing Clerk professor
authorization through an owner-executed PostgREST view.

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

`tests/production-schema-migration.test.ts` executes all checked-in migrations
against an embedded PostgreSQL runtime. It covers a fresh database, an upgrade
with legacy content/activity, the development seed, publication and role
constraints, Data API isolation, append-only history, snapshot completeness,
and deletion rules.

Tutor sessions store exactly one authenticated `user_id` or opaque
`anonymous_user_id`. Attempts belong to that owner through their `session_id` foreign
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

The commands below are Development-only fixture preparation. They are not a
Production import interface. Production uses only the signed-manifest workflow
documented in [Approved Content Production Import](approved-content-import.md).

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
