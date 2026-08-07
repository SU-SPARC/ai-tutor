# Server Authorization Permission Matrix

This is the human-readable companion to the executable inventory in
`src/lib/auth/server-boundary-policy.ts`. Automated tests enumerate the App
Router filesystem and fail if a page, layout, Route Handler method, or exported
Server Action is missing from that inventory. They also verify the declared
authorization/filter marker at each boundary and invoke protected APIs directly
without relying on navigation or hidden UI.

## Access semantics

| Access class            | Allowed caller                                                                           | Failure behavior                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Public                  | Anyone                                                                                   | Only approved, public, trusted questions may be read.                                      |
| Public Clerk protocol   | Anyone participating in Clerk sign-up, sign-in, verification, reset, or sign-out         | Clerk validates identity and cookies; it does not grant an application role by itself.     |
| Public sanitized health | Anyone/monitor                                                                           | Returns coarse availability only, with no credentials, database host, query, or records.   |
| Student or anonymous    | Active student/professor/admin account, or a valid signed anonymous pilot cookie         | `401` when no acceptable identity exists.                                                  |
| Authenticated student   | Active student/professor/admin account                                                   | `401` without authentication; `403` if the account lacks application access.               |
| Owned student resource  | Student or signed anonymous caller whose server-resolved owner matches the tutor session | Always `404` for missing identity, missing session, or wrong owner to prevent enumeration. |
| Professor review        | Active professor or admin                                                                | `401` without authentication; `403` for a student.                                         |
| Professor analytics     | Active professor or admin                                                                | Aggregate course data only; same `401`/`403` behavior.                                     |
| Administrator           | Active admin                                                                             | `401` without authentication; `403` for students and professors.                           |

Professor/admin roles are read from the database at the protected boundary.
Browser fields, email domains, shared secrets, request headers, and UI state
cannot grant access.

## Page and layout matrix

