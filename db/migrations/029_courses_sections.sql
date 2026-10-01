-- Courses, sections, rosters and per-section releases.
--
-- A course overlays the canonical syllabus (which topics, in what order, with
-- an optional professor label); a section is one meeting of a course that
-- students join with a short code; a section opens topics and releases
-- questions by pinning an already-published immutable question version with
-- section-scoped delivery settings. Nothing here changes a question, a
-- version, or the global availability from migration 017: a release can only
-- point at a version that exists, and the application only pins the version
-- that is published when the release is made. The one shared object it
-- replaces is the tutor-session guard (see the end of this file), so a
-- section member can start a session on the version their section pinned.
--
-- Students are identified by the same owner namespaces tutor sessions use
-- (an authenticated user id or an anonymous pilot id). Instructor screens only
-- ever see the hashed student key derived from these columns.

create table courses (
  id text primary key,
  code text not null,
  title text not null,
  term text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  owner_user_id text not null references users(id) on delete restrict,
  created_by_user_id text not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint courses_id_check check (
    id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$'
  ),
  constraint courses_code_check check (
    code = btrim(code) and char_length(code) between 2 and 32
  ),
  constraint courses_title_check check (
    title = btrim(title) and char_length(title) between 1 and 120
  ),
  constraint courses_term_check check (
    term = btrim(term) and char_length(term) between 1 and 40
  ),
  constraint courses_archived_check check (
    (status = 'archived') = (archived_at is not null)
  ),
  constraint courses_timestamps_check check (updated_at >= created_at),
  unique (owner_user_id, code, term)
);

create table course_topics (
  course_id text not null references courses(id) on delete cascade,
  topic_id text not null references topics(id) on delete restrict,
  position integer not null check (position >= 0),
  display_label text,
  included boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (course_id, topic_id),
  constraint course_topics_display_label_check check (
    display_label is null
    or (
      display_label = btrim(display_label)
      and char_length(display_label) between 1 and 120
    )
  )
);

create table course_sections (
  id text primary key,
  course_id text not null references courses(id) on delete cascade,
  label text not null,
  meeting_time text not null default '',
  join_code text not null unique,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint course_sections_id_check check (
    id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$'
  ),
  constraint course_sections_label_check check (
    label = btrim(label) and char_length(label) between 1 and 60
  ),
  constraint course_sections_meeting_time_check check (
    char_length(meeting_time) <= 80
  ),
  -- The printed "K7Q-2M" shape. The application draws codes from an alphabet
  -- without the glyphs students confuse (0/O, 1/I/L, 5/S).
  constraint course_sections_join_code_check check (
    join_code ~ '^[A-Z0-9]{3}-[A-Z0-9]{2}$'
  ),
  constraint course_sections_timestamps_check check (updated_at >= created_at),
  -- Target of the denormalised (section, course) reference from members.
  unique (id, course_id)
);

create table section_members (
  section_id text not null,
  course_id text not null references courses(id) on delete cascade,
  owner_kind text not null check (owner_kind in ('user', 'anonymous')),
  owner_id text not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (section_id, owner_kind, owner_id),
  constraint section_members_section_fkey
    foreign key (section_id, course_id)
    references course_sections(id, course_id) on delete cascade,
  constraint section_members_owner_id_check check (
    owner_id = btrim(owner_id) and char_length(owner_id) between 1 and 200
  ),
  constraint section_members_left_check check (
    left_at is null or left_at >= joined_at
  )
);

create table section_topic_availability (
  section_id text not null references course_sections(id) on delete cascade,
  topic_id text not null references topics(id) on delete restrict,
  state text not null default 'closed' check (
    state in ('open', 'closed', 'scheduled')
  ),
  opens_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (section_id, topic_id),
  constraint section_topic_availability_schedule_check check (
    (state = 'scheduled') = (opens_at is not null)
  )
);

create table section_question_availability (
  section_id text not null references course_sections(id) on delete cascade,
  question_id text not null references questions(id) on delete restrict,
  state text not null check (state in ('released', 'held')),
  released_at timestamptz,
  released_version_id bigint,
  position integer not null default 0 check (position >= 0),
  attempts_allowed integer not null default 3 check (
    attempts_allowed between 1 and 10
  ),
  hints_enabled boolean not null default true,
  solution_reveal text not null default 'after_2_wrong' check (
    solution_reveal in (
      'never',
      'after_2_wrong',
      'after_3_wrong',
      'after_correct'
    )
  ),
  updated_at timestamptz not null default now(),
  primary key (section_id, question_id),
  -- A pin always names a version of the same question.
  constraint section_question_availability_version_fkey
    foreign key (released_version_id, question_id)
    references question_versions(id, question_id) on delete restrict,
  constraint section_question_availability_released_check check (
    state <> 'released' or released_version_id is not null
  )
);

