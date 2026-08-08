# Authorization permission matrix

Clerk `publicMetadata.role` is the authoritative role source. Only `student` and
`professor` are supported; missing or invalid metadata is student. The database
role tables are a synchronized integrity projection, not an operator-controlled
grant interface.

| Boundary                      | Allowed principal                                            | Failure behavior                                          |
| ----------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| Public approved content       | Anyone                                                       | Draft/private content is omitted or `404`.                |
| Student practice              | Student, professor, or valid signed anonymous pilot identity | `401` when no accepted identity exists.                   |
| Authenticated student account | Student or professor                                         | `401` without authentication.                             |
| Owned student resource        | Matching authenticated user or signed anonymous identity     | Non-owner receives `404`.                                 |
| Professor tools               | Professor                                                    | Page: sign-in redirect or `/forbidden`; API: `401`/`403`. |

## Pages

| Page                              | Access                            | Server enforcement                                 |
| --------------------------------- | --------------------------------- | -------------------------------------------------- |
| `/`, `/topics/**`, `/practice/**` | Public                            | Approved/published queries only.                   |
| `/dashboard`                      | Student/professor/anonymous pilot | Server-resolved owner.                             |
| `/account`, `/onboarding`         | Student or professor              | `requireStudent`.                                  |
| `/professor`                      | Professor                         | Protected layout and page call `requireProfessor`. |
| `/professor/review`               | Professor                         | `requireProfessorReview`.                          |
| `/professor/questions`            | Professor                         | `requireProfessorReview` before dashboard reads.   |
| `/professor/upload`               | Professor                         | `requireProfessor`.                                |
| `/professor/analytics`            | Professor                         | `requireAnalyticsAccess`.                          |

The legacy `/admin/**` route tree does not exist.

## APIs

| API                                              | Access                                    | Data policy                                                                              |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GET /api/questions`, `GET /api/questions/[id]`  | Public                                    | Approved public questions only.                                                          |
| Student progress and tutor-session routes        | Student/professor/anonymous as applicable | Every session query includes its server-resolved owner.                                  |
| `GET`, `PATCH`, `POST /api/professor/review`     | Professor                                 | Professor-safe draft DTOs; real reviewer attribution.                                    |
| `GET`, `POST /api/professor/questions`           | Professor                                 | Lifecycle listing or a complete validated initial draft.                                 |
| `GET /api/professor/questions/[id]`              | Professor                                 | Immutable versions, lifecycle timeline, attribution, validation, and allowed actions.    |
| `POST /api/professor/questions/[id]/versions`    | Professor                                 | Complete immutable draft from a selected base version.                                   |
| `POST /api/professor/questions/[id]/transitions` | Professor                                 | Server-authorized, attributed, optimistic, idempotent lifecycle transition.              |
| `POST /api/professor/questions/[id]/regenerate`  | Professor                                 | Same-question regeneration with professor requestor and system executor attribution.     |
| Legacy professor question `PATCH` routes         | Professor                                 | Compatibility-only projection updates; they cannot publish or change student visibility. |
| `POST /api/professor/upload`                     | Professor                                 | Validated generated-candidate import.                                                    |
| `POST /api/professor/content-preview`            | Professor                                 | Private file parsing to an abstract needs-review preview.                                |
| `GET /api/professor/analytics`                   | Professor                                 | Aggregate metrics only; no student identities or raw answers.                            |
| `POST /api/retrieval/search`                     | Professor                                 | Client-accessible `student` audience only; internal draft audience is rejected.          |

## Invariants

- Proxy middleware performs only coarse authentication redirects. Every page,
  Route Handler, and repository boundary repeats authorization.
- Professors may use all normal student features.
- Students cannot access professor navigation, pages, queues, analytics,
  uploads, imports, or mutation APIs.
- Only lifecycle transitions can change publication pointers. Client-supplied
  trust, visibility, review state, and reviewer identity are not publication
  authority.
- Client role fields, headers, email domains, unsafe metadata, and legacy shared
  secrets cannot elevate a user.
- `ADMIN_SECRET` is rejected in every environment and there is no administrator
  role or export permission.
- Approved public content remains accessible when authentication is omitted;
  protected data fails closed when Clerk or identity storage is unavailable.
