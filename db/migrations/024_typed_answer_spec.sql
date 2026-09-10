-- Typed configuration exists only at question_versions.snapshot_json.answer.spec.
-- Existing immutable snapshots and migrations are never rewritten.

-- Bounded recursive descent over pre-tokenized numeric literals. Values retain
-- double operation order solely for the legacy publication safety check.
create function app_answer_parse_tokens(tokens text[], start_at integer, depth integer default 0)
returns table (value double precision, next_at integer)
language plpgsql immutable as $$
declare p integer := start_at; sign_value integer := 1; a double precision; b double precision; r record;
begin
  if depth > 64 or p > cardinality(tokens) then return; end if;
  if tokens[p] in ('-', '+') then
    if tokens[p] = '-' then sign_value := -1; end if;
    p := p + 1;
  end if;
  if left(tokens[p], 1) = 'n' then
    a := substring(tokens[p] from 2)::double precision;
    p := p + 1;
  elsif tokens[p] = 'frac' then
    p := p + 1;
    if tokens[p] is distinct from '{' then return; end if;
    select * into r from app_answer_parse_tokens(tokens, p + 1, depth + 1);
    if r.value is null or tokens[r.next_at] is distinct from '}' or tokens[r.next_at + 1] is distinct from '{' then return; end if;
    a := r.value;
    select * into r from app_answer_parse_tokens(tokens, r.next_at + 2, depth + 1);
    if r.value is null or r.value = 0 or tokens[r.next_at] is distinct from '}' then return; end if;
    a := a / r.value;
    p := r.next_at + 1;
  else return;
  end if;
  a := a * sign_value;
  if tokens[p] = '/' then
    p := p + 1; sign_value := 1;
    if tokens[p] in ('-', '+') then
      if tokens[p] = '-' then sign_value := -1; end if;
      p := p + 1;
    end if;
    -- A denominator is a primary, not an unrestricted expression.
    if left(tokens[p], 1) = 'n' then
      b := substring(tokens[p] from 2)::double precision * sign_value; p := p + 1;
    elsif tokens[p] = 'frac' then
      if tokens[p + 1] is distinct from '{' then return; end if;
      select * into r from app_answer_parse_tokens(tokens, p + 2, depth + 1);
      if r.value is null or tokens[r.next_at] is distinct from '}' or tokens[r.next_at + 1] is distinct from '{' then return; end if;
      b := r.value;
      select * into r from app_answer_parse_tokens(tokens, r.next_at + 2, depth + 1);
      if r.value is null or r.value = 0 or tokens[r.next_at] is distinct from '}' then return; end if;
      b := b / r.value * sign_value; p := r.next_at + 1;
    else return;
    end if;
    if b = 0 then return; end if;
    a := a / b;
  end if;
  if tokens[p] = '%' then a := a / 100; p := p + 1; end if;
  return query select a, p;
exception when numeric_value_out_of_range or division_by_zero or invalid_text_representation then return;
end;
$$;

