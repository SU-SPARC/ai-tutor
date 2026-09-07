-- Professor-authorized optional practice from the Reserve pool.
--
-- Reserve content stays unpublished and absent from app_public_questions. A
-- student can reach one exact working version only through an owned completed
-- tutor session and a server-created reserve_practice session.

alter table questions
  add column reserve_practice_allowed boolean not null default false,
  add constraint questions_reserve_practice_allowed_check check (
    not reserve_practice_allowed or is_reserved
  );

drop trigger questions_reserve_workflow_only on questions;
create trigger questions_reserve_workflow_only
before update of
  is_reserved,
  reserve_reason_code,
  reserve_note,
  reserved_by_user_id,
  reserved_at,
  reserve_practice_allowed
on questions
for each row execute function app_guard_question_reserve_write();

alter table question_reserve_events
  drop constraint question_reserve_events_action_check,
  drop constraint question_reserve_events_action_reason_check,
  add constraint question_reserve_events_action_check check (
    action in ('reserve', 'release', 'allow_practice', 'disallow_practice')
  ),
  add constraint question_reserve_events_action_reason_check check (
    (action = 'reserve' and reason_code is not null)
    or (action <> 'reserve' and reason_code is null)
  );

create view app_reserve_practice_questions as
select qvc.*
from app_question_version_content qvc
join questions q on q.id = qvc.id
join topics t on t.id = qvc.topic_id
left join topic_student_availability tsa on tsa.topic_id = t.id
left join question_student_availability qsa on qsa.question_id = qvc.id
where qvc.record_state = 'active'
  and t.is_active = true
  and q.is_reserved = true
  and q.reserve_practice_allowed = true
  and q.published_version_id is null
  and qvc.working_version_id = qvc.question_version_id
  and qvc.lifecycle_state in ('approved', 'unpublished')
  and qvc.review_status = 'approved'
  and qvc.source_type <> 'private_reference_pattern'
  and not exists (
    select 1
    from app_question_publication_gate_failures(
      q.id,
      q.working_version_id,
      qvc.lifecycle_state
    )
  )
  and coalesce(tsa.release_state, 'published') = 'published'
  and (tsa.available_from is null or tsa.available_from <= statement_timestamp())
  and (tsa.available_until is null or tsa.available_until > statement_timestamp())
  and coalesce(qsa.release_state, 'published') = 'published'
  and (qsa.available_from is null or qsa.available_from <= statement_timestamp())
  and (qsa.available_until is null or qsa.available_until > statement_timestamp());

alter view app_reserve_practice_questions set (security_invoker = true);

alter table tutor_sessions
  add column practice_context text not null default 'published',
  add column origin_session_id text references tutor_sessions(id) on delete restrict,
  add constraint tutor_sessions_practice_context_check check (
    practice_context in ('published', 'reserve_practice')
  ),
  add constraint tutor_sessions_practice_origin_check check (
    (practice_context = 'published' and origin_session_id is null)
    or (practice_context = 'reserve_practice' and origin_session_id is not null)
  );

create index tutor_sessions_reserve_practice_origin_idx
  on tutor_sessions (origin_session_id, question_id)
  where practice_context = 'reserve_practice';

create or replace function app_guard_tutor_session_practice_context()
returns trigger
language plpgsql
as $$
declare
  origin tutor_sessions%rowtype;
begin
  if new.practice_context = 'published' then
    if new.origin_session_id is not null then
      raise exception 'Published tutor sessions cannot have a similar-practice origin';
    end if;
    if tg_op = 'INSERT'
      and new.status = 'active'
      and not exists (
        select 1
        from questions q
        where q.id = new.question_id
          and q.published_version_id = new.question_version_id
      )
    then
      raise exception 'Active published tutor sessions require the published question version';
    end if;
    return new;
  end if;

  select * into origin
  from tutor_sessions
  where id = new.origin_session_id;

  if origin.id is null
    or not (origin.solved or origin.status = 'completed')
    or origin.question_id = new.question_id
    or origin.user_id is distinct from new.user_id
    or origin.anonymous_user_id is distinct from new.anonymous_user_id
    or not exists (
      select 1
      from app_reserve_practice_questions reserve_question
      where reserve_question.id = new.question_id
        and reserve_question.question_version_id = new.question_version_id
    )
  then
    raise exception 'Reserve practice requires an eligible question and an owned completed origin session';
  end if;

  return new;
end;
$$;

create trigger tutor_sessions_guard_practice_context
before insert or update of
  question_id,
  question_version_id,
  practice_context,
  origin_session_id
on tutor_sessions
for each row execute function app_guard_tutor_session_practice_context();

revoke all privileges on app_reserve_practice_questions from public;
revoke all privileges on function app_guard_tutor_session_practice_context() from public;

do $$
declare
  data_api_role text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = data_api_role) then
      execute format(
        'revoke all privileges on app_reserve_practice_questions from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on function app_guard_tutor_session_practice_context() from %I',
        data_api_role
      );
    end if;
  end loop;
end;
$$;
