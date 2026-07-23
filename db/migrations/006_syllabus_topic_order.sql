-- Add public-safe syllabus sequence metadata to the topic catalog.
-- Raw syllabus text and private course-material content must remain outside
-- the application database.

alter table topics
  add column if not exists week_number integer,
  add column if not exists module_ref text not null default '',
  add column if not exists is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'topics_sort_order_nonnegative'
  ) then
    alter table topics
      add constraint topics_sort_order_nonnegative check (sort_order >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'topics_week_number_positive'
  ) then
    alter table topics
      add constraint topics_week_number_positive check (
        week_number is null or week_number > 0
      );
  end if;
end
$$;

create index if not exists topics_student_sequence_idx
  on topics (is_active, sort_order, title, id);
