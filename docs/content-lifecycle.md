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

## Versions, generation, and rollback

`question_versions` contains the authoritative aggregate, parent lineage,
creation method, schema version, legacy MD5 fingerprint, and a SHA-256 content
hash that excludes workflow fields. Material edits and regeneration create a
new version; lifecycle transitions do not.

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
  selected base version with optimistic working-version concurrency.
- `POST /api/professor/questions/:id/transitions` performs one attributed,
  idempotent transition.
- `POST /api/professor/questions/:id/regenerate` creates a version under the
  same question.
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

## Rollout and verification

Migration `011_question_content_lifecycle.sql` expands and backfills before any
legacy fields can be contracted. It preserves existing version IDs, approval
history, attempts, and sessions; pins sessions from their earliest attempt when
possible; maps legacy states; and publishes only formerly approved, public,
trusted content. Student queries, retrieval, response cache, sessions, attempts,
and professor operations use version pointers after migration.

Before promotion, verify that every published lifecycle row has one matching
question pointer, no question has more than one published version, session and
retrieval version pairs belong to the same stable question, and both ledgers
reject update/delete operations.
