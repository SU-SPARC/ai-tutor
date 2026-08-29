-- Durable pilot LLM allowances and idempotent provider accounting.
--
-- All ownership and question keys are HMAC-derived. This migration stores no
-- prompts, answers, generated text, raw retrieval context, provider payloads,
-- account identifiers, IP addresses, or secrets.

alter table ai_usage
  add column if not exists llm_requests integer not null default 0,
  add column if not exists llm_provider_calls integer not null default 0;

alter table ai_usage
  add constraint ai_usage_llm_request_counts_check check (
    llm_requests >= 0 and llm_provider_calls >= llm_requests
  );

alter table ai_llm_reservations
  add column if not exists provider_calls integer not null default 0,
  add column if not exists usage_date date,
  add column if not exists counts_toward_limit boolean not null default true,
  add column if not exists limit_reason text,
  add column if not exists accounted_at timestamptz;

update ai_llm_reservations
set usage_date = timezone('UTC', created_at)::date,
    provider_calls = case
      when provider_calls > 0 then provider_calls
      when actual_total_tokens is not null then 1
      else 0
    end,
    accounted_at = case
      when status in ('settled', 'released') then coalesce(accounted_at, updated_at)
      else accounted_at
    end
where usage_date is null
   or (provider_calls = 0 and actual_total_tokens is not null)
   or (accounted_at is null and status in ('settled', 'released'));

alter table ai_llm_reservations
  alter column usage_date set default (timezone('UTC', now())::date),
  alter column usage_date set not null;

alter table ai_llm_reservations
  drop constraint if exists ai_llm_reservations_status_check,
  drop constraint if exists ai_llm_reservations_state_check;

alter table ai_llm_reservations
  add constraint ai_llm_reservations_status_check check (
    status in ('pending', 'settled', 'released', 'blocked')
  ),
  add constraint ai_llm_reservations_provider_calls_check check (
    provider_calls >= 0
  ),
  add constraint ai_llm_reservations_limit_reason_check check (
    limit_reason is null or limit_reason in (
      'burst_limit',
      'daily_limit',
      'question_limit',
      'session_limit'
    )
  ),
  add constraint ai_llm_reservations_state_check check (
    (
      status = 'pending'
      and actual_total_tokens is null
      and limit_reason is null
    )
    or (
      status = 'settled'
      and actual_total_tokens is not null
      and limit_reason is null
    )
    or (status = 'released' and limit_reason is null)
    or (
      status = 'blocked'
      and actual_input_tokens is null
      and actual_output_tokens is null
      and actual_total_tokens is null
      and provider_calls = 0
      and not counts_toward_limit
      and limit_reason is not null
    )
  );

create index ai_llm_reservations_student_usage_idx
  on ai_llm_reservations (
    student_key_hash,
    usage_date,
    counts_toward_limit,
    created_at
  );

create index ai_llm_reservations_student_question_usage_idx
  on ai_llm_reservations (
    student_key_hash,
    question_key_hash,
    counts_toward_limit,
    created_at
  );

create index ai_llm_reservations_session_usage_idx
  on ai_llm_reservations (session_id, counts_toward_limit, created_at);
