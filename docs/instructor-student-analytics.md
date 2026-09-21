# Instructor student analytics

A professor can inspect how students are using the tutor: a class list, one
student's practice record, and the cohort aggregate. Every figure is computed
deterministically from tutor sessions and attempts that the tutor already
records. No model is involved, and no analytics table was added.

## Student identity

The Students page lists every **signed-in student account** from the moment
of its first sign-in, before any practice, together with every owner of a
meaningful published practice session. A signed-in student account is a human
`users` row with `status = 'active'` and no current `professor` grant in
`user_roles`, the database projection of the authoritative Clerk role; system
actors, disabled and deleted accounts, and professors are not students and are
never listed. The session branch is how anonymous pilot students
(`tutor_sessions.anonymous_user_id`) are known. Both branches are unioned by
student key, so a student who has signed in and practised is one row.
Instructor surfaces never see the user id or the anonymous cookie subject.

A student who has signed in but not practised shows truthful zeros, no
first- or last-active time, and a detail page that says so; nothing about
their progress is inferred. Their row is not a participant in the pilot
export, and they do not count as an active student in the cohort panel: both
of those describe recorded practice, not the roster.

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
| `/professor/students`              | One row per student: username, sessions, attempts, correct, topics, hints, solutions, last active. Sortable and searchable by student code, paginated at 25. Under every sort, students with no recorded activity follow every active student, in student-key order. A **By topic** view (`?view=topics`) lists the same population grouped by practised topic; see below. Usernames are read live from Clerk for the signed-in professor and audited; see [student identity reveal](student-identity-reveal.md). |
| `/professor/students/[studentKey]` | Summary metrics, per-topic performance, per-question [practice credit evidence](practice-credit.md), a 30-day activity trend, recorded misconception codes, and the most recent 30 interactions. |
| `/professor/analytics`             | Cohort totals, the rule/retrieval/LLM/blocked split, most recorded misconceptions, and a count of students showing repeated difficulty.            |

## Students by topic

The Students page's **By topic** view groups the same population by the
syllabus topics each student has practised. The association is derived, never
assigned or stored: a student is under a topic when they have a published
session on one of its questions or an answer submission recorded against it —
the same two sources the per-student topic performance uses — so a student who
has practised several topics is listed under each of them, from one `users`
row, and a student who has practised none is listed once under "No topic
practice yet". Topics keep their syllabus order, and within each topic
students are ordered by username. The usernames, where they come from, and
how each display is recorded are described in
[student identity reveal](student-identity-reveal.md); the analytics queries
themselves remain pseudonymous.

## What it deliberately does not return

- The submitted answer, and the stored misconception feedback text. An attempt
  row reports only _that_ a misconception was matched.
- Retrieval chunks, prompts, and provider payloads — none are read.
- The student's name, email address, user id, or anonymous cookie value.
  Usernames are not analytics fields either: the Students page resolves them
  separately, from Clerk, for the signed-in professor.

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

- **Attempts** (labelled _Answer submissions_ on the detail page) are rows with
  `mode = 'check'`. Hint and solution requests are separate interactions and
  never inflate the attempt count.
- **Valid attempts**, used only by the practice credit evidence, are check rows
  with a `correct` or `incorrect` verdict; unreadable and blocked submissions
  are excluded. See [practice credit evidence](practice-credit.md).
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
