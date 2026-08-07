# Authentication and authorization

## Current decision

The initial release uses Clerk-managed email and password authentication through
`@clerk/nextjs`. Institutional OIDC/SSO is not required for this release and the
application no longer reads `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`,
`AUTH_CLIENT_SECRET`, or `AUTH_SESSION_SECRET`.

Clerk owns credentials, password policy, password reset, email verification,
session cookies, and authentication UI. The application never receives or
stores a password or password hash. Suffolk SSO can be enabled later as a Clerk
enterprise connection after University approval without replacing the
application authorization model.

## Trust boundaries

Authentication and authorization are deliberately separate:

- Clerk proves the current identity and supplies an immutable Clerk user ID.
- PostgreSQL maps that ID to an application user and stores account status and
  application roles.
- Server Components, Route Handlers, and repositories enforce roles and record
  ownership close to the data operation.
- Client fields, Clerk public/unsafe metadata, email addresses, and email
  domains never grant a role.

The mapping is stored in the existing `users` row:

| Column              | Value                                                  |
| ------------------- | ------------------------------------------------------ |
| `identity_provider` | `clerk`                                                |
| `external_subject`  | authenticated Clerk user ID, such as `user_...`        |
| `email`             | verified primary email copied at profile creation      |
| `display_name`      | Clerk display name, falling back to the verified email |
| `status`            | application-controlled account state                   |

`user_roles` remains the only application-role source. Provider tokens,
passwords, password hashes, session cookies, profile photos, organization
metadata, and Clerk role metadata are not persisted in the application
database.

## Account creation and sign-in

The public authentication pages are:

- `/sign-up` — Clerk's prebuilt sign-up flow.
- `/sign-in` — Clerk's prebuilt sign-in, forgot-password, verification, and
  password-reset flow.

Successful student authentication continues through `/onboarding`. On the
first active session, the server:

1. reads the authenticated Clerk user ID with Clerk's server helper;
2. looks up `(identity_provider = 'clerk', external_subject = Clerk user ID)`;
3. if no mapping exists, retrieves the Clerk user on the server;
4. requires the primary email to be verified;
5. creates the application user and `student` role in one database transaction;
6. rejects a duplicate-email/different-Clerk-ID conflict instead of linking by
   email.

Later requests use the stable Clerk user ID to load the application account.
The database status and current, non-revoked roles are re-read at each protected
boundary. Clerk session claims and browser-submitted metadata are not used for
authorization.

All callback targets go through `safeReturnPath`. External URLs, recursive
authentication paths, API paths, credential-bearing query/fragment values, and
oversized or malformed targets fall back to `/dashboard`. Clerk receives a
forced, server-computed post-authentication path.

## Clerk Dashboard setup

Create separate Clerk Development and Production instances. In each approved
instance:

1. Enable sign-up with email and require an email address.
2. Enable sign-in with email.
3. Enable sign-up with password.
4. Keep **Verify at sign-up** enabled and select the approved email verification
   strategy. Email verification code is the baseline.
5. Keep password-reset by verified email enabled so the prebuilt `<SignIn />`
   flow can handle forgotten passwords.
6. Configure the application domains/origins for local, Staging, and Production
   as appropriate for that Clerk instance.
7. Do not add role fields to sign-up, public metadata, or unsafe metadata.

Copy only the corresponding instance keys into the environment. A Production
deployment rejects Clerk development-instance keys.

Required in Staging and Production:

