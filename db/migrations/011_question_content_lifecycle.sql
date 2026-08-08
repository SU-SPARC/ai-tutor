-- Version-level question lifecycle and explicit publication pointers.
--
-- Existing question/version identifiers are preserved. Legacy question columns
-- remain as a compatibility projection during the expand/migrate/contract
-- rollout, while student reads move to the immutable published version.

insert into users (
  id,
  identity_provider,
  external_subject,
  display_name,
  user_type,
  status
)
values (
  'system:question-generator',
  'internal',
  'question-generator',
  'Question generation system',
  'system',
  'active'
)
on conflict (id) do nothing;

alter table question_versions
  add column parent_version_id bigint,
  add column creation_method text not null default 'manual',
  add column schema_version integer not null default 1,
  add column content_sha256 text,
  add column generation_metadata_json jsonb not null default '{}'::jsonb,
  add column legacy_audit_only boolean not null default false;

alter table question_versions
  add constraint question_versions_parent_fkey
    foreign key (parent_version_id) references question_versions(id) on delete restrict,
  add constraint question_versions_creation_method_check check (
    creation_method in ('manual', 'imported', 'generated', 'regenerated', 'rollback_clone')
  ),
  add constraint question_versions_schema_version_positive check (schema_version > 0),
  add constraint question_versions_generation_metadata_object check (
    jsonb_typeof(generation_metadata_json) = 'object'
  );

drop trigger question_versions_immutable on question_versions;

update question_versions qv
set creation_method = case
      when qv.snapshot_json ->> 'sourceType' in (
        'generated_original',
        'pattern_derived_original'
      ) then 'generated'
      else 'imported'
    end,
    content_sha256 = encode(
      sha256(
        convert_to(
          (
            qv.snapshot_json - array[
              'reviewStatus',
              'visibility',
              'trustLevel',
              'reviewPriority',
              'reviewNotes',
              'reviewedByUserId',
              'reviewedAt',
              'archivedAt'
            ]::text[]
          )::text,
          'UTF8'
        )
      ),
      'hex'
    );

alter table question_versions
  alter column content_sha256 set not null,
  add constraint question_versions_content_sha256_check check (
    content_sha256 ~ '^[0-9a-f]{64}$'
  );

create trigger question_versions_immutable
before update or delete on question_versions
for each row execute function app_reject_immutable_mutation();

create or replace function app_prepare_question_version_lifecycle_fields()
returns trigger
language plpgsql
as $$
declare
  requested_creation_method text;
begin
  requested_creation_method := nullif(
    current_setting('app.current_creation_method', true),
    ''
  );
  if requested_creation_method is not null then
    new.creation_method := requested_creation_method;
    new.schema_version := 2;
  end if;

  if new.content_sha256 is null then
    new.content_sha256 := encode(
      sha256(
        convert_to(
          (
            new.snapshot_json - array[
              'reviewStatus',
              'visibility',
              'trustLevel',
              'reviewPriority',
              'reviewNotes',
              'reviewedByUserId',
              'reviewedAt',
              'archivedAt'
            ]::text[]
          )::text,
          'UTF8'
        )
      ),
      'hex'
    );
  end if;

  if new.creation_method = 'manual'
    and new.snapshot_json ->> 'sourceType' in (
      'generated_original',
      'pattern_derived_original'
    )
  then
    new.creation_method := 'generated';
  end if;

  return new;
end;
$$;

create trigger question_versions_05_prepare_lifecycle_fields
before insert on question_versions
for each row execute function app_prepare_question_version_lifecycle_fields();

create or replace function app_record_question_version_trigger()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.suppress_question_version', true) = 'true' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform app_record_question_version(old.question_id);
    return old;
  end if;

  perform app_record_question_version(new.question_id);
  return new;
end;
$$;

create or replace function app_record_question_row_version_trigger()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.suppress_question_version', true) = 'true' then
    return new;
  end if;
  perform app_record_question_version(new.id);
  return new;
end;
$$;

create or replace function app_record_question_review()
returns trigger
language plpgsql
as $$
declare
  latest_version_id bigint;
  decision_value text;
