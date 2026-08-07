# Environment Configuration

The server configuration is parsed and validated by
`src/lib/env/server.ts`. Next.js calls `src/instrumentation.ts` when a server
instance starts, so an invalid Staging or Production deployment fails before it
serves requests.

Copy `.env.example` to `.env.local` for local overrides. Do not put real
secrets in `.env.example`, committed `.env` files, source code, browser code,
or variables prefixed with `NEXT_PUBLIC_`. The Clerk publishable key is the
intentional exception: it is public by design.

## Application environments

`APP_ENV` accepts exactly:

| Value         | Intended use                                        | Defaults                                                                                       |
| ------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `development` | Local development                                   | Local URL, demo repository, development logging, and safe numeric defaults                     |
| `test`        | Automated tests                                     | Local URL, demo repository, silent logging, and safe numeric defaults                          |
| `preview`     | Ephemeral pull-request/branch deployment            | Vercel URL may supply `APP_URL`; demo mode and safe numeric defaults are allowed               |
| `staging`     | Persistent production-shaped validation environment | No operational defaults; database, auth, logging, URL, and explicit mode settings are required |
| `production`  | Real production application                         | Same strict validation as Staging; HTTPS is required                                           |

Resolution order is:

1. Explicit `APP_ENV`.
2. `NODE_ENV=test`.
3. Vercel `VERCEL_ENV` (`development`, `preview`, or `production`).
4. A non-build server with `NODE_ENV=production`.
5. Local Development.

Vercel has no separate native Staging value. Set `APP_ENV=staging` as a
branch-scoped Preview variable for the persistent staging branch/project.
`NEXT_PHASE=phase-production-build` keeps an ordinary local `next build` from
being mistaken for a running Production server. A self-hosted production
server must explicitly set `APP_ENV=production`.

## Variable inventory

