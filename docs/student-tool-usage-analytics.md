# Student tool usage analytics

The professor Students page reports two non-academic metrics per signed-in
student: **AI Help Requests** and **Est. Sketchpad Time**. The analytics tables
store only the internal application user id and public-safe context; they do
not store names, email addresses, Clerk subjects, answers, prompts, AI Help
messages, or Sketchpad content.

## AI Help requests

`POST /api/tutor/respond` records one event for an accepted, authenticated
request with `aiHelp: true`, after the owned session, question, and event id
have been validated. This includes student-initiated free-text drawer messages,
repeated or cached help, and requests whose downstream provider later fails.
It is therefore a request count, not a literal DOM-button click count.

The tutor event id is also the usage idempotency key, so replaying the same
request does not add another event. Usage persistence occurs before downstream
answer generation. A telemetry failure is logged without identity and never
blocks AI Help. The ledger is separate from academic attempts and cannot alter
answer checking, correctness, practice credit, or similar-practice behavior.

The student detail and overall roster show the all-topic total. The topic roster
counts only events whose stored `topic_id` matches that topic.

## Estimated Sketchpad active time

`POST /api/student/tools/sketchpad/heartbeat` accepts an empty body only. It
derives the internal student id and UTC bucket time on the server and accepts
neither a target user, timestamp, nor duration. Each accepted request can add
exactly one 15-second bucket. The primary key deduplicates concurrent tabs and
devices for one student in the same bucket; gaps never receive credit.

The intended external integration reports at most once every 15 seconds only
while its document is visible and focused and the student has produced pointer,
touch, or keyboard activity within the previous 75 seconds. It stops on blur,
hidden state, or idle and resumes only after new activity. The endpoint also
applies per-student and per-client-IP traffic limits independently of bucket
accounting.

Because heartbeat time estimates engagement rather than verifying human
attention, professor surfaces label it **Est. Sketchpad Time**.

## Measurement capability gate

The tutor currently opens `https://interactive-sketchpad.onrender.com/` in a
new cross-origin tab. Its source is not in this repository, and no heartbeat
integration is deployed. Professor surfaces therefore render **Not yet
measured**, not `0m`, regardless of stored totals.

`SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED` is parsed by the typed server
environment (`src/lib/env/server.ts`, boolean, default `false`, only `true` or
`false` accepted). The professor Students and student detail pages read it once
on the server and pass the decision to the components; nothing about it reaches
the browser, and no total is used to infer availability. The topic roster shows
no Sketchpad column at all, because buckets carry no topic.

Enable it only after all of the following are true:

1. The external Sketchpad reports heartbeats through a separately reviewed
   same-origin bridge or short-lived, narrowly scoped credential exchange.
2. A test student's real session has produced buckets in
   `student_tool_active_buckets` in the target environment, verified read-only.
3. The change window records the flag change like any other Production
   environment change.

Then set `SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED=true` in that environment
and redeploy. The flag controls display availability; it does not credit time.
Once enabled, a genuine measured zero displays as `0m` and credited buckets
display as an estimated duration.

The external integration must use an approved same-origin bridge or a
short-lived, narrowly scoped credential exchange. It must never put an internal
user id, name, email address, Clerk subject, or durable secret in a URL. The
current heartbeat route intentionally rejects cross-origin requests until that
integration receives a coordinated authentication and CORS review.