begin
  if tg_op = 'UPDATE' and new.review_status is not distinct from old.review_status then
    return new;
  end if;

  if new.review_status = 'needs_review' then
    if tg_op = 'INSERT' then
      return new;
    end if;
    decision_value := 'reopened';
  else
    decision_value := new.review_status;
  end if;

  if new.reviewed_by_user_id is null then
    raise exception 'Question review history requires an immutable reviewer identity';
  end if;

  select qv.id
  into latest_version_id
  from question_versions qv
  where qv.question_id = new.id
  order by qv.version_number desc
  limit 1;

  if latest_version_id is null
    and current_setting('app.suppress_question_version', true) = 'true'
  then
    return new;
  end if;

  insert into question_approval_history (
    question_id,
    question_version_id,
    decision,
    reviewer_user_id,
    reviewer_label,
    notes,
    decided_at
  )
  values (
    new.id,
    latest_version_id,
    decision_value,
    new.reviewed_by_user_id,
    new.reviewed_by,
    new.review_notes,
    coalesce(new.reviewed_at, now())
  );

  return new;
end;
$$;

alter table questions
  add column record_state text not null default 'active',
  add column working_version_id bigint,
  add column published_version_id bigint;

alter table questions
  add constraint questions_record_state_check check (
    record_state in ('active', 'archived')
  ),
  add constraint questions_working_version_fkey
    foreign key (working_version_id, id)
    references question_versions(id, question_id)
    on delete restrict,
  add constraint questions_published_version_fkey
    foreign key (published_version_id, id)
    references question_versions(id, question_id)
    on delete restrict,
  add constraint questions_archived_publication_pointer_check check (
    record_state <> 'archived' or published_version_id is null
  );

with latest as (
  select distinct on (qv.question_id)
    qv.question_id,
    qv.id
  from question_versions qv
  order by qv.question_id, qv.version_number desc, qv.id desc
)
update questions q
set working_version_id = latest.id,
    published_version_id = case
      when q.archived_at is null
        and q.visibility = 'public'
        and q.review_status = 'approved'
        and q.trust_level in (
          'public_original',
          'professor_approved',
          'course_approved'
        )
      then latest.id
      else null
    end,
    record_state = case when q.archived_at is null then 'active' else 'archived' end
from latest
where latest.question_id = q.id;

create table question_version_lifecycle (
  question_version_id bigint primary key,
  question_id text not null,
  state text not null check (
    state in (
      'draft',
      'needs_review',
      'revision_requested',
      'approved',
      'published',
      'unpublished',
      'rejected'
    )
  ),
  validation_status text not null default 'valid' check (
    validation_status in ('pending', 'valid', 'invalid')
  ),
  updated_at timestamptz not null default now(),
  constraint question_version_lifecycle_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict
);

insert into question_version_lifecycle (
  question_version_id,
  question_id,
  state,
  validation_status
)
select
  qv.id,
  qv.question_id,
  case
    when q.published_version_id = qv.id then 'published'
    when q.working_version_id = qv.id then
      case q.review_status
        when 'approved' then 'approved'
        when 'needs_review' then 'needs_review'
        when 'needs_edit' then 'revision_requested'
        when 'needs_regeneration' then 'revision_requested'
        when 'rejected' then 'rejected'
        else 'draft'
      end
    when qv.snapshot_json ->> 'reviewStatus' = 'approved' then 'unpublished'
    when qv.snapshot_json ->> 'reviewStatus' = 'rejected' then 'rejected'
    when qv.snapshot_json ->> 'reviewStatus' in ('needs_edit', 'needs_regeneration')
      then 'revision_requested'
    else 'draft'
  end,
  'valid'
from question_versions qv
join questions q on q.id = qv.question_id;

create index question_version_lifecycle_queue_idx
  on question_version_lifecycle (state, updated_at, question_id);

create unique index question_version_lifecycle_one_published_idx
  on question_version_lifecycle (question_id)
  where state = 'published';

