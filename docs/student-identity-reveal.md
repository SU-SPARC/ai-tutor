# Student identity reveal

Professor practice analytics are keyed by a pseudonym — `Student 50DB` — and
nothing in an analytics row carries a name, an email address, or a browser
identifier. An authorized instructor can nevertheless ask who one pseudonym
belongs to, because a course sometimes requires reaching a particular student,
or who everyone is, because a class roster is easier to read by name. Both
reveals are separate, explicit actions rather than a column in the table.

## How the pseudonym maps back

A student key is `sha256('user:' || users.id)` for a signed-in student and
`sha256('anon:' || anonymous_user_id)` for the anonymous pilot, computed in SQL
in `STUDENT_KEY_SQL`. The digest is never reversed. The reveal recomputes the
same digest forwards over the population the Students page lists — signed-in
student accounts and the owners of the sessions that form the practice
analytics — and joins the owner it matches to its own `users` row, reading
only `identity_provider` and `external_subject` from it. A student who has
signed in but never practised therefore resolves exactly as one who has. A
key that belongs to no student in that population resolves to nothing, so the
endpoint cannot be used to probe accounts the Students page does not list:
professor accounts, system actors, and disabled or deleted accounts included.

`users.display_name` and `users.email` exist as an account projection that
Clerk refreshes at every sign-in, but the reveal does not read them: Clerk is
authoritative, so the display name, the username, and the primary email address
are read live from the Clerk Backend API at the moment the instructor asks. The
username is Clerk's own `username` field and is never assembled from the email
address, the name, or the subject; the project stores no username at all.
Nothing is written back. No analytics table, export, aggregate, prompt, or log
gains an identity field.

## Boundary

Two surfaces return an identity, and nothing else does.

`POST /api/professor/students/[studentKey]/identity` reveals one student. It
calls `requireAnalyticsAccess` before it reads the student key, so an
unauthorized caller is refused without learning whether the student exists:
signed out is `401`, an ordinary student is `403`. A key that is not a
64-character hex digest and a key that matches nobody both answer `404` with
the same body. The response contains at most `status`, `displayName`,
`username`, and `email`; the Clerk subject, the internal user id, and every
other profile field stay on the server. The URL carries only the pseudonym.

`POST /api/professor/students/identities` reveals the whole roster. It takes
no input — the population is the Students page's own, never the caller's to
choose — and is gated the same way, so an unauthorized caller learns nothing,
not even how many students there are. Each student in the response carries
`status` and, when identified, `displayName` only: the username and email
address stay behind the single reveal. Clerk is read in batches of at most a
hundred accounts through the user listing, filtered by id; an id the listing
does not return is `unlinked`, and a batch that fails leaves its accounts
`unavailable` without affecting the others.

Four outcomes are reported:

| Status        | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `identified`  | Display name, plus the username and primary email address when the account holds them. |
| `anonymous`   | The student practised without signing in.                    |
| `unlinked`    | The identity provider no longer holds the account.           |
| `unavailable` | The provider could not be reached, or the reveal could not be audited. The analytics still load. |

Clerk failures never reach the instructor as provider text: neither the error
nor its body is logged, because both can carry the account's own identifiers.

## Audit

Each reveal writes one `audit_events` row per student with action
`analytics.student_identity_viewed`, the acting professor, the pseudonymous
student key, the request id, and the outcome. A roster reveal writes its rows
in one statement and marks each with `scope: "roster"`, so an auditor can tell
a reveal of everyone from a reveal of one. The name, username, and email
address that were shown are not recorded.

Both reveals **fail closed**. The order is resolve, look up, record, and only
then return: if the audit row cannot be written — a rejected statement, or a
statement that inserts fewer rows than it was given — the resolved identity is
discarded and the instructor is shown `unavailable` instead; for the roster,
every student is shown `unavailable`, and with no name to order by the groups
keep their pseudonymous order. An unauditable reveal is therefore
indistinguishable from one that found no identity, and the underlying database
error is neither returned nor logged, because the identity is in scope where it
is raised.

## Interface

The Students activity table stays pseudonymous, and its search box still
matches only the student code. A single reveal happens on one student's detail
page, behind a **Reveal identity** button, and shows Name, Username, and Email
as labelled fields. A field the account does not hold reads "Username
unavailable" or "Email unavailable" rather than disappearing, so an instructor
can tell an absent value from one that failed to load — a missing username
never fails the rest of the reveal.

The roster reveal lives in the Students page's **By topic** view. The view
arrives pseudonymous: every student is listed by code under each syllabus
topic they have practised, and students with no practised topic under "No
topic practice yet". **Reveal all names** fetches the roster reveal and shows
each student's display name beside their code, with the students in each
group ordered by last name A–Z and then first name. The order is decided on
the server from Clerk's own first and last name fields, which never reach the
browser; a name Clerk holds unsplit sorts by its display name as a whole, and
students with no name to show — anonymous, unlinked, or unavailable — follow
every named student in pseudonym order. **Hide names** returns to the
pseudonymous roster. Nothing about either reveal is stored in the browser, so
leaving or reloading the page returns the records to their hidden state.
