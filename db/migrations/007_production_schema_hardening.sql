-- Production schema hardening.
--
-- This migration is forward-only and preserves existing application rows. It
-- introduces institutional identities, immutable question/review history,
-- durable progress, audit events, and feedback reports; makes ownership and
-- deletion behavior explicit; and strengthens existing data invariants.
--
-- Existing review decisions are attributed to a non-human migration actor.
-- This preserves their state without representing a demo label as a professor.

create or replace function app_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table users (
  id text primary key,
  identity_provider text not null,
  external_subject text not null,
  email text,
  display_name text not null,
  user_type text not null default 'human' check (
    user_type in ('human', 'system')
  ),
  status text not null default 'active' check (
    status in ('invited', 'active', 'disabled', 'deleted')
  ),
  last_login_at timestamptz,
  disabled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_provider, external_subject),
  constraint users_nonblank_identity check (
    btrim(id) <> ''
    and btrim(identity_provider) <> ''
    and btrim(external_subject) <> ''
    and btrim(display_name) <> ''
  ),
  constraint users_human_email_required check (
    user_type = 'system' or (email is not null and btrim(email) <> '')
  ),
  constraint users_disabled_state_check check (
    (status = 'disabled') = (disabled_at is not null)
  ),
  constraint users_deleted_state_check check (
    (status = 'deleted') = (deleted_at is not null)
  ),
  constraint users_timestamps_check check (updated_at >= created_at)
);

create unique index users_active_email_unique_idx
  on users (lower(email))
  where email is not null and deleted_at is null;

create index users_status_idx
  on users (status, user_type, created_at, id);

create trigger users_set_updated_at
before update on users
for each row execute function app_set_updated_at();

create table roles (
  id text primary key,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_nonblank_check check (
    btrim(id) <> '' and btrim(description) <> ''
  ),
  constraint roles_timestamps_check check (updated_at >= created_at)
);

create table user_roles (
  user_id text not null references users(id) on delete cascade,
  role_id text not null references roles(id) on delete restrict,
  granted_by_user_id text references users(id) on delete set null,
  revoked_by_user_id text references users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role_id),
  constraint user_roles_expiry_check check (
    expires_at is null or expires_at > granted_at
  ),
  constraint user_roles_revocation_check check (
    (revoked_at is null and revoked_by_user_id is null)
    or (
      revoked_at is not null
      and revoked_by_user_id is not null
      and revoked_at >= granted_at
    )
  ),
  constraint user_roles_timestamps_check check (updated_at >= created_at)
);

create trigger roles_set_updated_at
before update on roles
for each row execute function app_set_updated_at();

create trigger user_roles_set_updated_at
before update on user_roles
for each row execute function app_set_updated_at();

create index user_roles_active_role_idx
  on user_roles (role_id, user_id)
  where revoked_at is null;

insert into roles (id, description)
values
  ('student', 'Authenticated student application access'),
  ('professor', 'Academic content review and approval'),
  ('admin', 'Institutional application operations and role administration')
on conflict (id) do nothing;

insert into users (
  id,
  identity_provider,
  external_subject,
  display_name,
  user_type,
  status
)
values (
  'system:schema-migration',
  'internal',
  'schema-migration',
  'Schema migration system actor',
  'system',
  'active'
)
on conflict (id) do nothing;

insert into user_roles (user_id, role_id, granted_by_user_id)
values (
  'system:schema-migration',
  'admin',
  'system:schema-migration'
)
on conflict (user_id, role_id) do nothing;

alter table topics
  add constraint topics_id_nonblank check (btrim(id) <> ''),
  add constraint topics_title_nonblank check (btrim(title) <> ''),
  add constraint topics_sort_order_unique unique (sort_order),
  add constraint topics_timestamps_check check (updated_at >= created_at);

create trigger topics_set_updated_at
before update on topics
for each row execute function app_set_updated_at();

alter table questions
  add column reviewed_by_user_id text,
  add column archived_at timestamptz;