create table question_lifecycle_events (
  id bigserial primary key,
  question_id text not null references questions(id) on delete restrict,
  question_version_id bigint not null,
  action text not null check (
    action in (
      'create_version',
      'submit',
      'request_revision',
      'approve',
      'reject',
      'publish',
      'unpublish',
      'rollback',
      'archive',
      'restore',
      'regenerate',
      'migrate'
    )
  ),
  from_state text,
  to_state text,
  actor_user_id text not null references users(id) on delete restrict,
  actor_subject text not null,
  actor_display_name text not null,
  actor_role text not null check (actor_role in ('professor', 'system')),
  requested_by_user_id text references users(id) on delete restrict,
  executed_by_user_id text references users(id) on delete restrict,
  reason_code text,
  note text,
  idempotency_key text,
  request_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint question_lifecycle_events_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict,
  constraint question_lifecycle_events_states_check check (
    (from_state is null or from_state in (
      'draft', 'needs_review', 'revision_requested', 'approved',
      'published', 'unpublished', 'rejected'
    ))
    and (to_state is null or to_state in (
      'draft', 'needs_review', 'revision_requested', 'approved',
      'published', 'unpublished', 'rejected'
    ))
  ),
  constraint question_lifecycle_events_nonblank_check check (
    btrim(actor_subject) <> ''
    and btrim(actor_display_name) <> ''
    and (reason_code is null or btrim(reason_code) <> '')
    and (idempotency_key is null or btrim(idempotency_key) <> '')
  ),
  constraint question_lifecycle_events_note_length_check check (
    (note is null or char_length(note) <= 1000)
    and (reason_code is null or char_length(reason_code) <= 80)
    and (idempotency_key is null or char_length(idempotency_key) <= 200)
    and (request_id is null or char_length(request_id) <= 200)
  ),
  constraint question_lifecycle_events_metadata_object check (
    jsonb_typeof(metadata_json) = 'object'
  ),
  constraint question_lifecycle_events_time_check check (created_at >= occurred_at)
);

create unique index question_lifecycle_events_idempotency_idx
  on question_lifecycle_events (question_id, idempotency_key)
  where idempotency_key is not null;

create index question_lifecycle_events_question_idx
  on question_lifecycle_events (question_id, occurred_at desc, id desc);

create index question_lifecycle_events_version_idx
  on question_lifecycle_events (question_version_id, occurred_at desc, id desc);

insert into question_lifecycle_events (
  question_id,
  question_version_id,
  action,
  from_state,
  to_state,
  actor_user_id,
  actor_subject,
  actor_display_name,
  actor_role,
  reason_code,
  metadata_json,
  occurred_at
)
select
  qv.question_id,
  qv.id,
  case qvl.state
    when 'published' then 'publish'
    when 'approved' then 'approve'
    when 'unpublished' then 'approve'
    when 'rejected' then 'reject'
    when 'revision_requested' then 'request_revision'
    when 'needs_review' then 'submit'
    else 'migrate'
  end,
  null,
  qvl.state,
  coalesce(q.reviewed_by_user_id, qv.created_by_user_id),
  coalesce(u.external_subject, u.id),
  coalesce(u.display_name, q.reviewed_by, 'Schema migration system actor'),
  case when u.user_type = 'system' then 'system' else 'professor' end,
  'legacy_backfill',
  jsonb_build_object('legacyVersion', true),
  coalesce(q.reviewed_at, qv.created_at)
from question_versions qv
join question_version_lifecycle qvl on qvl.question_version_id = qv.id
join questions q on q.id = qv.question_id
join users u on u.id = coalesce(q.reviewed_by_user_id, qv.created_by_user_id);

create trigger question_lifecycle_events_immutable
before update or delete on question_lifecycle_events
for each row execute function app_reject_immutable_mutation();

alter table tutor_sessions
  add column question_version_id bigint;

update tutor_sessions s
set question_version_id = coalesce(
  (
    select a.question_version_id
    from attempts a
    where a.session_id = s.id
    order by a.created_at, a.id
    limit 1
  ),
  q.published_version_id,
  q.working_version_id
)
from questions q
where q.id = s.question_id;

alter table tutor_sessions
  alter column question_version_id set not null,
  drop constraint tutor_sessions_status_check,
  add constraint tutor_sessions_status_check check (
    status in ('active', 'completed', 'expired', 'content_unpublished')
  ),
  add constraint tutor_sessions_question_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict;

create index tutor_sessions_question_version_idx
  on tutor_sessions (question_version_id, status, last_seen_at desc);

create or replace function app_fill_tutor_session_question_version()
returns trigger
language plpgsql
as $$
begin
  if new.question_version_id is null then
    select case
      when new.status = 'active' then q.published_version_id
      else coalesce(q.published_version_id, q.working_version_id)
    end
    into new.question_version_id
    from questions q
    where q.id = new.question_id;
  end if;
  if new.status = 'active' and new.question_version_id is null then
    raise exception 'Active tutor sessions require a published question version';
  end if;
  return new;
end;
$$;

create trigger tutor_sessions_fill_question_version
before insert or update of question_id, question_version_id on tutor_sessions
for each row execute function app_fill_tutor_session_question_version();

