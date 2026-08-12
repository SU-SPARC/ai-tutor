-- Keep application data behind the Next.js server authorization boundary.
--
-- Supabase grants its Data API roles broad privileges on objects created in
-- the public schema. Row-level security protects base tables, but PostgreSQL
-- views execute with their owner's permissions unless security_invoker is
-- enabled. That combination can expose professor review drafts or private
-- retrieval content through PostgREST even though the student application
-- never queries those views.

alter view app_admin_retrieval_chunks set (security_invoker = true);
alter view app_public_questions set (security_invoker = true);
alter view app_question_version_content set (security_invoker = true);
alter view app_review_queue_questions set (security_invoker = true);
alter view app_student_retrieval_chunks set (security_invoker = true);

-- The application uses a server-only PostgreSQL connection and does not use
-- Supabase's anon/authenticated Data API roles. Remove ambient PUBLIC access
-- and the provider-created role grants, including defaults for future objects.
revoke all privileges on schema public from public;
revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke all privileges on all functions in schema public from public;

alter default privileges in schema public
  revoke all privileges on tables from public;
alter default privileges in schema public
  revoke all privileges on sequences from public;
alter default privileges in schema public
  revoke all privileges on functions from public;

do $$
declare
  data_api_role text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (
      select 1 from pg_roles where rolname = data_api_role
    ) then
      execute format(
        'revoke all privileges on schema public from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on all tables in schema public from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on all sequences in schema public from %I',
        data_api_role
      );
      execute format(
        'revoke all privileges on all functions in schema public from %I',
        data_api_role
      );
      execute format(
        'alter default privileges in schema public revoke all privileges on tables from %I',
        data_api_role
      );
      execute format(
        'alter default privileges in schema public revoke all privileges on sequences from %I',
        data_api_role
      );
      execute format(
        'alter default privileges in schema public revoke all privileges on functions from %I',
        data_api_role
      );
    end if;
  end loop;
end;
$$;