update questions
set reviewed_by_user_id = 'system:schema-migration',
    reviewed_at = coalesce(reviewed_at, updated_at, created_at)
where review_status <> 'needs_review';

alter table questions
  drop constraint questions_topic_id_fkey,
  add constraint questions_topic_id_fkey
    foreign key (topic_id) references topics(id) on delete restrict,
  add constraint questions_reviewed_by_user_id_fkey
    foreign key (reviewed_by_user_id) references users(id) on delete restrict,
  add constraint questions_id_topic_unique unique (id, topic_id),
  add constraint questions_id_nonblank check (btrim(id) <> ''),
  add constraint questions_title_nonblank check (btrim(title) <> ''),
  add constraint questions_prompt_nonblank check (btrim(prompt) <> ''),
  add constraint questions_explanation_nonblank check (
    btrim(answer_explanation) <> ''
  ),
  add constraint questions_answers_array check (
    jsonb_typeof(accepted_answers_json) = 'array'
  ),
  add constraint questions_tolerance_nonnegative check (
    tolerance is null or tolerance >= 0
  ),
  add constraint questions_review_decision_identity_check check (
    review_status = 'needs_review'
    or (reviewed_by_user_id is not null and reviewed_at is not null)
  ),
  add constraint questions_publication_state_check check (
    not (visibility = 'public' and review_status = 'approved')
    or (
      trust_level in (
        'public_original',
        'professor_approved',
        'course_approved'
      )
      and reviewed_by_user_id is not null
      and reviewed_at is not null
      and archived_at is null
    )
  ),
  add constraint questions_private_approval_state_check check (
    not (visibility = 'private' and review_status = 'approved')
    or trust_level = 'private_reference'
  ),
  add constraint questions_generated_review_state_check check (
    source_type not in ('generated_original', 'pattern_derived_original')
    or (
      review_status = 'approved'
      and trust_level = 'professor_approved'
    )
    or (
      review_status <> 'approved'
      and trust_level = 'generated_unverified'
    )
  ),
  add constraint questions_archived_state_check check (
    archived_at is null
    or not (visibility = 'public' and review_status = 'approved')
  ),
  add constraint questions_timestamps_check check (
    updated_at >= created_at
    and (reviewed_at is null or reviewed_at >= created_at)
    and (archived_at is null or archived_at >= created_at)
  );

create index questions_student_publication_idx
  on questions (topic_id, title, id)
  where visibility = 'public'
    and review_status = 'approved'
    and archived_at is null
    and trust_level in (
      'public_original',
      'professor_approved',
      'course_approved'
    );

create index questions_professor_queue_idx
  on questions (
    review_status,
    review_priority desc,
    created_at,
    topic_id,
    id
  )
  where archived_at is null;

create index questions_review_work_queue_idx
  on questions (
    (coalesce(review_priority, 'normal')) desc,
    created_at,
    id
  )
  where visibility = 'public'
    and source_type in ('generated_original', 'pattern_derived_original')
    and trust_level = 'generated_unverified'
    and review_status in ('needs_review', 'needs_edit', 'needs_regeneration')
    and archived_at is null;

create index questions_professor_catalog_idx
  on questions (review_status, source_type, topic_id, title, id)
  where visibility = 'public'
    and source_type <> 'private_reference_pattern'
    and archived_at is null;

create index questions_reviewer_history_idx
  on questions (reviewed_by_user_id, reviewed_at desc, id)
  where reviewed_by_user_id is not null;

create trigger questions_set_updated_at
before update on questions
for each row execute function app_set_updated_at();

alter table hints
  add column updated_at timestamptz not null default now(),
  add constraint hints_order_positive check (hint_order > 0),
  add constraint hints_body_nonblank check (btrim(body) <> ''),
  add constraint hints_timestamps_check check (updated_at >= created_at);

alter table hints
  drop constraint hints_question_id_fkey,
  add constraint hints_question_id_fkey
    foreign key (question_id) references questions(id) on delete cascade;

create trigger hints_set_updated_at
before update on hints
for each row execute function app_set_updated_at();

