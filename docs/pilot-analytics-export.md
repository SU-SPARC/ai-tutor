# Pilot analytics and research export

`GET /api/professor/analytics/export` downloads a versioned JSON document from
the Analytics page. The route and repository both require the application's
professor analytics authorization. The application currently has no separate
administrator role or legacy admin secret, so no broader admin bypass exists.

The export is a descriptive pilot dataset. Its embedded metric definitions
separate usage, observed answer performance, and feedback counts, and state that
research outcomes are not included. These figures do not establish learning
improvement, mastery, or causal impact.

## Stored-data audit

The exporter reads only the fields needed to derive its aggregates:

| Store                  | Read for export                                                                                                                                    | Deliberately excluded                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `tutor_sessions`       | owner namespace for server-side hashing; question/version; answer, hint and step counters; solved/status; retained misconception codes; timestamps | raw user or anonymous owner, session id, idempotency keys, answer fingerprint                                    |
| `attempts`             | question/topic/version dimensions, mode, source, verdict, timestamp                                                                                | submitted and normalized answers, previews, hashes, misconception feedback text, response text, idempotency keys |
| `ai_usage`             | aggregate counters from `scope = 'global'` only                                                                                                    | HMAC scope keys, reservations, request hashes, cache bodies, prompts, provider responses                         |
| `feedback_reports`     | category, status, timestamp                                                                                                                        | reporter, session, message, metadata, assignment, resolution notes                                               |
| `topics` / `questions` | stable ids and topic title for aggregate labels                                                                                                    | prompts, accepted answers, explanations, hints, solution bodies, review notes                                    |

The exporter never queries `users`, `retrieval_chunks`, `ai_response_cache`, or
`ai_llm_reservations`. Passwords and provider auth tokens are not stored in the
application database; database credentials and provider secrets remain
server-only environment values and are never read by this path.

## Privacy model

Participant rows use the same stable SQL-derived key as instructor student
analytics: `sha256('user:' || user_id)` or
`sha256('anon:' || anonymous_user_id)`. The namespace prefix prevents collisions
between account and anonymous subjects. Raw owners do not leave the query.

This is pseudonymization, not anonymization. A stable digest can still link the
same participant across exports, so downloaded files must remain access
controlled. The export has no participant timestamps or event-level rows and no
direct identifiers, raw student text, private-reference content, or report text.

## Version 2 schema

Version 2 keeps the field shape but changes participation and `sessions` to
meaningful practice. Version 1 counted technical sessions created on question
open. Do not compare the two session/participation series without accounting
for this definition change. Consumers must explicitly accept version 2.

Top-level fields:

| Field               | Meaning                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `schemaVersion`     | Integer `2`; consumers must reject unknown versions.                                                |
| `exportType`        | Constant `pilot_analytics`.                                                                         |
| `generatedAt`       | Server generation timestamp.                                                                        |
| `mode`              | `database` for retained production data or `demo` for an honest empty export.                       |
| `privacy`           | Machine-readable exclusions and pseudonym type.                                                     |
| `metricDefinitions` | Definitions for usage, performance, feedback, and the explicitly absent research-outcomes category. |
| `dataCoverage`      | Earliest and latest retained event dates, rounded to the day.                                       |
| `cohort`            | Course-wide participation, session, attempt, correctness, hint, reveal, and tutor-path totals.      |
| `tutorUsage`        | Course-wide deterministic, retrieval, LLM-provider, LLM-cache, and blocked interaction counts.      |
| `aiUsage`           | Global generation/accounting totals, never per-student token balances.                              |
| `participants`      | Pseudonymous participant aggregates without event timestamps.                                       |
| `topics`            | Topic aggregates with stable id and title.                                                          |
| `questions`         | Question aggregates with stable question/topic ids; no question text.                               |
| `misconceptions`    | Retained misconception code and number of sessions in which it appears.                             |
| `feedback`          | Total reports and counts by category/status; no messages or notes.                                  |
| `limitations`       | Interpretation and data-quality caveats carried with every export.                                  |