create function app_answer_number(raw_answer text, strip_currency boolean default false)
returns double precision language plpgsql immutable as $number$
declare s text; tokens text[] := '{}'; p integer := 1; start_at integer; literal text; mantissa text; exponent text; ch text; r record;
begin
  if raw_answer is null or length(raw_answer) > 500 then return null; end if;
  -- Normalize whitespace without joining tokens (1 2 must remain invalid).
  s := btrim(regexp_replace(raw_answer, U&'[[:space:]\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]', ' ', 'g'));
  if length(s) >= 4 and ((left(s, 2) = E'\\(' and right(s, 2) = E'\\)') or (left(s, 2) = E'\\[' and right(s, 2) = E'\\]') or (left(s, 2) = '$$' and right(s, 2) = '$$')) then
    s := btrim(substring(s from 3 for length(s) - 4));
  elsif left(s, 1) = '$' and right(s, 1) = '$' and length(s) >= 2 then
    s := btrim(substring(s from 2 for length(s) - 2));
  end if;
  if left(s, 6) = E'\\text{' and right(s, 1) = '}' then s := substring(s from 7 for length(s) - 7); end if;
  if strip_currency and left(s, 1) = '$' then s := substring(s from 2); end if;
  while p <= length(s) loop
    ch := substring(s from p for 1);
    if ch ~ '^[[:space:]]$' then p := p + 1; continue; end if;
    if cardinality(tokens) >= 64 then return null; end if;
    if ch ~ '^[0-9.]$' then
      start_at := p;
      while substring(s from p for 1) ~ '^[0-9.,]$' loop p := p + 1; end loop;
      mantissa := substring(s from start_at for p - start_at);
      if not (mantissa ~ '^[0-9]+([.][0-9]+)?$' or mantissa ~ '^[.][0-9]+$' or mantissa ~ '^[0-9]{1,3}(,[0-9]{3})+([.][0-9]+)?$') then return null; end if;
      if lower(substring(s from p for 1)) = 'e' then
        p := p + 1;
        if substring(s from p for 1) in ('+', '-') then p := p + 1; end if;
        literal := substring(s from start_at for p - start_at);
        start_at := p;
        while substring(s from p for 1) ~ '^[0-9]$' loop p := p + 1; end loop;
        exponent := substring(s from start_at for p - start_at);
        if exponent = '' or length(exponent) > 32 or exponent::numeric > 30 then return null; end if;
        literal := literal || exponent;
      else literal := mantissa;
      end if;
      if length(regexp_replace(literal, '[^0-9]', '', 'g')) > 32 then return null; end if;
      tokens := array_append(tokens, 'n' || replace(literal, ',', ''));
    elsif ch in ('+', '-', '/', '{', '}', '%') then tokens := array_append(tokens, ch); p := p + 1;
    elsif ch in ('½', '¼', '¾') then tokens := array_append(tokens, case ch when '½' then 'n0.5' when '¼' then 'n0.25' else 'n0.75' end); p := p + 1;
    elsif substring(s from p for 2) = E'\\%' then tokens := array_append(tokens, '%'); p := p + 2;
    elsif substring(s from p for 5) = E'\\frac' then tokens := array_append(tokens, 'frac'); p := p + 5;
    elsif substring(s from p for 6) in (E'\\dfrac', E'\\tfrac') then tokens := array_append(tokens, 'frac'); p := p + 6;
    elsif substring(s from p for 7) = 'percent' then tokens := array_append(tokens, '%'); p := p + 7;
    else return null;
    end if;
  end loop;
  select * into r from app_answer_parse_tokens(tokens, 1);
  if r.next_at is distinct from cardinality(tokens) + 1 or r.value::text in ('Infinity', '-Infinity', 'NaN') then return null; end if;
  return r.value;
exception when numeric_value_out_of_range or invalid_text_representation then return null;
end;
$number$;

create or replace function app_publication_numeric_answer_matches(raw_answer text, numeric_value double precision, tolerance_value double precision)
returns boolean language sql immutable as $$
  select coalesce(abs(app_answer_number(raw_answer, true) - numeric_value) <= greatest(tolerance_value, 0.000000001), false);
$$;

