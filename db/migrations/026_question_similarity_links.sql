-- Professor-approved, version-pinned question relationships.
--
-- Similar-practice selection is no longer inferred from topic or ranking
-- signals. A published origin may reach only the Reserve working versions
-- explicitly linked here. The origin and sibling versions are both pinned so
-- a later content revision requires a fresh professor decision.

create table question_similarity_links (
  id bigserial primary key,
  origin_question_id text not null references questions(id) on delete restrict,
  similar_question_id text not null references questions(id) on delete restrict,
  origin_version_id bigint not null,
  similar_version_id bigint not null,
  relationship_type text not null,
  slot smallint not null,
  created_at timestamptz not null default now(),
  created_by_user_id text not null references users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by_user_id text references users(id) on delete restrict,
  constraint question_similarity_links_distinct_questions_check check (
    origin_question_id <> similar_question_id
  ),
  constraint question_similarity_links_relationship_type_check check (
    relationship_type = 'similar_practice'
  ),
  constraint question_similarity_links_slot_check check (slot between 1 and 3),
  constraint question_similarity_links_revocation_check check (
    (revoked_at is null and revoked_by_user_id is null)
    or (revoked_at is not null and revoked_by_user_id is not null)
  ),
  constraint question_similarity_links_origin_version_fkey
    foreign key (origin_version_id, origin_question_id)
    references question_versions(id, question_id)
    on delete restrict,
  constraint question_similarity_links_similar_version_fkey
    foreign key (similar_version_id, similar_question_id)
    references question_versions(id, question_id)
    on delete restrict
);

-- Historical rows remain after revocation. Only active relationships consume
-- a professor slot or Reserve sibling, which permits a reviewed new-version
-- re-pin without erasing the old evidence relationship.
create unique index question_similarity_links_active_origin_slot_idx
  on question_similarity_links (origin_question_id, relationship_type, slot)
  where relationship_type = 'similar_practice' and revoked_at is null;

create unique index question_similarity_links_similar_practice_sibling_idx
  on question_similarity_links (similar_question_id)
  where relationship_type = 'similar_practice' and revoked_at is null;

create unique index question_similarity_links_active_pair_idx
  on question_similarity_links (
    origin_question_id,
    similar_question_id,
    relationship_type
  )
  where relationship_type = 'similar_practice' and revoked_at is null;

create index question_similarity_links_historical_evidence_idx
  on question_similarity_links (
    origin_question_id,
    origin_version_id,
    similar_question_id,
    similar_version_id
  )
  where relationship_type = 'similar_practice';

-- Cross-topic links are intentionally disallowed for this rollout. Professor
-- discretion chooses the dedicated sibling, but both questions must remain in
-- the same course topic and must be the exact currently eligible versions.
create or replace function app_guard_question_similarity_link_insert()
returns trigger
language plpgsql
as $$
begin
  if new.revoked_at is not null or new.revoked_by_user_id is not null then
    raise exception 'New question similarity links must be active';
  end if;
  if not exists (
    select 1
    from app_public_questions origin_question
    join app_reserve_practice_questions sibling_question
      on sibling_question.id = new.similar_question_id
     and sibling_question.question_version_id = new.similar_version_id
     and sibling_question.topic_id = origin_question.topic_id
    where origin_question.id = new.origin_question_id
      and origin_question.question_version_id = new.origin_version_id
  ) then
    raise exception 'Question similarity links require exact current versions in the same topic';
  end if;
  return new;
end;
$$;

create trigger question_similarity_links_validate_insert
before insert on question_similarity_links
for each row execute function app_guard_question_similarity_link_insert();

-- Every content/provenance field is immutable. The sole update is a one-way,
-- attributed revocation performed by the audited repository transaction.
create or replace function app_guard_question_similarity_link_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.similarity_link_write', true) is distinct from 'allowed' then
    raise exception 'Question similarity links may only be revoked through the audited workflow';
  end if;
  if old.revoked_at is not null
    or new.revoked_at is null
    or new.revoked_by_user_id is null
    or (to_jsonb(new) - 'revoked_at' - 'revoked_by_user_id')
      is distinct from
      (to_jsonb(old) - 'revoked_at' - 'revoked_by_user_id')
  then
    raise exception 'Question similarity links are immutable except for one-way revocation';
  end if;
  return new;
end;
$$;

