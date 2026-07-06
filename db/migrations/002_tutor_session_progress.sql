-- Track public-safe tutor session progress for backend session routes.
-- Raw answers, private course materials, extracted text, chunks, embeddings,
-- and professor-only notes must stay out of this table.

alter table tutor_sessions
  add column if not exists question_id text references questions(id),
  add column if not exists revealed_hints integer not null default 0,
  add column if not exists revealed_steps integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tutor_sessions_revealed_hints_nonnegative'
  ) then
    alter table tutor_sessions
      add constraint tutor_sessions_revealed_hints_nonnegative
      check (revealed_hints >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tutor_sessions_revealed_steps_nonnegative'
  ) then
    alter table tutor_sessions
      add constraint tutor_sessions_revealed_steps_nonnegative
      check (revealed_steps >= 0);
  end if;
end $$;

create index if not exists tutor_sessions_question_idx
  on tutor_sessions (question_id, created_at);