```text
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

The publishable key is intentionally exposed to the browser. The secret key is
server-only and must never use a `NEXT_PUBLIC_` prefix. Local Development/Test
may omit both keys; public/anonymous functionality remains available, while
`/sign-in` and `/sign-up` display a clear unavailable state and do not simulate
authentication. A partial key pair is rejected.

Provide the environment-specific Clerk key pair during both the Next.js build
and runtime deployment. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is compiled into the
browser bundle; injecting it only after the build is unsupported.

Email/password authentication has no Suffolk OIDC callback URL. Clerk's own
domains and allowed application origins must be configured in the Clerk
Dashboard. If enterprise SSO is added later, use the callback and connection
settings shown by that approved Clerk connection; do not invent them in this
repository.

## Roles and permissions

Application roles are `student`, `professor`, and `admin`.

- Every newly created application user receives only `student`.
- `professor` and `admin` are never inferred from email, domain, name, Clerk
  organizations, public metadata, unsafe metadata, or request headers.
- `admin` can perform professor operations plus admin-only question/upload
  operations.
- Professor/admin grants and revocations are server-side database operations
  with an operator, change ticket, and audit event.

There is no client route, form field, email allowlist, or role switch that can
grant `professor` or `admin`.

### Initial professor provisioning

The target must first complete Clerk sign-up so an application user row exists.
Use the application's `users.id` (not the Clerk ID) with the protected operator
CLI:

```bash
npm run auth:role -- grant --user USER_ID --role professor --operator ADMIN_USER_ID --ticket CHANGE_TICKET
```

The operator must be an existing active administrator. Production additionally
requires `--confirm-production PRODUCTION`.

### First administrator bootstrap

After the intended administrator creates an account, a trusted database
operator performs the one-time bootstrap:

```bash
npm run auth:role -- bootstrap-admin --user USER_ID --operator OPERATOR_ID --ticket CHANGE_TICKET
```

Bootstrap refuses to run once an active human administrator exists. Later admin
grants use the ordinary audited command:

```bash
npm run auth:role -- grant --user USER_ID --role admin --operator ADMIN_USER_ID --ticket CHANGE_TICKET
```

Revocation uses the same process with `revoke`. Account disable/enable is also
operator-controlled. A Clerk subject may be rebound only after documented
account-owner verification:

```bash
npm run auth:role -- rebind-clerk --user USER_ID --clerk-user-id CLERK_USER_ID --operator ADMIN_USER_ID --ticket CHANGE_TICKET
```

Never rebind by matching email.

## Server-side enforcement

`resolveAuthenticatedPrincipal()` converts a Clerk session into an application
principal. `requireUser()`, `requireStudent()`, `requireProfessor()`,
`requireAdministrator()`, and the specialized review/analytics checks remain
the shared authorization boundary.

`src/proxy.ts` performs only coarse authentication redirects for `/account`,
`/onboarding`, `/professor/**`, and `/admin/**`. It does not trust or evaluate
Clerk role metadata. Every protected page and API repeats application-role
authorization on the server. API behavior is:

- `401` for missing authentication;
- `403` for an authenticated account without the required database role;
- `404` for a tutor session not owned by the current server-resolved owner.

Tutor-session repository operations require `StudentOwner` and match both the
session ID and `user_id` or signed `anonymous_user_id`. Public question routes
continue to use approved/published-content queries, so draft and generated
review content is not exposed by the authentication migration.

## Anonymous pilot migration

Optional anonymous practice still uses a signed, HTTP-only browser cookie. A
signed-in student explicitly chooses whether to import practice from that
browser. Claims are transactional, unique, idempotent, audited, and cannot be
claimed by a second account. No automatic merge occurs on shared devices.

## Recovery and session response

- Password and email-verification recovery stay in Clerk.
- Role correction and application account enable/disable stay in the audited
  application operator process.
- Disabling an application account or revoking a role takes effect at the next
  protected application boundary because status and roles are read from the
  database.
- If the Clerk session itself must be revoked, an authorized operator must use
  the Clerk Dashboard. The legacy `users.session_version` column remains as an
  account authorization revision for migration compatibility; it is not a
  substitute for Clerk session revocation.

## Testing

Unit and API tests inject principals directly; CI does not contact Clerk and
does not store real accounts. Tests cover anonymous, student, professor, admin,
disabled-account, self-role-escalation, duplicate-email/different-Clerk-ID, and
cross-student ownership cases.

Interactive smoke tests use synthetic accounts in a Clerk Development instance.
There is no application-provided local professor/admin identity selector. Grant
staff roles only in an isolated test database through the audited CLI. Never
reuse Production accounts or keys.

## Privacy and remaining limitations

Clerk is an identity and credential processor and receives authentication
activity, email, and credential data according to the configured instance. The
application stores the Clerk user ID, verified email, display name, account
status, roles, audit history, and learning progress. Raw cookies, Clerk tokens,
passwords, password hashes, answers, and provider secrets must not be logged.

Current limitations:

- email/password is the only release authentication strategy;
- no Suffolk SSO, Google, Microsoft, SAML, group, or course-roster mapping is
  configured;
- accounts created under the retired OIDC boundary are not linked by email;
  after account-owner verification, an operator must use `rebind-clerk` to map
  existing application progress to the intended Clerk user ID;
- no Clerk webhook synchronizes later email/display-name changes, so the
  application profile is copied at initial linking and corrected through the
  documented support process if needed;
- Clerk account deletion is not yet synchronized automatically with application
  data deletion/deactivation;
- Clerk Dashboard setup, Production keys, domain configuration, privacy review,
  and operational ownership remain deployment prerequisites.
