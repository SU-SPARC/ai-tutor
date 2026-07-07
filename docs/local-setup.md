# Local Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Fill only the values you need for local work:
   - `DATABASE_URL` is optional. When it is missing or `APP_DEMO_MODE=true`,
     the app uses committed public demo fixtures.
   - `OPENAI_API_KEY` and `OPENAI_MODEL` enable server-side LLM fallback.
   - `OPENAI_EMBEDDING_MODEL` optionally enables server-side embedding
     generation when `OPENAI_API_KEY` is also configured.
   - `ADMIN_SECRET` enables professor/admin review mutations.
   - `APP_DEMO_MODE`, `MAX_LLM_CALLS_PER_SESSION`, and
     `MAX_DAILY_LLM_CALLS` control demo behavior and usage limits.
4. Run `npm run dev`.

Do not commit `.env.local` or any other local secret file. Do not use
`NEXT_PUBLIC_` for secrets because those values are exposed to browser code.

Course PDFs and professor materials must stay local under
`data/private/course-materials/`. Extracted private text, chunks, embeddings,
and generated private artifacts must stay under ignored private paths.

Generate local chunk embeddings with:

```bash
npm run embed:chunks
```

The script reads public-safe demo chunks plus ignored private question/reference
chunks when present. It writes only to ignored private storage at
`data/private/generated/chunk-embeddings.json`. If `OPENAI_API_KEY` is missing,
it writes a private skipped manifest and makes no OpenAI request.
Server-side retrieval uses that private embedding manifest when vectors and an
embedding provider are available; otherwise it falls back to local keyword
retrieval.

Database schema migrations live under `db/migrations/`; see
`docs/database.md`. Prepare reviewable public seed SQL with:

```bash
npm run db:seed
```

By default the seed script includes original demo questions only. Add
`-- --include-approved-generated` to include approved original generated
questions from `data/processed/`.