-- Append-only ledger of professor actions, one row per applied action.
create table course_events (
  id bigserial primary key,
  course_id text not null references courses(id) on delete cascade,
  section_id text references course_sections(id) on delete cascade,
  actor_user_id text not null references users(id) on delete restrict,
  action text not null check (action ~ '^[a-z]+/[A-Za-z]+$'),
  payload_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(payload_json) = 'object'
  ),
  request_id text check (
    request_id is null or char_length(request_id) between 1 and 200
  ),
  occurred_at timestamptz not null default now()
);

create index course_sections_course_idx on course_sections (course_id);

-- One active section per course per student; history rows keep left_at.
create unique index section_members_active_course_owner_idx
  on section_members (course_id, owner_kind, owner_id)
  where left_at is null;

create index section_members_owner_idx
  on section_members (owner_kind, owner_id, joined_at desc);

create index section_question_availability_state_idx
  on section_question_availability (section_id, state);

create index course_events_course_idx
  on course_events (course_id, occurred_at desc);

create trigger courses_set_updated_at
before update on courses
for each row execute function app_set_updated_at();

create trigger course_topics_set_updated_at
before update on course_topics
for each row execute function app_set_updated_at();

create trigger course_sections_set_updated_at
before update on course_sections
for each row execute function app_set_updated_at();

create trigger section_topic_availability_set_updated_at
before update on section_topic_availability
for each row execute function app_set_updated_at();

create trigger section_question_availability_set_updated_at
before update on section_question_availability
for each row execute function app_set_updated_at();

create trigger course_events_immutable
before update or delete on course_events
for each row execute function app_reject_immutable_mutation();

alter table courses enable row level security;
alter table course_topics enable row level security;
alter table course_sections enable row level security;
alter table section_members enable row level security;
alter table section_topic_availability enable row level security;
alter table section_question_availability enable row level security;
alter table course_events enable row level security;

revoke all privileges on courses from public;
revoke all privileges on course_topics from public;
revoke all privileges on course_sections from public;
revoke all privileges on section_members from public;
revoke all privileges on section_topic_availability from public;
revoke all privileges on section_question_availability from public;
revoke all privileges on course_events from public;
revoke all privileges on sequence course_events_id_seq from public;

do $$
declare
  data_api_role text;
  course_table text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = data_api_role) then
      foreach course_table in array array[
        'courses',
        'course_topics',
        'course_sections',
        'section_members',
        'section_topic_availability',
        'section_question_availability',
        'course_events'
      ]
      loop
        execute format(
          'revoke all privileges on %I from %I',
          course_table,
          data_api_role
        );
      end loop;
      execute format(
        'revoke all privileges on sequence course_events_id_seq from %I',
        data_api_role
      );
    end if;
  end loop;
end;
$$;

-- Published tutor sessions normally require the question's published version
-- (migrations 023, 025, 026). A section release pins an immutable version, so
-- a section student keeps practising that version after the professor
-- publishes a newer one, until the professor moves the release. The function
-- below is migration 026's body with the published branch extended: a section
-- member's session on a released question must use the section's pinned
-- version; everyone else keeps the published-version rule. The
-- Reserve-practice branch is unchanged.
create or replace function app_guard_tutor_session_practice_context()
returns trigger
language plpgsql
as $$
declare
  origin tutor_sessions%rowtype;
  origin_step_count integer;
  origin_valid_attempts integer;
  section_pins bigint[];
begin
  if new.practice_context = 'published' then
    if new.origin_session_id is not null then
      raise exception 'Published tutor sessions cannot have a similar-practice origin';
    end if;
    if tg_op = 'INSERT' and new.status = 'active' then
      -- Migration 029: a section release pins an immutable version. When the
      -- session's owner is an active member of an active section that
      -- releases this (still published) question, the session must use a
      -- pinned version, which may be older than the published one. Everyone
      -- else, including members whose section does not release the question,
      -- keeps the published-version rule unchanged.
      select array_agg(sqa.released_version_id)
        into section_pins
      from section_question_availability sqa
      join section_members m
        on m.section_id = sqa.section_id
       and m.left_at is null
      join course_sections cs
        on cs.id = sqa.section_id
       and cs.status = 'active'
      join courses c
        on c.id = cs.course_id
       and c.status = 'active'
      join questions q
        on q.id = sqa.question_id
      where sqa.question_id = new.question_id
        and sqa.state = 'released'
        and q.record_state = 'active'
        and q.published_version_id is not null
        and (
          (
            m.owner_kind = 'user'
            and new.user_id is not null
            and new.anonymous_user_id is null
            and m.owner_id = new.user_id
          )
          or (
            m.owner_kind = 'anonymous'
            and new.anonymous_user_id is not null
            and new.user_id is null
            and m.owner_id = new.anonymous_user_id
          )
        );

      if section_pins is not null then
        if not (new.question_version_id = any(section_pins)) then
          raise exception 'Active published tutor sessions require the published question version or the section''s pinned version';
        end if;
      elsif not exists (
        select 1
        from questions q
        where q.id = new.question_id
          and q.published_version_id = new.question_version_id
      ) then
        raise exception 'Active published tutor sessions require the published question version';
      end if;
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
