-- Multi-course foundation: one platform, several course content sets.
--
-- A course owns topics. Questions, sessions, attempts, availability, reserve
-- practice, similarity links, and retrieval chunks all already reach a topic,
-- so their course is derived through topics.course_id and no redundant
-- course_id column is added to them.
--
-- Existing content is Probability & Statistics and is backfilled to it. The
-- column default keeps every existing importer, seed script, and fixture that
-- inserts a topic without a course landing in Probability & Statistics during
-- the transition; course-aware tooling always passes the course explicitly.
-- Calculus I is registered here with no topics: its syllabus is loaded later
-- as data.

create table courses (
  id text primary key,
  code text,
  title text not null,
  is_active boolean not null default true,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint courses_id_format check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint courses_code_nonblank check (code is null or btrim(code) <> ''),
  constraint courses_title_nonblank check (btrim(title) <> ''),
  constraint courses_sort_order_nonnegative check (sort_order >= 0),
  constraint courses_sort_order_unique unique (sort_order),
  constraint courses_timestamps_check check (updated_at >= created_at)
);

create unique index courses_code_unique_idx
  on courses (code)
  where code is not null;

create trigger courses_set_updated_at
before update on courses
for each row execute function app_set_updated_at();

-- MATH-255 is the course code the platform already shows for Probability &
-- Statistics. No institutional code has been provided for Calculus I, so none
-- is recorded.
insert into courses (id, code, title, is_active, sort_order)
values
  ('probability-statistics', 'MATH-255', 'Probability & Statistics', true, 1),
  ('calculus-1', null, 'Calculus I', true, 2);

-- Adding the column with a default backfills every existing topic to
-- Probability & Statistics in the same statement that makes it NOT NULL.
alter table topics
  add column course_id text not null default 'probability-statistics'
    references courses(id) on delete restrict;

-- Topic order is a per-course sequence, not a global one.
alter table topics drop constraint topics_sort_order_unique;
alter table topics
  add constraint topics_course_sort_order_unique unique (course_id, sort_order);

create index topics_course_listing_idx
  on topics (course_id, is_active, sort_order, title, id);

-- A topic's course may not silently change once content depends on it, since
-- that would move every dependent question, session, and progress record into
-- another course.
create or replace function app_reject_topic_course_change_with_dependents()
returns trigger
language plpgsql
as $$
begin
  if new.course_id is distinct from old.course_id and (
    exists (select 1 from questions where topic_id = old.id)
    or exists (select 1 from attempts where topic_id = old.id)
    or exists (select 1 from retrieval_chunks where topic_id = old.id)
    or exists (select 1 from question_patterns where topic_id = old.id)
  ) then
    raise exception
      'Topic % already has questions, attempts, patterns, or retrieval content and cannot move to another course.',
      old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger topics_course_change_guard
before update of course_id on topics
for each row execute function app_reject_topic_course_change_with_dependents();

-- A question never moves to a topic in another course: its sessions, attempts,
-- and progress would silently change course with it.
create or replace function app_reject_question_course_change()
returns trigger
language plpgsql
as $$
declare
  old_course text;
  new_course text;
begin
  if new.topic_id is distinct from old.topic_id then
    select course_id into old_course from topics where id = old.topic_id;
    select course_id into new_course from topics where id = new.topic_id;
    if old_course is distinct from new_course then
      raise exception
        'Question % cannot move from course % to course %.',
        old.id, old_course, new_course
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger questions_course_change_guard
before update of topic_id on questions
for each row execute function app_reject_question_course_change();

-- Expose the derived course on every public, review, reserve, and retrieval
-- view so callers can filter in SQL. Like migration 024, this appends one
-- column to each existing definition without touching any existing column or
-- visibility predicate. A left join keeps the row set identical.
do $$
declare
  view_name text;
  definition text;
begin
  foreach view_name in array array[
    'app_question_version_content',
    'app_public_questions',
    'app_review_queue_questions',
    'app_reserve_practice_questions',
    'app_student_retrieval_chunks',
    'app_admin_retrieval_chunks'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = view_name
        and column_name = 'topic_id'
    ) then
      raise exception 'View % does not expose topic_id; cannot derive course.', view_name;
    end if;

    select pg_get_viewdef(view_name::regclass, true) into definition;
    definition := regexp_replace(definition, ';[[:space:]]*$', '');
    execute format(
      'create or replace view %I as select existing.*, course_topic.course_id from (%s) existing left join topics course_topic on course_topic.id = existing.topic_id',
      view_name,
      definition
    );
    execute format('alter view %I set (security_invoker = true)', view_name);
  end loop;
end;
$$;