create trigger question_similarity_links_guard_update
before update on question_similarity_links
for each row execute function app_guard_question_similarity_link_update();

create trigger question_similarity_links_immutable_delete
before delete on question_similarity_links
for each row execute function app_reject_immutable_mutation();

alter table question_similarity_links enable row level security;

revoke all privileges on question_similarity_links from public;
revoke all privileges on sequence question_similarity_links_id_seq from public;
revoke all privileges on function app_guard_question_similarity_link_insert() from public;
revoke all privileges on function app_guard_question_similarity_link_update() from public;

do $$
declare
  data_api_role text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = data_api_role) then
      execute format(
        'revoke all privileges on question_similarity_links from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on sequence question_similarity_links_id_seq from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on function app_guard_question_similarity_link_insert() from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on function app_guard_question_similarity_link_update() from %I',
        data_api_role
      );
    end if;
  end loop;
end;
$$;

-- Backfill only the pair already proven through the live 0.9 route. A fresh
-- empty installation has neither record and therefore has nothing to backfill.
-- Any partial presence or unexpected lifecycle/version state fails closed; in
-- Production the published origin is known to exist, so a missing or invalid
-- sibling cannot silently produce a successful migration.
do $$
declare
  origin_exists boolean;
  similar_exists boolean;
  origin_version bigint;
  similar_version bigint;
  relationship_actor text;
begin
  select exists (
    select 1 from questions
    where id = 'generated-syllabus-uniform-event-tokens'
  ) into origin_exists;
  select exists (
    select 1 from questions
    where id = 'reserve-similar-uniform-raffle-tickets-1'
  ) into similar_exists;

  if not origin_exists and not similar_exists then
    return;
  end if;
  if not origin_exists or not similar_exists then
    raise exception
      'Migration 026 requires both the Event Token origin and Raffle Ticket sibling';
  end if;

  select q.published_version_id
    into origin_version
  from questions q
  join question_version_lifecycle qvl
    on qvl.question_version_id = q.published_version_id
  where q.id = 'generated-syllabus-uniform-event-tokens'
    and q.record_state = 'active'
    and qvl.state = 'published';

  select q.working_version_id, q.reserved_by_user_id
    into similar_version, relationship_actor
  from questions q
  join question_version_lifecycle qvl
    on qvl.question_version_id = q.working_version_id
  where q.id = 'reserve-similar-uniform-raffle-tickets-1'
    and q.record_state = 'active'
    and q.is_reserved = true
    and q.reserve_practice_allowed = true
    and q.published_version_id is null
    and qvl.state in ('approved', 'unpublished');

  if origin_version is null or similar_version is null or relationship_actor is null then
    raise exception
      'Migration 026 requires the current published Event Token version and eligible Raffle Ticket working version';
  end if;
  if origin_version <> 387 or similar_version <> 464 then
    raise exception
      'Migration 026 expected reviewed Event Token version 387 and Raffle Ticket version 464, found % and %',
      origin_version,
      similar_version;
  end if;

  insert into question_similarity_links (
    origin_question_id,
    similar_question_id,
    origin_version_id,
    similar_version_id,
    relationship_type,
    slot,
    created_by_user_id
  ) values (
    'generated-syllabus-uniform-event-tokens',
    'reserve-similar-uniform-raffle-tickets-1',
    origin_version,
    similar_version,
    'similar_practice',
    1,
    relationship_actor
  );
end;
$$;

-- Preserve every migration-025 protection and add exact, version-pinned link
-- enforcement. Published origins and eligible Reserve working versions may
-- resume after harmless availability toggles, but changing either reviewed
-- content version makes the old relationship ineligible.
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
    or origin.practice_context <> 'published'
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
    raise exception 'Reserve practice requires an eligible question and an owned published origin session';
  end if;

  if not exists (
    select 1
    from question_similarity_links link
    join app_public_questions origin_question
      on origin_question.id = link.origin_question_id
    where link.relationship_type = 'similar_practice'
      and link.origin_question_id = origin.question_id
      and link.origin_version_id = origin.question_version_id
      and link.similar_question_id = new.question_id
      and link.similar_version_id = new.question_version_id
      and link.revoked_at is null
      and origin_question.question_version_id = link.origin_version_id
  )
  then
    raise exception 'Reserve practice requires an active approved similar-practice relationship for the exact origin and Reserve versions';
  end if;

  if origin.solved or origin.status = 'completed' then
    return new;
  end if;

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
