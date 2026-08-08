-- Preserve explicit manual attribution when a professor revises generated
-- content. The legacy fallback still classifies generated snapshots when no
-- creation method was supplied by an application transaction.

create or replace function app_prepare_question_version_lifecycle_fields()
returns trigger
language plpgsql
as $$
declare
  requested_creation_method text;
begin
  requested_creation_method := nullif(
    current_setting('app.current_creation_method', true),
    ''
  );
  if requested_creation_method is not null then
    new.creation_method := requested_creation_method;
    new.schema_version := 2;
  end if;

  if new.content_sha256 is null then
    new.content_sha256 := encode(
      sha256(
        convert_to(
          (
            new.snapshot_json - array[
              'reviewStatus',
              'visibility',
              'trustLevel',
              'reviewPriority',
              'reviewNotes',
              'reviewedByUserId',
              'reviewedAt',
              'archivedAt'
            ]::text[]
          )::text,
          'UTF8'
        )
      ),
      'hex'
    );
  end if;

  if requested_creation_method is null
    and new.creation_method = 'manual'
    and new.snapshot_json ->> 'sourceType' in (
      'generated_original',
      'pattern_derived_original'
    )
  then
    new.creation_method := 'generated';
  end if;

  return new;
end;
$$;