alter table solution_steps
  add column updated_at timestamptz not null default now(),
  add constraint solution_steps_order_positive check (step_order > 0),
  add constraint solution_steps_body_nonblank check (btrim(body) <> ''),
  add constraint solution_steps_timestamps_check check (
    updated_at >= created_at
  );

alter table solution_steps
  drop constraint solution_steps_question_id_fkey,
  add constraint solution_steps_question_id_fkey
    foreign key (question_id) references questions(id) on delete cascade;

create trigger solution_steps_set_updated_at
before update on solution_steps
for each row execute function app_set_updated_at();

alter table misconceptions
  add column metadata_json jsonb not null default '{}'::jsonb,
  add column updated_at timestamptz not null default now(),
  add constraint misconceptions_id_nonblank check (btrim(id) <> ''),
  add constraint misconceptions_feedback_nonblank check (btrim(feedback) <> ''),
  add constraint misconceptions_match_terms_array check (
    jsonb_typeof(match_terms_json) = 'array'
  ),
  add constraint misconceptions_metadata_object check (
    jsonb_typeof(metadata_json) = 'object'
  ),
  add constraint misconceptions_timestamps_check check (
    updated_at >= created_at
  );

alter table misconceptions
  drop constraint misconceptions_question_id_fkey,
  add constraint misconceptions_question_id_fkey
    foreign key (question_id) references questions(id) on delete cascade;

create trigger misconceptions_set_updated_at
before update on misconceptions
for each row execute function app_set_updated_at();

create table question_versions (
  id bigserial primary key,
  question_id text not null references questions(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  snapshot_json jsonb not null check (jsonb_typeof(snapshot_json) = 'object'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{32}$'),
  created_by_user_id text not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (question_id, version_number),
  unique (id, question_id)
);

create index question_versions_question_created_idx
  on question_versions (question_id, version_number desc, created_at desc);

create or replace function app_question_snapshot(target_question_id text)
returns jsonb
language sql
volatile
as $$
  select jsonb_build_object(
    'id', q.id,
    'topicId', q.topic_id,
    'patternId', q.pattern_id,
    'title', q.title,
    'prompt', q.prompt,
    'difficulty', q.difficulty,
    'acceptedAnswers', q.accepted_answers_json,
    'numericValue', q.numeric_value,
    'tolerance', q.tolerance,
    'answerExplanation', q.answer_explanation,
    'sourceType', q.source_type,
    'trustLevel', q.trust_level,
    'reviewStatus', q.review_status,
    'visibility', q.visibility,
    'originalityNote', q.originality_note,
    'reviewPriority', q.review_priority,
    'reviewNotes', q.review_notes,
    'reviewedByUserId', q.reviewed_by_user_id,
    'reviewedAt', q.reviewed_at,
    'archivedAt', q.archived_at,
    'hints', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('order', h.hint_order, 'body', h.body)
          order by h.hint_order
        )
        from hints h
        where h.question_id = q.id
      ),
      '[]'::jsonb
    ),
    'solutionSteps', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('order', s.step_order, 'body', s.body)
          order by s.step_order
        )
        from solution_steps s
        where s.question_id = q.id
      ),
      '[]'::jsonb
    ),
    'misconceptions', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'feedback', m.feedback,
            'matchTerms', m.match_terms_json,
            'metadata', m.metadata_json
          )
          order by m.id
        )
        from misconceptions m
        where m.question_id = q.id
      ),
      '[]'::jsonb
    )
  )
  from questions q
  where q.id = target_question_id;
$$;

create or replace function app_record_question_version(target_question_id text)
returns bigint
language plpgsql
as $$
declare
  actor_id text;
  next_version integer;
  snapshot jsonb;
  snapshot_hash text;
  latest_id bigint;
  latest_hash text;