create function app_answer_spec_failures(spec jsonb)
returns table(code text, message text) language plpgsql immutable as $spec$
declare kind text := spec->>'kind'; t jsonb := spec->'tolerance'; m text := t->>'mode'; item jsonb; number_value double precision; relative_value numeric := 0; absolute_value numeric := 0; label_count integer; fields text[];
begin
  if jsonb_typeof(spec) is distinct from 'object' or kind is null or kind not in ('numeric', 'categorical', 'number_list') then
    return query select 'invalid_answer_spec', 'Unknown typed answer structure.'; return;
  end if;
  fields := case kind when 'numeric' then array['kind','value','domain','percentMode','tolerance','requiredForm','formPolicy','unit'] when 'categorical' then array['kind','canonical','aliases','forbiddenTerms'] else array['kind','values','ordered','labels','tolerance'] end;
  if exists (select 1 from jsonb_object_keys(spec) k where not (k = any(fields))) then
    return query select 'invalid_answer_spec', 'Unsupported typed answer field.'; return;
  end if;
  if kind = 'categorical' then
    if jsonb_typeof(spec->'canonical') is distinct from 'string' or nullif(btrim(regexp_replace(spec->>'canonical', '[.,!?;:[:space:]]', '', 'g')), '') is null or length(spec->>'canonical') > 500 then
      return query select 'invalid_answer_spec', 'Categorical canonical answer is required.';
    end if;
    if jsonb_typeof(spec->'aliases') is distinct from 'array' then
      return query select 'categorical_alias_empty', 'Categorical aliases must be an array.'; return;
    end if;
    for item in select value from jsonb_array_elements(spec->'aliases') loop
      if jsonb_typeof(item) <> 'string' or nullif(btrim(regexp_replace(item #>> '{}', '[.,!?;:[:space:]]', '', 'g')), '') is null or length(item #>> '{}') > 500 then return query select 'categorical_alias_empty', 'Aliases must be nonempty bounded text.'; end if;
    end loop;
    if jsonb_array_length(spec->'aliases') > 32 then return query select 'invalid_answer_spec', 'Too many aliases.'; end if;
    if spec ? 'forbiddenTerms' then
      if jsonb_typeof(spec->'forbiddenTerms') <> 'array' then return query select 'invalid_answer_spec', 'Forbidden terms must be an array.'; return; end if;
      if jsonb_array_length(spec->'forbiddenTerms') > 32 or exists (select 1 from jsonb_array_elements(spec->'forbiddenTerms') a where jsonb_typeof(a) <> 'string' or nullif(btrim(regexp_replace(a #>> '{}', '[.,!?;:[:space:]]', '', 'g')), '') is null or length(a #>> '{}') > 500) then return query select 'invalid_answer_spec', 'Invalid forbidden terms.'; end if;
    end if;
    return;
  end if;
  if jsonb_typeof(t) is distinct from 'object' or m is null or m not in ('exact','absolute','relative','combined','decimals','significant') then
    return query select 'tolerance_out_of_bounds', 'Choose a supported tolerance.'; return;
  end if;
  fields := case m when 'exact' then array['mode'] when 'combined' then array['mode','absolute','relative'] when 'decimals' then array['mode','places'] when 'significant' then array['mode','digits'] else array['mode','value'] end;
  if exists (select 1 from jsonb_object_keys(t) k where not (k = any(fields))) then return query select 'tolerance_out_of_bounds', 'Unsupported tolerance field.'; return; end if;
  if m in ('absolute','relative','combined') then
    for item in select value from jsonb_each(t) where key <> 'mode' loop
      if jsonb_typeof(item) <> 'number' or item::text::numeric < 0 or item::text::numeric > 1e30 then return query select 'tolerance_out_of_bounds', 'Tolerance must be finite and nonnegative.'; return; end if;
    end loop;
    if (m in ('absolute','relative') and not t ? 'value') or (m = 'combined' and (not t ? 'absolute' or not t ? 'relative')) then return query select 'tolerance_out_of_bounds', 'Tolerance value is required.'; return; end if;
    absolute_value := case when m = 'absolute' then (t->>'value')::numeric when m = 'combined' then (t->>'absolute')::numeric else 0 end;
    relative_value := case when m = 'relative' then (t->>'value')::numeric when m = 'combined' then (t->>'relative')::numeric else 0 end;
  elsif m in ('decimals','significant') then
    item := case m when 'decimals' then t->'places' else t->'digits' end;
    if jsonb_typeof(item) is distinct from 'number' or item::text::numeric <> trunc(item::text::numeric) or item::text::numeric < (case m when 'decimals' then 0 else 1 end) or item::text::numeric > 15 then return query select 'tolerance_out_of_bounds', 'Invalid rounding precision.'; return; end if;
  end if;
  if kind = 'numeric' then
    if spec->>'percentMode' is null or spec->>'percentMode' not in ('decimal','percent','either') then return query select 'percent_mode_missing', 'Explicit percent mode is required.'; return; end if;
    if spec->>'domain' is null or spec->>'domain' not in ('probability','count','real') then return query select 'invalid_answer_spec', 'Numeric domain is required.'; end if;
    if spec ? 'unit' and (jsonb_typeof(spec->'unit') <> 'object' or jsonb_typeof(spec#>'{unit,label}') is distinct from 'string' or length(spec#>>'{unit,label}') not between 1 and 40 or spec#>>'{unit,label}' <> btrim(spec#>>'{unit,label}') or spec#>>'{unit,label}' !~ '^[[:alpha:]$€£¥°][[:alnum:] $€£¥°/²³-]*$' or jsonb_typeof(spec#>'{unit,required}') is distinct from 'boolean' or exists (select 1 from jsonb_object_keys(case when jsonb_typeof(spec->'unit') = 'object' then spec->'unit' else '{}'::jsonb end) k where k not in ('label','required'))) then return query select 'invalid_answer_spec', 'Invalid unit metadata.'; return; end if;
    if spec ? 'requiredForm' and (spec->>'requiredForm' is null or spec->>'requiredForm' not in ('decimal','fraction','simplified_fraction','percent','integer')) then return query select 'invalid_answer_spec', 'Invalid required form.'; end if;
    if spec ? 'formPolicy' and (spec->>'formPolicy' is null or spec->>'formPolicy' not in ('note','require')) then return query select 'invalid_answer_spec', 'Invalid form policy.'; end if;
    item := spec->'value';
    if jsonb_typeof(item) = 'string' then
      declare raw text := btrim(regexp_replace(item #>> '{}', U&'[[:space:]\00a0\1680\2000-\200a\2028\2029\202f\205f\3000\feff]', ' ', 'g')); begin
        if length(raw) >= 4 and ((left(raw,2) = E'\\(' and right(raw,2) = E'\\)') or (left(raw,2) = E'\\[' and right(raw,2) = E'\\]') or (left(raw,2) = '$$' and right(raw,2) = '$$')) then raw := btrim(substring(raw from 3 for length(raw)-4));
        elsif left(raw,1) = '$' and right(raw,1) = '$' and length(raw) >= 2 then raw := btrim(substring(raw from 2 for length(raw)-2)); end if;
        if left(raw,6) = E'\\text{' and right(raw,1) = '}' then raw := btrim(substring(raw from 7 for length(raw)-7)); end if;
        item := to_jsonb(raw);
      end;
    end if;
    -- Canonical unit removal is literal and authorized by the spec only.
    if spec ? 'unit' and jsonb_typeof(item) = 'string' then
      if starts_with(btrim(item #>> '{}'), spec#>>'{unit,label}') then item := to_jsonb(btrim(substring(btrim(item #>> '{}') from length(spec#>>'{unit,label}') + 1)));
      elsif right(btrim(item #>> '{}'), length(spec#>>'{unit,label}')) = spec#>>'{unit,label}' then item := to_jsonb(btrim(left(btrim(item #>> '{}'), length(btrim(item #>> '{}')) - length(spec#>>'{unit,label}')))); end if;
    end if;
    number_value := case when jsonb_typeof(item) = 'string' then app_answer_number(item #>> '{}') else null end;
    if spec->>'percentMode' = 'percent' and right(btrim(item #>> '{}'), 1) <> '%' and right(btrim(item #>> '{}'), 7) <> 'percent' then number_value := number_value / 100; end if;
    if number_value is null then return query select 'answer_value_unparseable', 'Canonical value must parse.'; return; end if;
    if number_value = 0 and m in ('relative','significant') then return query select 'tolerance_out_of_bounds', 'Relative/significant tolerance requires nonzero expected value.'; end if;
    if spec->>'domain' = 'count' and (m <> 'exact' or trunc(number_value::numeric) <> number_value) then return query select 'tolerance_out_of_bounds', 'Counts require exact integer answers.'; end if;
    if m = 'decimals' then absolute_value := 0.5 * power(10::numeric, -(t->>'places')::integer); end if;
    if m = 'significant' and number_value <> 0 then absolute_value := 0.5 * power(10::numeric, floor(log(10::numeric, abs(number_value::numeric))) - (t->>'digits')::integer + 1); end if;
    if spec->>'domain' = 'probability' then
      if number_value < 0 or number_value > 1 then return query select 'invalid_answer_spec', 'Expected probability must lie in [0,1].'; end if;
      if absolute_value > 0.01 or relative_value > 0.02 then return query select 'tolerance_out_of_bounds', 'Probability tolerance exceeds bounds.'; end if;
    end if;
    if spec->>'requiredForm' = 'percent' and spec->>'percentMode' = 'decimal' then return query select 'required_form_unsatisfiable', 'Decimal-only mode cannot require percent form.'; end if;
    if spec->>'requiredForm' = 'integer' and trunc(number_value::numeric) <> number_value then return query select 'required_form_unsatisfiable', 'Expected value is not an integer.'; end if;
  else
    if jsonb_typeof(spec->'values') is distinct from 'array' or jsonb_typeof(spec->'ordered') is distinct from 'boolean' then return query select 'invalid_answer_spec', 'Lists require values and an ordered flag.'; return; end if;
    if jsonb_array_length(spec->'values') not between 1 and 32 then return query select 'invalid_answer_spec', 'Lists require 1–32 values.'; end if;
    for item in select value from jsonb_array_elements(spec->'values') loop
      number_value := case when jsonb_typeof(item) = 'string' then app_answer_number(item #>> '{}') else null end;
      if number_value is null then return query select 'answer_value_unparseable', 'Every list value must parse.'; end if;
      if number_value = 0 and m in ('relative','significant') then return query select 'tolerance_out_of_bounds', 'Relative/significant tolerance requires nonzero expected values.'; end if;
    end loop;
    if spec ? 'labels' then
      if jsonb_typeof(spec->'labels') <> 'array' then return query select 'invalid_answer_spec', 'Labels must be an array.'; return; end if;
      select count(distinct lower(regexp_replace(value #>> '{}', '[[:space:]]', '', 'g'))) into label_count from jsonb_array_elements(spec->'labels');
      if jsonb_array_length(spec->'labels') <> jsonb_array_length(spec->'values') or label_count <> jsonb_array_length(spec->'labels') or exists (select 1 from jsonb_array_elements(spec->'labels') a where jsonb_typeof(a) <> 'string' or length(a #>> '{}') not between 1 and 80 or nullif(regexp_replace(a #>> '{}', '[[:space:]]', '', 'g'), '') is null or a #>> '{}' !~ '^[A-Za-z0-9_().=[:space:]-]+$') then return query select 'invalid_answer_spec', 'Labels must be unique and correspond to values.'; end if;
    end if;
  end if;
exception when others then
  return query select 'invalid_answer_spec', 'Malformed typed answer configuration.';
end;
$spec$;

-- Append a derived column without changing any existing column or visibility predicate.
do $$
declare view_name text; definition text;
begin
  foreach view_name in array array['app_question_version_content', 'app_public_questions', 'app_review_queue_questions', 'app_reserve_practice_questions'] loop
    select pg_get_viewdef(view_name::regclass, true) into definition;
    definition := regexp_replace(definition, ';[[:space:]]*$', '');
    execute format('create or replace view %I as select existing.*, qv.snapshot_json #> ''{answer,spec}'' as answer_spec_json from (%s) existing join question_versions qv on qv.id = existing.question_version_id', view_name, definition);
    execute format('alter view %I set (security_invoker = true)', view_name);
  end loop;
end;
$$;

alter table attempts add column check_detail text,
  add constraint attempts_check_detail_check check (check_detail in ('close_rounding','percent_decimal_confusion','complement','unsimplified','wrong_form','missing_unit','unknown_token'));

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
  spec jsonb;
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

  spec := snapshot #> '{answer,spec}';
  if spec is not null then
    return query select * from app_answer_spec_failures(spec);
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
          where spec is not null or app_publication_numeric_answer_matches(
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

-- New routines contain no privileged access. Preserve the runtime role boundary.
do $$
declare signature text;
begin
  foreach signature in array array['app_answer_parse_tokens(text[],integer,integer)', 'app_answer_number(text,boolean)', 'app_answer_spec_failures(jsonb)'] loop
    execute 'revoke all on function ' || signature || ' from public';
    if exists (select 1 from pg_roles where rolname = 'app_runtime') then
      execute 'grant execute on function ' || signature || ' to app_runtime';
    end if;
  end loop;
end;
$$;
