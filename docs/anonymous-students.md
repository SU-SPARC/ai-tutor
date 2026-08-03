# Anonymous Student Sessions

Anonymous practice is an optional, student-only pilot. The server creates an
opaque identifier and stores it in the `suffolk-tutor-anonymous` cookie. The
cookie is signed, HTTP-only, SameSite=Lax, Secure on HTTPS, and expires after
`ANONYMOUS_COOKIE_DAYS`. Browser JavaScript never receives the identifier and
API requests never accept an anonymous ID in a body or header.

Every tutor-session repository operation takes a server-resolved
`StudentOwner`: either the authenticated `users.id` or the verified anonymous
cookie subject. Database reads and writes match both the session ID and owner;
a known session ID belonging to another owner returns 404. API responses omit
`user_id` and `anonymous_user_id`.

Production-like environments require an explicit
`ANONYMOUS_PILOT_ENABLED` decision. An enabled deployed pilot also requires a
separate `ANONYMOUS_ID_SECRET` and explicit cookie duration. Local development
uses a per-process random signing key when no secret is configured, so a server
restart can invalidate local anonymous continuity.

## Import after sign-in

Sign-in does not automatically attach browser history. The account page asks
the user to choose whether to import, with a shared-device warning. A claim:

- verifies the signed cookie;
- hashes the anonymous subject before recording the one-account-only claim;
- moves matching sessions to the authenticated user in one transaction;
- records migrated counts and an audit event; and
- is idempotent for the same destination account.

Declining clears the cookie without linking its history. The old local-storage
identifier is supported only when the explicitly time-limited legacy bridge is
enabled. Possession is its only proof, so the bridge is rate-limited and each
legacy identity can be claimed once. Browser storage is removed only after a
successful exchange.

Anonymous identity is pseudonymous personal data, not authentication,
institutional affiliation, or account recovery. Clearing or losing the cookie
loses browser continuity, and anonymous history is unavailable across devices.
