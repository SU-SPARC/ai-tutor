# Student-generated similar practice variants

Status: future-architecture proposal, reviewed 2026-09-06. The Reserve-first
"Practice a similar problem" baseline is implemented through
`POST /api/tutor/session/[sessionId]/similar`; generated variants are not
implemented. This document designs a possible later fallback after the
professor-governed Reserve pool has no match, without weakening the content
architecture in [content-lifecycle.md](content-lifecycle.md).

Governing rule: **a practice variant is student-facing practice material that
is never a published question.** It is generated on demand, verified by code,
served only to the student who asked for it and to later students from a
shared pool, and it can become a published question only by a professor
copying it into the normal lifecycle as a draft.

## 0. Decisions at a glance

| Decision                       | Choice                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where variants live            | New tables (`practice_variants`, `practice_variant_sessions`, …). Never `questions`, `question_versions`, or `tutor_sessions`.                                                            |
| Order of preference            | Eligible Reserve question → shared variant pool → deterministic generator from a professor-enabled pattern → LLM-parameterized generator (later phase, off by default).                    |
| Who computes answers           | Always project code from numeric parameters. The LLM may propose scenarios and parameters; it is never the answer oracle.                                                                 |
| Professor governance           | Patterns are code, versioned, and must be professor-enabled with a reason. Each published question opts in to a generation mode. Every policy change is an append-only, attributed event. |
| Effect on progress and mastery | None by default. Variants are excluded from `student_progress`, the dashboard completion model, instructor accuracy, attention signals, and the version-1 analytics export.               |
| Provenance                     | Base question version, pattern id and version, generator kind, seed or parameters, model and prompt version, verification report, and content hash on every variant row.                  |
| Copyright boundary             | Variants are never textual derivatives of professor-provided course material. Generators use project-owned wording; the LLM receives only an abstract pattern descriptor for such bases.  |
| Tutoring on a variant          | Rule-only: answer check, saved hints, saved steps, misconception feedback. No retrieval, no LLM tutoring fallback.                                                                        |
| Retention                      | Variant sessions expire (30 days); pool content expires after 90 days unused; physical deletion is a separate approved operation, matching current repository practice.                   |
| Kill switches                  | `PRACTICE_VARIANTS_ENABLED` and `PRACTICE_VARIANT_LLM_ENABLED` environment flags, both default off in strict environments.                                                                |

## 1. Recommended architecture

### 1.1 Principles

1. **Publication authority is untouched.** `questions.published_version_id`,
   the lifecycle transition function, the publication quality gates, and the
   student views (`app_public_questions`, `app_student_retrieval_chunks`)
   are not modified. Variants are invisible to catalogs, search, `/api/questions`,
   retrieval, and the professor lifecycle tables.
2. **Separate storage, shared engine.** The tutor engine
   (`createTutorResponseFromState` in `src/lib/tutor/tutor-engine.ts`) already
   takes an explicit `PracticeQuestion` and state snapshot, so it can grade and
   coach a variant without change apart from one explicit content-policy option.
   Persistence, analytics, feedback, AI reservations, and integrity checks stay
   keyed on `tutor_sessions` and therefore ignore variants by construction.
3. **Deterministic before probabilistic.** A variant reaches a student through
   the cheapest trustworthy path that can serve it. LLM generation exists only as
   a later fallback and only for pattern families whose answers code can compute.
4. **Verification is code, not confidence.** Every candidate passes the same
   ordered gate list regardless of generator. A failed gate discards the
   candidate; nothing is served "with a warning".
5. **Professor visibility without professor workload.** Nothing in the student
   path waits on a professor. Professors enable patterns and question modes,
   and can inspect, quarantine, restore, or promote any variant at any time.
6. **Same privacy posture as the tutor.** HMAC-scoped keys for limits, redacted
   500-character answers, no prompts or provider payloads stored, pseudonymous
   analytics, and student data included in claim, cleanup, and retention paths.

### 1.2 Components

```
Practice workspace (client)
   └─ POST /api/tutor/session/[sessionId]/similar        (implemented Reserve selection; future ladder may extend it)
   ▼
Similar-practice service (server, current Reserve service plus future src/lib/practice-variants/)
   ├─ 1. eligible Reserve selector          → protected tutor session flow
   ├─ 2. policy resolver                   ← practice_variant_question_policies
   ├─ 3. pool selector                     ← practice_variants (+ per-student served ledger)
   ├─ 4. deterministic generator registry  (code, versioned, professor-enabled)
   ├─ 5. LLM parameterized generator       (phase 3, env + policy gated)
   ├─ verification pipeline                (shared by 4 and 5)
   └─ variant session repository           → practice_variant_sessions / _attempts
Variant session routes  (/api/practice/variants/sessions/[id]/…)  → tutor engine, rule-only
Professor oversight     (/professor/practice-variants, /api/professor/practice-variants/…)
Ledgers                 practice_variant_generation_requests, practice_variant_policy_events,
                        practice_variant_flags, audit_events
```

### 1.3 The generation ladder

Executed in one server request with one idempotency key. Each rung either
returns or falls through; the outcome is written to
`practice_variant_generation_requests` so limits and analytics come from one
ledger.

| Rung | Source                      | Preconditions                                                                                                         | Cost   | Result                       |
| ---- | --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------- |
| 0    | Preconditions               | Feature enabled; origin tutor session is owned, active or completed, on a published version, and finished             | none   | 404 / 409 / `none_available` |
| 1    | Eligible Reserve question   | Current Reserve selector returns an explicitly enabled, approved, available question in the same topic                | none   | `reserve_practice`           |
| 2    | Policy                      | Question policy mode is `deterministic` or `deterministic_then_llm`; pattern policy enabled                           | none   | else `none_available`        |
| 3    | Shared pool                 | An `available`, unexpired variant of that pattern not yet served to this student                                      | none   | `variant_session`            |
| 4    | Deterministic generator     | Registered generator for the pattern; an unused seed remains for this student; daily variant limit not reached        | none   | `variant_session`            |
| 5    | LLM parameterized generator | Mode `deterministic_then_llm`; `PRACTICE_VARIANT_LLM_ENABLED`; student, global, pool, and burst limits; reservation   | tokens | `variant_session`            |
| 6    | Nothing                     |                                                                                                                       | none   | `none_available` with reason |

"Finished" in rung 0 means `solved = true` or every solution step revealed,
matching how the workspace already unlocks the answer explanation.

### 1.4 Boundary invariants

These are testable statements. Each phase adds tests that assert them.

- **I1** No variant id ever appears in `questions`, `question_versions`,
  `app_public_questions`, `/api/questions`, `/api/questions/[id]`, retrieval
  chunks, or a tutor session.
- **I2** No code path inserts into `question_versions` from variant data
  except professor promotion, which creates a `draft` through the existing
  create-question path with `creation_method = 'generated'` and safe
  lineage metadata; the variant row itself is never moved.
- **I3** Variant ids use their own namespace (`pv_` + UUID) and are rejected by
  `POST /api/tutor/session` and every question API.
- **I4** Variants never influence `student_progress`, `getStudentProgress`,
  instructor accuracy, attention signals, or the v1 export sections.
- **I5** Every served variant has a verification report in which every gate
  passed, and a `content_sha256` matching its content.
- **I6** Every variant carries `base_question_version_id`; deleting or
  expiring a variant never touches published content, and unpublishing a base
  question quarantines its variants from new serves but does not delete them.
- **I7** Variant content contains no private-source signals (same regex as
  `questions_no_private_source_signals`) and no forbidden metadata keys (same
  list as the publication gates).
- **I8** Student DTOs for variants expose the same fields as
  `StudentPracticeQuestion` plus `contentKind: "practice_variant"` and a
  non-approved label; hints, steps, answers, and match terms cross the boundary
  only through an owned variant session as progress permits.

## 2. Data model

New tables only. Existing tables gain no columns. Every table follows the
conventions already used by migrations 011, 017, 018, and 022: `text` ids, `jsonb`
with `jsonb_typeof` checks, append-only ledgers guarded by
`app_reject_immutable_mutation()`, and the private-source-signal regex.

### 2.1 `practice_variant_pattern_policies` (current state) and `practice_variant_policy_events` (ledger)

Patterns are code (section 4.2). This table is the professor's approval that a
specific pattern id and generator version may generate student variants.

```sql
create table practice_variant_pattern_policies (
  pattern_id text primary key,
  generator_version integer not null check (generator_version > 0),
  enabled boolean not null default false,
  llm_allowed boolean not null default false,
  max_pool_size integer not null default 12 check (max_pool_size between 1 and 200),
  updated_by_user_id text not null references users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 1000)
);
```

`practice_variant_question_policies` (current state):

```sql
create table practice_variant_question_policies (
  question_id text primary key references questions(id) on delete restrict,
  mode text not null check (mode in ('alternatives_only', 'deterministic', 'deterministic_then_llm')),
  pattern_id text references practice_variant_pattern_policies(pattern_id) on delete restrict,
  daily_student_limit integer check (daily_student_limit between 1 and 50),
  updated_by_user_id text not null references users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  reason text check (reason is null or char_length(reason) <= 1000),
  constraint practice_variant_question_policy_pattern_check check (
    mode = 'alternatives_only' or pattern_id is not null
  )
);
```

