# Anonymous Student Sessions

The MVP does not require login. On the first visit to student practice,
`getOrCreateAnonymousStudentId()` creates an opaque random ID and stores it in
browser local storage under `suffolk-tutor-anonymous-student-id`.

The ID contains no name, email address, or campus identifier. It is sent only
when creating a tutor session or requesting that browser's aggregate progress.
Saved session keys are scoped to both the anonymous ID and question, so
changing the local anonymous identity does not resume another identity's saved
session or load its progress.

Tutor sessions store the ID in `tutor_sessions.anonymous_user_id`. Attempts are
linked to the student through `attempts.session_id`, which references that tutor
session. The same opaque ID also supplies the server-side HMAC scope used for
AI quotas and per-student response caching; raw IDs are not used as cache or
quota keys.

## MVP Limitations

- The ID provides browser continuity, not authentication or access control.
- Clearing site storage creates a new anonymous identity and loses locally
  saved session pointers. This can also reset low-friction prototype limits.
- When local storage is unavailable, the helper returns an ephemeral ID for the
  current page load.
- Demo progress is held in server memory and is lost when the demo server
  restarts. Postgres-backed progress is durable.
- No names or email addresses are requested or needed.

## Future Authentication

The browser identity boundary lives in
`src/lib/auth/anonymous-student.ts`. Campus authentication can replace this
identity resolver while preserving the tutor-session repository and attempt
relationship. At that point, session creation should resolve the authenticated
student on the server instead of accepting the anonymous ID from the browser.
