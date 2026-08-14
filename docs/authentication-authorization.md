# Authentication and authorization

## Current decision

The application uses Clerk through `@clerk/nextjs` for sign-up, sign-in,
verified-email recovery, credential policy, and sessions. Students and
professors use the same `/sign-up` and `/sign-in` pages. The application does
not collect or store passwords.

There are exactly two application roles:

- `student`
- `professor`

There is no administrator role or in-app role-management page.

## Role source of truth

The authoritative role value is the Clerk user's `publicMetadata.role`.
`resolveAuthenticatedPrincipal()` reads the current Clerk Backend `User` on the
server for each authorization boundary. It accepts only the exact value
`"professor"`; missing, null, differently cased, array-valued, legacy `admin`,
or otherwise malformed values resolve to `student`.

Clerk public metadata is readable by the user but writable only through Clerk's
Backend API or Dashboard. This repository exposes no metadata mutation route,
role selector, role form, email allowlist, or domain-based elevation. Request
headers, request bodies, unsafe metadata, session claims, display names, and
email addresses never grant professor access.

PostgreSQL retains `roles` and `user_roles` as a derived two-role projection for
reviewer-integrity triggers and approved-content import checks. It is not an
operator-managed authorization source. The projection is synchronized from the
validated Clerk user before the request receives an application principal. The
`010_student_professor_roles.sql` migration deletes every legacy `admin` grant
and the `admin` role.

## Account creation

On the first valid Clerk session, the server:

1. obtains the immutable Clerk user ID from `auth()`;
2. loads the current Clerk Backend `User` with `currentUser()`;
3. requires a verified primary email;
4. maps the identity by `(identity_provider = 'clerk', external_subject = Clerk
   user ID)`;
5. creates or refreshes the application `users` row;
6. resolves missing role metadata to `student`; and
7. synchronizes the database projection before granting access.

Email matching is never used to link a different Clerk identity. A duplicate
email with a different Clerk subject fails closed.

## Assigning the professor role

The intended professor first creates a normal account through the same Clerk
sign-up page used by students and verifies the email address. The project owner
then uses the correct Clerk environment:

1. Open Clerk Dashboard and select the Development, Staging, or Production
   instance that belongs to the deployment.
2. Open **Users** and select the intended, verified account. Confirm its Clerk
   user ID and email with the account owner; do not select by display name alone.
3. Edit the user's public metadata.
4. Set `publicMetadata.role` to `"professor"`. The equivalent JSON object is:

   ```json
   {
     "role": "professor"
   }
   ```

5. Save, then have the professor reload `/professor` (or open it in a new
   navigation).

A sign-out/sign-in cycle is not required by this implementation because the
server reads the current Backend `User` rather than a possibly stale custom JWT
claim. The application's role decision therefore does not require a session or
token refresh: the next server request reads the saved `publicMetadata.role`
directly. If Clerk Dashboard still shows the old value or the application
request was already in flight, reload once after the save.

Clerk session-token claims have separate refresh behavior. If a future client
feature copies the role into a custom claim, Clerk refreshes short-lived tokens
automatically, and that feature must force a fresh token with
`getToken({ skipCache: true })` or reload the Clerk `User` with `user.reload()`
when immediate consistency is required. The current Professor Panel navigation
and every authorization boundary intentionally avoid that stale-claim window by
using the Backend `User`.

To return an account to student access, remove `role` or set it to `"student"`.
The next protected request synchronizes the projection and denies professor
operations. Do not add a custom `admin` value; it resolves to student.

## Server-side enforcement

Central helpers in `src/lib/auth/authorization.ts` include:

- `requireAuthenticatedUser()`
- `requireStudent()`
- `requireProfessor()`
- specialized professor review and analytics aliases

Professors also satisfy the student boundary. The server never relies on
navigation visibility or proxy middleware as authorization.

`src/proxy.ts` performs a coarse authentication redirect for `/account`,
`/onboarding`, and `/professor/**`. Every Professor Server Component and Route
Handler repeats the role check close to its data operation:

- `/professor`, `/professor/review`, `/professor/questions`,
  `/professor/upload`, and `/professor/analytics`
- `/api/professor/review`
- `/api/professor/availability`
- `/api/professor/questions` and its detail/regeneration routes
- `/api/professor/upload` for generated candidate import
- `/api/professor/content-preview` for private upload previews
- `/api/professor/analytics`
- `/api/retrieval/search`

Unauthenticated page access redirects to `/sign-in` with the original professor
path as `callbackUrl`. A signed-in student is redirected to `/forbidden`.
Professor API calls return `401` without authentication and `403` for a student.

Review approvals, rejections, edits, regeneration, imports, and publication
changes receive the authenticated application user ID through the server-created
authorization grant. Client-supplied reviewer IDs, roles, and legacy shared
secret headers are ignored.

Professor availability changes use the same authenticated professor boundary.
Global topic/question release state and optional schedules are recorded in an
append-only availability ledger and the general audit log. Availability is a
separate gate: it may hide or schedule an already published question, but it
cannot approve a version, move a publication pointer, or expose archived,
unpublished, or unapproved content. Course/cohort assignment is not simulated
because the application has no course, cohort, membership, or enrollment data
model.

## Student boundaries

Students and professors may browse approved public topics/questions and use
student practice. Tutor-session repositories require a server-resolved
`StudentOwner` and match both the session ID and the authenticated `user_id` or
signed anonymous identity. A known session ID owned by another student returns
not found and cannot affect progress.

The `/dashboard` page and `/api/student/progress` are authenticated account
boundaries. They derive syllabus-ordered practice progress only from the
current application user's owned tutor sessions. Anonymous practice remains
available, but its progress appears on the account dashboard only after the
student signs in and explicitly imports that browser history. The dashboard
does not return peer records, rankings, percentiles, or class averages, and its
completion counts are labeled as practice activity rather than a formal grade.

Public question endpoints filter through both publication and availability:
generated, needs-review, rejected, private, lifecycle-unpublished, archived,
globally unpublished, not-yet-scheduled, expired, or otherwise unapproved
questions are not student-visible. Hiding a topic also hides its questions and
student retrieval material while preserving the remaining syllabus order.

## Configuration and local behavior

Required Clerk variables in Staging and Production:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Use separate Clerk Development and Production instances. Production rejects
Clerk development keys. Local Development/Test may omit both keys; public and
anonymous practice remains available, while sign-in/sign-up renders a clear
unavailable state and never simulates authentication. A partial key pair is
invalid.

`ADMIN_SECRET`, `AUTH_TEST_MODE`, the retired OIDC variables, and browser role
selectors do not enable authentication. `ADMIN_SECRET` is rejected in every
environment; there is no development bypass.

Tests inject typed principals only when `NODE_ENV=test`; CI does not contact
Clerk or contain real institutional identities. Interactive testing uses
synthetic users in a Clerk Development instance, with professor metadata set by
the project owner through that instance's Dashboard.

## Recovery and privacy

Credential reset and email verification remain in Clerk. Application account
status is still checked in PostgreSQL and disabled accounts fail closed. Clerk
session revocation and account recovery are performed through Clerk Dashboard;
application identity rebinding must never occur by email alone.

Clerk receives authentication activity and credential data. The application
stores the Clerk user ID, verified email, display name, account status, the
derived role projection, audit/review history, and learning progress. Never log
raw Clerk cookies or tokens, passwords, answers, anonymous IDs, or provider
secrets.

Suffolk SSO is not configured by this change. If the University later approves
an enterprise connection, use the settings and callback information supplied by
Clerk and University IT; do not invent tenant, issuer, or SSO values.
