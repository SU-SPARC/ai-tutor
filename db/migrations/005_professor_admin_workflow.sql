-- Professor/admin review workflow metadata.
--
-- This migration stores only public-safe review metadata for generated original
-- drafts. Raw private PDFs, extracted text, private chunks, embeddings, source
-- locators, and professor-only notes must stay outside public/admin routes.

alter table questions
  add column if not exists review_priority text not null default 'normal',
  add column if not exists review_notes text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'questions_review_priority_check'
  ) then
    alter table questions
      add constraint questions_review_priority_check
      check (review_priority in ('normal', 'priority'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'questions_review_notes_no_private_source_signals'
  ) then
    alter table questions
      add constraint questions_review_notes_no_private_source_signals
      check (
        coalesce(review_notes, '') !~*
          '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only)'
      );
  end if;
end $$;

drop view if exists app_review_queue_questions;

create view app_review_queue_questions as
select
  q.*,
  coalesce(q.pattern_id, q.source_type) as pattern_source,
  coalesce(
    (
      select jsonb_agg(h.body order by h.hint_order)
      from hints h
      where h.question_id = q.id
    ),
    '[]'::jsonb
  ) as hints_json,
  coalesce(
    (
      select jsonb_agg(s.body order by s.step_order)
      from solution_steps s
      where s.question_id = q.id
    ),
    '[]'::jsonb
  ) as solution_steps_json,
  coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'feedback', m.feedback,
          'matchTerms', m.match_terms_json
        )
        order by m.id
      )
      from misconceptions m
      where m.question_id = q.id
    ),
    '[]'::jsonb
  ) as misconceptions_json
from questions q
where q.visibility = 'public'
  and q.source_type in ('generated_original', 'pattern_derived_original')
  and q.trust_level = 'generated_unverified'
  and q.review_status in ('needs_review', 'needs_edit', 'needs_regeneration');

create index if not exists questions_review_priority_idx
  on questions (review_priority, review_status, trust_level, visibility);
