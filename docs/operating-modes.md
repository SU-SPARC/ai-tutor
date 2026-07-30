# Operating Modes And Demo Isolation

Runtime behavior is selected by the validated server environment and
`src/lib/runtime/operating-mode.ts`. Demo data is an explicit source or a
documented local recovery aid; it is never a deployed database fallback.

## Mode matrix

| Application environment | `APP_DEMO_MODE` | Operating mode | Content/session source | Database failure |
| --- | --- | --- | --- | --- |
| Development | `true` | `local-demo` | Committed public fixtures and process-memory sessions | Not applicable |
| Development | `false` | `local-database` | Configured database | Falls back locally to public fixtures/process memory |
| Automated Test | `true` | `test-demo` | Intentional test/demo fixtures | Not applicable |
| Automated Test | `false` | `test-database` | Configured/test repository | May use the documented test fallback |
| Preview | `true` | `preview-demo` | Intentional public demo fixtures | No database fallback |
| Preview | `false` | `preview-database` | Configured Preview database | Controlled service-unavailable response |
| Staging | `false` | `staging` | Configured Staging database | Controlled service-unavailable response |
| Production | `false` | `production` | Configured Production database | Controlled service-unavailable response |

Staging and Production environment validation rejects `APP_DEMO_MODE=true` and
requires `DATABASE_URL`. Preview database mode also fails closed when its
database is missing or unavailable.

The local database fallback is intentionally limited to Development and Test.
It preserves a low-friction development workflow but is non-durable and must
not be used to evaluate persistence, migrations, concurrency, or recovery.

## Controlled failures

When deployed content or session persistence is unavailable:

- repository functions throw a server-only `DataServiceUnavailableError`;
- student and administrative APIs return HTTP `503`;
- JSON responses contain `DATA_SERVICE_UNAVAILABLE`, a generic retry message,
  and `Cache-Control: no-store`;
- repository/database details are not returned to clients;
- Server Component failures render the application error boundary with a retry
  action;
- no committed question fixture or process-memory session is substituted.

## Student content safety

Every student-facing read still applies the approved-content predicate after
the repository responds. A question must be:

- `approved`;
- `public`;
- trusted as public, course-approved, or professor-approved content.

`needs_review`, `needs_edit`, `needs_regeneration`, rejected, private, and
`generated_unverified` records remain hidden even if a repository accidentally
returns them.

Production and Staging retrieval use database-backed retrieval chunks and
approved questions. Their default retrieval path does not read committed demo
chunks or ignored local private files.

## Environment indicator

The global header shows an environment badge only in Development and Preview:

- `Local demo` or `Development`;
- `Preview demo` or `Preview`.

Automated Test, Staging, and Production do not render this badge. Student-facing
empty states and tutor disclosures use production-neutral wording rather than
calling approved content “demo” content.
