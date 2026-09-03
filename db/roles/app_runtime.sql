-- Least-privilege application runtime role for the AI tutor database.
--
-- Run this as the database owner (the Supabase `postgres` role) from the
-- approved change job, never from the application or a migration. It is
-- idempotent. It does not set a password: University IT sets the login
-- password separately through the provider's audited process and stores the
-- resulting URL only as the Vercel Production `DATABASE_URL` secret.
--
-- The role receives exactly the data-manipulation, sequence, view, and
-- function access the server needs. It cannot run DDL, create or manage
-- roles, bypass row-level security, administer backups, or reach provider
-- administration. The three row-level-security tables are locked to
-- everything except this role and the owner through explicit policies; the
-- Data API roles (`anon`, `authenticated`) still receive no policy and no
-- privileges.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_runtime') then
    create role app_runtime nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls connection limit 40;
  end if;
end;
$$;

grant connect on database postgres to app_runtime;
grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant usage, select, update on all sequences in schema public to app_runtime;
grant execute on all functions in schema public to app_runtime;

-- Objects created later by the owner (for example through migrations) keep the
-- same runtime access without a manual follow-up grant.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to app_runtime;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to app_runtime;
alter default privileges for role postgres in schema public
  grant execute on functions to app_runtime;

-- Row-level security is enabled without policies on the availability tables so
-- that provider Data API roles see nothing. The runtime role needs full
-- access to those rows; policies scoped to the role keep the lockout intact
-- for every other non-owner role.
do $$
declare
  availability_table text;
begin
  foreach availability_table in array array[
    'topic_student_availability',
    'question_student_availability',
    'student_content_availability_events'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = availability_table
        and policyname = 'app_runtime_full_access'
    ) then
      execute format(
        'create policy app_runtime_full_access on %I for all to app_runtime using (true) with check (true)',
        availability_table
      );
    end if;
  end loop;
end;
$$;

-- Explicitly deny everything the runtime must never do.
revoke create on schema public from app_runtime;
revoke create on database postgres from app_runtime;

-- Verification (read-only): expect nosuperuser, nocreaterole, nocreatedb,
-- nobypassrls, no schema CREATE, and three app_runtime_full_access policies.
select
  rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin,
  has_schema_privilege('app_runtime', 'public', 'CREATE') as schema_create,
  (select count(*) from pg_policies where policyname = 'app_runtime_full_access') as availability_policies
from pg_roles
where rolname = 'app_runtime';
