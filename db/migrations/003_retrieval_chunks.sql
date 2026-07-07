-- Server-side retrieval chunks.
--
-- Public rows must be public-safe. Private reference rows in this table store
-- only reviewed summaries; raw private book text remains in ignored private
-- storage or a stricter server-only store outside public APIs.

create table if not exists retrieval_chunks (
  id text primary key,
  topic_id text not null references topics(id),
  question_id text references questions(id) on delete set null,
  chunk_type text not null check (
    chunk_type in (
      'concept',
      'example',
      'formula',
      'hint',
      'misconception',
      'pattern',
      'question',
      'solution_step',
      'solution_summary'
    )
  ),
  title text not null,
  body text not null default '',
  llm_safe_summary text,
  keywords_json jsonb not null default '[]'::jsonb,
  formula_refs_json jsonb not null default '[]'::jsonb,
  concept_tags_json jsonb not null default '[]'::jsonb,
  difficulty text check (
    difficulty in ('foundational', 'intermediate', 'challenge')
  ),
  source_type text not null check (
    source_type in (
      'original_demo',
      'professor_provided',
      'generated_original',
      'pattern_derived_original',
      'private_reference_pattern'
    )
  ),
  trust_level text not null check (
    trust_level in (
      'public_original',
      'professor_approved',
      'course_approved',
      'generated_unverified',
      'private_reference'
    )
  ),
  review_status text not null check (
    review_status in (
      'approved',
      'needs_review',
      'rejected',
      'needs_edit',
      'needs_regeneration'
    )
  ),
  visibility text not null check (visibility in ('public', 'private')),
  priority_tier text not null check (
    priority_tier in (
      'approved_professor_course',
      'approved_generated',
      'private_reference',
      'safe_demo',
      'admin_dev_draft'
    )
  ),
  embedding_model text,
  content_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retrieval_chunks_private_summary_only check (
    visibility <> 'private'
    or (body = '' and llm_safe_summary is not null)
  ),
  constraint retrieval_chunks_generated_defaults check (
    trust_level <> 'generated_unverified'
    or (review_status in ('needs_review', 'needs_edit', 'needs_regeneration')
        and priority_tier = 'admin_dev_draft')
  ),
  constraint retrieval_chunks_no_private_source_signals check (
    concat_ws(
      ' ',
      title,
      case when visibility = 'public' then body else '' end,
      llm_safe_summary
    ) !~*
      '(source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|textbook page)'
  )
);

create or replace view app_student_retrieval_chunks as
select
  rc.id,
  rc.topic_id,
  rc.question_id,
  rc.chunk_type,
  rc.title,
  case when rc.visibility = 'private' then rc.llm_safe_summary else rc.body end as body,
  rc.llm_safe_summary,
  rc.keywords_json,
  rc.formula_refs_json,
  rc.concept_tags_json,
  rc.difficulty,
  rc.source_type,
  rc.trust_level,
  rc.review_status,
  rc.visibility,
  rc.priority_tier,
  rc.embedding_model,
  rc.content_hash,
  case rc.priority_tier
    when 'approved_professor_course' then 1
    when 'approved_generated' then 2
    when 'private_reference' then 3
    when 'safe_demo' then 4
    else 5
  end as priority_rank
from retrieval_chunks rc
where rc.review_status = 'approved'
  and rc.trust_level <> 'generated_unverified'
  and (
    (
      rc.visibility = 'public'
      and rc.trust_level in ('public_original', 'professor_approved', 'course_approved')
    )
    or (
      rc.visibility = 'private'
      and rc.source_type = 'private_reference_pattern'
      and rc.trust_level = 'private_reference'
      and rc.llm_safe_summary is not null
    )
  );

create or replace view app_admin_retrieval_chunks as
select
  rc.id,
  rc.topic_id,
  rc.question_id,
  rc.chunk_type,
  rc.title,
  case when rc.visibility = 'private' then rc.llm_safe_summary else rc.body end as body,
  rc.llm_safe_summary,
  rc.keywords_json,
  rc.formula_refs_json,
  rc.concept_tags_json,
  rc.difficulty,
  rc.source_type,
  rc.trust_level,
  rc.review_status,
  rc.visibility,
  rc.priority_tier,
  rc.embedding_model,
  rc.content_hash,
  case rc.priority_tier
    when 'approved_professor_course' then 1
    when 'approved_generated' then 2
    when 'private_reference' then 3
    when 'safe_demo' then 4
    else 5
  end as priority_rank
from retrieval_chunks rc
where (
    rc.review_status = 'approved'
    and rc.trust_level <> 'generated_unverified'
  )
  or (
    rc.trust_level = 'generated_unverified'
    and rc.review_status in ('needs_review', 'needs_edit', 'needs_regeneration')
  );

create index if not exists retrieval_chunks_student_idx
  on retrieval_chunks (topic_id, review_status, trust_level, visibility, priority_tier);

create index if not exists retrieval_chunks_question_idx
  on retrieval_chunks (question_id);

create index if not exists retrieval_chunks_content_hash_idx
  on retrieval_chunks (content_hash, embedding_model);
