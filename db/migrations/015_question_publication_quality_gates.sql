-- Reject publication unless the immutable question version passes every
-- public-content quality gate. The application returns structured reasons;
-- these triggers are the final boundary for direct procedure or SQL callers.

create or replace function app_publication_json_item_text(item jsonb)
returns text
language sql
immutable
as $$
  select case jsonb_typeof(item)
    when 'string' then item #>> '{}'
    when 'object' then item ->> 'body'
    else null
  end;
$$;

create or replace function app_publication_numeric_answer_matches(
  raw_answer text,
  numeric_value double precision,
  tolerance_value double precision
)
returns boolean
language plpgsql
immutable
as $$
declare
  normalized text;
  parsed_value double precision;
  fraction_parts text[];
begin
  normalized := replace(replace(btrim(raw_answer), ',', ''), '$', '');
  if normalized ~ '^[-+]?[0-9]+([.][0-9]+)?%$' then
    parsed_value := left(normalized, -1)::double precision / 100;
  elsif normalized ~ '^[-+]?[0-9]+([.][0-9]+)?[[:space:]]*/[[:space:]]*[-+]?[0-9]+([.][0-9]+)?$' then
    fraction_parts := regexp_split_to_array(normalized, '[[:space:]]*/[[:space:]]*');
    if fraction_parts[2]::double precision = 0 then
      return false;
    end if;
    parsed_value := fraction_parts[1]::double precision
      / fraction_parts[2]::double precision;
  elsif normalized ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
    parsed_value := normalized::double precision;
  else
    return false;
  end if;
  return abs(parsed_value - numeric_value) <= greatest(tolerance_value, 0.000000001);
end;
$$;

create or replace function app_question_publication_gate_failures(
  target_question_id text,
  target_question_version_id bigint,
  target_review_state text
)
returns table (code text, message text)
language plpgsql
stable
as $$
declare
  snapshot jsonb;
  generation_metadata jsonb;
  accepted_answers jsonb;
  solution_steps jsonb;
  hints jsonb;
  numeric_value double precision;
  tolerance_value double precision;
  source_type_value text;
  trust_level_value text;
