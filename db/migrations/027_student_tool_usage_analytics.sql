-- Privacy-safe student usage telemetry for the two professor metrics that are
-- not academic attempts: AI Help requests and estimated Sketchpad active-time
-- buckets. Identity always comes from the authenticated server session; no
-- name, email, browser identifier, prompt, answer, or Sketchpad content is
-- stored.

create table student_usage_events (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  event_type text not null check (event_type in ('ai_help_click')),
  idempotency_key text not null,
  tutor_session_id text not null references tutor_sessions(id) on delete cascade,
  question_id text not null references questions(id) on delete restrict,
  question_version_id bigint not null,
  topic_id text not null references topics(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint student_usage_events_question_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id) on delete restrict,
  constraint student_usage_events_idempotency_key_check check (
    char_length(idempotency_key) between 1 and 128
  ),
  constraint student_usage_events_timestamps_check check (
    created_at >= occurred_at
  ),
  unique (user_id, event_type, idempotency_key)
);

create index student_usage_events_student_aggregate_idx
  on student_usage_events (user_id, event_type, occurred_at);

-- One row represents one server-bounded 15-second interval. The application
-- derives bucket_started_at from its receipt time and always supplies exactly
-- 15 credited seconds. The primary key deduplicates concurrent Sketchpad tabs
-- for the same student, tool, and interval without updating prior rows.
create table student_tool_active_buckets (
  user_id text not null references users(id) on delete cascade,
  tool text not null check (tool in ('sketchpad')),
  bucket_started_at timestamptz not null,
  credited_seconds smallint not null check (credited_seconds = 15),
  recorded_at timestamptz not null default now(),
  primary key (user_id, tool, bucket_started_at)
);
