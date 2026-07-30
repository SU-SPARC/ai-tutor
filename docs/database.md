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