Both current-state tables are updated only through the repository, and every
write appends to:

```sql
create table practice_variant_policy_events (
  id bigserial primary key,
  target_type text not null check (target_type in ('pattern', 'question')),
  target_id text not null,
  actor_user_id text not null references users(id) on delete restrict,
  actor_subject text not null,
  actor_display_name text not null,
  from_state_json jsonb not null default '{}'::jsonb,
  to_state_json jsonb not null,
  reason text,
  request_id text,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- + app_reject_immutable_mutation trigger, jsonb object checks, length checks,
--   unique (target_type, target_id, idempotency_key) where idempotency_key is not null
```

Absence of a question policy row means `alternatives_only`. Absence of a
pattern policy row means the generator is disabled everywhere.

### 2.2 `practice_variants` (shared, immutable content)

```sql
create table practice_variants (
  id text primary key check (id ~ '^pv_[0-9a-f-]{36}$'),
  base_question_id text not null,
  base_question_version_id bigint not null,
  topic_id text not null references topics(id) on delete restrict,
  pattern_id text not null references practice_variant_pattern_policies(pattern_id) on delete restrict,
  pattern_version integer not null check (pattern_version > 0),
  generator_kind text not null check (generator_kind in ('deterministic_pattern', 'llm_parameterized')),
  generator_version integer not null check (generator_version > 0),
  seed integer,
  parameters_json jsonb not null check (jsonb_typeof(parameters_json) = 'object'),
  content_json jsonb not null check (jsonb_typeof(content_json) = 'object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  structure_fingerprint text not null,
  number_tuple_hash text not null check (number_tuple_hash ~ '^[0-9a-f]{64}$'),
  model text check (model is null or char_length(model) <= 200),
  prompt_version integer check (prompt_version is null or prompt_version > 0),
  verification_json jsonb not null check (jsonb_typeof(verification_json) = 'object'),
  status text not null default 'available' check (status in ('available', 'quarantined', 'expired', 'promoted')),
  status_reason text check (status_reason is null or char_length(status_reason) <= 1000),
  status_changed_by_user_id text references users(id) on delete restrict,
  status_changed_at timestamptz,
  promoted_question_id text references questions(id) on delete restrict,
  serve_count integer not null default 0 check (serve_count >= 0),
  last_served_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint practice_variants_base_version_fkey
    foreign key (base_question_version_id, base_question_id)
    references question_versions(id, question_id) on delete restrict,
  constraint practice_variants_generator_shape_check check (
    (generator_kind = 'deterministic_pattern' and seed is not null and model is null and prompt_version is null)
    or
    (generator_kind = 'llm_parameterized' and model is not null and prompt_version is not null)
  ),
  constraint practice_variants_no_private_source_signals check (
    content_json::text !~* '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf)'
  ),
  constraint practice_variants_promoted_check check (
    (status = 'promoted') = (promoted_question_id is not null)
  )
);
create unique index practice_variants_content_idx on practice_variants (pattern_id, pattern_version, content_sha256);
create unique index practice_variants_seed_idx on practice_variants (pattern_id, pattern_version, seed) where seed is not null;
create index practice_variants_pool_idx on practice_variants (pattern_id, status, expires_at, last_served_at);
create index practice_variants_base_idx on practice_variants (base_question_id, created_at desc);
```

A trigger permits updates only to `status`, `status_reason`,
`status_changed_by_user_id`, `status_changed_at`, `promoted_question_id`,
`serve_count`, `last_served_at`, and `expires_at`. Content, provenance, and
verification columns are immutable after insert. Deletes are rejected by
trigger; the approved retention operation (section 9.4) disables the trigger
inside its own transaction the way existing custody scripts do.

`content_json` has exactly the `QuestionContent` shape minus `id`:
`title`, `prompt`, `difficulty`, `topicId`, `answer { acceptedAnswers,
explanation, numericValue?, tolerance? }`, `hints[]`, `solutionSteps[]`,
`misconceptions[{ id, feedback, matchTerms[] }]`. This lets the existing
`practiceQuestionFromSnapshot`-style mapping produce a `PracticeQuestion` for
the engine.

### 2.3 `practice_variant_sessions` and `practice_variant_attempts` (student-owned)

Mirror `tutor_sessions` and `attempts` after migration 018, with these
differences: they reference a variant instead of a question version; there are
no retrieval or LLM columns; there is no `response_label` column because it is
constant.

```sql
create table practice_variant_sessions (
  id text primary key,
  user_id text references users(id) on delete restrict,
  anonymous_user_id text,
  variant_id text not null references practice_variants(id) on delete restrict,
  origin_tutor_session_id text references tutor_sessions(id) on delete set null,
  creation_idempotency_key text not null check (char_length(creation_idempotency_key) between 1 and 128),
  status text not null default 'active' check (status in ('active', 'completed', 'expired')),
  current_state text not null default 'working' check (current_state in ('working','hinting','step_reveal','misconception_detected','solved','blocked')),
  attempt_count integer not null default 0,
  wrong_attempt_count integer not null default 0,
  revealed_hints integer not null default 0,
  revealed_steps integer not null default 0,
  solved boolean not null default false,
  completed_at timestamptz,
  last_answer_fingerprint text check (last_answer_fingerprint is null or last_answer_fingerprint ~ '^[0-9a-f]{64}$'),
  last_misconception_ids_json jsonb not null default '[]'::jsonb,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint practice_variant_sessions_identity_check check (num_nonnulls(user_id, anonymous_user_id) = 1),
  constraint practice_variant_sessions_counts_check check (
    attempt_count >= 0 and wrong_attempt_count between 0 and attempt_count and revision >= 0
    and revealed_hints >= 0 and revealed_steps >= 0
  ),
  constraint practice_variant_sessions_completion_check check (
    (status = 'completed' and solved and current_state = 'solved' and completed_at is not null) or status <> 'completed'
  )
);
create unique index practice_variant_sessions_user_idempotency_idx on practice_variant_sessions (user_id, creation_idempotency_key) where user_id is not null;
create unique index practice_variant_sessions_anonymous_idempotency_idx on practice_variant_sessions (anonymous_user_id, creation_idempotency_key) where anonymous_user_id is not null;
create index practice_variant_sessions_owner_idx on practice_variant_sessions (user_id, last_seen_at desc) where user_id is not null;
create index practice_variant_sessions_anonymous_owner_idx on practice_variant_sessions (anonymous_user_id, last_seen_at desc) where anonymous_user_id is not null;
create index practice_variant_sessions_variant_idx on practice_variant_sessions (variant_id, status);

create table practice_variant_attempts (
  id bigserial primary key,
  session_id text not null references practice_variant_sessions(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  mode text not null check (mode in ('check', 'hint', 'solution', 'full_solution')),
  submitted_answer text check (submitted_answer is null or char_length(submitted_answer) <= 500),
  normalized_answer text check (normalized_answer is null or char_length(normalized_answer) <= 500),
  verdict text check (verdict in ('correct', 'incorrect', 'guidance', 'blocked')),
  tutor_state text,
  misconception_ids_json jsonb not null default '[]'::jsonb,
  misconception_feedback_json jsonb not null default '[]'::jsonb,
  progress_revision bigint,
  created_at timestamptz not null default now(),
  unique (session_id, idempotency_key)
);
```

Storing `misconception_ids_json` per attempt removes the "codes are per
session, not per attempt" limitation documented in
[instructor-student-analytics.md](instructor-student-analytics.md) for
variants, and makes distractor analytics possible.

The per-student served ledger is derived: `practice_variant_sessions` joined on
owner and `variant_id`. No separate table is needed.

### 2.4 `practice_variant_generation_requests` (limits and cost ledger)

One append-only row per ladder execution. Keys are HMAC-derived with
`AI_USAGE_HMAC_SECRET` exactly as `ai_llm_reservations` does, so the ledger
holds no raw owner identifiers.

```sql
create table practice_variant_generation_requests (
  id bigserial primary key,
  student_key_hash text not null,
  idempotency_key text not null,
  base_question_id text not null references questions(id) on delete restrict,
  base_question_version_id bigint not null,
  pattern_id text,
  outcome text not null check (outcome in (
    'published_alternative', 'pool_hit', 'deterministic_generated', 'llm_generated',
    'none_available', 'blocked', 'verification_failed', 'provider_failed'
  )),
  block_reason text check (block_reason is null or block_reason in (
    'feature_disabled', 'policy_disabled', 'pattern_disabled', 'daily_student_limit',
    'daily_llm_student_limit', 'daily_llm_global_limit', 'pool_full', 'burst_limit', 'seeds_exhausted'
  )),
  variant_id text references practice_variants(id) on delete set null,
  served_question_id text references questions(id) on delete set null,
  provider_calls integer not null default 0 check (provider_calls >= 0),
  provider_input_tokens integer not null default 0,
  provider_output_tokens integer not null default 0,
  provider_total_tokens integer not null default 0,
  usage_is_estimate boolean not null default false,
  usage_date date not null default (timezone('UTC', now())::date),
  latency_ms integer,
  request_id text,
  created_at timestamptz not null default now(),
  unique (student_key_hash, idempotency_key),
  constraint practice_variant_generation_requests_base_version_fkey
    foreign key (base_question_version_id, base_question_id)
    references question_versions(id, question_id) on delete restrict
);
create index practice_variant_generation_requests_student_day_idx on practice_variant_generation_requests (student_key_hash, usage_date, outcome);
create index practice_variant_generation_requests_day_idx on practice_variant_generation_requests (usage_date, outcome);
```

