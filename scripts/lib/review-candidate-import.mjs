import { readFile } from "node:fs/promises";
import path from "node:path";

export const REVIEW_CANDIDATE_IMPORT_LOCK_ID = 7_241_903_207;

export const REVIEW_CANDIDATE_FILES = Object.freeze([
  "data/demo/generated-review-candidates.json",
  "data/demo/syllabus-review-candidates.json",
  "data/demo/next-syllabus-review-candidates.json",
  "data/demo/following-syllabus-review-candidates.json",
  "data/demo/next-uncovered-syllabus-review-candidates.json",
]);
const REVIEW_CANDIDATE_FILE_SET = new Set(REVIEW_CANDIDATE_FILES);

const TOPICS_FILE = "data/demo/topics.json";
const DIFFICULTIES = new Set(["foundational", "intermediate", "challenge"]);
const SOURCE_TYPES = new Set([
  "generated_original",
  "pattern_derived_original",
]);
const REVIEW_PRIORITIES = new Set(["normal", "priority"]);
const PRIVATE_FIELD_PATTERN =
  /(?:audit|extractedText|pageNumber|phraseHash|privateChunk|rawText|sourceItemId|sourceLocator|sourceNumber|sourceStory)/i;
const PRIVATE_TEXT_PATTERN =
  /source page|answer key|solution key|worked example|copied from|verbatim|raw extracted|private chunk|embedding|textbook page|professor-only|course pdf|private phrase|source number/i;

export class ReviewCandidateImportValidationError extends Error {
  constructor(issues) {
    super("Public review-candidate import validation failed.");
    this.name = "ReviewCandidateImportValidationError";
    this.issues = issues;
  }
}

export function resolveReviewCandidateDatabaseUrl(environment = process.env) {
  return (
    optionalEnvironmentValue(environment.DATABASE_URL) ??
    optionalEnvironmentValue(environment.POSTGRES_URL)
  );
}

export async function loadPublicReviewCandidateFixtures(repositoryRoot) {
  const topics = await readJson(path.join(repositoryRoot, TOPICS_FILE));
  const candidateGroups = await Promise.all(
    REVIEW_CANDIDATE_FILES.map(async (sourceFile) => ({
      candidates: await readJson(path.join(repositoryRoot, sourceFile)),
      sourceFile,
    })),
  );
  const fixtures = {
    candidates: candidateGroups.flatMap(({ candidates, sourceFile }) =>
      Array.isArray(candidates)
        ? candidates.map((candidate) => ({ candidate, sourceFile }))
        : [],
    ),
    topics,
  };

  validatePublicReviewCandidateFixtures(fixtures, candidateGroups);
  return fixtures;
}

export function validatePublicReviewCandidateFixtures(
  fixtures,
  candidateGroups = groupCandidatesBySource(fixtures.candidates),
) {
  const issues = [];
  const topicIds = validateTopics(fixtures.topics, issues);
  const candidateIds = new Set();
  const sourceFiles = new Set();

  for (const group of candidateGroups) {
    if (!REVIEW_CANDIDATE_FILE_SET.has(group.sourceFile)) {
      issues.push(`${group.sourceFile} is not an allowed public fixture file.`);
    }
    if (sourceFiles.has(group.sourceFile)) {
      issues.push(`${group.sourceFile} must be loaded exactly once.`);
    }
    sourceFiles.add(group.sourceFile);

    if (!Array.isArray(group.candidates)) {
      issues.push(`${group.sourceFile} must contain a JSON array.`);
      continue;
    }

    for (const [index, candidate] of group.candidates.entries()) {
      const label = `${group.sourceFile}[${index}]`;
      validateCandidate(candidate, label, topicIds, issues);

      if (candidate && typeof candidate === "object") {
        if (candidateIds.has(candidate.id)) {
          issues.push(`${label}.id duplicates candidate ID ${candidate.id}.`);
        }
        candidateIds.add(candidate.id);
      }
    }
  }

  if (issues.length > 0) {
    throw new ReviewCandidateImportValidationError(issues);
  }

  return fixtures;
}

