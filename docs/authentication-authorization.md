# Authentication and Authorization

The application uses Auth.js with a provider-neutral OIDC integration. It does
not store passwords or persist provider access/refresh tokens. The preferred
production provider is Suffolk's approved central SSO; Microsoft Entra ID is a
candidate only if University IT confirms it. No tenant, issuer, endpoints,
claims mapping, or SSO settings are invented in this repository.

## Runtime model

- Auth.js creates encrypted JWT-backed, HTTP-only application sessions lasting
  eight hours, with no remember-me option.
- OIDC accounts are keyed only by the validated `(issuer, subject)` pair.
- The existing `users` row stores the subject, issuer, institutional email,
  display name, status, `session_version`, and timestamps.
- Each accepted new institutional identity receives `student`. Email and email
  domain never grant `professor` or `admin`.
- Every protected boundary re-reads current status, session version, and roles
  from PostgreSQL. Disabling an account or rotating `session_version`
  invalidates existing sessions; role revocation takes effect immediately.
- `admin` may perform professor operations. `professor` does not imply admin.
- Staff pages have coarse proxy redirects and repeat authorization in layouts,
  route handlers, and ownership-aware repository queries.
- Successful student sign-in passes through `/onboarding`, which displays only
  the stored name and school email. Instructor destinations return directly to
  their protected workspace. Any same-origin return path is validated and
  API/auth-flow destinations are rejected before redirecting.
- Anonymous browser progress is never linked during sign-in. Onboarding offers
  explicit import and continue-without-importing choices, including the
  shared-device warning; migration endpoints are authenticated POST actions.
- Navigation is session-aware: signed-out visitors receive a sign-in link that
  preserves the current safe page, while signed-in users receive account and
  sign-out controls. Internal role and provider identifiers are not rendered.

Unauthenticated protected APIs return 401, insufficient roles return 403, and
non-owned tutor sessions return 404. Identity or role-store failures fail
closed. Public approved questions remain available when authentication is not
configured; sign-in explains that staff and durable account features are
unavailable.

## Central authorization layer

`src/lib/auth/authorization.ts` is the only application policy entry point.
Routes and protected Server Components obtain an opaque authorization grant
from a named helper, then pass that grant into the data gateway or repository.
Repository mutations validate the grant again and derive reviewer identity
from it. A user ID, role, reviewer name, owner ID, request header, or hidden UI
control is never an authorization grant.

| Helper / permission        | Allowed actor                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `currentAuthenticatedUser` | Current active, session-version-matched account, or no user                                                          |
| `requireStudent`           | Authenticated student, professor, or administrator                                                                   |
| `requireStudentAccess`     | The same authenticated roles, plus an approved signed anonymous pilot identity when explicitly enabled by the caller |
| `requireProfessor`         | Professor or administrator                                                                                           |
| `requireAdministrator`     | Administrator only                                                                                                   |
| `requireProfessorReview`   | Professor or administrator; supplies immutable reviewer attribution                                                  |
| `requireAnalyticsAccess`   | Professor or administrator; aggregate application analytics only                                                     |
| `requireExportAccess`      | Administrator only; no export route exists until it explicitly requires this grant                                   |

Unknown permissions deny by default. Page adapters redirect anonymous users to
sign-in and insufficient roles to `/forbidden`; API adapters return 401 or 403.
Ownership failures return 404. Tutor repositories derive the owner scope from
the student grant and repeat the owner predicate in every database read or
write. Publication helpers require approved, public, trusted content; approved
private-reference retrieval is eligible only for server-side sanitization.

UI visibility is convenience only. The proxy and hidden navigation links are
coarse UX controls; every Server Component, route handler, data gateway, and
repository repeats its applicable policy. The existing sign-in and sign-out
Server Actions are public session-lifecycle operations and therefore do not
carry an application-role grant; any future protected Server Action must call
the same named helpers before reading or mutating data.

Browser responses use explicit DTOs. Account pages receive only display name
and email, tutor-session responses receive only session ID and question ID,
professor review candidates omit matching terms and internal source fields,
and analytics omit unused duplicate aggregates. Repository models and grants
must never be serialized directly.

## Shared review secret deprecation

The shared review-secret flow is removed. Review and analytics browser code has
no secret input, does not send `x-professor-token`, and does not store a review
secret in local storage or session storage. Approval and rejection routes use
the current Auth.js session, require the application `professor` or `admin`
role, and derive reviewer display name and `reviewed_by_user_id` from the
server-created authorization grant. A submitted token, reviewer, or role field
cannot authorize or attribute an action.

The configuration deprecation path is intentionally one-way:

1. Preview, Staging, and Production reject `ADMIN_SECRET` during startup.
2. Development and Test temporarily tolerate the variable only so an existing
   local `.env` file does not block startup. The parser discards it, no runtime
   type exposes it, and it grants no access. Local operators should remove it
   now.
3. After local configuration cleanup, the compatibility tolerance may be
   removed so every environment rejects the obsolete variable. It must never
   be restored as a browser field, request header, or production fallback.

## Provider registration checklist

University IT/security must supply and approve all provider values. For each
environment:

1. Set the public application origin in `APP_URL`.
2. Register this exact sign-in callback URL:
   `${APP_URL}/api/auth/callback/institutional-oidc`.
3. Confirm the approved OIDC issuer/discovery URL and set
   `AUTH_ISSUER_URL`—do not copy a tenant or issuer from documentation or
   another application.
4. Set the environment-specific `AUTH_CLIENT_ID` and server-only
   `AUTH_CLIENT_SECRET` issued for this application.
5. Generate a new server-only `AUTH_SESSION_SECRET` with at least 32 random
   characters. Do not reuse a Development, Staging, or Production secret.
6. Approve only `openid profile email` scopes and release a stable subject,
   institutional email, and display name. No groups, directory/Graph access,
   course enrollment, photos, or refresh/offline scope are requested.
7. Register the approved logout/return behavior for `${APP_URL}` if required by
   the provider. Auth.js routes are rooted at `${APP_URL}/api/auth` and the
   application sign-in page is `${APP_URL}/sign-in`.
8. Confirm admitted populations, MFA/session policy, disabled-account behavior,
   deprovisioning, app-registration ownership, callback ownership, and separate
   Staging/Production sandbox identities.

If IT supplies only SAML, stop and select a University-approved SAML-capable
broker; do not implement SAML locally. Magic link or Google identity must be a
separately approved decision and is not configured by this integration.

## Local and automated testing

CI and unit/API tests inject typed principals and never contact Suffolk or use
real institutional accounts. For an interactive local role check only:

```dotenv
APP_ENV=development
AUTH_TEST_MODE=true
AUTH_SESSION_SECRET=<fresh random value of at least 32 characters>
```

The sign-in page then offers fixed student, professor, admin, and disabled test
identities. There is no password and no arbitrary email/role input. Test mode
is rejected in Preview, Staging, and Production.

Staging smoke tests require University-provided sandbox accounts for student,
professor, admin, disabled/revoked, and recovery cases. Production accounts
must not be reused as test fixtures.

## Roles and recovery

### Initial professor provisioning

Professor access is provisioned only after the real institutional account has
signed in once and the application has created its minimal `users` record. The
server-controlled sequence is:

1. The instructor signs in with the approved school account and initially
   receives only the baseline `student` role.
2. The service owner approves professor access under a change ticket and gives
   an authorized operator the existing application user ID. Email addresses,
   email domains, display names, and browser-submitted claims are not accepted
   as role evidence.
3. An active application administrator runs the audited `auth:role grant`
   command from a controlled operator environment with `DATABASE_URL`,
   `APP_ENV`, the target user ID, operator user ID, and change ticket.
4. The command changes `user_roles` in a transaction, writes an `audit_events`
   record, and increments `users.session_version`. The instructor signs in
   again before entering `/professor`.

There is no client route, form field, email allowlist, or identity-provider
profile claim that can grant `professor` or `admin`. The browser can request a
review action, but protected routes derive both authorization and
`reviewed_by_user_id` from the current server session; submitted reviewer or
role fields are ignored.

Use the audited operator command only after the target has signed in and has an
existing user ID. `DATABASE_URL` and `APP_ENV` must be set explicitly in the
operator environment:

```bash
npm run auth:role -- grant --user USER_ID --role professor --operator ADMIN_USER_ID --ticket CHANGE_ID
npm run auth:role -- revoke --user USER_ID --role professor --operator ADMIN_USER_ID --ticket CHANGE_ID
npm run auth:role -- bootstrap-admin --user USER_ID --operator BOOTSTRAP_OPERATOR --ticket CHANGE_ID
npm run auth:role -- invalidate --user USER_ID --operator ADMIN_USER_ID --ticket INCIDENT_ID
npm run auth:role -- disable --user USER_ID --operator ADMIN_USER_ID --ticket INCIDENT_ID
npm run auth:role -- enable --user USER_ID --operator ADMIN_USER_ID --ticket RECOVERY_ID
npm run auth:role -- rebind-subject --user USER_ID --operator ADMIN_USER_ID --ticket IT_CASE --issuer APPROVED_ISSUER --subject VERIFIED_SUBJECT
```

The first administrator is bootstrapped once with `bootstrap-admin`; Production
commands additionally require `--confirm-production PRODUCTION`. Changes are
audited and rotate the target's session version. There is no browser role
switch or bootstrap secret.

Credential and MFA recovery remain with the institutional identity provider
and Service Desk. Application operators can correct roles, disable accounts,
or invalidate sessions. A subject change must be manually verified with IT;
accounts are never linked automatically by matching email.

## Privacy

The institutional provider learns that a user is signing in to this
application. The application handles institutional email, provider subject,
application user ID, roles, session activity, progress, audit history,
pseudonymous anonymous cookies, and IP-derived rate-limit keys. Raw cookies,
subjects, session tokens, anonymous IDs, answers, and provider tokens must not
be logged.

The privacy owner must approve retention, deactivation/deletion behavior,
immutable academic review history, anonymous-to-account linkage and
shared-device messaging. Auth0 or an email-delivery service would be an
additional identity/data processor and is not introduced here.
