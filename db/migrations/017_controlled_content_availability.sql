-- Professor-controlled, global student availability for active syllabus topics
-- and editorially published questions. Approval and lifecycle publication stay
-- authoritative: an availability row can hide or schedule content, but can
-- never expose a question without a published immutable version.

create table topic_student_availability (
  topic_id text primary key references topics(id) on delete restrict,
  audience_type text not null default 'global' check (audience_type = 'global'),
  release_state text not null default 'published' check (
    release_state in ('published', 'unpublished', 'archived')
  ),
  available_from timestamptz,
  available_until timestamptz,
  updated_by_user_id text not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint topic_student_availability_schedule_check check (
    (release_state = 'published')
    or (available_from is null and available_until is null)
  ),
  constraint topic_student_availability_window_check check (
    available_from is null
    or available_until is null
    or available_until > available_from
  )
);

create table question_student_availability (
  question_id text primary key references questions(id) on delete restrict,
  audience_type text not null default 'global' check (audience_type = 'global'),
  release_state text not null default 'published' check (
    release_state in ('published', 'unpublished', 'archived')
  ),
  available_from timestamptz,
  available_until timestamptz,
  updated_by_user_id text not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint question_student_availability_schedule_check check (
    (release_state = 'published')
    or (available_from is null and available_until is null)
  ),
  constraint question_student_availability_window_check check (
    available_from is null
    or available_until is null
    or available_until > available_from
  )
);

create table student_content_availability_events (
  id bigserial primary key,
  target_type text not null check (target_type in ('topic', 'question')),
  target_id text not null check (btrim(target_id) <> ''),
  actor_user_id text not null references users(id) on delete restrict,
  from_release_state text not null check (
    from_release_state in ('published', 'unpublished', 'archived')
  ),
  to_release_state text not null check (
    to_release_state in ('published', 'unpublished', 'archived')
  ),
  from_available_from timestamptz,
  to_available_from timestamptz,
  from_available_until timestamptz,
  to_available_until timestamptz,
  reason text,
  request_id text,
  occurred_at timestamptz not null default now(),
  constraint student_content_availability_events_reason_check check (
    reason is null or (char_length(btrim(reason)) between 3 and 240)
  )
);

create index topic_student_availability_release_idx
  on topic_student_availability (
    release_state, available_from, available_until, topic_id
  );

create index question_student_availability_release_idx
  on question_student_availability (
    release_state, available_from, available_until, question_id
  );

create index student_content_availability_events_target_idx
  on student_content_availability_events (
    target_type, target_id, occurred_at desc, id desc
  );

create trigger topic_student_availability_set_updated_at
before update on topic_student_availability
for each row execute function app_set_updated_at();

create trigger question_student_availability_set_updated_at
before update on question_student_availability
for each row execute function app_set_updated_at();

create trigger student_content_availability_events_immutable
before update or delete on student_content_availability_events
for each row execute function app_reject_immutable_mutation();

create or replace function app_record_student_content_availability_change()
returns trigger
language plpgsql
as $$
declare
  actor_id text;
  change_reason text;
  request_id_value text;
  target_id_value text;
  target_type_value text;
  previous_release_state text;
  previous_available_from timestamptz;
  previous_available_until timestamptz;
