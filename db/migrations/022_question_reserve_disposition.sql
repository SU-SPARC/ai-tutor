-- Professor-owned "save for later" intent for good, approved content.
--
-- Reserve is deliberately not a lifecycle state. The immutable working version
-- remains approved/unpublished and the published pointer remains empty.

alter table questions
  add column is_reserved boolean not null default false,
  add column reserve_reason_code text,
  add column reserve_note text,
  add column reserved_by_user_id text references users(id) on delete restrict,
  add column reserved_at timestamptz,
  add constraint questions_reserve_reason_check check (
    reserve_reason_code is null or reserve_reason_code in (
      'repetitive',
      'save_for_later',
      'future_topic',
      'extra_practice',
      'other'
    )
  ),
  add constraint questions_reserve_note_length_check check (
    reserve_note is null or char_length(reserve_note) <= 1000
  ),
  add constraint questions_reserve_other_note_check check (
    reserve_reason_code <> 'other'
    or nullif(btrim(reserve_note), '') is not null
  ),
  add constraint questions_reserve_consistency_check check (
    (
      is_reserved
      and reserve_reason_code is not null
      and reserved_by_user_id is not null
      and reserved_at is not null
    )
    or (
      not is_reserved
      and reserve_reason_code is null
      and reserve_note is null
      and reserved_by_user_id is null
      and reserved_at is null
    )
  ),
  add constraint questions_reserved_content_hidden_check check (
    not is_reserved
    or (record_state = 'active' and published_version_id is null)
  );

create index questions_reserve_catalog_idx
  on questions (reserved_at desc, id)
  where is_reserved;

create table question_reserve_events (
  id bigserial primary key,
  question_id text not null references questions(id) on delete restrict,
  question_version_id bigint not null,
  action text not null check (action in ('reserve', 'release')),
  reason_code text,
  note text,
  actor_user_id text not null references users(id) on delete restrict,
  actor_subject text not null,
  actor_display_name text not null,
  idempotency_key text,
  request_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint question_reserve_events_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict,
  constraint question_reserve_events_reason_check check (
    reason_code is null or reason_code in (
      'repetitive',
      'save_for_later',
      'future_topic',
      'extra_practice',
      'other'
    )
  ),
  constraint question_reserve_events_nonblank_check check (
    btrim(actor_subject) <> ''
    and btrim(actor_display_name) <> ''
    and (idempotency_key is null or btrim(idempotency_key) <> '')
  ),
  constraint question_reserve_events_note_length_check check (
    (note is null or char_length(note) <= 1000)
    and (idempotency_key is null or char_length(idempotency_key) <= 200)
    and (request_id is null or char_length(request_id) <= 200)
  ),
  constraint question_reserve_events_action_reason_check check (
    (action = 'reserve' and reason_code is not null)
    or (action = 'release' and reason_code is null)
  ),
  constraint question_reserve_events_other_note_check check (
    reason_code <> 'other' or nullif(btrim(note), '') is not null
  ),
  constraint question_reserve_events_metadata_object check (
    jsonb_typeof(metadata_json) = 'object'
  ),
  constraint question_reserve_events_time_check check (created_at >= occurred_at)
);

create unique index question_reserve_events_idempotency_idx
  on question_reserve_events (question_id, idempotency_key)
  where idempotency_key is not null;

create index question_reserve_events_question_idx
  on question_reserve_events (question_id, occurred_at desc, id desc);

create trigger question_reserve_events_immutable
before update or delete on question_reserve_events
for each row execute function app_reject_immutable_mutation();

create or replace function app_guard_question_reserve_write()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.reserve_write', true) is distinct from 'allowed' then
    raise exception 'Reserve disposition must be changed through the audited reserve workflow';
  end if;
  return new;
end;
$$;

create trigger questions_reserve_workflow_only
before update of
  is_reserved,
  reserve_reason_code,
  reserve_note,
  reserved_by_user_id,
  reserved_at
on questions
for each row execute function app_guard_question_reserve_write();

create or replace function app_guard_reserved_question_content_change()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'questions' then
    if old.is_reserved and new.working_version_id is distinct from old.working_version_id then
      raise exception 'Remove Save for later before changing the working version';
    end if;
    return new;
  end if;

  if new.state not in ('approved', 'unpublished') and exists (
    select 1
    from questions q
    where q.working_version_id = new.question_version_id
      and q.is_reserved
  ) then
    raise exception 'Remove Save for later before changing the lifecycle state';
  end if;
  return new;
end;
$$;

create trigger questions_reserved_working_version_stable
before update of working_version_id on questions
for each row execute function app_guard_reserved_question_content_change();

create trigger question_version_lifecycle_reserved_state_stable
before update of state on question_version_lifecycle
for each row execute function app_guard_reserved_question_content_change();

alter table question_reserve_events enable row level security;

revoke all privileges on question_reserve_events from public;
revoke all privileges on sequence question_reserve_events_id_seq from public;
revoke all privileges on function app_guard_question_reserve_write() from public;
revoke all privileges on function app_guard_reserved_question_content_change() from public;

do $$
declare
  data_api_role text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = data_api_role) then
      execute format(
        'revoke all privileges on question_reserve_events from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on sequence question_reserve_events_id_seq from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on function app_guard_question_reserve_write() from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on function app_guard_reserved_question_content_change() from %I',
        data_api_role
      );
    end if;
  end loop;
end;
$$;