export async function importPublicReviewCandidates({
  client,
  dryRun,
  fixtures,
  target,
}) {
  validatePublicReviewCandidateFixtures(fixtures);
  await client.query("begin");

  try {
    const plan = await buildImportPlan(client, fixtures);
    const report = reportFromPlan(plan, { dryRun, target });

    if (dryRun) {
      await client.query("rollback");
      return report;
    }

    await applyTopicPlan(client, plan);
    for (const entry of plan.candidates.toInsert) {
      await insertReviewCandidate(client, entry);
    }
    await client.query("commit");

    return {
      ...report,
      committed: true,
      mode: "apply",
    };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

async function buildImportPlan(client, fixtures) {
  const [topicResult, questionResult] = await Promise.all([
    client.query(`
      select id, title, description, sort_order, week_number, module_ref, is_active
      from topics
      order by id
    `),
    client.query(
      `
        select
          q.id,
          q.record_state,
          q.published_version_id,
          q.working_version_id,
          qvl.state as lifecycle_state,
          qv.snapshot_json
        from questions q
        left join question_versions qv on qv.id = q.working_version_id
        left join question_version_lifecycle qvl
          on qvl.question_version_id = q.working_version_id
        where q.id = any($1::text[])
        order by q.id
      `,
      [fixtures.candidates.map(({ candidate }) => candidate.id)],
    ),
  ]);

  const existingTopics = new Map(
    topicResult.rows.map((row) => [String(row.id), row]),
  );
  const canonicalIds = new Set(fixtures.topics.map((topic) => topic.id));
  const desiredOrders = new Map(
    fixtures.topics.map((topic) => [topic.order, topic.id]),
  );

  for (const row of topicResult.rows) {
    const desiredOwner = desiredOrders.get(Number(row.sort_order));
    if (desiredOwner && desiredOwner !== row.id && !canonicalIds.has(row.id)) {
      throw new ReviewCandidateImportValidationError([
        `Canonical topic order ${row.sort_order} is already used by non-canonical topic ${row.id}.`,
      ]);
    }
  }

  const topics = {
    skipped: [],
    toInsert: [],
    toUpdate: [],
  };
  for (const topic of fixtures.topics) {
    const existing = existingTopics.get(topic.id);
    if (!existing) {
      topics.toInsert.push(topic);
    } else if (sameTopic(existing, topic)) {
      topics.skipped.push(topic);
    } else {
      topics.toUpdate.push(topic);
    }
  }

  const existingQuestions = new Map(
    questionResult.rows.map((row) => [String(row.id), row]),
  );
  const candidates = {
    preserved: [],
    skipped: [],
    toInsert: [],
  };

  for (const entry of fixtures.candidates) {
    const existing = existingQuestions.get(entry.candidate.id);
    if (!existing) {
      candidates.toInsert.push(entry);
    } else if (sameUnreviewedCandidate(existing, entry.candidate)) {
      candidates.skipped.push(entry);
    } else {
      // Any existing non-identical ID is immutable from this importer's point
      // of view. This preserves approvals, rejections, lifecycle work, and
      // edits even when a legacy review_status column is still needs_review.
      candidates.preserved.push(entry);
    }
  }

  return {
    candidates,
    maxTopicOrder: Math.max(
      0,
      ...topicResult.rows.map((row) => Number(row.sort_order)),
      ...fixtures.topics.map((topic) => topic.order),
    ),
    topics,
  };
}

async function applyTopicPlan(client, plan) {
  const changedExisting = plan.topics.toUpdate;

  for (const [index, topic] of changedExisting.entries()) {
    await client.query("update topics set sort_order = $2 where id = $1", [
      topic.id,
      plan.maxTopicOrder + index + 1,
    ]);
  }

  for (const topic of [...plan.topics.toInsert, ...plan.topics.toUpdate]) {
    await client.query(
      `
        insert into topics (
          id, title, description, sort_order, week_number, module_ref, is_active
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (id) do update set
          title = excluded.title,
          description = excluded.description,
          sort_order = excluded.sort_order,
          week_number = excluded.week_number,
          module_ref = excluded.module_ref,
          is_active = excluded.is_active,
          updated_at = now()
      `,
      [
        topic.id,
        topic.title,
        topic.description,
        topic.order,
        topic.weekNumber,
        topic.moduleRef,
        topic.active,
      ],
    );
  }
}

async function insertReviewCandidate(client, { candidate, sourceFile }) {
  const reviewPriority = candidate.review.reviewPriority ?? "normal";
  await client.query(
    `select
       set_config('app.current_user_id', 'system:question-generator', true),
       set_config('app.current_creation_method', 'imported', true),
       set_config('app.suppress_question_version', 'true', true)`,
  );
  await client.query(
    `
      insert into questions (
        id,
        topic_id,
        pattern_id,
        title,
        prompt,
        difficulty,
        accepted_answers_json,
        numeric_value,
        tolerance,
        answer_explanation,
        source_type,
        trust_level,
        visibility,
        review_status,
        originality_note,
        review_priority,
        review_notes
      )
      values (
        $1, $2, null, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
        'generated_unverified', 'public', 'needs_review', $11, $12, $13
      )
    `,
    [
      candidate.id,
      candidate.topicId,
      candidate.title,
      candidate.prompt,
      candidate.difficulty,
      JSON.stringify(candidate.answer.acceptedAnswers),
      candidate.answer.numericValue ?? null,
      candidate.answer.tolerance ?? null,
      candidate.answer.explanation,
      candidate.source.sourceType,
      candidate.source.originalityNote ?? null,
      reviewPriority,
      candidate.review.notes ?? null,
    ],
  );
  await client.query(
    `
      insert into hints (question_id, hint_order, body)
      select $1, item.ordinality::integer, item.body
      from jsonb_array_elements_text($2::jsonb)
        with ordinality as item(body, ordinality)
    `,
    [candidate.id, JSON.stringify(candidate.hints)],
  );
  await client.query(
    `
      insert into solution_steps (question_id, step_order, body)
      select $1, item.ordinality::integer, item.body
      from jsonb_array_elements_text($2::jsonb)
        with ordinality as item(body, ordinality)
    `,
    [candidate.id, JSON.stringify(candidate.solutionSteps)],
  );
  await client.query(
    `
      insert into misconceptions (
        question_id, id, feedback, match_terms_json, metadata_json
      )
      select
        $1,
        item.value ->> 'id',
        item.value ->> 'feedback',
        coalesce(item.value -> 'matchTerms', '[]'::jsonb),
        '{}'::jsonb
      from jsonb_array_elements($2::jsonb) as item(value)
    `,
    [candidate.id, JSON.stringify(candidate.misconceptions)],
  );
  await client.query(
    "select set_config('app.suppress_question_version', 'false', true)",
  );

  const generationMetadata = {
    importKind: "public_safe_review_candidate",
    patternIds: candidate.source.patternIds ?? [],
    patternSource: candidate.patternSource,
    sourceFile,
  };
  const versionResult = await client.query(
    `
      with snapshot as (
        select app_question_snapshot($1) as content
      )
      insert into question_versions (
        question_id,
        version_number,
        snapshot_json,
        content_hash,
        created_by_user_id,
        creation_method,
        schema_version,
        generation_metadata_json
      )
      select
        $1,
        1,
        content,
        md5(content::text),
        'system:question-generator',
        'imported',
        2,
        $2::jsonb
      from snapshot
      returning id
    `,
    [candidate.id, JSON.stringify(generationMetadata)],
  );
  const versionId = versionResult.rows[0]?.id;
  if (!versionId) {
    throw new Error(
      `Failed to create an immutable version for ${candidate.id}.`,
    );
  }

  await client.query(
    `
      select *
      from app_transition_question_version(
        $1,
        $2,
        'submit',
        'system:question-generator',
        'Question generation system',
        'draft',
        null,
        'Imported from a committed public-safe review-candidate fixture.',
        $3,
        null,
        $4::jsonb
      )
    `,
    [
      candidate.id,
      versionId,
      `review-candidate-import:${candidate.id}`,
      JSON.stringify({ importKind: generationMetadata.importKind, sourceFile }),
    ],
  );
}

function sameTopic(row, topic) {
  return (
    String(row.title) === topic.title &&
    String(row.description) === topic.description &&
    Number(row.sort_order) === topic.order &&
    Number(row.week_number) === topic.weekNumber &&
    String(row.module_ref) === topic.moduleRef &&
    Boolean(row.is_active) === topic.active
  );
}

function sameUnreviewedCandidate(row, candidate) {
  return (
    row.record_state === "active" &&
    row.published_version_id === null &&
    row.lifecycle_state === "needs_review" &&
    canonicalJson(row.snapshot_json) ===
      canonicalJson(expectedSnapshot(candidate))
  );
}

function expectedSnapshot(candidate) {
  return {
    acceptedAnswers: candidate.answer.acceptedAnswers,
    answerExplanation: candidate.answer.explanation,
    archivedAt: null,
    difficulty: candidate.difficulty,
    hints: candidate.hints.map((body, index) => ({ body, order: index + 1 })),
    id: candidate.id,
    misconceptions: candidate.misconceptions.map((misconception) => ({
      feedback: misconception.feedback,
      id: misconception.id,
      matchTerms: misconception.matchTerms,
      metadata: {},
    })),
    numericValue: candidate.answer.numericValue ?? null,
    originalityNote: candidate.source.originalityNote ?? null,
    patternId: null,
    prompt: candidate.prompt,
    reviewNotes: candidate.review.notes ?? null,
    reviewPriority: candidate.review.reviewPriority ?? "normal",
    reviewStatus: "needs_review",
    reviewedAt: null,
    reviewedByUserId: null,
    solutionSteps: candidate.solutionSteps.map((body, index) => ({
      body,
      order: index + 1,
    })),
    sourceType: candidate.source.sourceType,
    title: candidate.title,
    tolerance: candidate.answer.tolerance ?? null,
    topicId: candidate.topicId,
    trustLevel: "generated_unverified",
    visibility: "public",
  };
}

function reportFromPlan(plan, { dryRun, target }) {
  return {
    candidates: {
      inserted: plan.candidates.toInsert.length,
      preservedProfessorReviewed: plan.candidates.preserved.length,
      skipped: plan.candidates.skipped.length,
      total:
        plan.candidates.toInsert.length +
        plan.candidates.preserved.length +
        plan.candidates.skipped.length,
    },
    committed: false,
    mode: dryRun ? "check" : "apply",
    target,
    topics: {
      inserted: plan.topics.toInsert.length,
      skipped: plan.topics.skipped.length,
      total:
        plan.topics.toInsert.length +
        plan.topics.toUpdate.length +
        plan.topics.skipped.length,
      updated: plan.topics.toUpdate.length,
    },
  };
}

function validateTopics(topics, issues) {
  if (!Array.isArray(topics) || topics.length === 0) {
    issues.push(`${TOPICS_FILE} must contain a non-empty JSON array.`);
    return new Set();
  }

  const activeIds = new Set();
  const allIds = new Set();
  const orders = new Set();
  let previousOrder = 0;
  for (const [index, topic] of topics.entries()) {
    const label = `${TOPICS_FILE}[${index}]`;
    requireString(topic?.id, `${label}.id`, issues);
    requireString(topic?.title, `${label}.title`, issues);
    requireString(topic?.description, `${label}.description`, issues);
    requireString(topic?.moduleRef, `${label}.moduleRef`, issues);
    requirePositiveInteger(topic?.order, `${label}.order`, issues);
    requirePositiveInteger(topic?.weekNumber, `${label}.weekNumber`, issues);
    if (typeof topic?.active !== "boolean") {
      issues.push(`${label}.active must be a boolean.`);
    }
    if (allIds.has(topic?.id)) {
      issues.push(`${label}.id must be unique.`);
    }
    if (orders.has(topic?.order)) {
      issues.push(`${label}.order must be unique.`);
    }
    if (Number.isInteger(topic?.order) && topic.order <= previousOrder) {
      issues.push(`${TOPICS_FILE} must be in strictly increasing order.`);
    }
    if (Number.isInteger(topic?.order)) {
      previousOrder = topic.order;
    }
    if (topic?.active === true) {
      activeIds.add(topic?.id);
    }
    allIds.add(topic?.id);
    orders.add(topic?.order);
  }
  return activeIds;
}

function validateCandidate(candidate, label, topicIds, issues) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    issues.push(`${label} must be an object.`);
    return;
  }

  findPrivateFields(candidate, label, issues);
  if (PRIVATE_TEXT_PATTERN.test(JSON.stringify(candidate))) {
    issues.push(`${label} contains private-source or copied-source text.`);
  }

  requireString(candidate.id, `${label}.id`, issues);
  requireString(candidate.topicId, `${label}.topicId`, issues);
  requireString(candidate.title, `${label}.title`, issues);
  requireString(candidate.prompt, `${label}.prompt`, issues);
  requireString(candidate.patternSource, `${label}.patternSource`, issues);
  requireString(
    candidate.answer?.explanation,
    `${label}.answer.explanation`,
    issues,
  );
  requireString(
    candidate.source?.originalityNote,
    `${label}.source.originalityNote`,
    issues,
  );
  requireStringArray(
    candidate.answer?.acceptedAnswers,
    `${label}.answer.acceptedAnswers`,
    issues,
    { allowEmpty: false },
  );
  requireStringArray(candidate.hints, `${label}.hints`, issues, {
    allowEmpty: false,
  });
  requireStringArray(
    candidate.solutionSteps,
    `${label}.solutionSteps`,
    issues,
    {
      allowEmpty: false,
    },
  );

  if (!topicIds.has(candidate.topicId)) {
    issues.push(`${label}.topicId must reference an active canonical topic.`);
  }
  if (!DIFFICULTIES.has(candidate.difficulty)) {
    issues.push(`${label}.difficulty is invalid.`);
  }
  if (candidate.review?.status !== "needs_review") {
    issues.push(`${label}.review.status must equal needs_review.`);
  }
  if (
    candidate.review?.reviewPriority !== undefined &&
    !REVIEW_PRIORITIES.has(candidate.review.reviewPriority)
  ) {
    issues.push(`${label}.review.reviewPriority is invalid.`);
  }
  if (!SOURCE_TYPES.has(candidate.source?.sourceType)) {
    issues.push(`${label}.source.sourceType must be generated content.`);
  }
  if (candidate.source?.patternIds !== undefined) {
    requireStringArray(
      candidate.source.patternIds,
      `${label}.source.patternIds`,
      issues,
      { allowEmpty: true },
    );
  }
  if (candidate.source?.trustLevel !== "generated_unverified") {
    issues.push(`${label}.source.trustLevel must equal generated_unverified.`);
  }
  if (candidate.source?.visibility !== "public") {
    issues.push(`${label}.source.visibility must equal public.`);
  }
  if (
    candidate.answer?.numericValue !== undefined &&
    !Number.isFinite(candidate.answer.numericValue)
  ) {
    issues.push(`${label}.answer.numericValue must be finite when supplied.`);
  }
  if (
    candidate.answer?.tolerance !== undefined &&
    (!Number.isFinite(candidate.answer.tolerance) ||
      candidate.answer.tolerance < 0)
  ) {
    issues.push(`${label}.answer.tolerance must be nonnegative when supplied.`);
  }
  if (!Array.isArray(candidate.misconceptions)) {
    issues.push(`${label}.misconceptions must be an array.`);
  } else {
    const misconceptionIds = new Set();
    for (const [index, misconception] of candidate.misconceptions.entries()) {
      const misconceptionLabel = `${label}.misconceptions[${index}]`;
      requireString(misconception?.id, `${misconceptionLabel}.id`, issues);
      requireString(
        misconception?.feedback,
        `${misconceptionLabel}.feedback`,
        issues,
      );
      requireStringArray(
        misconception?.matchTerms,
        `${misconceptionLabel}.matchTerms`,
        issues,
        { allowEmpty: true },
      );
      if (misconceptionIds.has(misconception?.id)) {
        issues.push(`${misconceptionLabel}.id must be unique per question.`);
      }
      misconceptionIds.add(misconception?.id);
    }
  }
}

