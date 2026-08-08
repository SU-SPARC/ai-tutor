-- Record deliberate professor inspection of an exact immutable version before
-- it can participate in a batch lifecycle decision.

create table question_version_inspections (
  question_version_id bigint not null,
  question_id text not null,
  professor_user_id text not null references users(id) on delete restrict,
  inspected_at timestamptz not null default now(),
  primary key (question_version_id, professor_user_id),
  constraint question_version_inspections_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict
);

create index question_version_inspections_professor_idx
  on question_version_inspections (
    professor_user_id,
    inspected_at desc,
    question_version_id
  );

create trigger question_version_inspections_immutable
before update or delete on question_version_inspections
for each row execute function app_reject_immutable_mutation();

create or replace function app_record_question_version_inspection(
  target_question_id text,
  target_question_version_id bigint,
  professor_id text
)
returns timestamptz
language plpgsql
as $$
declare
  recorded_at timestamptz;
begin
  if not exists (
    select 1
    from users u
    where u.id = professor_id
      and u.user_type <> 'system'
      and app_user_can_review(u.id)
  ) then
    raise exception 'Question inspection requires an active professor identity';
  end if;

  if not exists (
    select 1
    from questions q
    join question_version_lifecycle qvl
      on qvl.question_version_id = target_question_version_id
     and qvl.question_id = q.id
    where q.id = target_question_id
      and q.record_state = 'active'
      and q.working_version_id = target_question_version_id
      and qvl.state in ('needs_review', 'approved', 'unpublished')
  ) then
    raise exception 'Only an active, current review version can be inspected';
  end if;

  insert into question_version_inspections (
    question_version_id,
    question_id,
    professor_user_id
  )
  values (
    target_question_version_id,
    target_question_id,
    professor_id
  )
  on conflict (question_version_id, professor_user_id) do nothing;

  select qvi.inspected_at
  into recorded_at
  from question_version_inspections qvi
  where qvi.question_version_id = target_question_version_id
    and qvi.professor_user_id = professor_id;

  return recorded_at;
end;
$$;
