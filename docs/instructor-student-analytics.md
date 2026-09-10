# Instructor student analytics

A professor can inspect how students are using the tutor: a class list, one
student's practice record, and the cohort aggregate. Every figure is computed
deterministically from tutor sessions and attempts that the tutor already
records. No model is involved, and no analytics table was added.

## Student identity

A participating student owns a meaningful published practice session: either an authenticated user
(`tutor_sessions.user_id`) or an anonymous cookie subject
(`tutor_sessions.anonymous_user_id`). Instructor surfaces never see either.

The repository derives a **student key** in SQL —
`sha256('user:' || user_id)` or `sha256('anon:' || anonymous_user_id)`, hex
encoded — and that digest is the only handle that leaves the server. It is
stable across sessions, so a professor can follow one student over time, and it
reveals nothing about the cookie, the account, or the row it came from. The two
namespaces are prefixed before hashing so they cannot collide.

The UI shortens the digest to a label such as `Student 8F2A`. When two keys in
one listing share that prefix, both labels lengthen rather than showing one name
for two people.

If campus authentication is added later, the underlying `users` row is already
linked to the session; only the digest input would change, not the analytics.

## What the instructor sees

| Surface                            | Contents                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/professor/students`              | One row per student: sessions, attempts, correct, topics, hints, solutions, last active. Sortable and searchable by student code, paginated at 25. |
| `/professor/students/[studentKey]` | Summary metrics, per-topic performance, a 30-day activity trend, recorded misconception codes, and the most recent 30 interactions.                |
| `/professor/analytics`             | Cohort totals, the rule/retrieval/LLM/blocked split, most recorded misconceptions, and a count of students showing repeated difficulty.            |

## What it deliberately does not return

- The submitted answer, and the stored misconception feedback text. An attempt
  row reports only _that_ a misconception was matched.
- Retrieval chunks, prompts, and provider payloads — none are read.
- The student's name, email address, user id, or anonymous cookie value.

## Counting rules

A **practice session** is a tutor session with at least one persisted tutoring
interaction or durable progress evidence. Opening, browsing, reloading, or
recovering a question alone does not count. See the shared
[engagement definition and architecture audit](tutor-session-engagement.md).
Student lists, drilldown, cohort totals, question analytics, attention signals,
and pilot export use this same population. Historical opened rows remain stored
but do not create activity, participants, topics, or recent-practice entries.
The excluded-professor-session count also counts only meaningful sessions.

Assigned-work counts, correctness, hint/solution totals, attention signals, and
misconception trends include only `practice_context = 'published'` sessions.
Reserve similar-practice sessions are excluded from those metrics and reported
separately, only after meaningful use, as `extraPracticeSessions` in student and cohort summaries.

- **Attempts** are rows with `mode = 'check'`. Hint and solution requests are
  separate interactions and never inflate the attempt count.
- **Hints and solutions** are summed from `tutor_sessions.revealed_hints` and
  `revealed_steps`, matching the existing practice analytics.
- **Misconception codes** come from `tutor_sessions.last_misconception_ids_json`
  and are therefore counted per session, not per attempt: an attempt row stores
  the feedback that was shown, while the session stores the ids that produced
  it. See the limitation below.
- **Accuracy** is the share of answer submissions marked correct. It is not a
  mastery model, and the UI does not call it one.

## Attention signals

`deriveAttentionSignals` produces explainable signals, never a ranking:

- `repeated_topic_difficulty` — at least 4 attempts on a topic with 40% or fewer
  correct.
- `solution_reliance` — at least 3 solutions revealed on a topic, more than the
  number of correct attempts.
- `repeated_misconception` — the same misconception code recorded in 3 or more
  sessions.

Every signal carries the counts it was derived from, so the instructor can check
the reasoning rather than trust a label.

## Demo mode

Demo mode keeps tutor sessions in an in-process store readable only per owner,
so there is no cohort to enumerate. The list and the cohort panel say so plainly
rather than showing synthetic students that could be mistaken for real ones.

## Known limitation

Misconception **codes** are recorded per session, not per attempt, so the
per-attempt view can only report whether a misconception was matched. Attaching
codes to `attempts` would need a migration and is not required by anything here;
it is worth doing if per-attempt misconception trends become important.

## Scored correctness versus activity

Student, cohort, and question/topic correctness percentages use scored checks
(`correctAttempts + incorrectAttempts`). The minimum evidence threshold and
low-accuracy attention signal use that same denominator. Guidance, unreadable
numeric submissions, and blocked requests still count as interaction activity,
but cannot lower correctness or independently trigger repeated-difficulty
attention. Reserve-practice counts remain separate. See
[answer-checker.md](answer-checker.md) for typed and legacy grading behavior.
