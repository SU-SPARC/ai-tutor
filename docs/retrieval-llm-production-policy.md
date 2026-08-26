# Production Retrieval And LLM Fallback Policy

This document records the enforced production boundary for student retrieval
and optional LLM tutoring. It describes project behavior, not institutional or
university approval of a provider, model, or generated explanation.

## Decision Order

1. Use the immutable published question version for deterministic answer
   checks, known misconceptions, saved hints, saved solution steps, and the
   explicitly requested saved answer.
2. When that material is missing or exhausted, retrieve at most two eligible
   chunks from the active question topic. A candidate needs a strong metadata
   match or at least two meaningful text overlaps; a topic match alone is not
   enough.
3. Call the configured LLM only for an owned active session and published
   course question, after the student explicitly asks for AI help, deterministic
   help is insufficient, and retrieval has been attempted. The LLM provides
   guidance only and cannot grade, complete a question, or override a rule.

Unbound or off-domain requests do not reach the provider.

## Sources And Private Boundaries

Production retrieval is database-only. Eligible sources are published
professor/course-approved public chunks, published approved-generated chunks,
immutable published question versions, and reviewed private-reference safe
summaries. Drafts, unpublished records, local private files, raw uploads,
external web content, and other students' data are excluded.

Raw private text, pages, excerpts, locators, source titles, chunk identifiers,
embeddings, prompts, and provider payloads are not sent to student clients or
stored in tutor sessions, AI caches, or usage logs. A private reference can
contribute only its reviewed `llmSafeSummary`; the prompt substitutes a generic
title and the student response carries the private-reference grounding label.

## Prompt, Model, And Output Contract

- The server sends versioned JSON containing the task, permitted disclosure,
  published question title/prompt, redacted student text, compact progress,
  deterministic answer feedback, and eligible summaries.
- Student text is limited to 500 characters and treated as untrusted data.
  Question title/prompt limits are 160/500 characters. Grounding is limited to
  two 400-character summaries and 800 characters total. The serialized user
  prompt is valid JSON and no more than 2,400 characters.
- The current OpenRouter integration and configured `AI_MODEL` remain in use.
  Temperature is `0.2`, reasoning generation is disabled, tools and streaming
  are disabled, SDK retries are disabled, and output is limited to 64–400
  tokens.
- Provider output must be exactly schema version 1 with a matching
  `pedagogicalAction` (`hint`, `next_step`, or `concept_explanation`) and a
  1–520 character plain-text `message`. The application owns verdict, source,
  disclosure, progress, and usage fields.

Each provider attempt uses the configured 1–30 second limit (25 seconds outside
strict environments), and the whole operation has a 40-second deadline. There
are at most two calls. Only network failures, 408, 429, 5xx, invalid schema, or
a retryable guardrail failure receive one retry. A timed-out attempt is retried
only when the deadline can still provide one full configured request window
after backoff. Other 4xx responses are not retried.

## Usage, Cache, Logging, And Outages

The project owner selected unlimited per-student LLM access: there is no daily,
per-question, or per-session allowance. Input/output limits, owner and IP burst
limits, idempotent event keys, and one pending generation per session remain
abuse and reliability controls.

Successful guarded guidance is cached for 15 minutes using an HMAC key over the
student, question version, model/prompt version, session state, disclosure,
redacted input, and grounding hashes. Cache entries are student-isolated, store
only the safe generated response, and use `source: cache`. Cache hits use no
provider tokens.

Reservations, cache changes, aggregate HMAC-scoped usage, provider token totals,
and the tutor transition settle in the same database transaction. Logs contain
only shortened HMAC keys, normalized outcome/error data, attempts, latency,
guardrail codes, context counts, and token totals. They never contain prompts,
answers, generated text, raw context, account identifiers, IP addresses,
provider bodies, or secret values.

If AI is disabled, times out, is rejected, returns unsafe output, or is
otherwise unavailable, the tutor returns the best eligible retrieval guidance.
If none exists, it returns a generic blocked response. Saved progress remains
unchanged, the failed response is not cached, the session is not marked as
having used AI, and provider or billing details are not shown to the student.

## Release Gates

`npm run test:ai-production` is the executable policy gate. Release requires:

- 100% deterministic routing accuracy and no provider call for rule-sufficient
  cases;
- zero unauthorized/private leakage or premature final-answer disclosure;
- retrieval Recall@2 of at least 90% and no-match precision of at least 95%
  across at least 50 evaluation cases;
- 100% valid student-facing output after repair or safe fallback; and
- grounded correctness of at least 90% and pedagogical helpfulness of at least
  85% across at least 50 balanced output cases.

Any critical safety failure blocks release regardless of aggregate scores.