A single-pending-per-student partial unique index (like
`ai_llm_reservations_one_pending_session_idx`) prevents two concurrent LLM
generations for one student. The mutable reservation is separate because the
final request ledger is append-only:

```sql
create table practice_variant_generation_reservations (
  id bigserial primary key,
  student_key_hash text not null,
  idempotency_key text not null,
  status text not null check (status in ('pending', 'settled', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_key_hash, idempotency_key)
);
create unique index practice_variant_generation_reservations_one_pending_student_idx
  on practice_variant_generation_reservations (student_key_hash)
  where status = 'pending';
```

### 2.5 `practice_variant_flags` (student reports)

```sql
create table practice_variant_flags (
  id bigserial primary key,
  variant_id text not null references practice_variants(id) on delete restrict,
  session_id text not null references practice_variant_sessions(id) on delete restrict,
  student_key_hash text not null,
  category text not null check (category in ('answer_appears_incorrect', 'wording_unclear', 'inappropriate_content', 'hint_unhelpful', 'other')),
  message text check (message is null or char_length(message) <= 1000),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (session_id, idempotency_key)
);
```

The first `answer_appears_incorrect` or `inappropriate_content` flag on a
variant sets its status to `quarantined` with reason `student_flag` in the same
transaction. Professors can restore it. `feedback_reports` is not extended
because its foreign keys require a tutor session and a question version.

### 2.6 Grants and integrity

`db/roles/app_runtime.sql` enumerates grants explicitly. The same change must
add `select, insert` on all new tables, `update` on `practice_variants` (status
columns), the two policy tables, `practice_variant_sessions`, and
`practice_variant_generation_reservations`, plus `usage` on new sequences. The
role script must be reapplied through the approved custody process after the
migration so it also creates the standard RLS policy for every new table. No
`delete` grant; deletion is the approved retention operation with the custody
role.

`scripts/lib/database-integrity.mjs` gains checks (all read-only, no repair):

- `orphaned_practice_variant_sessions`: exactly one identity, variant exists.
- `practice_variant_verification_incomplete`: `status = 'available'` with any
  gate not `passed` in `verification_json`.
- `practice_variant_content_hash_mismatch`: recomputed SHA-256 of
  canonical `content_json` differs from `content_sha256`.
- `practice_variant_leaked_into_lifecycle`: any `questions.id` or
  `question_versions.snapshot_json ->> 'id'` matching `^pv_`.
- `practice_variant_promotion_linkage`: `status = 'promoted'` rows whose
  question's first version lacks `generation_metadata_json.promotedFromVariantId`.

### 2.7 What is deliberately not changed

`questions`, `question_versions`, `question_version_lifecycle`,
`question_lifecycle_events`, `question_patterns`, `tutor_sessions`,
`attempts`, `student_progress`, `ai_usage`, `ai_llm_reservations`,
`ai_response_cache`, `feedback_reports`, all student views, all lifecycle
functions and triggers, and the publication quality gates.

## 3. Lifecycle distinction: published question versus ephemeral variant

| Aspect                 | Published question version                                  | Practice variant                                                                                            |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Identity               | Stable `questions.id`; immutable `question_versions.id`     | `pv_<uuid>`; immutable content row in `practice_variants`                                                   |
| Creation               | Professor, import, intake, or bounded generation as `draft` | Runtime generator (deterministic or LLM-parameterized) at a student's request                               |
| Review                 | Professor `approve` on the exact version; publication gates | Code verification report; professor may inspect, quarantine, restore, or promote afterwards                 |
| Visibility source      | `questions.published_version_id` plus availability rules    | Only through an owned `practice_variant_sessions` row; never listed                                         |
| Discovery              | Catalog, topic pages, search, `/api/questions`, retrieval   | None                                                                                                        |
| Tutoring               | Rule → retrieval → LLM fallback                             | Rule only                                                                                                   |
| Session                | `tutor_sessions` pinned to the version                      | `practice_variant_sessions` pinned to the variant                                                           |
| Progress and mastery   | Counts                                                      | Excluded; separate "extra practice" counters only                                                           |
| Analytics              | Instructor analytics, export v1                             | Separate professor section; export v2 `practiceVariants` block                                              |
| Feedback               | `feedback_reports`                                          | `practice_variant_flags` with auto-quarantine                                                               |
| Provenance record      | Lifecycle ledger, attribution, content hash                 | Base version, pattern id/version, generator, seed or parameters, model, prompt version, verification        |
| Takedown               | `unpublish` with immediate session `content_unpublished`    | `quarantine` stops new serves; open sessions continue; base unpublish quarantines its variants              |
| Retention              | Permanent academic record                                   | Sessions 30 days; content 90 days unused; physical deletion by approved operation                           |
| Path to the other side | n/a                                                         | Professor `promote` copies content into a new question `draft` in `needs_review`; variant marked `promoted` |

### 3.1 Variant status machine

```
available ──quarantine (professor | student flag | base unpublished)──▶ quarantined
available ──expires_at passed──▶ expired
quarantined ──restore (professor, reason)──▶ available
available | quarantined ──promote (professor, reason)──▶ promoted   (terminal)
```

`expired` and `promoted` are terminal. Serving requires `available` and
`expires_at > now()`. Open sessions on a `quarantined` variant remain usable
until they expire, because the student already saw the content; the workspace
shows the quarantine notice and hides "Try another" for that variant.

### 3.2 Promotion into the lifecycle

Promotion calls the existing initial-draft creation path (the repository
behind `POST /api/professor/questions`) with the variant's content, a new
stable question id, `creation_method = 'generated'`,
`source.sourceType = 'pattern_derived_original'` (pattern id recorded in
`source.patternIds` only if that pattern also exists in the reviewed
`question_patterns` table; otherwise `generated_original`),
`trustLevel = 'generated_unverified'`, `visibility = 'public'`, and an
originality note stating the pattern id, generator version, and seed or
parameter hash. `generation_metadata_json` gets only safe keys:
`promotedFromVariantId`, `patternId`, `patternVersion`, `generatorKind`,
`generatorVersion`, `promotedBy`, `promotedAt`. The professor then uses the
normal submit → approve → publish path. Approval and publication are never
implied by promotion.

## 4. Generation pipeline

### 4.1 Request contract

```
Implemented baseline:
POST /api/tutor/session/[sessionId]/similar
200  { practice: { question: StudentPracticeQuestion, sessionId } | null }

Future additive ladder contract:
POST /api/tutor/session/[sessionId]/similar
Body    { idempotencyKey: string (1–128 chars) }
200     { outcome: "reserve_practice", question: StudentPracticeQuestion, sessionId }
      | { outcome: "variant_session", session: PracticeVariantSessionDto, variant: StudentPracticeVariantDto }
      | { outcome: "none_available", reason: "policy_disabled" | "exhausted" | "limit_reached" | "generation_unavailable", message, retryAfterSeconds? }
400 malformed · 401 no identity · 404 origin session not owned/unavailable · 409 not completed or idempotency conflict · 429 burst · 503 data service
```

The same idempotency key always returns the same outcome, including the same
variant session, because the ledger row is looked up first.

### 4.2 Pattern registry contract (code)

`src/lib/practice-variants/patterns/` exports a registry keyed by pattern id.
Pattern ids reuse the public-safe seed ids in `data/demo/question-patterns.json`
where a matching generator exists (for example
`pattern-basic-probability-complement`,
`pattern-combinations-unordered-selection`,
`pattern-conditional-probability-restricted-table`,
`pattern-binomial-distribution-exact-count`), so published
`pattern_derived_original` questions can be prefilled with their pattern in the
professor UI.

```ts
export type PracticeVariantFamily =
  | "complement_probability"
  | "unordered_selection"
  | "ordered_selection"
  | "conditional_from_counts"
  | "independent_product"
  | "discrete_expected_value"
  | "discrete_variance"
  | "binomial_exact_count"
  | "z_score";

export type PracticeVariantDescriptor = {
  // public-safe; also the only LLM input for course-material bases
  patternId: string;
  family: PracticeVariantFamily;
  topicId: string;
  difficulty: Difficulty;
  taskShape: string; // one sentence, project-owned wording
  variables: Array<{
    name: string;
    role: string;
    type: "integer" | "decimal" | "percent" | "count";
    min?: number;
    max?: number;
    values?: number[];
  }>;
  constraints: string[];
  answerDomain: {
    kind: "probability" | "count" | "real";
    min?: number;
    max?: number;
  };
  misconceptionHooks: Array<{ id: string; description: string }>;
};

export type PracticeVariantCandidate = {
  content: Omit<QuestionContent, "id">;
  parameters: Record<string, number>;
  patternId: string;
  patternVersion: number;
  generatorKind: "deterministic_pattern" | "llm_parameterized";
  generatorVersion: number;
  seed?: number;
  model?: string;
  promptVersion?: number;
};

export type PracticeVariantGenerator = {
  descriptor: PracticeVariantDescriptor;
  version: number;
  seedSpace: number; // number of valid seeds
  generate(seed: number): PracticeVariantCandidate; // pure and deterministic
  computeAnswer(parameters: Record<string, number>): {
    numericValue: number;
    acceptedAnswers: string[];
    tolerance: number;
    explanation: string;
  };
  distractors(
    parameters: Record<string, number>,
  ): Array<{ misconceptionId: string; value: number; feedback: string }>;
  oracle?(parameters: Record<string, number>): number; // independent brute-force check when feasible
  render?(
    parameters: Record<string, number>,
    context: number,
  ): Omit<QuestionContent, "id">; // used by the LLM path to regenerate hints/steps deterministically when the LLM's text fails a gate
};
```