begin
  perform 1 from questions where id = target_question_id for update;

  snapshot := app_question_snapshot(target_question_id);
  if snapshot is null then
    return null;
  end if;

  snapshot_hash := md5(snapshot::text);

  select qv.id, qv.content_hash
  into latest_id, latest_hash
  from question_versions qv
  where qv.question_id = target_question_id
  order by qv.version_number desc
  limit 1;

  if latest_hash = snapshot_hash then
    return latest_id;
  end if;

  select u.id
  into actor_id
  from users u
  where u.id = nullif(current_setting('app.current_user_id', true), '')
  limit 1;

  if actor_id is null then
    select q.reviewed_by_user_id
    into actor_id
    from questions q
    where q.id = target_question_id;
  end if;

  actor_id := coalesce(actor_id, 'system:schema-migration');

  select coalesce(max(qv.version_number), 0) + 1
  into next_version
  from question_versions qv
  where qv.question_id = target_question_id;

  insert into question_versions (
    question_id,
    version_number,
    snapshot_json,
    content_hash,
    created_by_user_id
  )
  values (
    target_question_id,
    next_version,
    snapshot,
    snapshot_hash,
    actor_id
  )
  returning id into latest_id;

  return latest_id;
end;
$$;

select app_record_question_version(id)
from questions
order by id;

create or replace function app_record_question_version_trigger()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform app_record_question_version(old.question_id);
    return old;
  end if;

  perform app_record_question_version(new.question_id);
  return new;
end;
$$;

create or replace function app_record_question_row_version_trigger()
returns trigger
language plpgsql
as $$
begin
  perform app_record_question_version(new.id);
  return new;
end;
$$;

create trigger questions_10_record_version_insert
after insert on questions
for each row execute function app_record_question_row_version_trigger();

create trigger questions_10_record_version_update
after update of
  topic_id,
  pattern_id,
  title,
  prompt,
  difficulty,
  accepted_answers_json,
  numeric_value,
  tolerance,
  answer_explanation,
  source_type,
  trust_level,
  review_status,
  visibility,
  originality_note,
  review_priority,
  review_notes,
  reviewed_by_user_id,
  reviewed_at,
  archived_at
on questions
for each row execute function app_record_question_row_version_trigger();

create trigger hints_record_question_version
after insert or update or delete on hints
for each row execute function app_record_question_version_trigger();

create trigger solution_steps_record_question_version
after insert or update or delete on solution_steps
for each row execute function app_record_question_version_trigger();

create trigger misconceptions_record_question_version
after insert or update or delete on misconceptions
for each row execute function app_record_question_version_trigger();

create table question_approval_history (
  id bigserial primary key,
  question_id text not null,
  question_version_id bigint not null,
  decision text not null check (
    decision in (
      'approved',
      'rejected',
      'needs_edit',
      'needs_regeneration',
      'reopened'
    )
  ),
  reviewer_user_id text not null references users(id) on delete restrict,
  reviewer_label text,
  notes text,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint question_approval_history_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict,
  constraint question_approval_history_time_check check (
    created_at >= decided_at
  )
);

create index question_approval_history_question_idx
  on question_approval_history (question_id, decided_at desc, id desc);

create index question_approval_history_reviewer_idx
  on question_approval_history (reviewer_user_id, decided_at desc, id desc);

insert into question_approval_history (
  question_id,
  question_version_id,
  decision,
  reviewer_user_id,
  reviewer_label,
  notes,
  decided_at,
  created_at
)
select
  q.id,
  latest_version.id,
  q.review_status,
  q.reviewed_by_user_id,
  coalesce(q.reviewed_by, 'legacy schema state'),
  q.review_notes,
  q.reviewed_at,
  greatest(q.reviewed_at, q.created_at)
from questions q
cross join lateral (
  select qv.id
  from question_versions qv
  where qv.question_id = q.id
  order by qv.version_number desc
  limit 1
) latest_version
where q.review_status in (
  'approved',
  'rejected',
  'needs_edit',
  'needs_regeneration'
);

