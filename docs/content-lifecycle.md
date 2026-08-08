# Production question content lifecycle

Question content is an immutable, versioned aggregate. A stable question ID
owns hints, solution steps, misconceptions, topic, difficulty, prompt, and
answer content. Workflow state is stored per version, while
`questions.published_version_id` is the only publication decision used by
student reads.

## States and visibility

Version states are `draft`, `needs_review`, `revision_requested`, `approved`,
`published`, `unpublished`, and `rejected`. A question record is either
`active` or `archived`.

Only the version referenced by `published_version_id` is student-visible, and
only while its question and topic are active. Draft, review, approved,
unpublished, rejected, and archived content is absent from catalogs, search,
direct APIs, retrieval, and new sessions. A newer working version never changes
the bytes served from the published version.

Unpublish and publication replacement immediately mark sessions pinned to the
displaced version as `content_unpublished`. Historical attempts and attribution
remain, but student session DTOs expose only tombstoned question metadata.

## Transition contract

| Action                          | Allowed source                            | Result               | Additional requirement                             |
| ------------------------------- | ----------------------------------------- | -------------------- | -------------------------------------------------- |
| Create, import, generate, clone | New version                               | `draft`              | Complete public-safe aggregate and validation      |
| Submit                          | `draft`                                   | `needs_review`       | Professor or bounded generation system             |
| Request revision                | `needs_review`, `approved`, `unpublished` | `revision_requested` | Reason and `manual` or `regeneration` method       |
| Approve                         | `needs_review`                            | `approved`           | Current content/topic validation                   |
| Reject                          | `needs_review`, `approved`, `unpublished` | `rejected`           | Reason; terminal version                           |
| Publish                         | `approved`, eligible `unpublished`        | `published`          | Current validation; atomic replacement if needed   |
| Unpublish                       | `published`                               | `unpublished`        | Reason; immediate takedown                         |
| Roll back                       | Prior eligible `unpublished`              | `published`          | Reason and current validation; exact prior version |
| Archive                         | Active record with no publication         | Archived record      | Reason                                             |
| Restore                         | Archived record                           | Active record        | Never republishes                                  |

Professors may perform every human transition. System actors can create and
execute generation and submit a validated draft, but cannot approve, publish,
reject, unpublish, roll back, archive, or restore. Database guards reject direct
state or pointer updates.

## Safe batch review

Batch operations are intentionally limited to `request_revision`, `reject`,
and `publish`; there is no batch approval action. Before selection, the acting
professor must open the complete public-safe working aggregate and record an
inspection of that exact immutable version. Inspections are professor- and
version-specific, timestamped, and append-only.

Batch requests contain 2–25 distinct working versions, expected states, a
request id, and an idempotency key. The server locks questions in a stable
order and preflights every item for current version/state, active record,
current-professor inspection, permitted action, and—when publishing—schema,
content, validation status, and active topic. Any failure returns an itemized
report and changes nothing. Only a fully valid batch executes its attributed
lifecycle transitions and publication pointer changes in one transaction.

## Versions, generation, and rollback

`question_versions` contains the authoritative aggregate, parent lineage,
creation method, schema version, legacy MD5 fingerprint, and a SHA-256 content
hash that excludes workflow fields. Material edits and regeneration create a
new version; lifecycle transitions do not.

Professors may revise generated or pattern-derived working versions while they
are `draft`, `needs_review`, or `revision_requested`. The revision endpoint
accepts only wording, difficulty, answer structure, solution steps, hints,
misconception notes, and topic mapping. Source type, trust, visibility,
generation provenance, and stable question ID are derived from the base
version on the server. Each edit creates a new `manual` draft with the
professor and timestamp recorded; the source version remains immutable.
Numeric answers and tolerances, required solution structure, bounded field
counts, active topic mapping, and private-source wording are validated before
the draft is stored.

Regeneration is limited to generated or pattern-derived questions. It uses the
same stable question ID, records professor requestor and system executor, and
creates a submitted version without changing the published pointer. An
actionable working version must be explicitly superseded with a reason.
Idempotency keys prevent duplicate jobs. Failures leave pointers unchanged and
write bounded audit evidence. Private prompts, extracted text, locators, and
pattern controls are not accepted by lifecycle APIs or returned in DTOs.

Rollback republishes the exact prior version. It rechecks schema/content,
originality and private-source signals, topic activity, and validation status.
The current publication is atomically marked unpublished, cache entries are
invalidated, retrieval follows the new pointer, and sessions pinned to the
displaced version stop.

## Attribution and audit

`question_lifecycle_events` is the append-only academic record. It captures the
question/version, action, from/to state, actor identity and role snapshots,
requestor/executor when different, bounded reason/note, idempotency and request
IDs, safe metadata, and time. `question_approval_history` remains immutable
legacy evidence.

`audit_events` records successful transitions plus failed, denied, stale, and
generation-failure attempts. Lifecycle events and audit events are append-only;
student DTOs contain neither identities nor review notes.

## Professor API

- `GET /api/professor/questions?view=lifecycle` lists lifecycle records.
- `POST /api/professor/questions` creates the initial draft.
- `GET /api/professor/questions/:id` returns versions, timeline, attribution,
  validation, and server-derived actions.
- `POST /api/professor/questions/:id/versions` creates an immutable draft from a
  selected base version with optimistic working-version concurrency. A
  professor `revision` request accepts only editable content and never accepts
  client-controlled provenance.
- `POST /api/professor/questions/:id/transitions` performs one attributed,
  idempotent transition.
- `POST /api/professor/questions/:id/regenerate` creates a version under the
  same question.
- `POST /api/professor/questions/inspections` records deliberate inspection of
  the current immutable review version for the signed-in professor.
- `POST /api/professor/questions/batch` atomically requests revision, rejects,
  or publishes 2–25 already-inspected versions. It never accepts `approve`.
- `GET /api/professor/review` returns canonical syllabus topics and aggregate
  lifecycle counts without question content. Supplying one `topicId` returns
  only that topic's `needs_review` working versions through a narrow,
  public-safe review DTO.

Invalid/stale transitions return `409`; content validation returns `422`;
unavailable records return `404`; authentication and authorization retain
`401`/`403`. Demo mode is read-only.

The professor review page requires topic selection before loading version
content, preserves a one-question-at-a-time decision flow, and submits review
decisions through lifecycle transitions. Approval never publishes content.
The question catalog offers generated-draft editing and requires a side-by-side
change summary and explicit confirmation before publish or rollback actions.

## Rollout and verification

Migration `011_question_content_lifecycle.sql` expands and backfills before any
legacy fields can be contracted. It preserves existing version IDs, approval
history, attempts, and sessions; pins sessions from their earliest attempt when
possible; maps legacy states; and publishes only formerly approved, public,
trusted content. Student queries, retrieval, response cache, sessions, attempts,
and professor operations use version pointers after migration.
Migration `012_professor_question_revisions.sql` preserves explicit `manual`
creation attribution when professors revise generated content while retaining
legacy generated-snapshot classification when no creation method is supplied.
Migration `013_safe_batch_review_operations.sql` adds append-only,
professor-specific version inspections used by batch preflight.

Before promotion, verify that every published lifecycle row has one matching
question pointer, no question has more than one published version, session and
retrieval version pairs belong to the same stable question, and both ledgers
reject update/delete operations.
