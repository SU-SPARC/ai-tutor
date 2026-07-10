-- Durable LLM budget, cache, and dashboard metadata. This migration stores
-- aggregate counters and HMAC-derived keys only; never raw student answers or
-- private course material.

alter table tutor_sessions
  add column if not exists llm_calls integer not null default 0,
  add column if not exists llm_input_tokens integer not null default 0,
  add column if not exists llm_output_tokens integer not null default 0,
  add column if not exists llm_total_tokens integer not null default 0;

create index if not exists tutor_sessions_anonymous_user_idx
  on tutor_sessions (anonymous_user_id, last_seen_at)
  where anonymous_user_id is not null;

alter table attempts drop constraint if exists attempts_source_check;
alter table attempts
  add constraint attempts_source_check
  check (source in ('rule', 'retrieval', 'llm', 'cache', 'blocked'));

alter table ai_usage drop constraint if exists ai_usage_scope_check;
alter table ai_usage
  add column if not exists llm_input_tokens integer not null default 0,
  add column if not exists llm_output_tokens integer not null default 0,
  add column if not exists llm_total_tokens integer not null default 0,
  add column if not exists estimated_llm_tokens integer not null default 0,
  add column if not exists cache_hits integer not null default 0,
  add column if not exists limit_blocks integer not null default 0;
alter table ai_usage
  add constraint ai_usage_scope_check
  check (scope in ('session', 'global', 'student', 'student_question'));

alter table ai_response_cache
  add column if not exists student_key_hash text;
alter table ai_response_cache drop constraint if exists ai_response_cache_source_check;
alter table ai_response_cache
  add constraint ai_response_cache_source_check
  check (source in ('rule', 'retrieval', 'llm', 'cache', 'blocked'));

create table if not exists ai_llm_reservations (
  id text primary key,
  session_id text not null,
  student_key_hash text not null,
  question_key_hash text not null,
  reserved_total_tokens integer not null check (reserved_total_tokens > 0),
  actual_input_tokens integer,
  actual_output_tokens integer,
  actual_total_tokens integer,
  status text not null check (status in ('pending', 'settled', 'released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_llm_reservations_pending_idx
  on ai_llm_reservations (status, expires_at);

create index if not exists ai_llm_reservations_student_idx
  on ai_llm_reservations (student_key_hash, status, expires_at);

create index if not exists ai_response_cache_student_idx
  on ai_response_cache (student_key_hash, expires_at);