create or replace function app_user_can_review(target_user_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from users u
    where u.id = target_user_id
      and u.status = 'active'
      and (
        u.user_type = 'system'
        or exists (
          select 1
          from user_roles ur
          where ur.user_id = u.id
            and ur.role_id in ('professor', 'admin')
            and ur.revoked_at is null
            and (ur.expires_at is null or ur.expires_at > now())
        )
      )
  );
$$;

create or replace function app_enforce_question_reviewer()
returns trigger
language plpgsql
as $$
begin
  if new.review_status <> 'needs_review'
    and not app_user_can_review(new.reviewed_by_user_id)
  then
    raise exception 'Question review decisions require an active professor or admin identity';
  end if;

  return new;
end;
$$;

create trigger questions_05_enforce_reviewer
before insert or update of review_status, reviewed_by_user_id on questions
for each row execute function app_enforce_question_reviewer();

create or replace function app_record_question_review()
returns trigger
language plpgsql
as $$
declare
  latest_version_id bigint;
  decision_value text;
begin
  if tg_op = 'UPDATE' and new.review_status is not distinct from old.review_status then
    return new;
  end if;

  if new.review_status = 'needs_review' then
    if tg_op = 'INSERT' then
      return new;
    end if;
    decision_value := 'reopened';
  else
    decision_value := new.review_status;
  end if;

  if new.reviewed_by_user_id is null then
    raise exception 'Question review history requires an immutable reviewer identity';
  end if;

  select qv.id
  into latest_version_id
  from question_versions qv
  where qv.question_id = new.id
  order by qv.version_number desc
  limit 1;

  insert into question_approval_history (
    question_id,
    question_version_id,
    decision,
    reviewer_user_id,
    reviewer_label,
    notes,
    decided_at
  )
  values (
    new.id,
    latest_version_id,
    decision_value,
    new.reviewed_by_user_id,
    new.reviewed_by,
    new.review_notes,
    coalesce(new.reviewed_at, now())
  );

  return new;
end;
$$;

create trigger questions_20_record_review_insert
after insert on questions
for each row execute function app_record_question_review();

create trigger questions_20_record_review_update
after update of review_status on questions
for each row execute function app_record_question_review();

alter table tutor_sessions
  add column user_id text,
  add column status text not null default 'active',
  add column expires_at timestamptz,
  add column updated_at timestamptz not null default now();

update tutor_sessions
set anonymous_user_id = 'legacy-session:' || id
where anonymous_user_id is null;

alter table tutor_sessions
  drop constraint tutor_sessions_question_id_fkey,
  add constraint tutor_sessions_question_id_fkey
    foreign key (question_id) references questions(id) on delete set null,
  add constraint tutor_sessions_user_id_fkey
    foreign key (user_id) references users(id) on delete cascade,
  add constraint tutor_sessions_identity_check check (
    num_nonnulls(user_id, anonymous_user_id) = 1
  ),
  add constraint tutor_sessions_status_check check (
    status in ('active', 'completed', 'expired')
  ),
  add constraint tutor_sessions_counts_nonnegative check (
    revealed_hints >= 0
    and revealed_steps >= 0
    and llm_calls >= 0
    and llm_input_tokens >= 0
    and llm_output_tokens >= 0
    and llm_total_tokens >= 0
  ),
  add constraint tutor_sessions_token_total_check check (
    llm_total_tokens = llm_input_tokens + llm_output_tokens
  ),
  add constraint tutor_sessions_timestamps_check check (
    last_seen_at >= created_at
    and updated_at >= created_at
    and (expires_at is null or expires_at >= created_at)
  );

create index tutor_sessions_user_activity_idx
  on tutor_sessions (user_id, last_seen_at desc, id)
  where user_id is not null;

create index tutor_sessions_anonymous_activity_idx
  on tutor_sessions (
    anonymous_user_id,
    last_seen_at desc,
    created_at desc,
    id
  )
  where anonymous_user_id is not null;

create index tutor_sessions_status_expiry_idx
  on tutor_sessions (status, expires_at, id);

create trigger tutor_sessions_set_updated_at
before update on tutor_sessions
for each row execute function app_set_updated_at();

