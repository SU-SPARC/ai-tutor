-- migration-safety: destructive
-- Destructive scope is limited to the bounded retention function, which
-- deletes tutor sessions only after expiry plus a 30-day grace period.
-- Persist only the student-owned tutor state required to resume a session.
-- Retrieval chunks, embeddings, prompts, private grounding context, and
-- provider request/response payloads are deliberately excluded.

alter table tutor_sessions
  add column creation_idempotency_key text,
  add column current_state text not null default 'working',
  add column attempt_count integer not null default 0,
  add column wrong_attempt_count integer not null default 0,
  add column solved boolean not null default false,
  add column retrieval_used boolean not null default false,
  add column llm_used boolean not null default false,
  add column last_answer_fingerprint text,
  add column last_misconception_ids_json jsonb not null default '[]'::jsonb,
  add column completed_at timestamptz,
  add column revision bigint not null default 0;

update tutor_sessions
set creation_idempotency_key = 'legacy:' || id,
    expires_at = coalesce(expires_at, created_at + interval '180 days'),
    current_state = case
      when status = 'completed' then 'solved'
      else 'working'
    end,
    solved = status = 'completed',
    completed_at = case
      when status = 'completed' then coalesce(updated_at, last_seen_at)
      else null
    end
where creation_idempotency_key is null
   or expires_at is null;

alter table tutor_sessions
  alter column creation_idempotency_key set default gen_random_uuid()::text,
  alter column creation_idempotency_key set not null,
  alter column expires_at set default (now() + interval '180 days'),
  alter column expires_at set not null,
  add constraint tutor_sessions_creation_idempotency_key_check check (
    char_length(creation_idempotency_key) between 1 and 128
  ),
  add constraint tutor_sessions_current_state_check check (
    current_state in (
      'working',
      'hinting',
      'step_reveal',
      'misconception_detected',
      'solved',
      'retrieval_guidance',
      'llm_guidance',
      'blocked'
    )
  ),
  add constraint tutor_sessions_progress_counts_check check (
    attempt_count >= 0
    and wrong_attempt_count >= 0
    and wrong_attempt_count <= attempt_count
    and revision >= 0
  ),
  add constraint tutor_sessions_last_misconceptions_array_check check (
    jsonb_typeof(last_misconception_ids_json) = 'array'
    and jsonb_array_length(last_misconception_ids_json) <= 3
    and char_length(last_misconception_ids_json::text) <= 768
  ),
  add constraint tutor_sessions_answer_fingerprint_check check (
    last_answer_fingerprint is null
    or last_answer_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  add constraint tutor_sessions_completion_state_check check (
    (
      status = 'completed'
      and solved = true
      and current_state = 'solved'
      and completed_at is not null
    )
    or status <> 'completed'
  ),
  add constraint tutor_sessions_completion_timestamp_check check (
    completed_at is null or completed_at >= created_at
  );

create unique index tutor_sessions_user_creation_idempotency_idx
  on tutor_sessions (user_id, creation_idempotency_key)
  where user_id is not null;

create unique index tutor_sessions_anonymous_creation_idempotency_idx
  on tutor_sessions (anonymous_user_id, creation_idempotency_key)
  where anonymous_user_id is not null;

alter table attempts
  add column idempotency_key text,
  add column submitted_answer text,
  add column normalized_answer text,
  add column tutor_state text,
  add column misconception_feedback_json jsonb not null default '[]'::jsonb,
  add column context_used boolean not null default false,
  add column fallback_used boolean not null default false,
  add column response_label text,
  add column progress_revision bigint;

update attempts
set idempotency_key = 'legacy:' || id,
    submitted_answer = answer_preview,
    normalized_answer = lower(regexp_replace(coalesce(answer_preview, ''), '\\s+', '', 'g')),
    tutor_state = case verdict
      when 'correct' then 'solved'
      when 'incorrect' then 'working'
      when 'blocked' then 'blocked'
      else 'working'
    end
where idempotency_key is null;

alter table attempts drop constraint attempts_mode_check;
alter table attempts
  alter column idempotency_key set default gen_random_uuid()::text,
  alter column idempotency_key set not null,
  add constraint attempts_mode_check check (
    mode in ('check', 'hint', 'solution', 'full_solution')
  ),
  add constraint attempts_idempotency_key_check check (
    char_length(idempotency_key) between 1 and 128
  ),
  add constraint attempts_submitted_answer_length_check check (
    submitted_answer is null or char_length(submitted_answer) <= 500
  ),
  add constraint attempts_normalized_answer_length_check check (
    normalized_answer is null or char_length(normalized_answer) <= 500
  ),
  add constraint attempts_tutor_state_check check (
    tutor_state is null or tutor_state in (
      'working',
      'hinting',
      'step_reveal',
      'misconception_detected',
      'solved',
      'retrieval_guidance',
      'llm_guidance',
      'blocked'
    )
  ),
  add constraint attempts_misconception_feedback_array_check check (
    jsonb_typeof(misconception_feedback_json) = 'array'
    and jsonb_array_length(misconception_feedback_json) <= 3
    and char_length(misconception_feedback_json::text) <= 768
  ),
  add constraint attempts_response_label_check check (
    response_label is null or response_label in (
      'approved_course_content',
      'generated_approved_content',
      'general_ai_help',
      'private_reference_grounded_explanation'
    )
  ),
  add constraint attempts_progress_revision_check check (
    progress_revision is null or progress_revision > 0
  );

create unique index attempts_session_idempotency_idx
  on attempts (session_id, idempotency_key);

create index attempts_session_recovery_idx
  on attempts (session_id, created_at, id)
  include (
    mode,
    submitted_answer,
    normalized_answer,
    verdict,
    tutor_state,
    fallback_used
  );

-- A bounded, server-invoked retention sweep. Active or completed sessions are
-- made inaccessible at expiry; expired rows and their cascading attempts are
-- deleted after a 30-day grace period in batches.
create or replace function app_apply_tutor_session_retention(
  batch_size integer default 500
)
returns integer
language plpgsql
as $$
declare
  deleted_count integer;
begin
  if batch_size < 1 or batch_size > 5000 then
    raise exception 'Tutor session retention batch size must be between 1 and 5000';
  end if;

  update tutor_sessions
  set status = 'expired',
      updated_at = now()
  where expires_at <= now()
    and status <> 'expired';

  with expired_sessions as (
    select id
    from tutor_sessions
    where status = 'expired'
      and expires_at <= now() - interval '30 days'
    order by expires_at, id
    limit batch_size
    for update skip locked
  )
  delete from tutor_sessions s
  using expired_sessions e
  where s.id = e.id;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
