# Approved Content Production Import

The approved-content importer is the only supported path for bootstrapping
course content in Staging or Production. It consumes one complete,
professor-attested manifest and never reads demo fixtures, private source
directories, retrieval chunks, generated review queues, student data, tutor
sessions, or development logs.

No Production manifest or Production database is included in this repository.
Running the commands below requires an institution-controlled database and a
separately approved content release.

## Imported Data

The strict manifest schema permits only:

- canonical syllabus topics with stable IDs and exact, potentially
  non-contiguous `sortOrder` values;
- approved original questions with stable IDs;
- ordered hints and solution steps using one-based composite identity
  `(question ID, order)`;
- misconception feedback, match terms, and the public-safe `conceptTags`
  metadata field;
- only the minimal pattern metadata referenced by an approved generated
  question: stable ID, canonical topic ID, title, description, difficulty,
  concept tags, and misconception tags; and
- professor approval identity/time, source hashes, content hashes, expected
  counts, release ID, Git SHA, and change-ticket evidence.

The importer maps every question to `visibility=public`,
`review_status=approved`, and `trust_level=professor_approved`. A generated
question is eligible only when its ID appears in
`approvedGeneratedQuestionIds`, it uses a generated origin, and it references
pattern metadata included in the same manifest. There is no manifest field
that can publish a draft or generated-unverified question.

The schema rejects every unrecognized field. Consequently fields such as
`retrievalChunks`, `students`, `tutorSessions`, `attempts`, `reviewStatus`, raw
generation controls, source locators, private text, embeddings, or arbitrary
misconception metadata cannot pass validation.

## Storage Added By Migration 008

`008_approved_content_import.sql` adds:

- `question_patterns`, which holds only professor-reviewed, public-safe
  immutable metadata and supplies a foreign key target for new
  `questions.pattern_id` values; and
- append-only `approved_content_imports`, which records release ID, canonical
  manifest SHA-256, Git SHA, professor identity/time, execution identity,
  target, change ticket, summary, and application time.

The pattern foreign key is `NOT VALID` only to preserve unknown legacy rows
during upgrade. PostgreSQL enforces it for all new importer rows. The importer
also rejects every target content ID absent from the complete manifest.

## Manifest Contract

Store reviewed source artifacts under `data/production/approved/` and manifests
under `data/production/manifests/`. The importer resolves real paths, rejects
path traversal/symlinks outside the approved directory, reads each source, and
verifies its exact SHA-256 before opening a database connection. The manifest
and every source artifact must be tracked by Git; untracked files are rejected.

A schema-version 1 manifest contains exactly these root fields:

| Field                             | Requirement                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`                   | Exactly `1`                                                                                                     |
| `releaseId`                       | Stable, unique release identifier                                                                               |
| `sourceGitSha`                    | Full 40- or 64-character Git SHA for the approved source-content commit                                         |
| `sourceFiles`                     | One or more repository-relative paths under `data/production/approved/`, each with SHA-256                      |
| `approval`                        | `professor_approved`, immutable institutional signer user ID, canonical UTC signing time, change ticket, digest |
| `expectedTopicOrder`              | Exact ordered list of topic IDs and `sortOrder`; gaps are retained                                              |
| `approvedGeneratedQuestionIds`    | Exact set of generated/pattern-derived question IDs; may be empty                                               |
| `expectedCounts`                  | Exact topic, pattern, question, hint, solution-step, and misconception counts                                   |
| `contentHashes`                   | Canonical SHA-256 keyed by every topic, pattern, and question ID                                                |
| `topics`, `patterns`, `questions` | Complete approved release content                                                                               |

Question objects contain exactly `id`, `topicId`, `patternId`, `origin`,
`title`, `prompt`, `difficulty`, `acceptedAnswers`, `numericValue`, `tolerance`,
`answerExplanation`, `originalityNote`, `hints`, `solutionSteps`, and
`misconceptions`. Allowed origins are `professor_original`,
`generated_original`, and `pattern_derived_original`.

The canonical JSON algorithm recursively sorts object keys, preserves array
order, uses ordinary JSON primitives, and omits whitespace. SHA-256 is computed
over that representation. The approval digest covers the complete normalized
manifest, including signer, signing time, ticket, declared content hashes,
counts, and source hashes, but excluding only `approval.contentSha256` itself.
The exported `canonicalJson`, `computeContentHashes`, and
`computeManifestApprovalHash` functions are the authoritative release tooling
interfaces; the importer recalculates every value.

## Required Environment

Use the institution-controlled content-import job. Do not inject these values
into the running application or a Preview deployment.

| Variable                        | Requirement                                                              |
| ------------------------------- | ------------------------------------------------------------------------ |
| `CONTENT_IMPORT_DATABASE_URL`   | Dedicated import credential; the tool never falls back to `DATABASE_URL` |
| `CONTENT_IMPORT_ACTOR`          | Named job/human executor recorded in the immutable import ledger         |
| `CONTENT_IMPORT_CHANGE_TICKET`  | Must exactly match the professor-approved manifest                       |
| `CONTENT_IMPORT_SOURCE_GIT_SHA` | Must exactly match `manifest.sourceGitSha`                               |

The target database must report the complete checksum-clean migration history.
The manifest signer must already be an active institutional human with an
active `professor` application role. A role label, demo identity, shared token,
or `system:schema-migration` is rejected as the approval identity.

## Commands

Always start with Staging and retain the JSON reports with the change ticket.

```bash
npm run db:migrate:check
npm run db:import:approved -- \
  --manifest data/production/manifests/<release>.json \
  --target staging \
  --dry-run \
  --json