begin
  select
    qv.snapshot_json,
    qv.generation_metadata_json,
    qv.snapshot_json -> 'acceptedAnswers',
    qv.snapshot_json -> 'solutionSteps',
    qv.snapshot_json -> 'hints',
    case when jsonb_typeof(qv.snapshot_json -> 'numericValue') = 'number'
      then (qv.snapshot_json ->> 'numericValue')::double precision
      else null
    end,
    case when jsonb_typeof(qv.snapshot_json -> 'tolerance') = 'number'
      then (qv.snapshot_json ->> 'tolerance')::double precision
      else 0.000000001
    end,
    qv.snapshot_json ->> 'sourceType',
    qv.snapshot_json ->> 'trustLevel'
  into
    snapshot,
    generation_metadata,
    accepted_answers,
    solution_steps,
    hints,
    numeric_value,
    tolerance_value,
    source_type_value,
    trust_level_value
  from question_versions qv
  where qv.id = target_question_version_id
    and qv.question_id = target_question_id;

  if snapshot is null then
    return query select
      'deterministic_validation_failed',
      'The immutable question version could not be validated.';
    return;
  end if;

  if not exists (
    select 1 from topics t
    where t.id = snapshot ->> 'topicId' and t.is_active = true
  ) then
    return query select
      'invalid_syllabus_topic',
      'The question must reference an active syllabus topic.';
  end if;

  if nullif(btrim(snapshot ->> 'prompt'), '') is null then
    return query select
      'missing_question_text',
      'Question text is required before publication.';
  end if;

  if jsonb_typeof(accepted_answers) is distinct from 'array'
    or jsonb_array_length(
      case when jsonb_typeof(accepted_answers) = 'array'
        then accepted_answers else '[]'::jsonb end
    ) = 0
    or not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(accepted_answers) = 'array'
          then accepted_answers else '[]'::jsonb end
      ) answer
      where nullif(btrim(app_publication_json_item_text(answer)), '') is not null
    )
  then
    return query select
      'missing_final_answer',
      'At least one non-empty final answer is required.';
  end if;

  if jsonb_typeof(accepted_answers) is distinct from 'array'
    or nullif(btrim(snapshot ->> 'answerExplanation'), '') is null
    or exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(accepted_answers) = 'array'
          then accepted_answers else '[]'::jsonb end
      ) answer
      where nullif(btrim(app_publication_json_item_text(answer)), '') is null
    )
    or (
      snapshot ->> 'numericValue' is not null
      and (
        jsonb_typeof(snapshot -> 'numericValue') <> 'number'
        or (
          snapshot ->> 'tolerance' is not null
          and (
            jsonb_typeof(snapshot -> 'tolerance') <> 'number'
            or tolerance_value < 0
          )
        )
        or not exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(accepted_answers) = 'array'
              then accepted_answers else '[]'::jsonb end
          ) answer
          where app_publication_numeric_answer_matches(
            app_publication_json_item_text(answer),
            numeric_value,
            tolerance_value
          )
        )
      )
    )
    or (
      snapshot ->> 'tolerance' is not null
      and snapshot ->> 'numericValue' is null
    )
  then
    return query select
      'invalid_answer_schema',
      'The final answer does not satisfy the required answer schema.';
  end if;

  if jsonb_typeof(solution_steps) is distinct from 'array'
    or jsonb_array_length(
      case when jsonb_typeof(solution_steps) = 'array'
        then solution_steps else '[]'::jsonb end
    ) = 0
    or not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(solution_steps) = 'array'
          then solution_steps else '[]'::jsonb end
      ) step
      where nullif(btrim(app_publication_json_item_text(step)), '') is not null
    )
  then
    return query select
      'missing_solution_steps',
      'At least one non-empty solution step is required.';
  end if;

  if jsonb_typeof(hints) is distinct from 'array'
    or not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(hints) = 'array'
          then hints else '[]'::jsonb end
      ) hint
      where char_length(btrim(app_publication_json_item_text(hint))) >= 8
        and btrim(app_publication_json_item_text(hint)) !~* '^(the[[:space:]]+)?(final[[:space:]]+)?answer[[:space:]]+is'
        and lower(regexp_replace(btrim(app_publication_json_item_text(hint)), '[[:space:]]+', ' ', 'g'))
          <> lower(regexp_replace(btrim(coalesce(snapshot ->> 'prompt', '')), '[[:space:]]+', ' ', 'g'))
        and lower(regexp_replace(btrim(app_publication_json_item_text(hint)), '[[:space:]]+', ' ', 'g'))
          <> lower(regexp_replace(btrim(coalesce(snapshot ->> 'answerExplanation', '')), '[[:space:]]+', ' ', 'g'))
        and not exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(accepted_answers) = 'array'
              then accepted_answers else '[]'::jsonb end
          ) answer
          where lower(btrim(app_publication_json_item_text(answer)))
            = lower(btrim(app_publication_json_item_text(hint)))
        )
        and not exists (
          select 1 from jsonb_array_elements(
            case when jsonb_typeof(solution_steps) = 'array'
              then solution_steps else '[]'::jsonb end
          ) step
          where lower(regexp_replace(btrim(app_publication_json_item_text(step)), '[[:space:]]+', ' ', 'g'))
            = lower(regexp_replace(btrim(app_publication_json_item_text(hint)), '[[:space:]]+', ' ', 'g'))
        )
    )
  then
    return query select
      'missing_required_hint',
      'At least one useful hint is required before publication.';
  end if;

  if (snapshot || jsonb_build_object('generationMetadata', generation_metadata))::text
      ~* '"(answerKey|embedding|embeddings|extractedText|locator|page|pageNumber|privateNotes|privatePrompt|promptTemplate|rawText|sourceId|sourceIds|sourceLocator|sourceMetadata|sourcePage|sourceText|textbookText)"[[:space:]]*:'
    or coalesce(snapshot ->> 'originalityNote', '')
      ~* '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number)'
  then
    return query select
      'forbidden_private_source_metadata',
      'Forbidden private-source metadata cannot be published.';
  end if;

  if snapshot ->> 'visibility' is distinct from 'public'
    or nullif(btrim(snapshot ->> 'originalityNote'), '') is null
    or source_type_value is null
    or trust_level_value is null
    or source_type_value = 'private_reference_pattern'
    or trust_level_value = 'private_reference'
    or (
      source_type_value in ('generated_original', 'pattern_derived_original')
      and trust_level_value not in ('generated_unverified', 'professor_approved')
    )
    or (
      source_type_value in ('original_demo', 'professor_provided')
      and trust_level_value not in ('public_original', 'course_approved', 'professor_approved')
    )
    or source_type_value not in (
      'original_demo', 'professor_provided',
      'generated_original', 'pattern_derived_original'
    )
    or (
      source_type_value = 'pattern_derived_original'
      and nullif(btrim(snapshot ->> 'patternId'), '') is null
    )
  then
    return query select
      'invalid_source_classification',
      'The source classification or originality evidence is invalid.';
  end if;

  if snapshot ->> 'id' is distinct from target_question_id
    or exists (
      select 1
      from question_versions duplicate_version
      where duplicate_version.question_id <> target_question_id
        and duplicate_version.legacy_audit_only = false
        and duplicate_version.snapshot_json ->> 'id' = snapshot ->> 'id'
    )
  then
    return query select
      'duplicate_question_id',
      'The immutable version must retain a unique stable question ID.';
  end if;

  if target_review_state is null
    or target_review_state not in ('approved', 'unpublished')
  then
    return query select
      'invalid_review_state',
      'Only an approved or previously unpublished version can be published.';
  end if;

  if not exists (
    select 1
    from question_versions qv
    join question_version_lifecycle qvl on qvl.question_version_id = qv.id
    where qv.id = target_question_version_id
      and qv.question_id = target_question_id
      and qvl.validation_status = 'valid'
      and qv.schema_version = 2
      and qv.content_sha256 ~ '^[0-9a-f]{64}$'
      and qv.content_sha256 = encode(
        sha256(
          convert_to(
            (
              qv.snapshot_json - array[
                'reviewStatus', 'visibility', 'trustLevel',
                'reviewPriority', 'reviewNotes', 'reviewedByUserId',
                'reviewedAt', 'archivedAt'
              ]::text[]
            )::text,
            'UTF8'
          )
        ),
        'hex'
      )
      and nullif(btrim(qv.snapshot_json ->> 'title'), '') is not null
      and qv.snapshot_json ->> 'difficulty' in (
        'foundational', 'intermediate', 'challenge'
      )
  ) then
    return query select
      'deterministic_validation_failed',
      'The immutable version failed deterministic schema or content-hash validation.';
  end if;

  if not (
    exists (
      select 1
      from question_lifecycle_events approval
      where approval.question_id = target_question_id
        and approval.question_version_id = target_question_version_id
        and approval.action = 'approve'
        and approval.actor_role = 'professor'
    )
    or exists (
      select 1
      from question_approval_history legacy_approval
      join users reviewer on reviewer.id = legacy_approval.reviewer_user_id
      where legacy_approval.question_id = target_question_id
        and legacy_approval.question_version_id = target_question_version_id
        and legacy_approval.decision = 'approved'
        and reviewer.user_type <> 'system'
        and exists (
          select 1
          from user_roles reviewer_role
          where reviewer_role.user_id = reviewer.id
            and reviewer_role.role_id = 'professor'
        )
    )
    or exists (
      select 1
      from questions legacy_question
      join question_versions first_version
        on first_version.id = target_question_version_id
       and first_version.question_id = legacy_question.id
       and first_version.version_number = 1
      join users reviewer on reviewer.id = legacy_question.reviewed_by_user_id
      where legacy_question.id = target_question_id
        and legacy_question.review_status = 'approved'
        and legacy_question.reviewed_at is not null
        and reviewer.user_type <> 'system'
        and exists (
          select 1
          from user_roles reviewer_role
          where reviewer_role.user_id = reviewer.id
            and reviewer_role.role_id = 'professor'
        )
    )
  ) then
    return query select
      'professor_approval_missing',
      'An immutable professor approval for this exact version is required.';
  end if;