Bumping `version` invalidates nothing already served; pool rows record the
version they were generated with, and the pool selector filters on the current
version.

### 4.3 Deterministic generation and parameter substitution

Parameter substitution is done only over **project-owned template wording that
lives in the generator**, ported from the builders in
`scripts/generate-questions.mjs` and
`src/lib/tutor/generated-question-regeneration.ts`. A seed indexes the
enumerated, constraint-filtered Cartesian product of variable values plus a
small list of neutral scenario contexts (tickets, survey slips, app prompts,
routes). The base question's text is never read by a deterministic generator;
only its policy (which pattern) is. That is what keeps professor-provided
course problems out of derivative wording.

Seed selection for a student: iterate `i = 0, 1, 2, …` over
`seed = (hash(studentKeyHash, patternId) + i) mod seedSpace`, skipping seeds
whose pool row was already served to that student and seeds whose pool row is
quarantined; stop at the first seed that yields a verified candidate. Different
students therefore start at different seeds, and one student never sees the
same seed twice. When all seeds have been served to the student, rung 4 reports
`seeds_exhausted`.

Recommended first generators (all with brute-force oracles): complement
probability, unordered selection, ordered selection, conditional probability
from counts. Binomial exact count and discrete expected value can follow with
formula-only verification plus a second independent implementation.

### 4.4 LLM parameterized generation (later phase)

The LLM proposes; code decides. The provider call reuses the OpenRouter client
pattern in `src/lib/question-intake/ai.ts`: server-only, tool-call forced,
`reasoning: { enabled: false }`, temperature 0.2, two attempts, one deadline,
no streaming, no SDK retries.

Input (versioned JSON, `PRACTICE_VARIANT_PROMPT_VERSION = 1`):

- the pattern descriptor (section 4.2);
- the requested difficulty;
- for a base question whose `source.sourceType` is `original_demo`,
  `generated_original`, or `pattern_derived_original`: the base prompt as a
  style exemplar (≤ 500 characters), with an instruction to use a different
  scenario and different numbers;
- for a base question whose `source.sourceType` is `professor_provided`: **no
  base text at all**, only the descriptor;
- an explicit list of forbidden contexts (section 5.4) and the schema.

Output tool `submit_practice_variant` (all keys required, no extras):

```
schemaVersion: 1
patternId: <enum: the requested id>
parameters: { <each descriptor variable>: number }      // JSON schema generated from the descriptor
title: string (≤160)
prompt: string (≤500)
hints: string[2..4]
solutionSteps: string[2..8]
misconceptions: [{ id: <enum: descriptor hook ids>, feedback: string }]
claimedAnswer: number
```

Then, in code:

1. `computeAnswer(parameters)` produces the authoritative answer, accepted
   forms, tolerance, and explanation. `claimedAnswer` must agree within
   tolerance or the candidate is rejected (`answer_matches_family_formula`).
2. `distractors(parameters)` produces misconception match terms as the wrong
   values a student would actually type. The LLM's misconception text is used
   as feedback only if it passes the gates; otherwise the descriptor's
   default feedback is used.
3. Every number token in `prompt` must be one of the parameter values or a
   constant declared by the descriptor (`prompt_numbers_match_parameters`).
4. If hints or steps fail a gate and the generator implements `render`, the
   deterministic rendering replaces them and the candidate is re-verified
   once; otherwise the candidate is rejected.

A pattern family with no `computeAnswer` cannot use the LLM path. Free-form
LLM questions for a student are out of scope by design; the correct home for
unverifiable AI drafts is the professor intake queue that already exists.

### 4.5 Solution, hint, and misconception generation

| Artifact       | Deterministic path                                     | LLM path                                                             |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Final answer   | `computeAnswer`                                        | `computeAnswer`; LLM's claim only checked for agreement              |
| Explanation    | `computeAnswer.explanation` template                   | Same                                                                 |
| Solution steps | Template with parameters substituted                   | LLM text if gates pass, else `render`, else reject                   |
| Hints          | Template (2–4, first never reveals the answer)         | LLM text if gates pass, else `render`, else reject                   |
| Misconceptions | `distractors` values as match terms, template feedback | `distractors` values as match terms; LLM feedback text if gates pass |

Match terms built from computed distractor values are stronger than the phrase
lists in published questions: they match exactly what a student who made that
error would type, and they can never collide with the correct answer because
the verification gate `distractor_terms_not_equal_answer` rejects that case.

### 4.6 Duplicate prevention

Three layers, cheapest first:

1. **Per student**: the served ledger (variant sessions by owner) excludes
   variants already seen; seed selection skips them.
2. **Within the pool**: unique `(pattern_id, pattern_version, content_sha256)`
   and `(pattern_id, pattern_version, seed)`; an insert conflict becomes a pool
   hit.
3. **Against published content**: the candidate's normalized prompt must not
   equal any published prompt; the pair (`structure_fingerprint`,
   `number_tuple_hash`) must not equal the base question's or any published
   question's in the same topic. `questionStructureFingerprint` and the token
   helpers in `src/lib/question-intake/duplicates.ts` are reused. Same
   structure with different numbers is allowed; that is what "similar" means.

## 5. Verification pipeline

One pure function, `verifyPracticeVariantCandidate(candidate, context)`, returns
`{ passed: boolean, checks: Array<{ code, status: "passed" | "failed", message }> }`.
The full report is stored in `verification_json`; a candidate is stored and
served only when every check passed. Order is fixed so reports are comparable.

| #   | Code                                    | Rule                                                                                                                                | Reused from                                |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | `schema_shape`                          | Exact `QuestionContent` shape and the intake length limits (title ≤ 500, prompt ≤ 8,000, 2–4 hints, 1–12 steps, ≤ 8 misconceptions) | `validateQuestionIntakeModelDraft` limits  |
| 2   | `topic_active`                          | `topicId` equals the pattern's topic and is an active syllabus topic                                                                | canonical topics                           |
| 3   | `difficulty_matches_pattern`            | Difficulty equals the pattern descriptor's difficulty                                                                               |                                            |
| 4   | `parameters_in_domain`                  | Every parameter satisfies the descriptor's type, range, and constraints                                                             |                                            |
| 5   | `answer_matches_family_formula`         | `answer.numericValue` equals `computeAnswer(parameters)` within tolerance; accepted answers parse to the same value                 | `parseAnswerNumber`                        |
| 6   | `answer_matches_oracle`                 | When `oracle` exists, brute-force result agrees within tolerance                                                                    |                                            |
| 7   | `answer_in_domain`                      | Probability answers in [0, 1]; counts are non-negative integers                                                                     |                                            |
| 8   | `answer_schema`                         | Numeric value, tolerance, and accepted answers are mutually consistent                                                              | `answerSchemaIsConsistent` (intake schema) |
| 9   | `answer_in_solution`                    | The final value appears in the explanation or a step                                                                                | `answerAppearsInSolution`                  |
| 10  | `hint_progression`                      | Hint 1 does not reveal the answer; no hint duplicates prompt, steps, or answer                                                      | `hintRevealsAnswer`, `usefulHint` logic    |
| 11  | `prompt_numbers_match_parameters`       | Numeric tokens in the prompt ⊆ parameters ∪ declared constants                                                                      | number regex from `numericValuesInText`    |
| 12  | `misconception_ids_valid`               | Ids unique and drawn from the descriptor's hooks                                                                                    |                                            |
| 13  | `distractor_terms_not_equal_answer`     | No match term parses to the correct value                                                                                           |                                            |
| 14  | `private_source_signal`                 | Regex from the publication gates and `questions_no_private_source_signals` finds nothing in any text field                          | `PRIVATE_SOURCE_SIGNAL`                    |
| 15  | `forbidden_metadata_keys`               | No key in `FORBIDDEN_PRIVATE_METADATA_KEYS` anywhere in the candidate                                                               | publication gates                          |
| 16  | `content_safety_denylist`               | Section 5.4 denylist finds nothing                                                                                                  | new                                        |
| 17  | `not_duplicate_published`               | Section 4.6 layer 3                                                                                                                 | `duplicates.ts`                            |
| 18  | `numbers_differ_from_base`              | `number_tuple_hash` differs from the base question version's                                                                        |                                            |
| 19  | `wording_distance_from_course_material` | Only when the base is `professor_provided`: Jaccard ≤ 0.5 against the base prompt and no shared 8-word n-gram                       | `jaccardSimilarity`                        |
| 20  | `content_hash`                          | SHA-256 over canonical JSON of `content` equals the stored hash                                                                     | lifecycle hashing conventions              |