alter table attempts
  add column question_version_id bigint,
  add column updated_at timestamptz not null default now();

update attempts a
set question_id = s.question_id
from tutor_sessions s
where a.session_id = s.id
  and a.question_id is null;

update attempts a
set topic_id = q.topic_id
from questions q
where a.question_id = q.id
  and a.topic_id is null;

update attempts a
set question_version_id = (
  select qv.id
  from question_versions qv
  where qv.question_id = a.question_id
  order by qv.version_number desc
  limit 1
)
where a.question_version_id is null;

alter table attempts
  alter column question_id set not null,
  alter column topic_id set not null,
  alter column question_version_id set not null,
  alter column mode set not null,
  drop constraint attempts_session_id_fkey,
  drop constraint attempts_question_id_fkey,
  drop constraint attempts_topic_id_fkey,
  add constraint attempts_session_id_fkey
    foreign key (session_id) references tutor_sessions(id) on delete cascade,
  add constraint attempts_question_topic_fkey
    foreign key (question_id, topic_id)
    references questions(id, topic_id)
    on delete restrict,
  add constraint attempts_question_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict,
  add constraint attempts_tokens_nonnegative check (estimated_tokens >= 0),
  add constraint attempts_answer_preview_length check (
    answer_preview is null or char_length(answer_preview) <= 80
  ),
  add constraint attempts_answer_hash_nonblank check (
    answer_hash is null or btrim(answer_hash) <> ''
  ),
  add constraint attempts_timestamps_check check (updated_at >= created_at);

create or replace function app_fill_attempt_dimensions()
returns trigger
language plpgsql
as $$
begin
  if new.question_id is null then
    select s.question_id
    into new.question_id
    from tutor_sessions s
    where s.id = new.session_id;
  end if;

  if new.topic_id is null
    or (tg_op = 'UPDATE' and new.question_id is distinct from old.question_id)
  then
    select q.topic_id
    into new.topic_id
    from questions q
    where q.id = new.question_id;
  end if;

  if new.question_version_id is null
    or (tg_op = 'UPDATE' and new.question_id is distinct from old.question_id)
  then
    select qv.id
    into new.question_version_id
    from question_versions qv
    where qv.question_id = new.question_id
    order by qv.version_number desc
    limit 1;
  end if;

  return new;
end;
$$;

create trigger attempts_fill_dimensions
before insert or update of question_id, topic_id, question_version_id
on attempts
for each row execute function app_fill_attempt_dimensions();

create trigger attempts_set_updated_at
before update on attempts
for each row execute function app_set_updated_at();

create index attempts_question_activity_idx
  on attempts (question_id, created_at desc, verdict, id desc);

create index attempts_topic_activity_idx
  on attempts (topic_id, created_at desc, id desc);

create index attempts_pending_session_idx
  on attempts (session_id, created_at desc, id desc)
  where verdict is null;

create index attempts_session_timeline_idx
  on attempts (session_id, created_at, id);

create table student_progress (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  topic_id text not null,
  question_id text not null,
  question_version_id bigint not null,
  status text not null default 'not_started' check (
    status in ('not_started', 'in_progress', 'completed', 'mastered')
  ),
  attempts_count integer not null default 0 check (attempts_count >= 0),
  hints_revealed integer not null default 0 check (hints_revealed >= 0),
  steps_revealed integer not null default 0 check (steps_revealed >= 0),
  best_verdict text check (best_verdict in ('correct', 'incorrect')),
  last_attempt_id bigint references attempts(id) on delete set null,
  first_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, question_id),
  constraint student_progress_question_topic_fkey
    foreign key (question_id, topic_id)
    references questions(id, topic_id)
    on delete restrict,
  constraint student_progress_question_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict,
  constraint student_progress_timestamps_check check (
    updated_at >= created_at
    and (first_started_at is null or first_started_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
  ),
  constraint student_progress_status_time_check check (
    status not in ('completed', 'mastered') or completed_at is not null
  )
);