create or replace function app_fill_attempt_dimensions()
returns trigger
language plpgsql
as $$
begin
  if new.question_id is null or new.question_version_id is null then
    select s.question_id, s.question_version_id
    into new.question_id, new.question_version_id
    from tutor_sessions s
    where s.id = new.session_id;
  end if;

  if new.topic_id is null
    or (tg_op = 'UPDATE' and new.question_version_id is distinct from old.question_version_id)
  then
    select qv.snapshot_json ->> 'topicId'
    into new.topic_id
    from question_versions qv
    where qv.id = new.question_version_id
      and qv.question_id = new.question_id;
  end if;

  return new;
end;
$$;

alter table retrieval_chunks
  add column question_version_id bigint;

update retrieval_chunks rc
set question_version_id = coalesce(q.published_version_id, q.working_version_id)
from questions q
where q.id = rc.question_id;

alter table retrieval_chunks
  add constraint retrieval_chunks_question_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete cascade,
  add constraint retrieval_chunks_question_version_pair_check check (
    (question_id is null) = (question_version_id is null)
  );

create index retrieval_chunks_question_version_idx
  on retrieval_chunks (question_version_id, priority_tier);

create or replace function app_fill_retrieval_chunk_question_version()
returns trigger
language plpgsql
as $$
begin
  if new.question_id is null then
    new.question_version_id := null;
  elsif new.question_version_id is null then
    select coalesce(q.published_version_id, q.working_version_id)
    into new.question_version_id
    from questions q
    where q.id = new.question_id;
  end if;
  return new;
end;
$$;

create trigger retrieval_chunks_fill_question_version
before insert or update of question_id, question_version_id on retrieval_chunks
for each row execute function app_fill_retrieval_chunk_question_version();

alter table ai_response_cache
  add column question_version_id bigint;

update ai_response_cache cache
set question_version_id = coalesce(q.published_version_id, q.working_version_id)
from questions q
where q.id = cache.question_id;

alter table ai_response_cache
  add constraint ai_response_cache_question_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete cascade,
  add constraint ai_response_cache_question_version_pair_check check (
    (question_id is null) = (question_version_id is null)
  );

create index ai_response_cache_question_version_idx
  on ai_response_cache (question_version_id, expires_at);

create or replace function app_fill_ai_cache_question_version()
returns trigger
language plpgsql
as $$
begin
  if new.question_id is null then
    new.question_version_id := null;
  elsif new.question_version_id is null then
    select q.published_version_id
    into new.question_version_id
    from questions q
    where q.id = new.question_id;
  end if;
  if new.question_id is not null and new.question_version_id is null then
    raise exception 'Question response cache entries require a published version';
  end if;
  return new;
end;
$$;

create trigger ai_response_cache_fill_question_version
before insert or update of question_id, question_version_id on ai_response_cache
for each row execute function app_fill_ai_cache_question_version();

create or replace function app_guard_question_lifecycle_projection()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.lifecycle_write', true) <> 'allowed' then
    raise exception 'Question lifecycle pointers may only be changed by lifecycle procedures';
  end if;
  return new;
end;
$$;

create trigger questions_04_guard_lifecycle_projection
before update of record_state, working_version_id, published_version_id on questions
for each row execute function app_guard_question_lifecycle_projection();

create or replace function app_guard_question_version_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.lifecycle_write', true) <> 'allowed' then
    raise exception 'Question version lifecycle may only be changed by lifecycle procedures';
  end if;
  return new;
end;
$$;

create trigger question_version_lifecycle_guard
before update or delete on question_version_lifecycle
for each row execute function app_guard_question_version_lifecycle();

create or replace function app_initialize_question_version_lifecycle()
returns trigger
language plpgsql
as $$
declare
  actor_subject_value text;
  actor_display_value text;
  actor_role_value text;
  initial_action text;
  initial_state text;