Gates 5, 6, 11, 13, 17, 18, and 19 are the ones that exist specifically
because an LLM may be upstream. They run for deterministic candidates too, so
a generator bug is caught the same way a model error is.

### 5.1 Independent oracles

For counting and finite-sample-space families, the oracle enumerates the
sample space directly (for example, counting subsets for `C(n, k)` with
`n ≤ 15`, or enumerating labeled items for complement and conditional
probabilities). Formula and enumeration disagreeing is a generator bug and
blocks the candidate. Oracles are required for the first four generators and
are covered by property tests over the entire seed space, which is small by
construction.

### 5.2 Release gates for the LLM path

Modeled on `npm run test:ai-production`. A fixture set of at least 50
provider outputs (recorded, synthetic, and adversarial) must show: 100% schema
rejection of malformed payloads; 100% rejection when `claimedAnswer` disagrees
with `computeAnswer`; zero private-signal or denylist leakage; zero candidates
that pass with numbers absent from `parameters`; and at least 90% of
well-formed outputs passing all gates so the path is actually useful. Any
critical safety failure blocks enabling `PRACTICE_VARIANT_LLM_ENABLED`.

### 5.3 Provider output handling

Only tool-call arguments are parsed. Free text, markdown fences, reasoning
leakage, or an unexpected root key fails `schema_shape`. The provider response
body is never logged or stored; logs carry outcome, attempt count, latency,
token totals, and failing gate codes only, following
`logPilotOperationalEvent` conventions.

### 5.4 Content safety

- Scenario contexts are restricted to neutral everyday settings. The system
  prompt lists allowed context families and forbids real people, named
  institutions, protected-characteristic demographics as variables, violence,
  medical diagnosis, sexual content, self-harm, illegal activity, and
  real-money gambling framings. Dice, cards, and spinners remain allowed as
  classical probability devices.
- A code denylist (regex, maintained in
  `src/lib/practice-variants/content-safety.ts`) enforces the same list on
  every text field for both generator kinds.
- Student flags with category `inappropriate_content` quarantine immediately.
- Professors see flagged and quarantined variants first in the oversight page.

### 5.5 Copyright and private-reference boundaries

- Deterministic generators contain only project-owned wording and never read
  base question text.
- The LLM path never receives professor-provided prompt text and never
  receives private extracted text, pattern controls, phrase hashes, or
  locators. It receives the descriptor, which is the same public-safe
  abstraction the existing generation workflow already permits.
- Gate 19 rejects wording that drifts toward a course-material base even
  through the descriptor.
- Gates 14 and 15 keep the existing private-signal and metadata prohibitions.
- Promotion carries an originality note stating the generator and parameters
  so a professor can judge originality before approving.

## 6. Student UX

Entry point: in the practice workspace, when the session is solved or all
steps are revealed, a "Practice a similar problem" button appears next to
"Back to topic".

Outcomes:

- **Published question**: the workspace loads that question through the
  existing session flow. The lookup and button are already implemented and
  use no model tokens. A future variant mode may add a "Professor-approved"
  badge without changing that flow.
- **Variant session**: the workspace switches to variant mode in place. A
  persistent banner reads "Practice variant · generated from an approved
  pattern · not professor-reviewed · does not count toward your progress", with
  a "Report a problem" link. The sidebar does not list the variant; the
  breadcrumb shows the base question title. Answer, hint, and step controls
  behave exactly as today. There is no AI-help control. On solve: "Try
  another" runs the ladder again from the same origin session, and "Back to
  course problems" returns to the base question.
- **None available**: an inline notice, "No similar problem is available for
  this question yet", with a link to the topic page. Reason `limit_reached`
  adds the retry hint.

Loading: the deterministic path completes in one round trip. The LLM path may
take up to the provider deadline; the button shows "Preparing a practice
variant…" with a cancel control, and a failure degrades to the
`none_available` notice without exposing provider details.

Resume: variant sessions are resumable for their retention period through a
"Recent practice variants" list inside the workspace (phase 2). They do not
appear on the dashboard's question list. The dashboard summary may gain one
line, "Extra practice: N variants solved (not counted toward progress)".

Reporting: categories are answer appears incorrect, wording unclear,
inappropriate content, hint unhelpful, other; message optional, 1,000
characters, redacted like tutor answers.

## 7. Professor oversight

Page `/professor/practice-variants` (requires `requireProfessorReview`) with
three views:

1. **Policies**: per published question, the current mode and pattern (with a
   prefilled suggestion when the version's `source.patternIds[0]` matches a
   registered generator), and per pattern the enabled flag, generator version,
   LLM allowance, and pool cap. Every change requires a reason and produces a
   `practice_variant_policy_events` row and an `audit_events` row. Read-only in
   demo mode, like the availability panel.
2. **Pool**: per pattern and per base question: available, quarantined,
   expired, promoted counts; serve count; first-attempt correct rate; flag
   count; generator mix; tokens spent. Flagged variants sort first. Each
   variant opens a detail view with the full content, parameters, verification
   report, provenance chain, and its sessions summary (counts only).
3. **Actions**: quarantine and restore (reason required, idempotent), promote
   to draft (section 3.2), and "regenerate pool" which pre-fills the pool
   deterministically up to the cap so the first students never wait.

APIs (all professor-only, added to the permission matrix):

```
GET   /api/professor/practice-variants?view=policies|pool&questionId=&patternId=
GET   /api/professor/practice-variants/[variantId]
POST  /api/professor/practice-variants/[variantId]/status   { action: "quarantine" | "restore", reason, idempotencyKey }
POST  /api/professor/practice-variants/[variantId]/promote  { reason, idempotencyKey }  → QuestionLifecycleDto
PATCH /api/professor/practice-variants/policies             { target: "question" | "pattern", id, …fields, reason, idempotencyKey }
POST  /api/professor/practice-variants/prefill              { patternId, count ≤ cap, idempotencyKey }
```

Base question events that affect variants: `unpublish`, `archive`, and
publication replacement quarantine the question's variants with reason
`base_question_changed` (the pool selector also re-checks that the base version
is still the published one, so no trigger on lifecycle tables is needed).
`rollback` to a prior version does not restore them automatically; a professor
restores explicitly.

## 8. Token and cost design

| Rung                    | Provider tokens        | Notes                                                                        |
| ----------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| Eligible Reserve question | 0                    | Implemented baseline; no generation or provider call                        |
| Pool hit                | 0                      | Shared across students; the pool is the primary cost control                 |
| Deterministic generator | 0                      | Bounded CPU; whole seed spaces are small                                     |
| LLM parameterized       | ≈ 900 in / ≤ 1,200 out | Only when the pool is below cap and the student has exhausted pool and seeds |

Controls, all environment-configured and validated in `src/lib/env/server.ts`:

Eligible Reserve questions are the implemented first additional-practice
source. Published alternatives are not a rung in this design. The flags below
control the future generated-variant work only.

| Variable                                   | Default (strict envs) | Purpose                                           |
| ------------------------------------------ | --------------------- | ------------------------------------------------- |
| `PRACTICE_VARIANTS_ENABLED`                | `false`               | Future generated variants beyond Reserve practice |
| `PRACTICE_VARIANT_DAILY_STUDENT_LIMIT`     | `10`                  | Variant sessions created per student per UTC day  |
| `PRACTICE_VARIANT_LLM_ENABLED`             | `false`               | Rung 5                                            |
| `PRACTICE_VARIANT_LLM_DAILY_STUDENT_LIMIT` | `2`                   | Provider generations per student per UTC day      |
| `PRACTICE_VARIANT_LLM_DAILY_GLOBAL_LIMIT`  | `50`                  | Provider generations per UTC day across the pilot |
| `PRACTICE_VARIANT_LLM_MAX_OUTPUT_TOKENS`   | `1200`                | Provider `max_tokens`                             |
| `PRACTICE_VARIANT_POOL_MAX_PER_PATTERN`    | `12`                  | Default pool cap; pattern policy may lower it     |
| `PRACTICE_VARIANT_SESSION_RETENTION_DAYS`  | `30`                  | Session `expires_at`                              |
| `PRACTICE_VARIANT_CONTENT_RETENTION_DAYS`  | `90`                  | Pool row `expires_at`, extended on each serve     |

Existing variables reused: `AI_ENABLED`, `AI_MODEL`, `OPENROUTER_API_KEY`,
`AI_REQUEST_TIMEOUT_MS`, `AI_USAGE_HMAC_SECRET`, `AI_LLM_BURST_MAX_REQUESTS`
and window (applied to variant generation requests as well).

Accounting: the request ledger stores provider calls and token totals per
request; a daily aggregate is a query, not a table. The professor analytics
section shows tokens per day and per pattern. The pool cap converts spend into
a bounded asset: at most `cap × patterns` LLM generations can ever be needed
while the pool is healthy, and the prefill action lets a professor pay that
cost up front instead of at student request time.

