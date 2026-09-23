-- Reserve similar practice as the partial-credit route.
--
-- Migration 023 allowed a reserve_practice session only from an owned origin
-- session that was already solved or completed. The course practice-credit
-- policy also needs the route "three valid answer attempts, worked solution
-- fully revealed, then a similar problem" while the origin is still unsolved.
--
-- This migration replaces only the origin condition inside
-- app_guard_tutor_session_practice_context(). Everything else the guard
-- enforces is unchanged: a published session can never carry an origin; an
-- active published session must pin the published version; a reserve session
-- needs an existing origin owned by the same student (user id and anonymous id
-- both matched), a different question, and a candidate that is currently
-- eligible in app_reserve_practice_questions. The trigger definition, its
-- firing columns, and the privilege revocations are re-stated unchanged.
--
-- The new origin rule, mirrored by similarProblemOriginQualifies() in
-- src/lib/tutor/practice-credit.ts:
--
--   origin.solved or origin.status = 'completed'
--   or (
--     origin.practice_context = 'published'
--     and the origin's pinned question version has at least one solution
--       step and origin.revealed_steps covers all of them
--     and the student has at least three valid answer attempts on that
--       question across every published session they own, where a valid
--       answer attempt is an attempts row with mode = 'check' and verdict in
--       ('correct', 'incorrect')
--   )
--
-- Rollback: re-run the create or replace function statement from
-- 023_reserve_similar_practice.sql, whose origin condition is exactly
--   not (origin.solved or origin.status = 'completed')
-- Sessions created under the wider rule remain valid rows either way; no data
-- is rewritten by this migration or by its reversal.

create or replace function app_guard_tutor_session_practice_context()
returns trigger
language plpgsql
as $$
declare
  origin tutor_sessions%rowtype;
  origin_step_count integer;
  origin_valid_attempts integer;
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
    raise exception 'Reserve practice requires an eligible question and an owned origin session';
  end if;

  if origin.solved or origin.status = 'completed' then
    return new;
  end if;

  -- Partial-credit route: the assigned question is unsolved, its worked
  -- solution is fully revealed, and three valid answer attempts exist.
  select jsonb_array_length(qv.snapshot_json -> 'solutionSteps')
    into origin_step_count
  from question_versions qv
  where qv.id = origin.question_version_id
    and jsonb_typeof(qv.snapshot_json -> 'solutionSteps') = 'array';

  select count(*)
    into origin_valid_attempts
  from attempts a
  join tutor_sessions s on s.id = a.session_id
  where s.question_id = origin.question_id
    and s.practice_context = 'published'
    and s.user_id is not distinct from origin.user_id
    and s.anonymous_user_id is not distinct from origin.anonymous_user_id
    and a.mode = 'check'
    and a.verdict in ('correct', 'incorrect');

  if origin.practice_context = 'published'
    and coalesce(origin_step_count, 0) > 0
    and origin.revealed_steps >= origin_step_count
    and origin_valid_attempts >= 3
  then
    return new;
  end if;

  raise exception 'Reserve practice requires a solved origin session, or three valid answer attempts and the fully revealed worked solution';
end;
$$;

revoke all privileges on function app_guard_tutor_session_practice_context() from public;

do $$
declare
  data_api_role text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = data_api_role) then
      execute format(
        'revoke all privileges on function app_guard_tutor_session_practice_context() from %I',
        data_api_role
      );
    end if;
  end loop;
end;
$$;
