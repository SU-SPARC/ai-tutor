-- Question figures exist only at question_versions.snapshot_json.figure.
-- Existing immutable snapshots and migrations are never rewritten; a version
-- without a figure simply has no "figure" key and reads back as SQL null.

-- Append a derived column without changing any existing column or visibility predicate.
do $$
declare view_name text; definition text;
begin
  foreach view_name in array array['app_question_version_content', 'app_public_questions', 'app_review_queue_questions', 'app_reserve_practice_questions'] loop
    select pg_get_viewdef(view_name::regclass, true) into definition;
    definition := regexp_replace(definition, ';[[:space:]]*$', '');
    execute format('create or replace view %I as select existing.*, qv.snapshot_json -> ''figure'' as figure_json from (%s) existing join question_versions qv on qv.id = existing.question_version_id', view_name, definition);
    execute format('alter view %I set (security_invoker = true)', view_name);
  end loop;
end;
$$;
