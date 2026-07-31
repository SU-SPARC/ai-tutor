-- Approved-content Production import support.
--
-- This migration stores only professor-approved, public-safe pattern metadata
-- and immutable import evidence. Raw retrieval chunks, private source text,
-- generation controls, drafts, test data, and student activity are excluded.

create or replace function app_reject_approved_content_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'approved content evidence is append-only; % is not allowed', tg_op;
end;
$$;

create or replace function app_is_active_human_professor(target_user_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from users u
    join user_roles ur on ur.user_id = u.id
    where u.id = target_user_id
      and u.user_type = 'human'
      and u.status = 'active'
      and ur.role_id = 'professor'
      and ur.revoked_at is null
      and (ur.expires_at is null or ur.expires_at > now())
  );
$$;

create or replace function app_enforce_approved_content_professor()
returns trigger
language plpgsql
as $$
begin
  if not app_is_active_human_professor(new.reviewed_by_user_id) then
    raise exception 'approved pattern metadata requires an active human professor';
  end if;
  return new;
end;
$$;

create or replace function app_enforce_approved_import_professor()
returns trigger
language plpgsql
as $$
begin
  if not app_is_active_human_professor(new.signed_by_user_id) then
    raise exception 'approved content import requires an active human professor';
  end if;
  return new;
end;
$$;

create table question_patterns (
  id text primary key,
  topic_id text not null references topics(id) on delete restrict,
  title text not null,
  description text not null,
  difficulty text not null check (
    difficulty in ('foundational', 'intermediate', 'challenge')
  ),
  concept_tags_json jsonb not null default '[]'::jsonb,
  misconception_tags_json jsonb not null default '[]'::jsonb,
  reviewed_by_user_id text not null references users(id) on delete restrict,
  reviewed_at timestamptz not null,
  created_at timestamptz not null,
  constraint question_patterns_nonblank_check check (
    btrim(id) <> ''
    and btrim(title) <> ''
    and btrim(description) <> ''
  ),
  constraint question_patterns_concept_tags_array check (
    jsonb_typeof(concept_tags_json) = 'array'
  ),
  constraint question_patterns_misconception_tags_array check (
    jsonb_typeof(misconception_tags_json) = 'array'
  ),
  constraint question_patterns_no_private_source_signals check (
    concat_ws(
      ' ',
      id,
      title,
      description,
      concept_tags_json::text,
      misconception_tags_json::text
    ) !~*
      '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only)'
  ),
  constraint question_patterns_timestamps_check check (reviewed_at >= created_at)
);

create trigger question_patterns_immutable
before update or delete on question_patterns
for each row execute function app_reject_approved_content_mutation();

create trigger question_patterns_enforce_professor
before insert on question_patterns
for each row execute function app_enforce_approved_content_professor();

create index question_patterns_topic_idx
  on question_patterns (topic_id, difficulty, title, id);

alter table questions
  add constraint questions_pattern_id_fkey
  foreign key (pattern_id) references question_patterns(id) on delete restrict
  not valid;

create table approved_content_imports (
  release_id text primary key,
  manifest_sha256 text not null unique check (
    manifest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  source_git_sha text not null check (
    source_git_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'
  ),
  signed_by_user_id text not null references users(id) on delete restrict,
  signed_at timestamptz not null,
  applied_by text not null,
  target text not null check (target in ('staging', 'production', 'test')),
  change_ticket text not null,
  summary_json jsonb not null check (jsonb_typeof(summary_json) = 'object'),
  applied_at timestamptz not null default now(),
  constraint approved_content_imports_nonblank_check check (
    btrim(release_id) <> ''
    and btrim(applied_by) <> ''
    and btrim(change_ticket) <> ''
  ),
  constraint approved_content_imports_time_check check (
    applied_at >= signed_at
  )
);

create trigger approved_content_imports_immutable
before update or delete on approved_content_imports
for each row execute function app_reject_approved_content_mutation();

create trigger approved_content_imports_enforce_professor
before insert on approved_content_imports
for each row execute function app_enforce_approved_import_professor();

create index approved_content_imports_signer_idx
  on approved_content_imports (signed_by_user_id, signed_at desc, release_id);