```

The dry run opens a consistent transaction, validates the target and exact
existing content, plans every insert/no-op, writes nothing, and rolls back. It
does not consume sequence values.

After review of the successful dry-run report:

```bash
npm run db:import:approved -- \
  --manifest data/production/manifests/<release>.json \
  --target staging \
  --apply \
  --json
```

Production uses the same manifest and command, with the additional explicit
gate:

```bash
npm run db:import:approved -- \
  --manifest data/production/manifests/<release>.json \
  --target production \
  --dry-run \
  --json

npm run db:import:approved -- \
  --manifest data/production/manifests/<release>.json \
  --target production \
  --apply \
  --confirm-production \
  --json
```

There is deliberately no default mode: callers must choose `--dry-run` or
`--apply`. Production confirmation is accepted only as an additional apply
gate, never as a replacement for manifest approval.

## Validation And Duplicate Rules

Before a write, the importer verifies:

- exact schema, source hashes, approval digest, item hashes, expected counts,
  and Git SHA;
- unique source paths, stable IDs, topic orders, child orders, misconception
  composite IDs, and generated approval IDs;
- exact topic-order agreement, with syllabus gaps preserved;
- all topic/pattern references and same-topic pattern use;
- generated questions are exactly allowlisted and every included pattern is
  required by an approved question;
- numeric answer/tolerance pairs and allowed difficulty/origin values;
- no unexpected/private/retrieval/draft/test fields or copied-source signals;
- active professor signer identity;
- absence of target topic, pattern, or question IDs outside the complete
  manifest; and
- for Production bootstrap, zero student roles and zero sessions, attempts,
  progress, usage, reservations, caches, retrieval chunks, audit events,
  feedback reports, or other operational rows.

For a missing stable ID, the importer plans an insert. For an existing ID, it
reconstructs the exact canonical entity—including all hints, solution steps,
misconceptions, publication state, signer, and signing time. An identical hash
is an idempotent no-op; any difference is a hard conflict. It never updates or
deletes existing content and never removes stale children to force a match.

## Transaction, Report, And Recovery

Apply uses serializable isolation, takes a transaction-scoped PostgreSQL
advisory lock, uses bounded lock and statement timeouts, inserts topics before
patterns and questions, and inserts every child before making a question
approved. The final approval transition records the professor against the
complete question version. The import ledger row is written last. Any error
rolls back the entire release, so no topic, pattern, question, child, approval,
or ledger subset remains.

The redacted report contains release ID, manifest hash, target, mode,
commit/status flags, operational-table counts, validation result codes, and
insert/no-op/total counts for topics, patterns, questions, hints, solution
steps, misconceptions, approvals, and import records. It never prints the
database URL, question text, answers, source contents, or credentials.

After apply, run the same manifest again in dry-run mode. Every content row and
the import ledger must report no-op. If apply fails, preserve its rejected
report and retry only after correcting the release artifact or target state;
the transaction has already rolled back. If a release was committed, never
rewrite it, delete its ledger row, or change a stable ID in place. Create a new
complete professor-approved release and forward-fix under a new change ticket.
