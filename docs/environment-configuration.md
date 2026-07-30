# Environment Configuration

The server configuration is parsed and validated by
`src/lib/env/server.ts`. Next.js calls `src/instrumentation.ts` when a server
instance starts, so an invalid Staging or Production deployment fails before it
serves requests.

Copy `.env.example` to `.env.local` for local overrides. Do not put real
secrets in `.env.example`, committed `.env` files, source code, browser code,
or variables prefixed with `NEXT_PUBLIC_`.

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

| Variable                    | Category                  | Secret           | Requirement and behavior                                                                                                                                                                     |
| --------------------------- | ------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                   | Runtime                   | No               | Recommended everywhere; required to identify Staging and non-Vercel Production explicitly.                                                                                                   |
| `APP_URL`                   | Application URL           | No               | Required in Preview unless derived from `VERCEL_URL`; required in Staging and Production and must use HTTPS. Development/Test default to `http://localhost:3000`.                            |
| `APP_DEMO_MODE`             | Runtime/data              | No               | Defaults to `true` outside strict environments. Must be explicitly `false` in Staging and Production.                                                                                        |
| `DATABASE_URL`              | Database                  | **Yes**          | Required in Staging and Production. Must be a `postgres://` or `postgresql://` URL. Optional for local demo/test/preview.                                                                    |
| `AUTH_ISSUER_URL`           | Authentication            | Sensitive config | Required in Staging and Production and must use HTTPS. The identity provider is an institutional decision.                                                                                   |
| `AUTH_CLIENT_ID`            | Authentication            | Sensitive config | Required in Staging and Production.                                                                                                                                                          |
| `AUTH_CLIENT_SECRET`        | Authentication            | **Yes**          | Required in Staging and Production. Server-only.                                                                                                                                             |
| `AUTH_SESSION_SECRET`       | Authentication            | **Yes**          | Required in Staging and Production and must contain at least 32 characters. Server-only.                                                                                                     |
| `ADMIN_SECRET`              | Legacy demo authorization | **Yes**          | Optional temporary shared secret used by the existing professor/admin prototype. It is not a substitute for production authentication and should be removed by the authentication migration. |
| `AI_ENABLED`                | AI                        | No               | Must be explicitly `true` or `false` in Staging and Production. Outside strict environments it defaults to enabled only when an OpenRouter key is supplied.                                  |
| `AI_PROVIDER`               | AI                        | No               | Required when AI is enabled. The current integration accepts `openrouter` only. This does not constitute institutional provider approval.                                                    |
| `OPENROUTER_API_KEY`        | AI                        | **Yes**          | Required when AI is enabled with the current provider. Server-only.                                                                                                                          |
| `AI_MODEL`                  | AI                        | No               | Required when AI is enabled in Staging or Production. A demo model default is available only outside strict environments.                                                                    |
| `MAX_LLM_OUTPUT_TOKENS`     | AI/cost                   | No               | Required positive integer when AI is enabled in Staging or Production. Defaults to `400` only outside strict environments.                                                                   |
| `LOG_LEVEL`                 | Logging                   | No               | Required in Staging and Production. Allowed values: `debug`, `info`, `warn`, `error`, `silent`.                                                                                              |
| `ERROR_TRACKING_DSN`        | Error tracking            | **Yes**          | Required in Staging and Production and must use HTTPS. The provider remains an institutional decision. Server-only.                                                                          |
| `RATE_LIMIT_MAX_REQUESTS`   | Abuse controls            | No               | Required positive integer in Staging and Production. Defaults to `20` only outside strict environments.                                                                                      |
| `RATE_LIMIT_WINDOW_SECONDS` | Abuse controls            | No               | Required positive integer in Staging and Production. Defaults to `60` only outside strict environments.                                                                                      |
| `NODE_ENV`                  | Framework                 | No               | Set by Node/Next.js; used to recognize automated tests and a running production server. Do not use it to represent Staging.                                                                  |
| `NEXT_PHASE`                | Framework                 | No               | Set by Next.js; used to distinguish a production build from a running production server.                                                                                                     |
| `VERCEL_ENV`                | Hosting                   | No               | Set by Vercel; used to infer Development, Preview, or Production when `APP_ENV` is absent.                                                                                                   |
| `VERCEL_URL`                | Hosting                   | No               | Set by Vercel; used as the Preview application URL when `APP_URL` is absent.                                                                                                                 |

The authentication and error-tracking variables reserve required production
boundaries. Their presence does not mean authentication or error tracking has
been integrated or institutionally approved.

Repository and user-interface behavior for each environment is documented in
[Operating Modes And Demo Isolation](operating-modes.md).

## Secret isolation

`src/lib/env/server.ts` imports `server-only`, so Next.js rejects imports from
Client Components. Validation also rejects these browser-exposed aliases:

- `NEXT_PUBLIC_ADMIN_SECRET`
- `NEXT_PUBLIC_AUTH_CLIENT_SECRET`
- `NEXT_PUBLIC_AUTH_SESSION_SECRET`
- `NEXT_PUBLIC_DATABASE_URL`
- `NEXT_PUBLIC_ERROR_TRACKING_DSN`
- `NEXT_PUBLIC_OPENROUTER_API_KEY`

Keep secrets in `.env.local`, an environment-specific `.local` file, or the
hosting platform's encrypted environment-variable store. Scope Vercel
Production, Preview, and Development variables separately. Preview must never
receive Production database, authentication, AI, or logging credentials.

## Validation examples

Local development can run without secrets:

```bash
npm run dev
```

Automated tests infer `APP_ENV=test` from `NODE_ENV=test`.

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