create index student_progress_student_topic_idx
  on student_progress (user_id, topic_id, status, updated_at desc, question_id);

create index student_progress_topic_status_idx
  on student_progress (topic_id, status, updated_at desc, user_id);

create trigger student_progress_set_updated_at
before update on student_progress
for each row execute function app_set_updated_at();

alter table ai_usage
  add constraint ai_usage_scope_key_nonblank check (btrim(scope_key) <> ''),
  add constraint ai_usage_counts_nonnegative check (
    interactions >= 0
    and estimated_tokens >= 0
    and llm_fallbacks >= 0
    and llm_input_tokens >= 0
    and llm_output_tokens >= 0
    and llm_total_tokens >= 0
    and estimated_llm_tokens >= 0
    and cache_hits >= 0
    and limit_blocks >= 0
  ),
  add constraint ai_usage_token_total_check check (
    llm_total_tokens = llm_input_tokens + llm_output_tokens
  ),
  add constraint ai_usage_timestamps_check check (updated_at >= created_at);

create index ai_usage_reporting_idx
  on ai_usage (date_key desc, scope, updated_at desc, scope_key);

create trigger ai_usage_set_updated_at
before update on ai_usage
for each row execute function app_set_updated_at();

alter table ai_response_cache
  drop constraint ai_response_cache_question_id_fkey,
  drop constraint ai_response_cache_topic_id_fkey,
  add constraint ai_response_cache_question_id_fkey
    foreign key (question_id) references questions(id) on delete cascade,
  add constraint ai_response_cache_topic_id_fkey
    foreign key (topic_id) references topics(id) on delete cascade,
  add constraint ai_response_cache_question_topic_fkey
    foreign key (question_id, topic_id)
    references questions(id, topic_id)
    on delete cascade,
  add constraint ai_response_cache_question_topic_check check (
    question_id is null or topic_id is not null
  ),
  add constraint ai_response_cache_response_object check (
    jsonb_typeof(response_json) = 'object'
  ),
  add constraint ai_response_cache_timestamps_check check (
    updated_at >= created_at and expires_at > created_at
  );

create trigger ai_response_cache_set_updated_at
before update on ai_response_cache
for each row execute function app_set_updated_at();

alter table ai_llm_reservations
  add constraint ai_llm_reservations_session_fkey
    foreign key (session_id) references tutor_sessions(id) on delete cascade,
  add constraint ai_llm_reservations_actual_tokens_check check (
    (actual_input_tokens is null or actual_input_tokens >= 0)
    and (actual_output_tokens is null or actual_output_tokens >= 0)
    and (actual_total_tokens is null or actual_total_tokens >= 0)
    and (
      actual_total_tokens is null
      or actual_total_tokens =
        coalesce(actual_input_tokens, 0) + coalesce(actual_output_tokens, 0)
    )
  ),
  add constraint ai_llm_reservations_state_check check (
    (status = 'pending' and actual_total_tokens is null)
    or (status = 'settled' and actual_total_tokens is not null)
    or status = 'released'
  ),
  add constraint ai_llm_reservations_timestamps_check check (
    updated_at >= created_at and expires_at > created_at
  );

create index ai_llm_reservations_session_idx
  on ai_llm_reservations (session_id, status, created_at desc, id);

create trigger ai_llm_reservations_set_updated_at
before update on ai_llm_reservations
for each row execute function app_set_updated_at();

alter table retrieval_chunks
  drop constraint retrieval_chunks_topic_id_fkey,
  drop constraint retrieval_chunks_question_id_fkey,
  add constraint retrieval_chunks_topic_id_fkey
    foreign key (topic_id) references topics(id) on delete cascade,
  add constraint retrieval_chunks_question_id_fkey
    foreign key (question_id) references questions(id) on delete cascade,
  add constraint retrieval_chunks_question_topic_fkey
    foreign key (question_id, topic_id)
    references questions(id, topic_id)
    on delete cascade,
  add constraint retrieval_chunks_title_nonblank check (btrim(title) <> ''),
  add constraint retrieval_chunks_json_arrays_check check (
    jsonb_typeof(keywords_json) = 'array'
    and jsonb_typeof(formula_refs_json) = 'array'
    and jsonb_typeof(concept_tags_json) = 'array'
  ),
  add constraint retrieval_chunks_timestamps_check check (
    updated_at >= created_at
  );