Each cohort, participant, topic, and question activity record contains:

- `sessions`, `questionsAttempted`, `hintsUsed`, and
  `solutionStepsRevealed` usage counts;
- `answerAttempts`, `correctAnswerAttempts`, `incorrectAnswerAttempts`,
  `unscoredAnswerAttempts`, and nullable `correctnessRate` performance fields;
- `deterministicInteractions`, `retrievalInteractions`,
  `llmProviderInteractions`, `llmCacheInteractions`,
  `llmAssistanceInteractions`, `blockedInteractions`, and
  `totalInteractions` tutor-path counts.

Topic and question rows also contain `participatingStudents`. Question rows add
`questionVersionsAttempted`. Participant rows add only a 64-character
`participantId` pseudonym.

`aiUsage` contains:

| Field                                        | Counting rule                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| `generationRequests`                         | Reserved LLM-generation requests recorded by the runtime.                  |
| `providerCalls`                              | Provider attempts, including bounded retries.                              |
| `successfulFallbacks`                        | Successful non-cache LLM fallbacks.                                        |
| `cacheHits`                                  | Safe repeated-response cache hits.                                         |
| `limitBlocks`                                | Requests blocked by configured usage controls.                             |
| `inputTokens`, `outputTokens`, `totalTokens` | Provider-reported values or safe fallbacks when unavailable.               |
| `estimatedTokenPortion`                      | Portion of `totalTokens` that was estimated rather than provider-reported. |
| `estimatedRequestTokens`                     | Pre-call request budget estimates used by the controls.                    |

Runtime accounting writes the same event into global, session, student, and
student-question scopes. The export sums only `scope = 'global'`; summing all
rows would multiply usage.

## Counting and interpretation

- Version 2 includes only engaged `practice_context = 'published'` tutor sessions and
  their attempts. Reserve similar-practice sessions remain outside every
  participant, cohort, topic, question, usage, and performance aggregate.
- A practice session has a persisted tutoring interaction or durable progress,
  using the shared [engagement definition](tutor-session-engagement.md). Simply
  opening, reloading, or recovering a question does not qualify. Technical-only
  rows stay stored but are excluded from participation, session counts, topic
  and question activity, misconception aggregates, and session-based coverage.
- A participating student is a distinct owner of such published practice.
- Recorded `check`, `hint`, `solution`, and `full_solution` requests qualify,
  including rule, retrieval, LLM, cache, and blocked outcomes. Legacy interaction
  rows without a mode also qualify; answer counts still require `mode = 'check'`.
  Durable answer/reveal counters or completion also preserve historical practice.
- No raw technical-session total is exported. Global AI accounting and feedback
  workflow counts keep their separate operational population and coverage.
- A question is attempted when a retained `mode = 'check'` interaction exists.
- Correctness is `correctAnswerAttempts / (correctAnswerAttempts +
incorrectAnswerAttempts)`, or null when there are no scored checks. Blocked
  checks and unreadable guidance remain in `answerAttempts` and
  `unscoredAnswerAttempts`, but do not lower correctness. Typed checker support
  retains export schema version 2 and Reserve-practice separation.
- Hint and solution-step counts are the durable counters on each session. Each
  session belongs to one question version, allowing aggregation by participant,
  topic, and question without duplicating those counters.
- Tutor-path counts include all recorded interactions, not only answer checks.
  `llmAssistanceInteractions` is provider LLM plus safe LLM cache interactions.
- Misconception frequency uses the latest retained codes on each session. It is
  a session-occurrence measure, not a historical per-attempt frequency.
- Feedback reports are workflow counts. They do not imply that a report was
  valid, that content changed, or that a particular resolution was promised.

## Operational behavior

The response is `private, no-store`, uses `nosniff`, includes a request id, and
downloads as `pilot-analytics-YYYY-MM-DD.json`. Authentication, authorization,
and storage failures fail closed. Demo mode returns a valid empty document
rather than synthetic participants or activity.
