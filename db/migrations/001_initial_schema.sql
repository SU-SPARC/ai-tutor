-- Suffolk AI Probability & Statistics Tutor database foundation.
--
-- This migration creates only public-safe tutoring tables. Raw private PDFs,
-- extracted textbook text, private chunks, embeddings, answer keys, source
-- locators, and professor-only materials must stay outside this database.

create table if not exists topics (
  id text primary key,
  title text not null,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists questions (
  id text primary key,
  topic_id text not null references topics(id),
  pattern_id text,
  title text not null,
  prompt text not null,
  difficulty text not null check (
    difficulty in ('foundational', 'intermediate', 'challenge')
  ),
  accepted_answers_json jsonb not null default '[]'::jsonb,
  numeric_value double precision,
  tolerance double precision,
  answer_explanation text not null,
  source_type text not null check (
    source_type in (
      'original_demo',
      'professor_provided',
      'generated_original',
      'pattern_derived_original',
      'private_reference_pattern'
    )
  ),
  trust_level text not null check (
    trust_level in (
      'public_original',
      'professor_approved',
      'course_approved',
      'generated_unverified',
      'private_reference'
    )
  ),
  review_status text not null check (
    review_status in (
      'approved',
      'needs_review',
      'rejected',
      'needs_edit',
      'needs_regeneration'
    )
  ),
  visibility text not null check (visibility in ('public', 'private')),
  originality_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_generated_defaults check (
    source_type not in ('generated_original', 'pattern_derived_original')
    or trust_level in ('generated_unverified', 'professor_approved')
  ),
  constraint questions_no_private_source_signals check (
    concat_ws(' ', prompt, answer_explanation, originality_note) !~*
      '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding)'
  )
);

create table if not exists solution_steps (
  id bigserial primary key,
  question_id text not null references questions(id) on delete cascade,
  step_order integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (question_id, step_order),
  constraint solution_steps_no_private_source_signals check (
    body !~* '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding)'
  )
);

create table if not exists hints (
  id bigserial primary key,
  question_id text not null references questions(id) on delete cascade,
  hint_order integer not null,
  body text not null,
  created_at timestamptz not null default now(),
  unique (question_id, hint_order),
  constraint hints_no_private_source_signals check (
    body !~* '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding)'
  )
);

create table if not exists misconceptions (
  id text not null,
  question_id text not null references questions(id) on delete cascade,
  feedback text not null,
  match_terms_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (question_id, id),
  constraint misconceptions_no_private_source_signals check (
    concat_ws(' ', id, feedback) !~*
      '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding)'
  )
);

create table if not exists tutor_sessions (
  id text primary key,
  anonymous_user_id text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists attempts (
  id bigserial primary key,
  session_id text not null references tutor_sessions(id),
  question_id text references questions(id),
  topic_id text references topics(id),
  mode text check (mode in ('check', 'hint', 'solution')),
  answer_hash text,
  answer_preview text,
  source text not null check (source in ('rule', 'retrieval', 'llm', 'blocked')),
  verdict text check (verdict in ('correct', 'incorrect', 'guidance', 'blocked')),
  estimated_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists ai_usage (
  scope text not null check (scope in ('session', 'global')),
  scope_key text not null,
  date_key date not null,
  interactions integer not null default 0,
  estimated_tokens integer not null default 0,
  llm_fallbacks integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, scope_key, date_key)
);

create table if not exists ai_response_cache (
  id bigserial primary key,
  request_hash text not null unique,
  question_id text references questions(id),
  topic_id text references topics(id),
  mode text check (mode in ('check', 'hint', 'solution')),
  source text not null check (source in ('rule', 'retrieval', 'blocked')),
  response_json jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view app_public_questions as
select
  q.*,
  coalesce(
    (
      select jsonb_agg(h.body order by h.hint_order)
      from hints h
      where h.question_id = q.id
    ),
    '[]'::jsonb
  ) as hints_json,
  coalesce(
    (
      select jsonb_agg(s.body order by s.step_order)
      from solution_steps s
      where s.question_id = q.id
    ),
    '[]'::jsonb
  ) as solution_steps_json,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'feedback', m.feedback,
          'matchTerms', m.match_terms_json
        )
        order by m.id
      )
      from misconceptions m
      where m.question_id = q.id
    ),
    '[]'::jsonb
  ) as misconceptions_json
from questions q
where q.visibility = 'public'
  and q.review_status = 'approved'
  and q.trust_level in ('public_original', 'professor_approved', 'course_approved');

create or replace view app_review_queue_questions as
select
  q.*,
  coalesce(q.pattern_id, q.source_type) as pattern_source,
  coalesce(
    (
      select jsonb_agg(h.body order by h.hint_order)
      from hints h
      where h.question_id = q.id
    ),
    '[]'::jsonb
  ) as hints_json,
  coalesce(
    (
      select jsonb_agg(s.body order by s.step_order)
      from solution_steps s
      where s.question_id = q.id
    ),
    '[]'::jsonb
  ) as solution_steps_json,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'feedback', m.feedback,
          'matchTerms', m.match_terms_json
        )
        order by m.id
      )
      from misconceptions m
      where m.question_id = q.id
    ),
    '[]'::jsonb
  ) as misconceptions_json
from questions q
where q.visibility = 'public'
  and q.trust_level = 'generated_unverified'
  and q.review_status in ('needs_review', 'needs_edit', 'needs_regeneration');

create index if not exists questions_student_facing_idx
  on questions (topic_id, review_status, trust_level, visibility);

create index if not exists questions_review_queue_idx
  on questions (review_status, trust_level, visibility, created_at);

create index if not exists solution_steps_question_idx
  on solution_steps (question_id, step_order);

create index if not exists hints_question_idx
  on hints (question_id, hint_order);

create index if not exists misconceptions_question_idx
  on misconceptions (question_id);

create index if not exists attempts_session_idx
  on attempts (session_id, created_at);

create index if not exists ai_response_cache_expires_idx
  on ai_response_cache (expires_at);
