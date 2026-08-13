# Canonical syllabus topics

`data/canonical/syllabus-topics.json` is the single source of topic identity and
syllabus order. Database rows, demo data, review imports, generators, analytics,
retrieval exports, and professor/student views must preserve those IDs and that
order. Display names are not IDs and must never be re-slugged to create mappings.

Run a repository-only check in CI or before generating content:

```sh
npm run syllabus:sync -- --dry-run --files-only
```

Run a database dry-run by setting `DATABASE_URL` or `POSTGRES_URL`:

```sh
npm run syllabus:sync -- --dry-run
```

Apply canonical topic-row inserts and metadata/order updates with:

```sh
npm run syllabus:sync -- --apply
```

Apply mode uses one database transaction. It never deletes topics, remaps
questions, or rewrites historical exports. Extra topics, stale mappings,
occupied canonical order values, and changed historical topic-order manifests
are reported for human review. Resolve those reports explicitly and rerun the
dry-run before importing or publishing content.