begin
  perform set_config('app.lifecycle_write', 'allowed', true);

  initial_state := case
    when new.snapshot_json ->> 'reviewStatus' = 'approved'
      and new.snapshot_json ->> 'visibility' = 'public'
      and new.snapshot_json ->> 'trustLevel' in (
        'public_original',
        'professor_approved',
        'course_approved'
      )
      and exists (
        select 1 from users u
        where u.id = new.created_by_user_id and u.user_type = 'system'
      )
      and exists (
        select 1 from questions q
        where q.id = new.question_id and q.published_version_id is null
      )
    then 'published'
    else 'draft'
  end;
  initial_action := case when initial_state = 'published' then 'publish'
    when new.creation_method = 'regenerated' then 'regenerate'
    else 'create_version'
  end;

  insert into question_version_lifecycle (
    question_version_id,
    question_id,
    state,
    validation_status
  )
  values (new.id, new.question_id, initial_state, 'valid');

  update questions
  set working_version_id = new.id,
      published_version_id = case
        when initial_state = 'published' then new.id
        else published_version_id
      end
  where id = new.question_id;

  select
    coalesce(u.external_subject, u.id),
    u.display_name,
    case when u.user_type = 'system' then 'system' else 'professor' end
  into actor_subject_value, actor_display_value, actor_role_value
  from users u
  where u.id = new.created_by_user_id;

  insert into question_lifecycle_events (
    question_id,
    question_version_id,
    action,
    to_state,
    actor_user_id,
    actor_subject,
    actor_display_name,
    actor_role,
    requested_by_user_id,
    executed_by_user_id,
    reason_code,
    note,
    idempotency_key,
    request_id,
    metadata_json
  )
  values (
    new.question_id,
    new.id,
    initial_action,
    initial_state,
    new.created_by_user_id,
    actor_subject_value,
    actor_display_value,
    actor_role_value,
    case
      when new.creation_method in ('generated', 'regenerated')
      then nullif(new.generation_metadata_json ->> 'requestedByUserId', '')
      else null
    end,
    case
      when new.creation_method in ('generated', 'regenerated')
      then new.created_by_user_id
      else null
    end,
    case
      when nullif(current_setting('app.current_supersede_reason', true), '') is not null
      then 'working_version_superseded'
      else null
    end,
    left(
      nullif(current_setting('app.current_supersede_reason', true), ''),
      1000
    ),
    nullif(new.generation_metadata_json ->> 'idempotencyKey', ''),
    nullif(new.generation_metadata_json ->> 'requestId', ''),
    jsonb_build_object(
      'creationMethod', new.creation_method,
      'parentVersionId', new.parent_version_id
    ) || new.generation_metadata_json
  );

  return new;
end;
$$;

create trigger question_versions_initialize_lifecycle
after insert on question_versions
for each row execute function app_initialize_question_version_lifecycle();

create or replace function app_transition_question_version(
  target_question_id text,
  target_question_version_id bigint,
  transition_action text,
  actor_id text,
  actor_display text,
  expected_state text default null,
  reason_code_value text default null,
  note_value text default null,
  idempotency_key_value text default null,
  request_id_value text default null,
  metadata_value jsonb default '{}'::jsonb
)
returns table (
  result_question_id text,
  result_question_version_id bigint,
  result_state text,
  result_record_state text
)
language plpgsql
as $$
declare
  current_state text;
  current_record_state text;
  current_published_version_id bigint;
  current_working_version_id bigint;
  event_version_id bigint;
  next_state text;
  actor_subject_value text;
  actor_display_value text;
  actor_role_value text;
  actor_user_type_value text;
