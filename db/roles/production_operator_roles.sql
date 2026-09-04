-- Least-privilege Production database operator roles.
--
-- Run only through the approved custody operation after the Production project
-- fingerprint, database name, named owner, second reviewer, recovery point,
-- and change ticket have been verified. This file never creates LOGIN secrets.
-- University IT enables LOGIN and sets each credential through the provider's
-- audited secret workflow only after the post-provision read-only checks pass.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_migrator') then
    create role app_migrator nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls connection limit 2;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'integrity_audit') then
    create role integrity_audit nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication bypassrls connection limit 2;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'backup_export') then
    create role backup_export nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication bypassrls connection limit 2;
  end if;
end;
$$;

-- Reassert the non-administrative attributes without changing LOGIN state.
alter role app_migrator nosuperuser nocreatedb nocreaterole noinherit
  noreplication nobypassrls connection limit 2;
alter role integrity_audit nosuperuser nocreatedb nocreaterole noinherit
  noreplication bypassrls connection limit 2;
alter role backup_export nosuperuser nocreatedb nocreaterole noinherit
  noreplication bypassrls connection limit 2;

alter role integrity_audit set default_transaction_read_only = on;
alter role backup_export set default_transaction_read_only = on;

-- Canonicalize grants so a re-run removes stale or excessive privileges.
revoke all privileges on database postgres
  from app_migrator, integrity_audit, backup_export;
revoke all privileges on schema public
  from app_migrator, integrity_audit, backup_export;
revoke all privileges on all tables in schema public
  from app_migrator, integrity_audit, backup_export;
revoke all privileges on all sequences in schema public
  from app_migrator, integrity_audit, backup_export;
revoke all privileges on all functions in schema public
  from app_migrator, integrity_audit, backup_export;

grant connect on database postgres
  to app_migrator, integrity_audit, backup_export;
grant usage on schema public
  to app_migrator, integrity_audit, backup_export;

-- The migrator owns only application objects in public. It can evolve that
-- schema but cannot create databases, roles, extensions, or provider objects.
grant create on schema public to app_migrator;

do $$
declare
  object_record record;
begin
  for object_record in
    select c.relkind, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and pg_get_userbyid(c.relowner) = current_user
    order by c.relkind, c.relname
  loop
    execute format(
      'alter %s public.%I owner to app_migrator',
      case object_record.relkind
        when 'v' then 'view'
        when 'm' then 'materialized view'
        else 'table'
      end,
      object_record.relname
    );
  end loop;

  -- Changing a table owner also changes its owned identity/serial sequences.
  -- A separate pass transfers only any standalone sequences that remain.
  for object_record in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and pg_get_userbyid(c.relowner) = current_user
    order by c.relname
  loop
    execute format(
      'alter sequence public.%I owner to app_migrator',
      object_record.relname
    );
  end loop;

  for object_record in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and pg_get_userbyid(p.proowner) = current_user
    order by p.proname, p.oid
  loop
    execute format(
      'alter routine public.%I(%s) owner to app_migrator',
      object_record.proname,
      object_record.args
    );
  end loop;
end;
$$;

-- The provider owner retains an explicit, auditable ability to SET ROLE for
-- emergency ownership administration; no application or operator login does.
grant app_migrator to postgres;

grant all privileges on all tables in schema public to app_migrator;
grant all privileges on all sequences in schema public to app_migrator;
grant execute on all functions in schema public to app_migrator;

grant select on all tables in schema public to integrity_audit;
grant select on all tables in schema public to backup_export;
grant select on all sequences in schema public to backup_export;

-- Future migration-owned objects default to a locked-down posture. Runtime
-- write access and routine execution always require an explicit reviewed edit.
alter default privileges for role app_migrator in schema public
  revoke all privileges on tables from public;
alter default privileges for role app_migrator in schema public
  revoke all privileges on sequences from public;
alter default privileges for role app_migrator in schema public
  revoke all privileges on functions from public;
alter default privileges for role app_migrator in schema public
  grant select on tables to app_runtime, integrity_audit, backup_export;
alter default privileges for role app_migrator in schema public
  grant usage on sequences to app_runtime;
alter default privileges for role app_migrator in schema public
  grant select on sequences to backup_export;

revoke create on database postgres
  from app_migrator, integrity_audit, backup_export;
revoke create on schema public from integrity_audit, backup_export;

-- Read-only summary. LOGIN is expected to remain false until target and
-- privilege verification succeeds and IT performs the credential step.
select
  rolname,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolreplication,
  rolbypassrls,
  rolcanlogin,
  rolconnlimit
from pg_roles
where rolname in ('app_migrator', 'integrity_audit', 'backup_export')
order by rolname;