| Variable                                | Category         | Secret  | Requirement and behavior                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                               | Runtime          | No      | Recommended everywhere; required to identify Staging and non-Vercel Production explicitly.                                                                                                                                                                  |
| `APP_URL`                               | Application URL  | No      | Exact application origin only: no credentials, path, query, or fragment. Required in Preview unless derived from `VERCEL_URL`; required in Staging and Production. Every deployed URL must use HTTPS. Development/Test defaults to `http://localhost:3000`. |
| `APP_DEMO_MODE`                         | Runtime/data     | No      | Defaults to `true` outside strict environments. Must be explicitly `false` in Staging and Production.                                                                                                                                                       |
| `DATABASE_URL`                          | Database         | **Yes** | Required in Staging and Production. Must be a `postgres://` or `postgresql://` URL. Optional for local demo/test/preview.                                                                                                                                   |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`     | Authentication   | No      | Clerk instance publishable key. Required with `CLERK_SECRET_KEY` in Staging and Production; optional only as a complete pair outside strict environments.                                                                                                   |
| `CLERK_SECRET_KEY`                      | Authentication   | **Yes** | Clerk instance secret key. Required with the publishable key in Staging and Production and server-only. Production rejects development-instance keys.                                                                                                       |
| `ANONYMOUS_PILOT_ENABLED`               | Student identity | No      | Defaults to `true` locally. Must be explicit in deployed environments. When false, unauthenticated practice is rejected.                                                                                                                                    |
| `ANONYMOUS_ID_SECRET`                   | Student identity | **Yes** | HMAC key for signed anonymous cookies. Required with at least 32 characters when the anonymous pilot is enabled in a deployed environment.                                                                                                                  |
| `ANONYMOUS_COOKIE_DAYS`                 | Student identity | No      | Positive cookie/retention duration. Defaults to 30 days locally and is required for a deployed anonymous pilot.                                                                                                                                             |
| `LEGACY_ANONYMOUS_MIGRATION_ENABLED`    | Student identity | No      | Enables the time-limited local-storage migration bridge. Defaults to false and requires the anonymous pilot.                                                                                                                                                |
| `LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT` | Student identity | No      | ISO-8601 cutoff required when the legacy bridge is enabled in a deployed environment.                                                                                                                                                                       |
| `AI_ENABLED`                            | AI               | No      | Must be explicitly `true` or `false` in Staging and Production. Outside strict environments it defaults to enabled only when an OpenRouter key is supplied.                                                                                                 |
| `AI_PROVIDER`                           | AI               | No      | Required when AI is enabled. The current integration accepts `openrouter` only. This does not constitute institutional provider approval.                                                                                                                   |
| `OPENROUTER_API_KEY`                    | AI               | **Yes** | Required when AI is enabled with the current provider. Server-only.                                                                                                                                                                                         |
| `AI_MODEL`                              | AI               | No      | Required when AI is enabled in Staging or Production. A demo model default is available only outside strict environments.                                                                                                                                   |
| `MAX_LLM_OUTPUT_TOKENS`                 | AI/cost          | No      | Required positive integer when AI is enabled in Staging or Production. Defaults to `400` only outside strict environments.                                                                                                                                  |
| `LOG_LEVEL`                             | Logging          | No      | Required in Staging and Production. Allowed values: `debug`, `info`, `warn`, `error`, `silent`.                                                                                                                                                             |
| `ERROR_TRACKING_DSN`                    | Error tracking   | **Yes** | Required in Staging and Production and must use HTTPS. The provider remains an institutional decision. Server-only.                                                                                                                                         |
| `RATE_LIMIT_MAX_REQUESTS`               | Abuse controls   | No      | Required positive integer in Staging and Production. Defaults to `20` only outside strict environments.                                                                                                                                                     |
| `RATE_LIMIT_WINDOW_SECONDS`             | Abuse controls   | No      | Required positive integer in Staging and Production. Defaults to `60` only outside strict environments.                                                                                                                                                     |
| `NODE_ENV`                              | Framework        | No      | Set by Node/Next.js; used to recognize automated tests and a running production server. Do not use it to represent Staging.                                                                                                                                 |
| `NEXT_PHASE`                            | Framework        | No      | Set by Next.js; used to distinguish a production build from a running production server.                                                                                                                                                                    |
| `VERCEL_ENV`                            | Hosting          | No      | Set by Vercel; used to infer Development, Preview, or Production when `APP_ENV` is absent.                                                                                                                                                                  |
| `VERCEL_URL`                            | Hosting          | No      | Set by Vercel; used as the Preview application URL when `APP_URL` is absent.                                                                                                                                                                                |

The authentication variables configure Clerk-managed email/password identity.
Dashboard configuration, privacy review, and Production keys remain operational
prerequisites; see
[Authentication and authorization](authentication-authorization.md).
Provide the Clerk key pair to both the build and runtime environment because the
publishable key is compiled into the browser bundle.

`ADMIN_SECRET` is obsolete, is not part of the variable inventory, and is
rejected in every environment. It cannot authorize a request. Professor access
is assigned only through Clerk public metadata; see the
[role provisioning process](authentication-authorization.md#assigning-the-professor-role).

Repository and user-interface behavior for each environment is documented in
[Operating Modes And Demo Isolation](operating-modes.md).

## Secret isolation

`src/lib/env/server.ts` imports `server-only`, so Next.js rejects imports from
Client Components. Validation also rejects these browser-exposed aliases:

- `NEXT_PUBLIC_ADMIN_SECRET`
- `NEXT_PUBLIC_CLERK_SECRET_KEY`
- `NEXT_PUBLIC_DATABASE_URL`
- `NEXT_PUBLIC_ERROR_TRACKING_DSN`
- `NEXT_PUBLIC_OPENROUTER_API_KEY`

Keep secrets in `.env.local`, an environment-specific `.local` file, or the
hosting platform's encrypted environment-variable store. Scope Vercel
Production, Preview, and Development variables separately. Preview must never
receive Production database, authentication, AI, or logging credentials.

`APP_URL` identifies the intended environment origin. Configure the matching
domain/origin in the corresponding Clerk instance. Preview must use its own
approved Clerk configuration and must never receive Production keys.

## Validation examples

Local development can run without secrets:

```bash
npm run dev
```

Automated tests infer `APP_ENV=test` from `NODE_ENV=test`.

For interactive local authentication, configure both Clerk keys from a Clerk
Development instance. With neither key, the public local demo continues to run
but account sign-in remains unavailable. Automated role tests inject principals
directly; there is no browser role selector or simulated professor login.

A Staging or Production server must provide all strict variables. AI may be
disabled, but `AI_ENABLED=false` must be explicit; when it is enabled, provider,
key, model, and token limit become required.

Validation errors contain variable names and corrective requirements but never
include configured secret values.

## Git and Vercel workflow

The repository ignores `.env` and `.env.*`, then explicitly allows only
`.env.example`. Verify the rule with:

```bash
git check-ignore -v .env.local
git check-ignore -v .env.production.local
git ls-files '.env*'
```

For a linked Vercel project, pull local development secrets into the ignored
file:

```bash
vercel env pull .env.local --environment=development
```

Use Vercel environment scoping or branch-specific Preview variables for
Staging. Never pull Production values into a committed file.