begin
  if not app_user_can_review(actor_id) then
    raise exception 'Question lifecycle transitions require an active professor or system identity';
  end if;
  select u.user_type, u.display_name
  into actor_user_type_value, actor_display_value
  from users u where u.id = actor_id;
  if actor_user_type_value = 'system' and transition_action <> 'submit' then
    raise exception 'System actors may only submit validated question drafts';
  end if;

  if idempotency_key_value is not null and exists (
    select 1
    from question_lifecycle_events qle
    where qle.question_id = target_question_id
      and qle.idempotency_key = idempotency_key_value
  ) then
    select q.record_state, qvl.state, q.working_version_id
    into current_record_state, current_state, event_version_id
    from questions q
    join question_version_lifecycle qvl
      on qvl.question_version_id = coalesce(target_question_version_id, q.working_version_id)
    where q.id = target_question_id;

    return query select target_question_id, event_version_id, current_state, current_record_state;
    return;
  end if;

  select
    q.record_state,
    q.published_version_id,
    q.working_version_id
  into current_record_state, current_published_version_id, current_working_version_id
  from questions q
  where q.id = target_question_id
  for update;

  if current_record_state is null then
    raise exception 'Question was not found';
  end if;

  event_version_id := coalesce(target_question_version_id, current_working_version_id);

  select qvl.state
  into current_state
  from question_version_lifecycle qvl
  where qvl.question_id = target_question_id
    and qvl.question_version_id = event_version_id
  for update;

  if current_state is null then
    raise exception 'Question version was not found';
  end if;

  if transition_action in (
      'submit', 'request_revision', 'approve', 'reject', 'publish'
    )
    and event_version_id <> current_working_version_id
  then
    raise exception '% requires the current working version', transition_action;
  end if;

  if expected_state is not null and expected_state <> current_state then
    raise exception 'Stale question lifecycle state: expected %, found %', expected_state, current_state;
  end if;

  if transition_action in ('request_revision', 'reject', 'unpublish', 'rollback', 'archive')
    and nullif(btrim(reason_code_value), '') is null
  then
    raise exception '% requires a reason code', transition_action;
  end if;
  if transition_action = 'request_revision'
    and coalesce(metadata_value ->> 'revisionMethod', '') not in ('manual', 'regeneration')
  then
    raise exception 'request_revision requires a manual or regeneration revision method';
  end if;

  if current_record_state = 'archived' and transition_action <> 'restore' then
    raise exception 'Archived questions must be restored before lifecycle changes';
  end if;

  perform set_config('app.lifecycle_write', 'allowed', true);

  if transition_action = 'archive' then
    if current_published_version_id is not null then
      raise exception 'Published questions must be unpublished before archival';
    end if;
    perform set_config('app.suppress_question_version', 'true', true);
    update questions
    set record_state = 'archived',
        archived_at = now(),
        review_status = 'needs_review',
        visibility = 'private',
        trust_level = case
          when source_type in ('generated_original', 'pattern_derived_original')
          then 'generated_unverified'
          else trust_level
        end
    where id = target_question_id;
    next_state := current_state;
  elsif transition_action = 'restore' then
    if current_record_state <> 'archived' then
      raise exception 'Only archived questions can be restored';
    end if;
    perform set_config('app.suppress_question_version', 'true', true);
    update questions
    set record_state = 'active', archived_at = null, visibility = 'public'
    where id = target_question_id;
    next_state := current_state;
  elsif transition_action = 'submit' and current_state = 'draft' then
    next_state := 'needs_review';
  elsif transition_action = 'request_revision'
    and current_state in ('needs_review', 'approved', 'unpublished')
  then
    next_state := 'revision_requested';
  elsif transition_action = 'approve' and current_state = 'needs_review' then
    if not exists (
      select 1
      from question_version_lifecycle qvl
      join question_versions qv on qv.id = qvl.question_version_id
      join topics t on t.id = qv.snapshot_json ->> 'topicId'
      where qvl.question_version_id = event_version_id
        and qvl.validation_status = 'valid'
        and qv.schema_version = 2
        and t.is_active = true
        and jsonb_typeof(qv.snapshot_json -> 'acceptedAnswers') = 'array'
        and jsonb_array_length(qv.snapshot_json -> 'acceptedAnswers') > 0
        and jsonb_typeof(qv.snapshot_json -> 'solutionSteps') = 'array'
        and jsonb_array_length(qv.snapshot_json -> 'solutionSteps') > 0
        and qv.snapshot_json::text !~* '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number)'
    ) then
      raise exception 'Only valid question versions can be approved';
    end if;
    next_state := 'approved';
  elsif transition_action = 'reject'
    and current_state in ('needs_review', 'approved', 'unpublished')
  then
    next_state := 'rejected';
  elsif transition_action in ('publish', 'rollback')
    and (
      (transition_action = 'publish' and current_state in ('approved', 'unpublished'))
      or (transition_action = 'rollback' and current_state = 'unpublished')
    )
  then
    if not exists (
      select 1
      from question_version_lifecycle qvl
      join question_versions qv on qv.id = qvl.question_version_id
      join topics t on t.id = qv.snapshot_json ->> 'topicId'
      where qvl.question_version_id = event_version_id
        and qvl.validation_status = 'valid'
        and qv.schema_version = 2
        and t.is_active = true
        and jsonb_typeof(qv.snapshot_json -> 'acceptedAnswers') = 'array'
        and jsonb_array_length(qv.snapshot_json -> 'acceptedAnswers') > 0
        and jsonb_typeof(qv.snapshot_json -> 'solutionSteps') = 'array'
        and jsonb_array_length(qv.snapshot_json -> 'solutionSteps') > 0
        and qv.snapshot_json::text !~* '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number)'
    ) then
      raise exception 'Only valid question versions can be published';
    end if;

    if current_published_version_id is not null
      and current_published_version_id <> event_version_id
    then
      update question_version_lifecycle
      set state = 'unpublished', updated_at = now()
      where question_version_id = current_published_version_id;

      update tutor_sessions
      set status = 'content_unpublished', updated_at = now()
      where question_id = target_question_id
        and question_version_id = current_published_version_id
        and status = 'active';

      insert into question_lifecycle_events (
        question_id,
        question_version_id,
        action,
        from_state,
        to_state,
        actor_user_id,
        actor_subject,
        actor_display_name,
        actor_role,
        reason_code,
        request_id,
        metadata_json
      )
      select
        target_question_id,
        current_published_version_id,
        'unpublish',
        'published',
        'unpublished',
        actor_id,
        coalesce(u.external_subject, u.id),
        actor_display_value,
        'professor',
        case when transition_action = 'rollback' then 'rollback_replaced' else 'publication_replaced' end,
        request_id_value,
        jsonb_build_object('replacementVersionId', event_version_id)
      from users u where u.id = actor_id;
    end if;

    update questions
    set published_version_id = event_version_id
    where id = target_question_id;
    next_state := 'published';
  elsif transition_action = 'unpublish'
    and current_state = 'published'
    and current_published_version_id = event_version_id
  then
    update questions set published_version_id = null where id = target_question_id;
    update tutor_sessions
    set status = 'content_unpublished', updated_at = now()
    where question_id = target_question_id
      and question_version_id = event_version_id
      and status = 'active';
    next_state := 'unpublished';
  else
    raise exception 'Illegal question lifecycle transition: % from %', transition_action, current_state;
  end if;

  if transition_action in ('publish', 'unpublish', 'rollback') then
    update ai_response_cache
    set expires_at = greatest(
          created_at + interval '1 microsecond',
          clock_timestamp()
        )
    where question_id = target_question_id
      and expires_at > clock_timestamp();
  end if;

  if next_state <> current_state then
    update question_version_lifecycle
    set state = next_state, updated_at = now()
    where question_version_id = event_version_id;
  end if;

  select
    coalesce(u.external_subject, u.id),
    case when u.user_type = 'system' then 'system' else 'professor' end
  into actor_subject_value, actor_role_value
  from users u where u.id = actor_id;

  insert into question_lifecycle_events (
    question_id,
    question_version_id,
    action,
    from_state,
    to_state,
    actor_user_id,
    actor_subject,
    actor_display_name,
    actor_role,
    reason_code,
    note,
    idempotency_key,
    request_id,
    metadata_json
  )
  values (
    target_question_id,
    event_version_id,
    transition_action,
    current_state,
    next_state,
    actor_id,
    actor_subject_value,
    actor_display_value,
    actor_role_value,
    nullif(btrim(reason_code_value), ''),
    nullif(btrim(note_value), ''),
    nullif(btrim(idempotency_key_value), ''),
    nullif(btrim(request_id_value), ''),
    coalesce(metadata_value, '{}'::jsonb)
  );

  insert into audit_events (
    actor_user_id,
    actor_subject,
    action,
    entity_type,
    entity_id,
    outcome,
    request_id,
    metadata_json
  )
  values (
    actor_id,
    actor_subject_value,
    'question_lifecycle.' || transition_action,
    'question',
    target_question_id,
    'success',
    nullif(btrim(request_id_value), ''),
    jsonb_build_object(
      'questionVersionId', event_version_id,
      'fromState', current_state,
      'toState', next_state
    )
  );

  select q.record_state into current_record_state
  from questions q where q.id = target_question_id;

  return query select target_question_id, event_version_id, next_state, current_record_state;