| Route/layout                                                            | Access                      | Server enforcement and data rule                                                                                                     |
| ----------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/`, `/topics`, `/topics/[slug]`, `/practice`, `/practice/[questionId]` | Public                      | Data-store reads filter through approved/public/trusted publication policy. Dynamic question metadata uses the same approved lookup. |
| `/sign-in`, `/sign-up`, `/forbidden`                                    | Public                      | No protected application data. Return locations are normalized and auth/API destinations are rejected.                               |
| `/dashboard`                                                            | Student or anonymous        | The page is a data-free shell; `/api/student/progress` resolves the owner and returns only that owner’s aggregates.                  |
| `/account`, `/onboarding`                                               | Authenticated student       | `requireStudent` runs in the Server Component. Profile output is a minimal name/email DTO.                                           |
| `/professor` and its layout                                             | Professor/admin             | `requireProfessor` runs in both the layout and page before the protected client workspace loads.                                     |
| `/admin` layout                                                         | Professor/admin coarse gate | Child pages repeat their narrower policy before data access.                                                                         |
| `/admin/review`                                                         | Professor/admin             | `requireProfessorReview`; receives professor-safe draft DTOs without private-source internals.                                       |
| `/admin/analytics`                                                      | Professor/admin             | `requireAnalyticsAccess`; receives aggregate analytics DTOs without student identity or answers.                                     |
| `/admin/questions`, `/admin/upload`                                     | Admin                       | `requireAdministrator` runs before dashboard reads or upload UI rendering.                                                           |
| Root layout                                                             | Public                      | Site chrome only; authorization is repeated in protected descendants.                                                                |

The Next.js proxy supplies coarse redirects for account, onboarding, professor,
and admin routes. It is not the authorization boundary; the Server Components,
Route Handlers, and repositories above repeat policy close to their data.

## Route Handler matrix

| Method and endpoint                             | Access                  | Data and mutation policy                                                                                                                                    |
| ----------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/questions`                            | Public                  | Approved/public/trusted summaries only; answers and solutions omitted.                                                                                      |
| `GET /api/questions/[id]`                       | Public                  | Approved/public/trusted detail only; drafts and private records return `404`.                                                                               |
| `GET /api/health/database`                      | Public sanitized health | Coarse status/category/latency only with `no-store`.                                                                                                        |
| `POST /api/account/claim-anonymous`             | Authenticated student   | Explicitly claims the signed browser identity into the current user.                                                                                        |
| `POST /api/account/discard-anonymous`           | Authenticated student   | Clears the browser identity without linking it.                                                                                                             |
| `POST /api/identity/legacy-anonymous`           | Authenticated student   | Time-limited, rate-limited, one-account claim into the current user.                                                                                        |
| `GET /api/student/progress`                     | Student or anonymous    | Aggregates only sessions owned by the current user/cookie; omits owner IDs, session IDs, and answer previews.                                               |
| `POST /api/tutor/session`                       | Student or anonymous    | Creates a session only for a currently approved question and the server-resolved owner.                                                                     |
| `GET /api/tutor/session/[sessionId]`            | Owned student resource  | Matches both session ID and owner; returns only session ID and approved question ID.                                                                        |
| `POST /api/tutor/session/[sessionId]/attempt`   | Owned student resource  | Validates owner and approved question before mutation; DTO omits attempt details.                                                                           |
| `POST /api/tutor/session/[sessionId]/hint`      | Owned student resource  | Validates owner and approved question before mutation; DTO omits counters.                                                                                  |
| `POST /api/tutor/session/[sessionId]/step`      | Owned student resource  | Validates owner and approved question before mutation; DTO omits counters.                                                                                  |
| `POST /api/tutor/respond`                       | Owned student resource  | Uses the owned session’s approved question/topic, never client-selected content. Retrieval chunks remain server-only and are removed from the response DTO. |
| `GET /api/professor/review`                     | Professor/admin         | Professor-safe generated-draft review DTOs.                                                                                                                 |
| `PATCH`, `POST /api/professor/review`           | Professor/admin         | Review mutations require `requireProfessorReview`; actor attribution comes from the grant.                                                                  |
| `POST /api/professor/upload`                    | Professor/admin         | Imports public-safe generated review candidates only; private source keys/text are rejected.                                                                |
| `GET /api/professor/analytics`                  | Professor/admin         | Aggregate course analytics DTO only; no raw answers, student IDs, or private source fields.                                                                 |
| `POST /api/retrieval/search` (`student` mode)   | Professor/admin         | Searches approved public retrieval material. The internal `server` audience is not accepted from clients.                                                   |
| `POST /api/retrieval/search` (`admin_dev` mode) | Admin                   | May search administrative draft metadata; private reference text is replaced with a server-only placeholder.                                                |
| `GET`, `PATCH /api/admin/questions`             | Admin                   | Admin-safe public question/review records; private reference records are excluded.                                                                          |
| `PATCH /api/admin/questions/[id]`               | Admin                   | Public-safe review metadata only; private/copy-source fields are rejected.                                                                                  |
| `POST /api/admin/questions/[id]/regenerate`     | Admin                   | Deterministic needs-review regeneration only.                                                                                                               |
| `POST /api/admin/upload`                        | Admin                   | Private file parsing creates an abstract needs-review preview; it does not publish or return raw source content.                                            |

There is currently no export or download endpoint. `requireExportAccess` is
administrator-only, and any future export must be added to the executable
matrix, call that requirement, minimize fields, and add direct `401`/`403`
tests before release.

Clerk's prebuilt components own authentication lifecycle requests. The
application exposes no custom password, role-selection, or authentication
Server Action. Any future application mutation implemented as a Server Action
must be added to the executable matrix and call the same centralized
requirement used by Route Handlers before it touches data.

## Cross-boundary invariants

- Public reads apply publication filtering in the data store, database view,
  repository mapper, and HTTP handler. A repository returning a draft is still
  filtered before serialization.
- Tutor-session repositories require a `StudentAuthorization` grant and include
  the owner predicate in every read/write. Direct knowledge of a session ID is
  insufficient.
- Student session APIs verify that the session’s question remains published.
  Draft-bound legacy/corrupt sessions return `404` and mutation routes do not
  alter them.
- Review writes require a professor-review grant at the handler, data gateway,
  and repository. The reviewer ID/name comes from the authenticated grant.
- Private retrieval records may contribute only approved safe grounding inside
  server-only tutor code. Browser tutor responses contain an empty retrieval
  array; staff retrieval APIs never return raw private-reference text.
- Analytics are aggregate-only. Exports are unavailable until an admin-only
  design and direct authorization tests are added.
