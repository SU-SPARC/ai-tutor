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

## Correcting imported source provenance

Drafts imported before the generators were reclassified claim
`pattern_derived_original` while carrying no catalogued pattern. The
publication quality gate requires a linked pattern ID for that source type, so
those drafts are permanently blocked with `invalid_source_classification`. The
truthful classification is `generated_original`: the drafts come from ad-hoc
templates in the generator scripts, not from
`data/demo/question-patterns.json`.

The importer never updates an existing ID, and `question_versions`,
`question_lifecycle_events`, and `audit_events` reject `DELETE`, so neither
re-import nor removal can correct an already-imported draft. The repair instead
appends a corrected version through the lifecycle system:

```bash
npm run db:repair:review-candidate-provenance -- --target production --check
npm run db:repair:review-candidate-provenance -- \
  --target production \
  --apply \
  --confirm-production
```

`--only <question-id>` restricts an apply to a single draft. The command is
idempotent; a second run reports every corrected draft as already correct.

Safety model:

- Only IDs whose committed fixture says `generated_original` are considered.
- A draft is repaired only when the question row and its working version both
  still claim `pattern_derived_original` and no pattern ID is linked anywhere.
  Every other state is reported as blocked and left untouched, so the twelve
  `generated-additional-*` drafts that genuinely name a catalogued pattern are
  never reclassified and no pattern ID is ever invented.
- `questions.source_type` is corrected on the mutable projection only. The
  stored snapshot of every existing version is left byte-for-byte unchanged.
- A new immutable version is appended with parent lineage, `imported` creation
  method, and repair metadata, then submitted back to `needs_review`.
- Approval is version-specific, so a draft approved before the repair must be
  approved again on the corrected version before it can be published. The
  publication gate is untouched in both the TypeScript evaluator and the
  migration 015 trigger.
- Migration history must be checksum-clean, and the whole apply runs in one
  transaction under an advisory lock.