create trigger retrieval_chunks_set_updated_at
before update on retrieval_chunks
for each row execute function app_set_updated_at();

create table audit_events (
  id bigserial primary key,
  actor_user_id text references users(id) on delete set null,
  actor_subject text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  outcome text not null default 'success' check (
    outcome in ('success', 'failure', 'denied')
  ),
  request_id text,
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint audit_events_nonblank_check check (
    btrim(actor_subject) <> ''
    and btrim(action) <> ''
    and btrim(entity_type) <> ''
  ),
  constraint audit_events_metadata_object check (
    jsonb_typeof(metadata_json) = 'object'
  ),
  constraint audit_events_timestamps_check check (created_at >= occurred_at)
);

create index audit_events_actor_idx
  on audit_events (actor_user_id, occurred_at desc, id desc)
  where actor_user_id is not null;

create index audit_events_entity_idx
  on audit_events (entity_type, entity_id, occurred_at desc, id desc);

create index audit_events_action_idx
  on audit_events (action, outcome, occurred_at desc, id desc);

create table feedback_reports (
  id bigserial primary key,
  reporter_user_id text references users(id) on delete set null,
  reporter_subject_hash text not null,
  tutor_session_id text references tutor_sessions(id) on delete set null,
  question_id text references questions(id) on delete restrict,
  question_version_id bigint,
  category text not null check (
    category in (
      'content_error',
      'technical_issue',
      'accessibility',
      'privacy',
      'other'
    )
  ),
  severity text not null default 'normal' check (
    severity in ('low', 'normal', 'high', 'urgent')
  ),
  status text not null default 'open' check (
    status in ('open', 'triaged', 'resolved', 'dismissed')
  ),
  message text not null,
  metadata_json jsonb not null default '{}'::jsonb,
  assigned_to_user_id text references users(id) on delete set null,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feedback_reports_message_nonblank check (btrim(message) <> ''),
  constraint feedback_reports_reporter_hash_nonblank check (
    btrim(reporter_subject_hash) <> ''
  ),
  constraint feedback_reports_metadata_object check (
    jsonb_typeof(metadata_json) = 'object'
  ),
  constraint feedback_reports_resolution_check check (
    (status in ('resolved', 'dismissed') and resolved_at is not null)
    or (status in ('open', 'triaged') and resolved_at is null)
  ),
  constraint feedback_reports_timestamps_check check (
    updated_at >= created_at
    and (resolved_at is null or resolved_at >= created_at)
  ),
  constraint feedback_reports_question_version_fkey
    foreign key (question_version_id, question_id)
    references question_versions(id, question_id)
    on delete restrict,
  constraint feedback_reports_question_version_check check (
    (question_id is null) = (question_version_id is null)
  )
);

create index feedback_reports_professor_queue_idx
  on feedback_reports (status, severity desc, created_at, id)
  where status in ('open', 'triaged');

create index feedback_reports_question_idx
  on feedback_reports (question_id, created_at desc, id desc)
  where question_id is not null;

create index feedback_reports_reporter_idx
  on feedback_reports (reporter_user_id, created_at desc, id desc)
  where reporter_user_id is not null;

create trigger feedback_reports_set_updated_at
before update on feedback_reports
for each row execute function app_set_updated_at();

create or replace function app_reject_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only; % is not allowed', tg_table_name, tg_op;
end;
$$;

create trigger question_versions_immutable
before update or delete on question_versions
for each row execute function app_reject_immutable_mutation();

create trigger question_approval_history_immutable
before update or delete on question_approval_history
for each row execute function app_reject_immutable_mutation();

create trigger audit_events_immutable
before update or delete on audit_events
for each row execute function app_reject_immutable_mutation();