## 9. Privacy and provenance design

### 9.1 Identity

Variant sessions store the owner exactly as `tutor_sessions` does (one of
`user_id`, `anonymous_user_id`) so ownership checks, the `StudentOwner`
predicate, and the sign-in claim flow work unchanged. Limits and analytics use
`sha256('user:' || user_id)` / `sha256('anon:' || anonymous_user_id)` for the
instructor surfaces and HMAC keys with `AI_USAGE_HMAC_SECRET` for the ledger,
mirroring the two existing conventions.

### 9.2 What is stored and what is not

| Stored                                                                             | Never stored                                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Variant content, parameters, verification report, hashes, model id, prompt version | Provider request or response bodies, prompt text, reasoning text, API keys |
| Redacted 500-character submitted and normalized answers on variant attempts        | Raw student free text beyond that limit, IP addresses                      |
| HMAC student key, token totals, outcome, block reason                              | Owner identifiers in the generation ledger                                 |
| Flag category and 1,000-character message                                          | Reporter identity beyond the HMAC key                                      |

Variant content is not personal data: it is generated from a descriptor, never
from student input.

### 9.3 Provenance chain

Every served variant answers these questions from stored columns alone: which
published version prompted it; which pattern and generator version produced
it; whether a model was involved and which prompt version; which parameters
and seed; which gates ran and their results; when it was created, last served,
quarantined, restored, or promoted, and by whom. Student-facing DTOs expose
only `baseQuestionId`, the pattern's topic, and the non-approved label.

### 9.4 Retention and deletion

- Reads filter on `expires_at`; a row past expiry behaves as absent.
- Physical deletion is `npm run db:practice-variants:prune` (new script under
  `scripts/`, custody role, dry-run first, JSON evidence, never prunes a
  variant with an unexpired session), added alongside the existing custody
  scripts rather than as an automatic job, consistent with the note in
  migration 018 that retention enforcement requires a separately approved
  change.
- `src/lib/auth/anonymous-claims.ts` moves `practice_variant_sessions` (and
  their attempts and flags follow by foreign key) in the same transaction as
  tutor sessions; the discard path deletes nothing, as today.
- `scripts/lib/pilot-data-cleanup.mjs` includes the four student-data tables
  in its inspect, plan, rehearse, and execute manifests.
- Backups need no change; the daily export dumps the whole `public` schema.

## 10. Migration requirements

Use the next available forward-only migration, currently
`023_practice_variants.sql`:

1. Tables and indexes from section 2, with immutability triggers on
   `practice_variant_policy_events`, `practice_variant_generation_requests`,
   `practice_variant_attempts`, and `practice_variant_flags`, and the
   column-restricted update trigger on `practice_variants`.
2. Enable RLS on every new table. Update `db/roles/app_runtime.sql` and custody
   verification expectations in the same change; do not grant runtime access
   from the migration. Reapply the role script only through the approved
   custody process after migration.
3. No data backfill; no change to existing constraints, views, functions, or
   triggers.
4. `docs/database.md`, `docs/database-integrity.md`,
   `docs/authorization-permission-matrix.md`, `docs/content-lifecycle.md` (a
   short "outside the lifecycle" cross-reference), and
   `docs/retrieval-llm-production-policy.md` (a second LLM purpose with its own
   limits) updated in the same change.
5. `tests/production-schema-migration.test.ts` and
   `tests/database-integrity.test.ts` extended for the new objects and checks;
   `tests/pilot-data-cleanup.test.ts` extended for the new student-data tables.
6. Custody: `npm run db:custody:verify` expectations updated for the new
   grants; the credential-topology fingerprint is unaffected.

Rollback: the migration workflow is forward-only; the feature flags default
off, so a deployed migration with the feature disabled is inert.

## 11. Implementation phases

| Phase | Scope                                                                                                                                                                                                                                                                                                                                              | Exit criteria                                                                                                                               |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Implemented baseline: eligible Reserve selection through `POST /api/tutor/session/[sessionId]/similar`, protected tutor session, workspace button, no generation ledger                                                                                                                                                                           | Existing Reserve-practice service and API/UI tests remain green                                                                             |
| 1     | Migration 023 (or next available); env flags; future POST ladder; pattern registry with four deterministic generators and oracles; verification pipeline; pool and variant-session repositories (database and memory); rule-only variant session routes; workspace variant mode; flags with auto-quarantine; claim, cleanup, and integrity updates | Invariants I1–I8 tested; `npm run typecheck`, `npm run lint`, vitest green; feature works with `PRACTICE_VARIANTS_ENABLED=true` and LLM off |
| 2     | Professor policies page, pool view, variant detail, quarantine/restore, promote-to-draft, prefill; analytics section; export v2 `practiceVariants`; dashboard "extra practice" line; resume list; prune script                                                                                                                                     | Professor can govern everything without SQL; export consumers see `schemaVersion: 2`                                                        |
| 3     | LLM parameterized generator behind `PRACTICE_VARIANT_LLM_ENABLED`; reservation table; cost ledger columns used; release-gate test suite `test:practice-variants-ai`; policy doc update                                                                                                                                                             | Section 5.2 gates pass on the fixture set; production stays off until the pilot owner enables it                                            |
| 4     | Optional: professor-authored slot templates with a whitelist arithmetic grammar; topic-level policy defaults; more oracles; difficulty ladders (harder variant after two solves)                                                                                                                                                                   | Each item has its own design note                                                                                                           |

## 12. Risks

| Risk                                                                  | Likelihood | Impact | Mitigation                                                                                                |
| --------------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------- |
| A variant has a wrong answer                                          | Medium     | High   | Code-computed answers, oracles, property tests over whole seed spaces, student flags with auto-quarantine |
| LLM paraphrases a course-material problem                             | Medium     | High   | No base text for `professor_provided` bases; descriptor only; gate 19; professor visibility               |
| Variants pollute mastery or instructor signals                        | Low        | High   | Separate tables; I4 tests; analytics opt-in only                                                          |
| Cost runaway                                                          | Low        | Medium | Ladder, shared pool with cap, per-student and global daily limits, burst limit, kill switch               |
| Operational tooling drift (integrity, cleanup, claim, custody grants) | Medium     | Medium | Each is an explicit deliverable in phase 1 with tests                                                     |
| Engine coupling regressions in published-question tutoring            | Low        | High   | One additive option with default `published`; existing tutor tests unchanged and required to pass         |
| Students mistake variants for reviewed content                        | Medium     | Medium | Persistent banner, non-approved label, no catalog listing, no AI-help control                             |
| Seed spaces too small for popular questions                           | Medium     | Low    | Report `seeds_exhausted`; add generators; LLM rung later                                                  |
| Free-tier provider unreliability on the LLM path                      | High       | Low    | Tool-call schema, two attempts, deterministic fallback, `none_available` degrade                          |
| Quarantine of a base question's variants lags a takedown              | Low        | Medium | Pool selector re-checks the published pointer on every serve                                              |
| Anonymous cookie loss defeats per-student duplicate prevention        | Medium     | Low    | Accepted; seeds are spread by key so repeats are unlikely and harmless                                    |
| Professor workload                                                    | Low        | Low    | Nothing blocks on review; oversight is inspection and one-click actions                                   |

## 13. Codex-ready implementation prompts

Each prompt is self-contained and assumes the working directory is the
repository root. Run them in order. Every prompt ends with the same
verification commands. Do not run `npm run build` with the default
environment; see the local build note in the project memory or
`docs/environment-configuration.md`.

### Prompt 1 — Verify the implemented Reserve-first baseline

```
Read docs/practice-variants.md first. Inspect the
implemented baseline in src/app/api/tutor/session/[sessionId]/similar/route.ts,
src/lib/tutor/similar-reserve-practice.ts,
src/components/tutor/practice-similar-problem-action.tsx, and its workspace
integration. Do not rebuild or replace it.

Confirm that it authorizes the owning student resource, requires a completed
question, excludes the current question, returns only currently available
eligible Reserve questions in the same topic, prefers difficulty/pattern/shared
misconception/uncompleted signals in the implemented order, returns a minimal
student-safe DTO, leaks no cross-student progress, and uses no LLM. Record any
baseline contract changes needed by later phases as additive behavior; keep the
current POST contract backward compatible.

Verify: npm run lint && npm run typecheck && npx vitest run tests/similar-reserve-practice.test.ts tests/similar-reserve-practice-api.test.ts tests/practice-similar-problem-action.test.ts
```

### Prompt 2 — Migration 023 and operational tooling

