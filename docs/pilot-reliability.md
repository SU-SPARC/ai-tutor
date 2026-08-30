# Pilot Reliability and Recovery

This document defines the application behavior for important real-student pilot
failures. It describes application controls, not university approval or a claim
that external providers, monitoring, backups, or incident response are ready.

## Student failure contract

The hardened pilot paths return stable application codes and short recovery
guidance. They never serialize caught exceptions, SQL, stack traces, database
locations, provider response bodies, credentials, student identifiers, answers,
prompts, or private retrieval context. The operational failure responses below
are not cached and carry a server-generated `X-Request-Id`; retryable HTTP
failures also include a bounded `Retry-After` value.

| Failure                         | Student behavior                                                                                                                   | Write and recovery behavior                                                                                                                                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL unavailable          | HTTP 503, `DATA_SERVICE_UNAVAILABLE`                                                                                               | Database-selected writes never fall back to memory or demo data. The client does not report success and retains the session and idempotency key for safe recovery.                                                                        |
| Authentication unavailable      | HTTP 503, `AUTHENTICATION_SERVICE_UNAVAILABLE`                                                                                     | No protected read or write begins. Authentication-required and denied requests remain 401/403 (or concealed 404 for owned student resources).                                                                                             |
| Retrieval unavailable           | HTTP 503, `RETRIEVAL_SERVICE_UNAVAILABLE`                                                                                          | Retrieval fails closed before the LLM stage, so an unavailable approved source cannot silently become an ungrounded provider request. No tutor transition is written.                                                                     |
| LLM provider unavailable        | Existing deterministic or retrieved guidance is returned when available; otherwise the tutor returns a friendly `blocked` response | The response never claims LLM use, exposes the provider, or caches failed output. Reservations are settled/released, and the blocked transition is persisted only if the session transaction succeeds.                                    |
| Rate limit reached              | HTTP 429, `TUTOR_RATE_LIMITED`, with `Retry-After`                                                                                 | The rejected request does not reach session lookup, tutoring, or persistence. Logs do not retain the IP or owner identifier.                                                                                                              |
| Malformed tutor request         | HTTP 400, `MALFORMED_TUTOR_REQUEST` or `TUTOR_REQUEST_INTERRUPTED`; HTTP 413, `TUTOR_REQUEST_TOO_LARGE`                            | The streamed body is bounded at 8,192 bytes. Parsing and validation complete before session access or writes.                                                                                                                             |
| Stale session revision          | HTTP 409, `TUTOR_SESSION_STALE`                                                                                                    | The server retries a non-AI optimistic conflict up to three times. The client reloads the owned durable session and asks the student to submit again only when needed.                                                                    |
| Expired session                 | Concealed HTTP 404, `TUTOR_SESSION_UNAVAILABLE`                                                                                    | The browser removes only the stale continuity pointer, then may create a new idempotent session. The expired database record remains governed by its retention lifecycle.                                                                 |
| Question removed or unpublished | The same concealed HTTP 404 as an expired session                                                                                  | No new tutoring occurs. The session and immutable question-version/audit history are preserved server-side with the existing `content_unpublished` lifecycle.                                                                             |
| Network interruption            | Friendly connection message with no save claim                                                                                     | The browser retries once with the same session-creation or tutor-event idempotency key. After uncertainty it keeps the key and session pointer, reloads durable state when possible, and restores an unconfirmed answer for resubmission. |

## Write truthfulness

Tutor session creation and tutor transitions use durable idempotency keys. The
browser stores only a pending opaque key (and, for tutor events, a small input
fingerprint) until the server confirms success. It does not store raw tutor
answers in that recovery metadata. A transient 5xx or interrupted connection
does not cause the browser to discard the known session or create a replacement.

The session repository continues to use transactions, owner-scoped reads,
optimistic revisions, and idempotent event lookup. A database write failure is
not replaced with an in-memory success. If a connection is lost around commit,
the same event key lets the server return the already-saved transition or apply
it once; the client reports uncertainty until a read proves the durable state.

## Protected diagnostics

Operational failures emit bounded JSON records to protected hosting runtime
logs. Each record contains only:

- a server-generated random request ID;
- timestamp, route, status, subsystem, and event;
- a normalized error class; and
- when available, a coarse database category and retryable flag.

The logger classifies caught causes but never serializes their message, stack,
body, headers, query, parameters, URLs, or identifiers. This makes the same log
safe even when an upstream exception contains SQL, an answer, a private source,
or a credential.

`GET /api/professor/operations` is professor-authorized and returns at most the
100 most recent privacy-safe summaries from the current warm application
instance. It is a quick pilot diagnostic, not a durable event store. Protected
hosting runtime logs are the cross-instance source for platform administrators;
external drains, dashboards, alert rules, access review, and retention are
still operational prerequisites.

The existing public database health route remains coarse and sanitized. It
does not reveal the database host, name, user, or connection string.

## Lifecycle and audit guarantees

This hardening does not delete, recreate, or rewrite session history when a
question is unpublished or a request conflicts. Content lifecycle transactions
continue to mark affected sessions `content_unpublished`, preserve immutable
question versions, invalidate eligible AI cache entries, and append the
existing audit events. Reliability logging is additive and contains no student
content.

## Executable evidence

- `tests/pilot-operational-errors.test.ts`: database/authentication safe errors,
  request correlation, classified diagnostics, and redaction.
- `tests/professor-operational-diagnostics.test.ts`: professor-only access and
  diagnostic response redaction.
- `tests/tutor-response-boundary.test.ts`: body limits, interrupted streams,
  retrieval outage, throttling, stale conflicts, expired sessions, and
  unpublished questions.
- `tests/tutor-client-recovery.test.ts`: retained sessions, safe replacement,
  idempotent network recovery, and unsafe server-message suppression.
- `tests/tutor-engine.test.ts` and `tests/llm-tutor.test.ts`: retrieval-before-LLM
  fail-closed routing and provider outage/timeout/retry behavior.
- `tests/question-lifecycle-database.test.ts`: session and audit preservation
  when published content is removed.
