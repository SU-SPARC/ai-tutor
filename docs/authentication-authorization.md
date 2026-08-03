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
- Successful sign-in passes through `/onboarding`, which displays only the
  stored name and school email. Any same-origin return path is validated and
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