```
Read docs/practice-variants.md sections 2, 9.4, and 10 first, then db/migrations/017_controlled_content_availability.sql and db/migrations/018_production_tutor_session_persistence.sql for conventions, and db/roles/app_runtime.sql for the grant style.

Write db/migrations/023_practice_variants.sql (or the next available migration at implementation time) creating exactly the tables, constraints, indexes, and triggers in docs/practice-variants.md section 2 (practice_variant_pattern_policies, practice_variant_question_policies, practice_variant_policy_events, practice_variants, practice_variant_sessions, practice_variant_attempts, practice_variant_generation_requests, practice_variant_generation_reservations, practice_variant_flags). Use app_reject_immutable_mutation() for the append-only ledgers. Add a trigger function app_guard_practice_variant_update that raises unless only the mutable columns listed in section 2.2 change. Add the private-source-signal check on practice_variants.content_json using the regex from the questions table in 001_initial_schema.sql extended with the extra terms used in src/lib/tutor/question-publication-quality-gates.ts. Enable RLS on all new tables. Separately update db/roles/app_runtime.sql with select and insert on all new tables; update on practice_variants, practice_variant_sessions, practice_variant_generation_reservations, and the two policy tables; usage on new sequences; and no delete. Update the custody verification expectations and tests for those exact grants and policies.

Do not alter existing application tables, views, lifecycle functions, or
triggers. Changes to the runtime-role provisioning script are required only for
the new tables and sequences.

Extend scripts/lib/database-integrity.mjs with the five read-only checks in section 2.6 (no repair actions) and document them in docs/database-integrity.md. Extend scripts/lib/pilot-data-cleanup.mjs so inspect/plan/rehearse/execute include practice_variant_sessions, practice_variant_attempts, practice_variant_flags, and practice_variant_generation_requests as student-data tables. Extend src/lib/auth/anonymous-claims.ts so the claim transaction also moves practice_variant_sessions from the anonymous subject to the user (attempts and flags follow by foreign key) and records the migrated count in the existing audit event metadata.

Add a migration summary paragraph to docs/database.md.

Tests: extend tests/production-schema-migration.test.ts (objects exist, immutability triggers reject update/delete, update guard allows status but rejects content changes, generator shape check), tests/database-integrity.test.ts (each new check has a passing and a failing fixture), tests/pilot-data-cleanup.test.ts (new tables appear in the plan), and tests/anonymous-student.test.ts (claim moves a variant session).

Verify: npm run lint && npm run typecheck && npm run test:migrations && npx vitest run tests/anonymous-student.test.ts
```

### Prompt 3 — Pattern registry, deterministic generators, verification pipeline

```
Read docs/practice-variants.md sections 4.2, 4.3, 4.5, 4.6, and 5 first, then scripts/generate-questions.mjs, src/lib/tutor/generated-question-regeneration.ts, src/lib/question-intake/schema.ts, src/lib/question-intake/duplicates.ts, src/lib/tutor/question-publication-quality-gates.ts, and src/lib/tutor/answer-checker.ts.

Create src/lib/practice-variants/types.ts (PracticeVariantDescriptor, PracticeVariantCandidate, PracticeVariantGenerator, PracticeVariantVerificationReport, StudentPracticeVariantDto, PracticeVariantSessionDto, and the outcome union) exactly as specified.

Create src/lib/practice-variants/patterns/index.ts exporting a registry Map keyed by pattern id, and four generators under src/lib/practice-variants/patterns/: complement-probability.ts (pattern-basic-probability-complement), unordered-selection.ts (pattern-combinations-unordered-selection), ordered-selection.ts (pattern-permutations-ordered-selection), conditional-from-counts.ts (pattern-conditional-probability-restricted-table). Each is pure: enumerate the constraint-filtered Cartesian product of variables and neutral contexts, expose seedSpace, generate(seed), computeAnswer, distractors (wrong values a student would type, e.g. excluded count over total, P(n,k) instead of C(n,k), unconditioned denominator), and a brute-force oracle. Wording must be project-owned and must never read any base question text. Reuse the answer formatting conventions (fractions plus decimals in acceptedAnswers, tolerance 0.001 for probabilities, 0 for counts).

Create src/lib/practice-variants/verification.ts exporting verifyPracticeVariantCandidate(candidate, context) implementing the twenty gates in section 5 in that order, reusing the named helpers from the intake schema, duplicates, and publication gate modules (export them if they are currently module-private, without changing their behavior). Create src/lib/practice-variants/content-safety.ts with the denylist from section 5.4. Create src/lib/practice-variants/hashing.ts with canonical JSON content SHA-256, structure fingerprint, and number-tuple hash.

Constraints: no database access, no server-only imports in the pure modules, no changes to existing exported behavior.

Tests: tests/practice-variant-generators.test.ts must, for every registered generator, iterate the entire seed space and assert computeAnswer equals the oracle, every candidate passes all gates, hint 1 never contains the answer, distractor values never equal the answer, and content hashes are unique across seeds. tests/practice-variant-verification.test.ts must have one failing fixture per gate code, including a candidate whose prompt contains a number absent from parameters, a candidate copied from a professor_provided base prompt, and a candidate containing a private-source phrase.

Verify: npm run lint && npm run typecheck && npx vitest run tests/practice-variant-generators.test.ts tests/practice-variant-verification.test.ts tests/question-intake-schema.test.ts tests/question-publication-quality-gates.test.ts
```

### Prompt 4 — Repositories, ladder service, limits

```
Read docs/practice-variants.md sections 1.3, 2, 4.1, 4.3, 4.6, and 8 first, then src/lib/data/tutor-session-repository.ts (database and memory implementations, owner checks, revision-based persistTransition), src/lib/ai/usage-controls.ts (HMAC keys, reservation pattern), and src/lib/runtime/operating-mode.ts.

Add to src/lib/env/server.ts the variables in section 8 with the stated defaults, validated like AI_LLM_* (booleans default false in strict environments). Update .env.example and docs/environment-configuration.md.

Create src/lib/data/practice-variant-repository.ts with database and memory implementations behind the same read/write selection used by the tutor session repository: getQuestionPolicy, getPatternPolicy, selectPoolVariantForStudent(owner, patternId, patternVersion), insertVariant (on content-hash conflict return the existing row), createVariantSession, getVariantSession(sessionId, owner), listVariantSessionsForStudent, persistVariantTransition (revision-checked, idempotent, mirrors persistTransition), recordGenerationRequest, countDailyVariantSessions(studentKeyHash, usageDate), and the flag insert with auto-quarantine. Sessions load the variant's content_json and map it to PracticeQuestion with source { sourceType: "pattern_derived_original", trustLevel: "generated_unverified", visibility: "public" } and review { status: "needs_review" }.

Create src/lib/practice-variants/similar-practice-service.ts implementing the ladder in section 1.3 with the implemented Reserve selector as rung 1, followed by policy resolution, pool selection, deterministic generation with the seed-selection rule from section 4.3, verification, insert, session creation, and one ledger row per execution. The pool selector must re-check that the base question version is still the published pointer (getApprovedQuestionById) and skip quarantined or expired rows. Rung 5 (LLM) must exist as an explicit "not enabled" branch returning block_reason "feature_disabled".

Add POST to src/app/api/tutor/session/[sessionId]/similar/route.ts for the full ladder when PRACTICE_VARIANTS_ENABLED is true. Preserve the implemented GET handler byte-for-byte in behavior and keep the client on GET whenever the flag is off.

Constraints: never insert into questions or question_versions; never reference tutor_sessions for variant persistence; HMAC keys via AI_USAGE_HMAC_SECRET; no raw owner identifiers in the generation ledger; every write path must have a memory implementation for demo mode.

Tests: tests/practice-variant-repository.test.ts (PGlite, following tests/question-lifecycle-database.test.ts setup) covering pool conflict reuse, per-student served exclusion, revision conflicts, idempotent creation, auto-quarantine on flag; tests/practice-similar-ladder.test.ts covering every rung outcome and block reason with the memory repository; an invariant test asserting that after a full ladder run the questions and question_versions row counts are unchanged.

Verify: npm run lint && npm run typecheck && npx vitest run tests/practice-variant-repository.test.ts tests/practice-similar-ladder.test.ts tests/practice-similar-api.test.ts
```

### Prompt 5 — Variant session routes and rule-only engine option

```
Read docs/practice-variants.md sections 1.2, 1.4, 6, and 9 first, then src/app/api/tutor/respond/route.ts, src/app/api/tutor/session/[sessionId]/route.ts, src/lib/api/tutor-session-dto.ts, src/lib/api/tutor-response-dto.ts, and src/lib/tutor/tutor-engine.ts.

Engine: add an optional contentPolicy parameter to createTutorResponseFromState and decideTutorResponse with type { kind: "published" } | { kind: "practice_variant" }, default { kind: "published" }. For "practice_variant": never call retrieval or the LLM (the hint and solution branches that escalate when hints or steps are empty must return the rule response instead), force allowLlmFallback to false, set responseLabel to the new TutorResponseLabel value "practice_variant_content", and set usage.llmFallbackEligible to false. Existing behavior for "published" must be unchanged; all existing tutor tests must pass unmodified.

Routes under src/app/api/practice/variants/sessions/[sessionId]/: GET route.ts returning PracticeVariantSessionDto plus disclosed hints, steps, and explanation according to progress (mirror toStudentTutorSessionDto); POST respond/route.ts accepting { mode, answer, eventId, expectedRevision } with the same size, rate-limit, idempotency, and concurrency-retry handling as /api/tutor/respond but without any AI reservation code, persisting through persistVariantTransition; POST flag/route.ts accepting { category, message?, idempotencyKey }. Return 404 for non-owned or expired sessions. The variant DTO must contain only the StudentPracticeQuestion fields plus contentKind "practice_variant", baseQuestionId, and sourceLabel "Practice variant (not professor-reviewed)". Add the label mapping to src/lib/labels.ts and the response-label copy to src/lib/api/tutor-response-dto.ts.

Reject variant ids in POST /api/tutor/session and in /api/questions/[id] with the existing QUESTION_UNAVAILABLE 404 (they will already be absent, but add explicit tests).

Tests: tests/practice-variant-session-api.test.ts (ownership, idempotent respond, revision conflict 409, no llmFallbackEligible ever true, hint and step disclosure limits, flag auto-quarantine, expired session 404); extend tests/tutor-engine.test.ts with practice_variant policy cases; extend tests/questions-api.test.ts and tests/tutor-session-api.test.ts with pv_ id rejection. Update docs/authorization-permission-matrix.md.

Verify: npm run lint && npm run typecheck && npx vitest run tests/tutor-engine.test.ts tests/tutor-respond-api.test.ts tests/tutor-response-boundary.test.ts tests/practice-variant-session-api.test.ts tests/questions-api.test.ts tests/tutor-session-api.test.ts
```

