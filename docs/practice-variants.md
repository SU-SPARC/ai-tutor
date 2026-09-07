# Reserve-first similar practice

Status: implemented 2026-09-06.

The preserved proposal for a possible later generated-variant fallback is in
[practice-variants-future.md](practice-variants-future.md). It is not part of
the implemented flow described here.

“Practice a similar problem” uses professor-approved questions from Reserve.
It does not select another normally published question and does not generate a
question with an LLM.

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

The origin session must be owned by the caller and completed. The server—not
the browser—loads and ranks eligible Reserve candidates. The request accepts no
question ID, so a student cannot enumerate or substitute a Reserve ID.

On a match, the server creates an ordinary tutor session with:

- `practice_context = 'reserve_practice'`;
- `origin_session_id` set to the completed owned session;
- `question_version_id` pinned to the eligible working version;
- a deterministic idempotency key for the origin/candidate pair.

A database trigger rejects a Reserve-practice session unless the candidate is
still eligible, the version is current, the origin is complete, the owners
match, and the two questions differ. The normal session-creation API remains
published-only. Session reads and tutor responses re-check eligibility, so
changing an ID or retaining a withdrawn session URL does not broaden access.

If no candidate is available, the UI says:

> No additional approved practice problem is available for this question yet.

There is no published-question or generated-question fallback.

## Deterministic ranking

Candidates must share the origin question's topic. The remaining order is
lexicographic:

1. same difficulty;
2. shared legitimate pattern ID;
3. number of shared misconception IDs;
4. not previously practiced by this student;
5. oldest reservation timestamp;
6. question ID.

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

## Verification invariants

- An eligible Reserve question is absent from every normal student catalog.
- A disabled, rejected, draft, revision-requested, archived, stale, or
  unavailable Reserve version cannot create a Reserve-practice session.
- A student cannot create or read another student's session.
- The normal session API cannot create a session for a Reserve question.
- Practicing a Reserve question does not publish it or change its lifecycle.
- Withdrawing eligibility prevents further reads and tutor interactions.
- Selection and ranking make no LLM call.
