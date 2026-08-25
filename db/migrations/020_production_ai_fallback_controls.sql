-- Production AI fallback execution controls.
--
-- Reservation and cache identifiers are HMAC-derived. Raw prompts, answers,
-- retrieval context, provider payloads, credentials, and student identifiers
-- are deliberately excluded.

alter table ai_llm_reservations
  add column if not exists idempotency_key text,
  add column if not exists request_hash text,
  add column if not exists usage_is_estimate boolean not null default false;

update ai_llm_reservations
set idempotency_key = coalesce(idempotency_key, 'legacy:' || id),
    request_hash = coalesce(request_hash, id)
where idempotency_key is null or request_hash is null;

alter table ai_llm_reservations
  alter column idempotency_key set not null,
  alter column request_hash set not null,
  add constraint ai_llm_reservations_idempotency_key_check check (
    char_length(idempotency_key) between 1 and 128
  ),
  add constraint ai_llm_reservations_request_hash_nonblank check (
    btrim(request_hash) <> ''
  );

update ai_llm_reservations
set status = 'released', updated_at = now()
where status = 'pending' and expires_at <= now();

with ranked_pending as (
  select
    id,
    row_number() over (
      partition by session_id
      order by created_at desc, id desc
    ) as pending_rank
  from ai_llm_reservations
  where status = 'pending'
)
update ai_llm_reservations reservation
set status = 'released', updated_at = now()
from ranked_pending ranked
where reservation.id = ranked.id and ranked.pending_rank > 1;

create unique index ai_llm_reservations_session_event_idx
  on ai_llm_reservations (session_id, idempotency_key);

create unique index ai_llm_reservations_one_pending_session_idx
  on ai_llm_reservations (session_id)
  where status = 'pending';

create index ai_llm_reservations_request_idx
  on ai_llm_reservations (request_hash, status, expires_at);

create index ai_response_cache_owner_request_idx
  on ai_response_cache (student_key_hash, request_hash, expires_at);