end;
$$;

create or replace function app_assert_question_publication_quality(
  target_question_id text,
  target_question_version_id bigint,
  target_review_state text
)
returns void
language plpgsql
as $$
declare
  failures text;
begin
  select string_agg(gate.code || ': ' || gate.message, '; ' order by gate.code)
  into failures
  from app_question_publication_gate_failures(
    target_question_id,
    target_question_version_id,
    target_review_state
  ) gate;

  if failures is not null then
    raise exception 'Publication blocked: %', failures
      using errcode = '23514';
  end if;
end;
$$;

create or replace function app_guard_published_question_quality()
returns trigger
language plpgsql
as $$
declare
  current_state text;
begin
  if new.published_version_id is not null
    and new.published_version_id is distinct from old.published_version_id
  then
    select qvl.state into current_state
    from question_version_lifecycle qvl
    where qvl.question_version_id = new.published_version_id;

    if current_state = 'published' then
      select coalesce(qv.snapshot_json ->> 'reviewStatus', current_state)
      into current_state
      from question_versions qv
      where qv.id = new.published_version_id;
    end if;

    perform app_assert_question_publication_quality(
      new.id,
      new.published_version_id,
      current_state
    );
  end if;
  return new;
end;
$$;

create trigger questions_03_publication_quality_gate
before update of published_version_id on questions
for each row execute function app_guard_published_question_quality();

create or replace function app_guard_published_version_quality()
returns trigger
language plpgsql
as $$
declare
  previous_state text;
begin
  if new.state = 'published'
    and old.state <> 'published'
  then
    previous_state := old.state;
    perform app_assert_question_publication_quality(
      new.question_id,
      new.question_version_id,
      previous_state
    );
  end if;
  return new;
end;
$$;

create trigger question_version_lifecycle_02_publication_quality_gate
before update of state on question_version_lifecycle
for each row execute function app_guard_published_version_quality();
