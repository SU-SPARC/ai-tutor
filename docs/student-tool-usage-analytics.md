# Student tool usage analytics

Professors see two non-academic metrics per signed-in student. The student's
record shows **Asked the AI tutor** and, once measured, **Time on sketchpad**
(an estimate; helper "About how long they spent drawing on the sketchpad, all
topics, since they joined. An estimate."). Students by topic shows the AI tutor
count per topic in the column **Asked the AI tutor**. The All students list
shows neither. The analytics tables store only the internal application user id
and public-safe context; they do not store names, email addresses, Clerk subjects, answers, prompts, AI Help
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

The student's record shows the all-topic total, with the helper "Times they
asked the AI tutor for help, across all topics since they joined. Asking is a
good sign, and it's not part of any grade. See Students by topic for each
topic." (or "They haven't asked the AI tutor yet." at zero). The tile is hidden when `AI_ENABLED` is false for the
deployment. Students by topic counts only events whose stored `topic_id`
matches that topic, and shows "—" for zero. The record's own Topics practiced
table has no per-topic count (the record's topic query does not read usage
events); the tile's helper points to Students by topic instead.

Recent activity on the record cannot yet tell an AI tutor request from an
answer check: both are stored as `mode = 'check'`, and `verdict = 'guidance'`
is also used for empty and unreadable answers. Telling them apart needs the
attempt joined to `student_usage_events` by session and idempotency key.

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
attention, the tile's helper ends "An estimate." Durations are written in
words: "None yet", "Under a minute", "1 minute", "12 minutes", "1 hour",
"2 hours 5 minutes".

## Measurement capability gate

The tutor currently opens `https://interactive-sketchpad.onrender.com/` in a
new cross-origin tab. Its source is not in this repository, and no heartbeat
integration is deployed. While measurement is off, the record page does not
render the Time on sketchpad tile at all, regardless of stored totals.

`SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED` is parsed by the typed server
environment (`src/lib/env/server.ts`, boolean, default `false`, only `true` or
`false` accepted). The student record page reads it once on the server and
passes the decision to the component; the join page, onboarding and account page
read it to decide whether the student notice mentions sketchpad time. Nothing
else about it reaches the browser, and no total is used to infer availability. The topic roster shows
no Sketchpad column at all, because buckets carry no topic.

Enable it only after all of the following are true:

1. The external Sketchpad reports heartbeats through a separately reviewed
   same-origin bridge or short-lived, narrowly scoped credential exchange.
2. A test student's real session has produced buckets in
   `student_tool_active_buckets` in the target environment, verified read-only.
3. The change window records the flag change like any other Production
   environment change.
4. Student notice updated: join note, onboarding, account row and the full
   notice say "Your professor sees about how long you spend on the sketchpad,
   not what you draw." (gated on the flag). This is wired to the flag: when it
   is true, the join note, onboarding paragraph and account row read "Your
   professor also sees how many times you asked the AI tutor and about how long
   you spent on the sketchpad, not what you wrote or drew." and the full notice
   adds the sentence above. Check the wording is still true of the bridge before
   enabling.

Then set `SKETCHPAD_ACTIVE_TIME_MEASUREMENT_ENABLED=true` in that environment
and redeploy. The flag controls display availability; it does not credit time.
Once enabled, the tile appears; a genuine measured zero displays as "None yet"
and credited buckets display as an estimated duration in words.

The external integration must use an approved same-origin bridge or a
short-lived, narrowly scoped credential exchange. It must never put an internal
user id, name, email address, Clerk subject, or durable secret in a URL. The
current heartbeat route intentionally rejects cross-origin requests until that
integration receives a coordinated authentication and CORS review.
