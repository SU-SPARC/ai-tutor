# Reserve-first similar practice

Status: explicit relationship model implemented 2026-09-17.

The preserved proposal for a possible later generated-variant fallback is in
[practice-variants-future.md](practice-variants-future.md). It is not part of
the implemented flow described here.

“Practice a similar problem” uses only professor-approved questions from
Reserve that are explicitly assigned to the exact published origin version.
It does not infer similarity from topic or other metadata, select another
normally published question, or generate a question with an LLM.

## Content governance

Reserve remains a disposition, not a lifecycle state. A question is eligible
only when all of these are true:

- the record and topic are active;
- the working version is `approved` or `unpublished`;
- no version is published;
- Save for later is still active;
- the professor has explicitly enabled “Allow as similar-problem practice”;
- topic and question availability windows permit access.

The permission defaults off, is stored as
`questions.reserve_practice_allowed`, and is changed through the audited
Reserve endpoint. `allow_practice` and `disallow_practice` events are appended
to `question_reserve_events`. Releasing Reserve clears the permission.

Eligible questions remain absent from `app_public_questions`, normal question
APIs, Topics, Practice listings, search, and direct `/practice/[questionId]`
navigation. The internal `app_reserve_practice_questions` view is server-only
and applies the eligibility and availability rules above.

## Student entry and ownership

The only entry point is:

`POST /api/tutor/session/[sessionId]/similar`

The origin session must be owned by the caller and either completed or on the
partial-credit route (three valid answer attempts on the question and the
worked solution fully revealed — see [practice credit](practice-credit.md)).
The server—not the browser—loads the origin's eligible, explicitly linked
Reserve siblings. The request accepts no question ID, so a student cannot
enumerate or substitute a Reserve ID.

On a match, the server creates an ordinary tutor session with:

- `practice_context = 'reserve_practice'`;
- `origin_session_id` set to the qualifying owned session;
- `question_version_id` pinned to the eligible working version;
- a deterministic idempotency key for the origin/candidate pair.

A database trigger (migration 026) rejects a Reserve-practice session unless
an exact origin-question/version to Reserve-question/version relationship is
present, the origin remains the current published version, the sibling remains
the current eligible Reserve working version, the origin qualifies under the
same rule as the server, the owners match, and the two questions differ. The
normal session-creation API remains
published-only. Session reads and tutor responses re-check eligibility, so
changing an ID or retaining a withdrawn session URL does not broaden access.

If no candidate is available, the UI says:

> No additional approved practice problem is available for this question yet.

There is no published-question or generated-question fallback.

## Explicit relationship and deterministic ordering

`question_similarity_links` stores a stable row ID, the reviewed origin and
sibling, exact version IDs, `similar_practice` relationship type,
professor-selected slot 1–3, creator, timestamp, and optional attributed
revocation. One published origin may have at most three active slots, and a
Reserve sibling may belong to only one active origin. Rows are historical:
changing an assignment means soft-revoking it through the audited professor
workflow and creating the replacement. Hard deletion and in-place reassignment
are rejected.

Active-only partial unique indexes enforce origin-slot, sibling, and pair
uniqueness while preserving revoked rows. Revocation is allowed by stable link
ID even after the origin is unpublished, because removing future eligibility
must not depend on a current publication pointer. Assignment remains strict:
the origin must be the exact current public version and the sibling the exact
current eligible Reserve working version.

Both versions are pinned. Availability changes or temporarily disabling
Reserve practice make a relationship ineligible without deleting it, so the
same pinned relationship resumes when eligibility is restored. Publishing a
new origin version or creating a new Reserve working version makes the old
relationship stale; a professor must revoke it, review the new content, and
assign a new relationship. The old row remains available only as exact
historical credit evidence.

Cross-topic links are deliberately disallowed in both the application and the
database. Topic membership does not prove similarity, but the dedicated sibling
rollout is topic-scoped and a reviewed sibling must stay in the same topic as
its origin.

Among the origin's eligible linked siblings, selection prefers a question the
student has not practiced, then professor slot, reservation timestamp, and
stable question ID. Topic, difficulty, pattern IDs, and misconception IDs do
not create relationships or expand the candidate set.

No LLM call or token usage occurs during selection.

## Tutoring and withdrawal

The selected version uses the normal tutor engine for deterministic checking,
misconception feedback, hints, solution reveal, retrieval, and any LLM fallback
allowed by the existing tutor policy. Practicing never changes the question's
Reserve disposition, lifecycle state, working version, or publication pointer.

The workspace shows a persistent Extra practice banner and keeps the Reserve
question out of its sidebar. An owned session can be resumed with
`/practice?sessionId=...`; the session response provides only the safe question
summary needed by that workspace.

Disabling similar practice or releasing Reserve marks active and completed
Reserve-practice sessions `content_unpublished`. Subsequent session reads and
tutor actions return the same concealed unavailable response used for other
withdrawn content.

## Progress and analytics

Reserve-practice sessions are normal persisted tutor interactions marked by
`practice_context`. Assigned-question completion, accuracy, attention signals,
and the version-1 pilot analytics export filter to `published` sessions.

Student progress reports the number of extra-practice sessions separately and
labels owned recent sessions as Extra practice. Professor cohort and student
analytics report separate extra-practice session counts, while their existing
assigned-work metrics remain unchanged.

A Reserve session is read by the per-question
[practice credit evidence](practice-credit.md): solving it supports the
partial-credit route only when its exact question/version pair is explicitly
linked to the exact origin question/version. The exact row may be active or
revoked later; revocation never erases already-earned evidence. Legacy or
manually corrupted same-topic Reserve sessions remain historical records but
cannot earn credit.
The student-facing copy says so rather than calling it practice that does not
count.

## Verification invariants

- An eligible Reserve question is absent from every normal student catalog.
- A disabled, rejected, draft, revision-requested, archived, stale, or
  unavailable Reserve version cannot create a Reserve-practice session.
- A student cannot create or read another student's session.
- The normal session API cannot create a session for a Reserve question.
- Practicing a Reserve question does not publish it or change its lifecycle.
- Withdrawing eligibility prevents further reads and tutor interactions.
- Selection reads only the origin-scoped relationship set and makes no LLM call.
