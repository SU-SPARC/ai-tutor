# Production review-candidate import

The committed files under `data/demo/` contain 11 canonical active syllabus
topics and 234 original, public-safe generated drafts. Production remains
database-backed; these fixtures are copied into Postgres only by the explicit
operator command documented here.

The importer reads only `data/canonical/syllabus-topics.json` and the five hard-coded
`*-review-candidates.json` files listed in
`scripts/lib/review-candidate-import.mjs`. It never scans or reads
`data/private/`, extracted course material, retrieval chunks, or arbitrary
operator-supplied paths.

## Safety model

- Topics are validated and upserted first by stable ID.
- Missing questions are inserted as `needs_review`, `generated_unverified`,
  and `public`, then submitted into the immutable lifecycle review queue.
- Imported questions have no published version, so student views, question
  counts, practice, tutor APIs, and retrieval cannot see them.
- Migration `014_lock_down_data_api.sql` must be current before import. It
  removes Supabase `anon`/`authenticated` access to owner-executed review and
  private-content views, so PostgREST cannot bypass the application boundary.
- The 11 active syllabus topics remain visible to students with zero question
  counts until questions in them are both approved and published.
- Existing question IDs are never updated. Exact prior imports are skipped;
  approvals, rejections, revisions, and any content difference are reported as
  preserved professor-reviewed content.
- Duplicate fixture IDs, missing topic references, unsafe source metadata,
  copied/private-source signals, and stale database migrations fail the whole
  operation.
- Apply is one transaction under an advisory lock. Any error rolls everything
  back.
- The command prefers `DATABASE_URL` and falls back to the managed Supabase
  integration's `POSTGRES_URL`. It prints only the explicit target label and
  aggregate counts, never the URL or credentials.

## Check first

Run this in a shell where the intended database's `DATABASE_URL` or managed
`POSTGRES_URL` is already loaded from the environment or secret store:

```bash
npm run db:import:review-candidates -- --target production --check
```

The check validates all repository fixtures, confirms the migration ledger is
current, compares stable IDs with the target database, and rolls back without
writing.

## Apply

After reviewing the check output and confirming the target is the intended
Production database:

```bash
npm run db:import:review-candidates -- \
  --target production \
  --apply \
  --confirm-production
```

The Production command is intentionally manual. It is not run during builds,
deployments, migrations, or application startup.