begin
  if tg_op = 'UPDATE'
    and new.release_state is not distinct from old.release_state
    and new.available_from is not distinct from old.available_from
    and new.available_until is not distinct from old.available_until
  then
    return new;
  end if;

  actor_id := nullif(current_setting('app.current_user_id', true), '');
  if actor_id is null or not exists (
    select 1
    from users u
    join user_roles ur on ur.user_id = u.id
    where u.id = actor_id
      and u.status = 'active'
      and ur.role_id = 'professor'
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  ) then
    raise exception 'Student content availability changes require an active professor identity';
  end if;

  if new.updated_by_user_id is distinct from actor_id then
    raise exception 'Availability attribution must match the active professor identity';
  end if;

  target_type_value := case tg_table_name
    when 'topic_student_availability' then 'topic'
    else 'question'
  end;
  target_id_value := case target_type_value
    when 'topic' then to_jsonb(new) ->> 'topic_id'
    else to_jsonb(new) ->> 'question_id'
  end;
  previous_release_state := case when tg_op = 'INSERT'
    then 'published' else old.release_state end;
  previous_available_from := case when tg_op = 'INSERT'
    then null else old.available_from end;
  previous_available_until := case when tg_op = 'INSERT'
    then null else old.available_until end;
  change_reason := nullif(
    btrim(current_setting('app.availability_change_reason', true)),
    ''
  );
  request_id_value := nullif(
    btrim(current_setting('app.availability_request_id', true)),
    ''
  );

  insert into student_content_availability_events (
    target_type,
    target_id,
    actor_user_id,
    from_release_state,
    to_release_state,
    from_available_from,
    to_available_from,
    from_available_until,
    to_available_until,
    reason,
    request_id
  ) values (
    target_type_value,
    target_id_value,
    actor_id,
    previous_release_state,
    new.release_state,
    previous_available_from,
    new.available_from,
    previous_available_until,
    new.available_until,
    change_reason,
    request_id_value
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
  ) values (
    actor_id,
    actor_id,
    'content_availability.update',
    target_type_value,
    target_id_value,
    'success',
    request_id_value,
    jsonb_build_object(
      'audienceType', 'global',
      'fromReleaseState', previous_release_state,
      'toReleaseState', new.release_state,
      'fromAvailableFrom', previous_available_from,
      'toAvailableFrom', new.available_from,
      'fromAvailableUntil', previous_available_until,
      'toAvailableUntil', new.available_until
    )
  );

  return new;
end;
$$;

create trigger topic_student_availability_audit
after insert or update on topic_student_availability
for each row execute function app_record_student_content_availability_change();

create trigger question_student_availability_audit
after insert or update on question_student_availability
for each row execute function app_record_student_content_availability_change();

-- Missing availability rows intentionally preserve the pre-migration behavior:
-- active syllabus topics and editorially published questions are globally
-- available with no time window.
create or replace view app_public_questions as
select qvc.*
from app_question_version_content qvc
join topics t on t.id = qvc.topic_id
left join topic_student_availability tsa on tsa.topic_id = t.id
left join question_student_availability qsa on qsa.question_id = qvc.id
where qvc.record_state = 'active'
  and t.is_active = true
  and qvc.lifecycle_state = 'published'
  and qvc.published_version_id = qvc.question_version_id
  and coalesce(tsa.release_state, 'published') = 'published'
  and (tsa.available_from is null or tsa.available_from <= statement_timestamp())
  and (tsa.available_until is null or tsa.available_until > statement_timestamp())
  and coalesce(qsa.release_state, 'published') = 'published'
  and (qsa.available_from is null or qsa.available_from <= statement_timestamp())
  and (qsa.available_until is null or qsa.available_until > statement_timestamp());

alter view app_public_questions set (security_invoker = true);

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
left join topic_student_availability tsa on tsa.topic_id = rc.topic_id
left join question_student_availability qsa on qsa.question_id = rc.question_id
where rc.review_status = 'approved'
  and rc.trust_level <> 'generated_unverified'
  and t.is_active = true
  and coalesce(tsa.release_state, 'published') = 'published'
  and (tsa.available_from is null or tsa.available_from <= statement_timestamp())
  and (tsa.available_until is null or tsa.available_until > statement_timestamp())
  and (
    (
      rc.visibility = 'public'
      and rc.trust_level in ('public_original', 'professor_approved', 'course_approved')
      and rc.question_id is not null
      and q.record_state = 'active'
      and q.published_version_id = rc.question_version_id
      and coalesce(qsa.release_state, 'published') = 'published'
      and (qsa.available_from is null or qsa.available_from <= statement_timestamp())
      and (qsa.available_until is null or qsa.available_until > statement_timestamp())
    )
    or (
      rc.visibility = 'private'
      and rc.question_id is null
      and rc.source_type = 'private_reference_pattern'
      and rc.trust_level = 'private_reference'
      and rc.llm_safe_summary is not null
    )
  );

alter view app_student_retrieval_chunks set (security_invoker = true);

alter table topic_student_availability enable row level security;
alter table question_student_availability enable row level security;
alter table student_content_availability_events enable row level security;

revoke all privileges on topic_student_availability from public;
revoke all privileges on question_student_availability from public;
revoke all privileges on student_content_availability_events from public;

do $$
declare
  data_api_role text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = data_api_role) then
      execute format(
        'revoke all privileges on topic_student_availability from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on question_student_availability from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on student_content_availability_events from %I',
        data_api_role
      );
    end if;
  end loop;
end;
$$;