end;
$$;

drop view if exists app_public_questions;
drop view if exists app_review_queue_questions;
drop view if exists app_student_retrieval_chunks;

create view app_question_version_content as
select
  q.id,
  q.record_state,
  q.working_version_id,
  q.published_version_id,
  qv.id as question_version_id,
  qv.version_number,
  qv.parent_version_id,
  qv.creation_method,
  qv.schema_version,
  qv.content_sha256,
  qv.generation_metadata_json,
  qvl.state as lifecycle_state,
  qvl.validation_status,
  qv.snapshot_json ->> 'topicId' as topic_id,
  nullif(qv.snapshot_json ->> 'patternId', '') as pattern_id,
  qv.snapshot_json ->> 'title' as title,
  qv.snapshot_json ->> 'prompt' as prompt,
  qv.snapshot_json ->> 'difficulty' as difficulty,
  coalesce(qv.snapshot_json -> 'acceptedAnswers', '[]'::jsonb) as accepted_answers_json,
  nullif(qv.snapshot_json ->> 'numericValue', '')::double precision as numeric_value,
  nullif(qv.snapshot_json ->> 'tolerance', '')::double precision as tolerance,
  qv.snapshot_json ->> 'answerExplanation' as answer_explanation,
  qv.snapshot_json ->> 'sourceType' as source_type,
  case
    when qvl.state = 'published'
      and qv.snapshot_json ->> 'sourceType' in (
        'generated_original',
        'pattern_derived_original'
      )
    then 'professor_approved'
    else qv.snapshot_json ->> 'trustLevel'
  end as trust_level,
  case qvl.state
    when 'rejected' then 'rejected'
    when 'revision_requested' then 'needs_edit'
    when 'draft' then 'needs_review'
    when 'needs_review' then 'needs_review'
    else 'approved'
  end as review_status,
  case when qvl.state = 'published' then 'public' else 'private' end as visibility,
  nullif(qv.snapshot_json ->> 'originalityNote', '') as originality_note,
  latest_event.actor_display_name as reviewed_by,
  latest_event.actor_user_id as reviewed_by_user_id,
  latest_event.occurred_at as reviewed_at,
  coalesce(qv.snapshot_json ->> 'reviewPriority', q.review_priority, 'normal') as review_priority,
  nullif(qv.snapshot_json ->> 'reviewNotes', '') as review_notes,
  q.archived_at,
  q.created_at,
  q.updated_at,
  coalesce(
    (
      select jsonb_agg(item.value ->> 'body' order by item.ordinality)
      from jsonb_array_elements(coalesce(qv.snapshot_json -> 'hints', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ),
    '[]'::jsonb
  ) as hints_json,
  coalesce(
    (
      select jsonb_agg(item.value ->> 'body' order by item.ordinality)
      from jsonb_array_elements(coalesce(qv.snapshot_json -> 'solutionSteps', '[]'::jsonb))
        with ordinality as item(value, ordinality)
    ),
    '[]'::jsonb
  ) as solution_steps_json,
  coalesce(qv.snapshot_json -> 'misconceptions', '[]'::jsonb) as misconceptions_json
from questions q
join question_versions qv on qv.question_id = q.id
join question_version_lifecycle qvl on qvl.question_version_id = qv.id
left join lateral (
  select qle.actor_display_name, qle.actor_user_id, qle.occurred_at
  from question_lifecycle_events qle
  where qle.question_version_id = qv.id
  order by qle.occurred_at desc, qle.id desc
  limit 1
) latest_event on true;

create view app_public_questions as
select qvc.*
from app_question_version_content qvc
join topics t on t.id = qvc.topic_id
where qvc.record_state = 'active'
  and t.is_active = true
  and qvc.lifecycle_state = 'published'
  and qvc.published_version_id = qvc.question_version_id;

create view app_review_queue_questions as
select
  qvc.*,
  coalesce(qvc.pattern_id, qvc.source_type) as pattern_source
from app_question_version_content qvc
where qvc.record_state = 'active'
  and qvc.working_version_id = qvc.question_version_id
  and qvc.lifecycle_state in ('draft', 'needs_review', 'revision_requested');

create or replace view app_student_retrieval_chunks as
select
  rc.id,
  rc.topic_id,
  rc.question_id,
  rc.question_version_id,
  rc.chunk_type,
  rc.title,
  case when rc.visibility = 'private' then rc.llm_safe_summary else rc.body end as body,
  rc.llm_safe_summary,
  rc.keywords_json,
  rc.formula_refs_json,
  rc.concept_tags_json,
  rc.difficulty,
  rc.source_type,
  rc.trust_level,
  rc.review_status,
  rc.visibility,
  rc.priority_tier,
  rc.embedding_model,
  rc.content_hash,
  case rc.priority_tier
    when 'approved_professor_course' then 1
    when 'approved_generated' then 2
    when 'private_reference' then 3
    when 'safe_demo' then 4
    else 5
  end as priority_rank
from retrieval_chunks rc
left join questions q on q.id = rc.question_id
left join topics t on t.id = rc.topic_id
where rc.review_status = 'approved'
  and rc.trust_level <> 'generated_unverified'
  and (
    (
      rc.visibility = 'public'
      and rc.trust_level in ('public_original', 'professor_approved', 'course_approved')
      and rc.question_id is not null
      and q.record_state = 'active'
      and q.published_version_id = rc.question_version_id
      and t.is_active = true
    )
    or (
      rc.visibility = 'private'
      and rc.question_id is null
      and rc.source_type = 'private_reference_pattern'
      and rc.trust_level = 'private_reference'
      and rc.llm_safe_summary is not null
    )
  );

create index questions_lifecycle_catalog_idx
  on questions (record_state, published_version_id, working_version_id, id);
