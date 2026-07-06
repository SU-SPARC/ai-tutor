# Database Schema And Migrations

Database migrations live in `db/migrations/` and are intended for Postgres.
Local development remains safe without a database: when `DATABASE_URL` is
missing or `APP_DEMO_MODE=true`, the app uses committed public demo fixtures.

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
