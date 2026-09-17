# Practice credit evidence

The course awards credit for tutor practice under a policy the professor
applies. The tutor is not a gradebook: it records what happened and shows the
instructor which route of the policy that evidence supports. Nothing in the
product computes or stores a grade, and nothing is sent to Canvas.

## The policy

- **Full credit (1.0)** — the assigned question was answered correctly within
  **three valid answer attempts**, and the worked solution was **not**
  revealed before that first correct answer. Revealing the solution first ends
  eligibility for this route on the question; solving the original afterwards
  does not restore it.
- **Partial credit (0.9)** — the question was not completed on the full-credit
  route, and the student then solved the **linked similar problem**. The
  documented fallback (no similar problem available → Start over → solve the
  original) is the instructor's to apply by hand; see the evidence gap below.

The three-attempt threshold classifies evidence. It never caps practice: the
student can keep answering, use hints, open the solution, and continue.

## Valid answer attempts

One definition, in `src/lib/tutor/practice-credit.ts`, shared by the student
dashboard (TypeScript) and the instructor analytics (the matching SQL
fragment). A **valid answer attempt** is an attempt row with

- `mode = 'check'` (a legacy row with no mode is a check), and
- `verdict in ('correct', 'incorrect')`.

Everything else is a recorded interaction but not an attempt:

| Interaction                         | Row                             | Counts? |
| ----------------------------------- | ------------------------------- | ------- |
| Readable answer, right or wrong     | `check` / `correct`,`incorrect` | yes     |
| Unreadable or empty submission      | `check` / `guidance`            | no      |
| Blocked response                    | `check` / `blocked`             | no      |
| Hint                                | `hint`                          | no      |
| Solution step or full solution      | `solution`, `full_solution`     | no      |
| AI help                             | `check` / `guidance`,`blocked`  | no      |

`tutor_sessions.attempt_count` is **not** this number. It counts every engine
transition (hints and solution reveals included) and feeds AI-help repeat
detection and the engagement rule; it keeps that meaning. Valid attempts are
always derived from attempt rows, never from the counter.

An unreadable submission tells the student *"Couldn't read that answer —
This was not counted as an attempt. Retype your answer using the format shown
and try again."* It is still persisted for diagnostics.

## Derivation

`derivePracticeCreditEvidence` takes, for one student and one assigned
question:

- every interaction across **all** of the student's published sessions for
  the question, ordered by time (Start over creates a new session; ordering
  across sessions is what stops a restart from resetting the count);
- the number of published sessions (`startOverUsed` when more than one);
- the linked similar problems — reserve-practice sessions whose
  `origin_session_id` is one of those published sessions **and** whose exact
  origin question/version and Reserve question/version match a historical
  `question_similarity_links` row — and whether each was attempted and solved;
- whether any session is recorded as solved (covers counter-only rows).

It returns `validAttempts`, `validAttemptsToFirstCorrect` (the position of the
first correct valid attempt), `workedSolutionViewedBeforeFirstCorrect` (a
`solution`/`full_solution` row before that attempt, or at all when never
solved), the similar-problem flags, and the route:

| Route             | Evidence                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `full`            | first correct valid attempt ≤ 3 and no worked-solution reveal before it                               |
| `partial_similar` | not `full`, and a linked similar problem was solved                                                   |
| `manual_review`   | not `full`, no solved similar problem, original solved after the worked solution — no number derived |
| `not_qualified`   | neither route proven (including solved on a 4th+ valid attempt with no solution and no similar)       |

### Evidence gap: the Start over fallback

The fallback "no similar problem was available, so Start over and solve the
original for 0.9" is **not derived**. Nothing persists that a similar problem
was unavailable — a `none` result from the similar-problem lookup writes no
row — so the record cannot distinguish that fallback from a student who simply
reworked the question after reading the solution. Rather than classify it on
insufficient evidence, the row reports `solved`, `startOverUsed`,
`workedSolutionViewedBeforeFirstCorrect`, and the attempt counts, and the
instructor applies the fallback manually: such rows are labelled **Manual
review** with the facts beside them. Recording the unavailable lookup would
need a new persisted event.

`origin_session_id` alone does not establish approved similarity. An unlinked
same-topic Reserve session, a different version pair, a different origin, or
another student's session never reaches the derivation. The matching
relationship may be active or later revoked: revocation stops future selection
but preserves the truthful historical 0.9 evidence for sessions created while
that exact version-pinned relationship existed.

## Where it appears

- **Student dashboard** — the Attempts figures count valid attempts only; the
  subtitle says the instructor determines credit.
- **Instructor student detail** (`/professor/students/[studentKey]`) — a
  *Practice credit evidence* table with one row per assigned question:
  status, valid attempts, worked solution before first correct, similar problem,
  Start over, and the credit route. It is built from three batched reads
  (sessions, interactions, linked reserve sessions) in
  `instructor-student-repository.ts`, never per question, and stays keyed by
  the pseudonymous student key. The raw metric is labelled *Answer submissions*
  so it cannot be mistaken for the valid-attempt count.
- Existing summary, topic, cohort, attention, and export metrics are unchanged.

## When a similar problem can be started

`similarProblemOriginQualifies` (application) and the trigger
`app_guard_tutor_session_practice_context` as replaced by migration
`026_question_similarity_links.sql` (database) enforce one rule:

- the origin session is solved or completed (the existing post-solve extra
  practice), **or**
- the origin is a published session whose pinned question version has at
  least one solution step, `revealed_steps` covers all of them, and the
  student has at least three valid answer attempts on that question across
  every published session they own.

Every other guard in 023 is unchanged: no origin on published sessions, the
published version for active sessions, same owner, different question, and a
currently eligible Reserve candidate. New Reserve-session creation additionally
requires an active (`revoked_at is null`) exact version-pinned relationship.
The workspace shows *Try a similar problem* only on eligible published-origin
sessions (never on a Reserve-practice sibling) once the worked solution is fully
revealed; the server answers 409 `TUTOR_SESSION_NOT_COMPLETE` until the attempts
exist, and the button explains the rule rather than failing.

## AI help is never an attempt

"Ask AI for help" sends `aiHelp: true`. The engine then skips the answer
checker entirely: the draft is context for the help, the reply is guidance or
blocked, the session cannot become solved, no misconception feedback is
issued, and the wrong-attempt counter does not move. The row is persisted as
`check` with a `guidance`/`blocked` verdict, so raw submission totals keep
their history while the valid-attempt count is untouched. `allowLlmFallback`
on its own keeps its long-standing meaning (rules first, AI if they do not
suffice) and still grades.

## Known limits

- A student who solves on a fourth valid attempt without opening the worked
  solution is `not_qualified` under the documented policy; the row still shows
  the attempt count so the instructor can decide otherwise.
- `startOverUsed` counts meaningful published sessions, so a restart that
  recorded nothing is not visible.
- Legacy sessions with counters but no attempt rows report `solved` without
  attempt detail rather than inventing attempts.
