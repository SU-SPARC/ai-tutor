-- Topic windows close a week without hiding it.
--
-- Before this migration a topic's topic_student_availability.available_until
-- ("Hide after" in the professor dialog) removed the topic and every question
-- in it from students once it passed. A week's end date now only *closes* the
-- week: the topic stays listed, its published questions (and eligible Reserve
-- practice and retrieval chunks) stay available, and the application labels
-- it as closed. Everything else is unchanged:
--   * topic available_from still hides the topic until it arrives;
--   * topic release_state unpublished/archived still hides it;
--   * a question's own question_student_availability.available_until still
--     hides that question once it passes.
--
-- Each view is redefined from its current catalog definition (preserving the
-- figure_json / answer_spec_json columns appended by 024 and 028 and their
-- order) with only the topic-level available_until predicate removed. The
-- block aborts if the predicate is not found exactly once per view or if the
-- question-level available_until predicates would change.

do $$
declare
  view_name text;
  definition text;
  rewritten text;
  topic_until_pattern constant text :=
    '[[:space:]]+and[[:space:]]+\([[:space:]]*tsa\.available_until[[:space:]]+is[[:space:]]+null[[:space:]]+or[[:space:]]+tsa\.available_until[[:space:]]*>[[:space:]]*statement_timestamp\(\)[[:space:]]*\)';
  question_until_pattern constant text :=
    'qsa\.available_until[[:space:]]+is[[:space:]]+null[[:space:]]+or[[:space:]]+qsa\.available_until[[:space:]]*>[[:space:]]*statement_timestamp\(\)';
  topic_matches integer;
  question_matches_before integer;
  question_matches_after integer;
begin
  foreach view_name in array array[
    'app_public_questions',
    'app_student_retrieval_chunks',
    'app_reserve_practice_questions'
  ] loop
    select pg_get_viewdef(view_name::regclass, true) into definition;
    definition := regexp_replace(definition, ';[[:space:]]*$', '');

    select count(*) into topic_matches
    from regexp_matches(definition, topic_until_pattern, 'gi');
    if topic_matches <> 1 then
      raise exception
        'migration 030: expected exactly one topic available_until predicate in %, found %',
        view_name, topic_matches;
    end if;

    select count(*) into question_matches_before
    from regexp_matches(definition, question_until_pattern, 'gi');

    rewritten := regexp_replace(definition, topic_until_pattern, '', 'gi');

    select count(*) into question_matches_after
    from regexp_matches(rewritten, question_until_pattern, 'gi');
    if question_matches_after <> question_matches_before
      or question_matches_before < 1 then
      raise exception
        'migration 030: question available_until predicates changed in % (% -> %)',
        view_name, question_matches_before, question_matches_after;
    end if;
    if rewritten ~* 'tsa\.available_until' then
      raise exception
        'migration 030: topic available_until reference remains in %',
        view_name;
    end if;

    execute format('create or replace view %I as %s', view_name, rewritten);
    execute format('alter view %I set (security_invoker = true)', view_name);
    execute format('revoke all privileges on %I from public', view_name);
  end loop;
end;
$$;

do $$
declare
  data_api_role text;
  view_name text;
begin
  foreach data_api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = data_api_role) then
      foreach view_name in array array[
        'app_public_questions',
        'app_student_retrieval_chunks',
        'app_reserve_practice_questions'
      ] loop
        execute format(
          'revoke all privileges on %I from %I',
          view_name,
          data_api_role
        );
      end loop;
    end if;
  end loop;
end;
$$;
