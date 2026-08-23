-- Connect the existing operational feedback ledger to the student tutor and
-- professor workflow. Historical categories remain valid so this forward-only
-- migration does not rewrite prior reports; new application writes use only
-- the six student-facing categories introduced here.

alter table feedback_reports
  drop constraint feedback_reports_category_check;

alter table feedback_reports
  add constraint feedback_reports_category_check check (
    category in (
      'answer_appears_incorrect',
      'wording_unclear',
      'hint_unhelpful',
      'solution_step_issue',
      'technical_problem',
      'other',
      'content_error',
      'technical_issue',
      'accessibility',
      'privacy'
    )
  ),
  add column idempotency_key text;

update feedback_reports
set idempotency_key = 'legacy:' || id
where idempotency_key is null;

alter table feedback_reports
  alter column idempotency_key set default gen_random_uuid()::text,
  alter column idempotency_key set not null,
  add constraint feedback_reports_idempotency_key_check check (
    char_length(idempotency_key) between 1 and 128
  );

create unique index feedback_reports_reporter_idempotency_idx
  on feedback_reports (reporter_subject_hash, idempotency_key);

create index feedback_reports_reporter_rate_idx
  on feedback_reports (reporter_subject_hash, created_at desc, id desc);

create index feedback_reports_session_category_idx
  on feedback_reports (
    reporter_subject_hash,
    tutor_session_id,
    category,
    created_at desc,
    id desc
  )
  where tutor_session_id is not null;