### Prompt 6 — Student workspace variant mode

```
Read docs/practice-variants.md section 6 first, then src/components/tutor/practice-workspace.tsx, src/components/tutor/question-feedback-form.tsx, and tests/tutor-client-recovery.test.ts.

Extend the practice workspace so the "variant_session" outcome from POST /api/tutor/session/[sessionId]/similar switches the chat area into variant mode in place: persistent banner with the exact wording from section 6, "Report a problem" opening a small flag form posting to the flag route, breadcrumb showing the base question title, answer/hint/step controls posting to /api/practice/variants/sessions/[id]/respond, no AI-help control rendered regardless of usage flags, "Try another" that calls the same POST route again with a fresh idempotency key and the origin session id in the path, and "Back to course problems" that restores the base question session. The sidebar must not list variants. Handle "none_available" reasons and the LLM-path loading state with a cancel control (AbortController) even though the LLM rung is not enabled yet. Persist the current variant session id in sessionStorage keyed by base question so a reload resumes it via the GET route.

Constraints: no answer, hint body, step body, or match term may be present in client state before the server discloses it; keep all existing published-question behavior and tests unchanged.

Tests: tests/practice-workspace-variant-mode.test.tsx covering banner and label rendering, absence of the AI-help control, try-another flow, back-to-course flow, flag submission, none_available notices, and reload resume.

Verify: npm run lint && npm run typecheck && npx vitest run tests/practice-workspace-variant-mode.test.tsx tests/tutor-client-recovery.test.ts tests/practice-usage-indicators.test.ts
```

### Prompt 7 — Professor policies, oversight, quarantine, promotion

```
Read docs/practice-variants.md sections 3, 7, and 9.3 first, then src/app/professor/availability/page.tsx, src/components/professor/professor-content-availability-panel.tsx, src/lib/data/content-availability-repository.ts (event ledger pattern), src/lib/data/question-lifecycle-repository.ts (createQuestion path and QuestionLifecycleDto), and src/app/api/professor/questions/route.ts.

Implement the professor APIs listed in section 7 under src/app/api/professor/practice-variants/, all behind authorizeApi(requireProfessorReview), read-only in demo mode, with reason and idempotency key required for every mutation and an audit_events row per mutation. Policy writes update the current-state tables and append practice_variant_policy_events with actor snapshot, from and to state, reason, and request id. Promotion creates a new question through the existing initial-draft creation function with the provenance rules in section 3.2, marks the variant "promoted" with promoted_question_id, and returns the QuestionLifecycleDto; it must be idempotent per idempotency key and must never approve or publish. Prefill generates deterministically up to the cap, skipping seeds already in the pool.

Add page src/app/professor/practice-variants/page.tsx and components under src/components/professor/practice-variants-*.tsx for the policies, pool, and detail views described in section 7, including the pattern prefill suggestion from the published version's source.patternIds[0]. Add the section to src/components/professor/professor-section-nav.tsx and docs/authorization-permission-matrix.md.

Hook base-question takedown: in the similar-practice service pool selector (already re-checking the published pointer) also quarantine variants whose base version is no longer published with reason base_question_changed, attributed to the system actor; do not add triggers to lifecycle tables.

Tests: tests/professor-practice-variants-api.test.ts (403 for students, demo read-only, policy event ledger contents, quarantine/restore idempotency, promotion creates exactly one version in draft state with safe generation_metadata_json keys and never an approved or published version, prefill respects cap) and tests/professor-practice-variants-panel.test.tsx for the UI.

Verify: npm run lint && npm run typecheck && npx vitest run tests/professor-practice-variants-api.test.ts tests/professor-practice-variants-panel.test.tsx tests/question-lifecycle-database.test.ts tests/professor-questions-api.test.ts
```

### Prompt 8 — Analytics, export v2, dashboard extra-practice, prune script

```
Read docs/practice-variants.md sections 1.4 (I4), 3, 8, and 9.4 first, then src/lib/data/instructor-student-repository.ts, src/lib/analytics/pilot-export.ts, src/lib/data/pilot-analytics-export-repository.ts, docs/pilot-analytics-export.md, src/lib/data/student-progress.ts, and scripts/clean-production-pilot-data.mjs for the custody script style.

Analytics: add a practiceVariants section to ProfessorAnalyticsDashboard (ladder outcome counts, tokens per day, per-pattern generated/served/solved/flagged, per-base-question base first-attempt correct rate versus variant first-attempt correct rate) computed from the new tables only. Add an "extra practice" block (variants attempted and solved) to InstructorStudentDetail as a separate object; do not change summary accuracy, attempts, or attention signals. Add "Extra practice: N variants solved (not counted toward progress)" to StudentProgressDashboard.summary as a separate field and render it on the dashboard without changing question or topic progress computations.

Export: bump the pilot export schemaVersion to 2, add a practiceVariants block with the same pseudonym rules and no content text, and update docs/pilot-analytics-export.md and its version guidance.

Prune: add scripts/prune-practice-variants.mjs and the npm script db:practice-variants:prune with dry-run default, JSON evidence output, custody-role execution, and the rule that a variant with any unexpired session is never deleted. Document it in docs/database-operations.md.

Invariant tests: assert that a student with only variant sessions has zero questions, zero completed questions, and zero attempts in getStudentProgress, instructor list, cohort analytics, and export v2 cohort/participant/topic/question sections.

Verify: npm run lint && npm run typecheck && npx vitest run tests/student-progress.test.ts tests/instructor-student-analytics.test.ts tests/pilot-analytics-export-api.test.ts tests/pilot-analytics-export-database.test.ts tests/practice-variant-analytics.test.ts
```

### Prompt 9 — Phase 3: LLM parameterized generator, cost ledger, release gates

```
Read docs/practice-variants.md sections 4.4, 4.5, 5.2, 5.3, 5.4, 5.5, and 8 first, then src/lib/question-intake/ai.ts (tool-call provider pattern), src/lib/ai/usage-controls.ts (reservation and settlement), src/lib/ai/llm-tutor.ts (deadline and retry rules), docs/retrieval-llm-production-policy.md, and tests/ai-production-evaluation.test.ts.

Create src/lib/practice-variants/llm-generator.ts: server-only, OpenRouter via the openai client, forced tool call submit_practice_variant whose JSON schema is generated from the pattern descriptor (parameters object with one required numeric property per variable, misconception id enum from hooks, patternId enum of one value), reasoning disabled, temperature 0.2, max_tokens PRACTICE_VARIANT_LLM_MAX_OUTPUT_TOKENS, two attempts, one 55-second deadline, no streaming, maxRetries 0. Build the input exactly as section 4.4 specifies, including the professor_provided rule that sends no base text. After the provider returns: computeAnswer from parameters, replace the answer, build distractor match terms, run verifyPracticeVariantCandidate, and on hint/step gate failure use generator.render once before rejecting. Never log or store the prompt or response body; log outcome, attempts, latency, token totals, and failing gate codes via logPilotOperationalEvent.

Wire rung 5 in the similar-practice service behind PRACTICE_VARIANT_LLM_ENABLED and pattern/question policy llm_allowed, with a mutable practice_variant_generation_reservations row (one pending per student), per-student and global daily limits from the final request ledger, and the existing AI burst settings. Insert the immutable final request-ledger row in the same transaction as the variant insert, then mark the reservation settled; never update a final ledger row.

Add npm script test:practice-variants-ai running tests/practice-variant-llm-gates.test.ts: a fixture set of at least 50 recorded or synthetic provider payloads under data/eval/practice-variant-provider-outputs.json (synthetic only, no private material) meeting the thresholds in section 5.2, plus limit and reservation tests with the memory repository and a PGlite test for settlement atomicity.

Update docs/retrieval-llm-production-policy.md with a "Practice variant generation" section (purpose, inputs, limits, storage exclusions, release gates) and docs/environment-configuration.md for the LLM variables.

Verify: npm run lint && npm run typecheck && npm run test:practice-variants-ai && npm run test:ai-production
```
