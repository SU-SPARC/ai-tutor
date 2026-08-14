-- Record only whether and when an authenticated student completed the
-- production tutor/data notice. Do not store per-section responses, request
-- metadata, notice text, or a duplicate audit event.

alter table users
  add column student_onboarding_acknowledged_at timestamptz;

alter table users
  add constraint users_student_onboarding_acknowledgement_time_check check (
    student_onboarding_acknowledged_at is null
    or student_onboarding_acknowledged_at >= created_at
  );