function findPrivateFields(value, label, issues) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      findPrivateFields(entry, `${label}[${index}]`, issues),
    );
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_FIELD_PATTERN.test(key)) {
      issues.push(`${label}.${key} is a forbidden private-source field.`);
    }
    findPrivateFields(nested, `${label}.${key}`, issues);
  }
}

function requireString(value, label, issues) {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`${label} must be a non-empty string.`);
  }
}

function requireStringArray(value, label, issues, { allowEmpty }) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    issues.push(
      `${label} must be ${allowEmpty ? "a" : "a non-empty"} string array.`,
    );
    return;
  }
  if (value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    issues.push(`${label} must contain only non-empty strings.`);
  }
}

function requirePositiveInteger(value, label, issues) {
  if (!Number.isInteger(value) || value < 1) {
    issues.push(`${label} must be a positive integer.`);
  }
}

function groupCandidatesBySource(candidates) {
  const groups = new Map();
  for (const entry of candidates ?? []) {
    const current = groups.get(entry.sourceFile) ?? [];
    current.push(entry.candidate);
    groups.set(entry.sourceFile, current);
  }
  return [...groups].map(([sourceFile, groupedCandidates]) => ({
    candidates: groupedCandidates,
    sourceFile,
  }));
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function optionalEnvironmentValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function rollbackQuietly(client) {
  try {
    await client.query("rollback");
  } catch {
    // Preserve the original failure.
  }
}
