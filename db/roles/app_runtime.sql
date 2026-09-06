-- Least-privilege application runtime role for the AI tutor database.
--
-- Run this as the database owner (the Supabase `postgres` role) from the
-- approved change job, never from the application or a migration. It is
-- idempotent. It does not set a login secret: University IT sets the login
-- credential separately through the provider's audited process and stores the
-- resulting URL only as the Vercel Production `DATABASE_URL` secret.
--
-- The role receives only the table mutations and routines exercised by the
-- server. It cannot write migration/import ledgers, role definitions, topic
-- configuration, retrieval source rows, or other operator-owned records. It
-- cannot run DDL, create or manage
-- roles, bypass row-level security, administer backups, or reach provider
-- administration. Every public table with row-level security enabled gets an
-- explicit policy for this role only, so the Data API roles (`anon`,
-- `authenticated`) still receive no policy and no privileges. Production
-- currently has row-level security enabled on every public table, so the
-- policy loop is dynamic rather than a fixed list.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls connection limit 40;
  end if;
end;
$$;

-- Supabase's managed owner can create a non-administrative role but cannot
-- issue ALTER ROLE statements that mention provider-protected attributes such
-- as SUPERUSER or BYPASSRLS. Fail closed if an existing role drifted instead
-- of attempting an unauthorized repair. LOGIN remains the separate credential
-- step after this role and its grants have been verified.
do $$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'app_runtime'
      and (
        rolsuper or rolcreatedb or rolcreaterole or rolinherit
        or rolreplication or rolbypassrls or rolconnlimit <> 40
      )
  ) then
    raise exception 'app_runtime role attributes drifted';
  end if;
end;
$$;

grant connect on database postgres to app_runtime;
grant usage on schema public to app_runtime;

-- Canonicalize an existing role before granting the application surface. This
-- makes a re-run remove historical privileges instead of silently preserving
-- them. LOGIN/NOLOGIN is intentionally left to the provider credential step.
revoke all privileges on database postgres from app_runtime;
revoke all privileges on schema public from app_runtime;
revoke all privileges on all tables in schema public from app_runtime;
revoke all privileges on all sequences in schema public from app_runtime;
revoke all privileges on all functions in schema public from app_runtime;

-- PostgreSQL grants EXECUTE on newly created routines to PUBLIC unless the
-- creating role's default privileges say otherwise. Canonicalize both current
-- and future routines before exposing the reviewed application entry points.
-- This is intentionally schema-scoped and mirrors migration 014's Data API
-- lockdown; it does not change old migration files or their checksums.
revoke all privileges on all functions in schema public from public;
alter default privileges for role postgres in schema public
  revoke all privileges on functions from public;

grant connect on database postgres to app_runtime;
grant usage on schema public to app_runtime;
grant select on all tables in schema public to app_runtime;

grant insert on
  ai_llm_reservations,
  ai_response_cache,
  ai_usage,
  anonymous_identity_claims,
  attempts,
  audit_events,
  feedback_reports,
  hints,
  misconceptions,
  question_approval_history,
  question_lifecycle_events,
  question_reserve_events,
  question_student_availability,
  question_version_inspections,
  question_version_lifecycle,
  question_versions,
  questions,
  solution_steps,
  student_content_availability_events,
  topic_student_availability,
  tutor_sessions,
  user_roles,
  users
to app_runtime;

grant update on
  ai_llm_reservations,
  ai_response_cache,
  ai_usage,
  attempts,
  feedback_reports,
  question_student_availability,
  question_version_lifecycle,
  questions,
  topic_student_availability,
  tutor_sessions,
  user_roles,
  users
to app_runtime;

grant delete on hints, misconceptions, solution_steps to app_runtime;
grant usage on all sequences in schema public to app_runtime;
grant execute on function app_question_snapshot(text) to app_runtime;
grant execute on function app_record_question_version(text) to app_runtime;
grant execute on function app_record_question_version_inspection(
  text,
  bigint,
  text
) to app_runtime;
grant execute on function app_user_can_review(text) to app_runtime;
grant execute on function app_transition_question_version(
  text,
  bigint,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to app_runtime;

-- Future objects are readable by default but never gain write or routine
-- execution privileges implicitly. A migration that adds an application write
-- path must update this reviewed role file explicitly.
alter default privileges for role postgres in schema public
  grant select on tables to app_runtime;
alter default privileges for role postgres in schema public
  grant usage on sequences to app_runtime;

-- Enforce row-level security on every application table. The runtime role
-- needs full access to those rows; policies scoped to the role keep the
-- lockout intact for every other non-owner role. Re-run this script after a
-- migration adds a table so the new table cannot escape this boundary.
do $$
declare
  secured_table text;
begin
  for secured_table in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
    order by c.relname
  loop
    execute format(
      'alter table public.%I enable row level security',
      secured_table
    );
    execute format(
      'drop policy if exists app_runtime_full_access on public.%I',
      secured_table
    );
    execute format(
      'create policy app_runtime_full_access on public.%I for all to app_runtime using (true) with check (true)',
      secured_table
    );
  end loop;
end;
$$;

-- Explicitly deny everything the runtime must never do.
revoke create on schema public from app_runtime;
revoke create on database postgres from app_runtime;
revoke insert, update, delete, truncate, references, trigger
  on schema_migrations, approved_content_imports, question_patterns, roles,
     retrieval_chunks, student_progress, topics
  from app_runtime;

-- Verification (read-only): expect nosuperuser, nocreaterole, nocreatedb,
-- nobypassrls, no schema CREATE, and one app_runtime_full_access policy per
-- public table.
select
  rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin,
  has_schema_privilege('app_runtime', 'public', 'CREATE') as schema_create,
  (select count(*) from pg_policies where policyname = 'app_runtime_full_access') as runtime_policies,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity) as row_level_security_tables
from pg_roles
where rolname = 'app_runtime';
