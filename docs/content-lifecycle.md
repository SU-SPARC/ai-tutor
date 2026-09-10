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

## Typed final-answer configuration

Phase B supports optional numeric, categorical, and number-list `answer.spec`
metadata. Its sole persisted authority is the newly created immutable version's
`snapshot_json.answer.spec`; editing it creates a revision and pinned sessions
keep the exact old configuration. Legacy snapshots remain unchanged. See
[answer-checker.md](answer-checker.md) for authoring controls, the professor-only
non-persisting simulator, deterministic AI intake validation, and publication
gates. AI proposals never bypass professor review or publish automatically.

## Tutor behavior

For numeric questions, an unreadable submission returns guidance when it matches
no misconception and AI fallback is disabled. It does not count as a wrong
attempt or reveal another hint. The check is still recorded and appears in the
pilot export's unscored bucket (`unscoredAnswerAttempts`). Text questions,
recognized misconceptions, and requests with AI fallback enabled continue
through the existing feedback and coaching paths.

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

## AI question intake saves

`PUT /api/professor/question-intake` turns a professor-reviewed AI draft into a
new question aggregate and, in the same transaction, submits the immutable
first version so it lands in `needs_review`. The `submit` event is attributed
to the professor and carries whitelisted metadata (`source: question_intake`,
input mode, model, answer type) plus a note describing the analysis, so the
timeline states where the version came from without a schema change. Nothing
is approved or published by saving: the Review Queue shows the question under
its topic, the lifecycle table lists it, and `/professor/questions/{id}`
reopens it with every field, the revision editor, and the normal approve and
publish actions.

Saves are idempotent per browser draft. The client sends one `Idempotency-Key`
per generated draft; the server derives the stable question ID from the
professor and that key, so a repeated click or a retry after a timeout returns
the already-committed question (`200`, `replayed: true`) instead of creating a
second one. Storage failures return `503` with no success payload and log only
the error class, question ID, and user ID.

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

Publication preview uses the same item preflight without a transaction or any
write. Items are checked sequentially so one 25-item preview cannot exhaust the
four-connection runtime pool. It reports each version as ready or blocked; the
professor may remove blocked selections and preview the remaining set before
submitting the normal atomic commit.

## Save for later

Save for later is an audited disposition, not a lifecycle state. It is limited
to an active `approved` or `unpublished` working version with no published
pointer. The working version stays immutable and approved, while the reserve
flag prevents publication, revision, regeneration, provenance correction, and
other lifecycle changes until a professor removes the disposition. Reserved
questions are absent from student views and intentional reserves are excluded
from waiting-to-publish warnings.

`question_reserve_events` is an append-only professor-attributed ledger for
reserve, release, allow-practice, and disallow-practice actions. The current disposition lives on `questions` for
filtering. The runtime role has SELECT plus the exact INSERT permission needed
for the ledger, UPDATE on `questions`, and a role-scoped RLS policy; Data API
roles retain no access.

## Publication quality gates

Every single publish, rollback, and batch publish evaluates the same ordered,
deterministic quality gates. A version must reference an active syllabus topic;
contain question text, a schema-valid final answer, solution steps, and at
least one useful non-answer hint; contain no private-source metadata; carry a
public-safe source/originality classification and unique stable ID; be approved
or previously unpublished; pass current schema and content-hash validation;
and have immutable professor approval evidence for that exact version.

Blocked single operations return `422` with all applicable `{code, message}`
reasons. Batch preflight attaches the same reasons to each failed item and
changes no questions. Migration `015_question_publication_quality_gates.sql`
also enforces the gates on publication pointer and lifecycle-state writes so a
direct procedure or SQL caller cannot bypass the application evaluator.

## Versions, generation, and rollback

`question_versions` contains the authoritative aggregate, parent lineage,
creation method, schema version, legacy MD5 fingerprint, and a SHA-256 content
hash that excludes workflow fields. Material edits and regeneration create a
new version; lifecycle transitions do not.

When a professor changes difficulty while approving in the Review Queue, the
server clones the complete authoritative working snapshot into a new `manual`
version, changes only difficulty, submits it through normal lifecycle
validation, and approves that exact version. The earlier version remains
immutable. The submit/approve events retain the previous and selected
difficulty as whitelisted professor timeline metadata.

Professors may revise any active, public-safe working version, including a
currently published version. The revision endpoint accepts only wording,
difficulty, answer structure, solution steps, hints, misconception notes, topic
mapping, and an optional bounded history comment. Source type, trust,
visibility, generation provenance, and stable question ID are derived from the
base version on the server. Each edit creates a new `manual` draft with parent
lineage, professor identity, timestamp, and comment recorded; the source
version remains immutable. Editing a published version leaves its publication
pointer and all pinned sessions unchanged until the new draft is separately
reviewed and published. Numeric answers and tolerances, required solution
structure, bounded field counts, active topic mapping, and private-source
wording are validated before the draft is stored.

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

Professor rejection and revision requests use stable review reason codes plus
an optional note; `other` requires the note. Lifecycle-only actions also offer
content correction, restore previous release, and course retired choices.
Historical and unknown reason codes remain readable through friendly fallback
labels.

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
- `POST /api/professor/questions/:id/reserve` records or removes Save for later
  and controls whether an already-reserved approved version may be selected
  for optional similar-problem practice
  on the exact active working version.
- `POST /api/professor/questions/inspections` records deliberate inspection of
  the current immutable review version for the signed-in professor.
- `POST /api/professor/questions/batch` atomically requests revision, rejects,
  or publishes 2–25 already-inspected versions. `mode: preview` runs the
  publication preflight without mutation. It never accepts `approve`.
- `GET|POST /api/professor/content-transfer` provides professor-only sanitized
  JSON exports and dry-run-first transactional imports. See
  [Protected question content transfer](./content-transfer.md).
- `GET /api/professor/review` returns canonical syllabus topics and aggregate
  lifecycle counts without question content. Supplying one `topicId` returns
  only that topic's `needs_review` working versions through a narrow,
  public-safe review DTO.
- `POST /api/tutor/session/:sessionId/similar` is an owned-student-resource
  mutation that selects an eligible Reserve version and creates the protected
  optional-practice session after completion without accepting a question ID
  from the client. It ranks only explicitly enabled, currently available
  Reserve questions in the same topic and returns no private review metadata.

Invalid/stale transitions return `409`; content validation returns `422`;
unavailable records return `404`; authentication and authorization retain
`401`/`403`. Demo mode is read-only.

The professor review page requires topic selection before loading version
content, preserves a one-question-at-a-time decision flow, and submits review
decisions through lifecycle transitions. Approval never publishes content.
The question catalog offers immutable revision editing and a professor-only
history inspector with full version content, parent/regeneration lineage,
working and published pointers, hashes, actors, timestamps, lifecycle reasons,
and comments. It requires a side-by-side change summary and explicit
confirmation before publish or rollback actions. Student DTOs never contain
these audit fields.

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
Migration `022_question_reserve_disposition.sql` adds the current reserve
columns, consistency/visibility guards, and append-only reserve ledger. It does
not create a new lifecycle state or mutate an existing question version.

Before promotion, verify that every published lifecycle row has one matching
question pointer, no question has more than one published version, session and
retrieval version pairs belong to the same stable question, and both ledgers
reject update/delete operations.
