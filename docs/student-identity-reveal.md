# Student identity reveal

Professor practice analytics are keyed by a pseudonym — `Student 50DB` — and
nothing in an analytics row carries a name, an email address, or a browser
identifier. An authorized instructor can nevertheless ask who one pseudonym
belongs to, because a course sometimes requires reaching a particular student.
The reveal is a separate, explicit action rather than a column in the table.

## How the pseudonym maps back

A student key is `sha256('user:' || users.id)` for a signed-in student and
`sha256('anon:' || anonymous_user_id)` for the anonymous pilot, computed in SQL
in `STUDENT_KEY_SQL`. The digest is never reversed. The reveal recomputes the
same digest forwards over the sessions that already form the analytics
population and joins the owner it matches to its own `users` row, reading only
`identity_provider` and `external_subject` from it. A key that belongs to no
student in that population resolves to nothing, so the endpoint cannot be used
to probe accounts the analytics do not already list — a professor's own
practice included, since staff sessions are excluded from the population.

`users.display_name` and `users.email` exist as an account projection that
Clerk refreshes at every sign-in, but the reveal does not read them: Clerk is
authoritative, so the display name and primary email address are read live from
the Clerk Backend API at the moment the instructor asks. Nothing is written
back. No analytics table, export, aggregate, prompt, or log gains an identity
field.

## Boundary

`POST /api/professor/students/[studentKey]/identity` is the only surface that
returns an identity. It calls `requireAnalyticsAccess` before it reads the
student key, so an unauthorized caller is refused without learning whether the
student exists: signed out is `401`, an ordinary student is `403`. A key that
is not a 64-character hex digest and a key that matches nobody both answer
`404` with the same body. The response contains at most `status`,
`displayName`, and `email`; the Clerk subject, the internal user id, and every
other profile field stay on the server. The URL carries only the pseudonym.

Four outcomes are reported:

| Status        | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `identified`  | Display name, and the primary email address when one exists. |
| `anonymous`   | The student practised without signing in.                    |
| `unlinked`    | The identity provider no longer holds the account.           |
| `unavailable` | The provider could not be reached, or the reveal could not be audited. The analytics still load. |

Clerk failures never reach the instructor as provider text: neither the error
nor its body is logged, because both can carry the account's own identifiers.

## Audit

Each reveal writes one `audit_events` row with action
`analytics.student_identity_viewed`, the acting professor, the pseudonymous
student key, the request id, and the outcome. The name and the email address
that were shown are not recorded.

The reveal **fails closed**. The order is resolve, look up, record, and only
then return: if the audit row cannot be written — a rejected statement, or a
statement that inserts nothing — the resolved identity is discarded and the
instructor is shown `unavailable` instead. An unauditable reveal is therefore
indistinguishable from one that found no identity, and the underlying database
error is neither returned nor logged, because the identity is in scope where it
is raised.

## Interface

The Students list stays pseudonymous, and its search box still matches only the
student code. A reveal happens on one student's detail page, behind a
**Reveal identity** button. Nothing about a reveal is stored in the browser, so
leaving or reloading the page returns the record to its hidden state.
