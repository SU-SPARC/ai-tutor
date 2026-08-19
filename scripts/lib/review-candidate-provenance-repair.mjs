import {
  loadPublicReviewCandidateFixtures,
  validatePublicReviewCandidateFixtures,
} from "./review-candidate-import.mjs";

export const PROVENANCE_REPAIR_LOCK_ID = 7_241_903_208;

export const PROVENANCE_REPAIR_ACTOR = "system:question-generator";
export const PROVENANCE_REPAIR_ACTOR_DISPLAY = "Question generation system";

const INCORRECT_SOURCE_TYPE = "pattern_derived_original";
const CORRECT_SOURCE_TYPE = "generated_original";

export class ProvenanceRepairError extends Error {
  constructor(issues) {
    super("Review-candidate provenance repair failed.");
    this.name = "ProvenanceRepairError";
    this.issues = issues;
  }
}

export { loadPublicReviewCandidateFixtures };

/**
 * Professor revisions live only in `question_versions.snapshot_json`; the
 * `questions`/`hints` projection is deliberately left stale by the revision
 * endpoint. Corrected content must therefore come from the newest version this
 * repair did not itself write, never from `app_question_snapshot()`, or a
 * professor edit would be silently reverted.
 */
function authoritativeTargetSnapshot(snapshot) {
  return { ...snapshot, sourceType: CORRECT_SOURCE_TYPE };
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
  return JSON.stringify(value ?? null);
}

/**
 * A draft is repairable only when the committed fixture says the truthful
 * classification is generated_original, the authoritative version still
 * claims pattern-derived provenance, and no catalogued pattern is linked
 * anywhere. Anything else is reported and left untouched.
 */
export async function buildProvenanceRepairPlan(client, fixtures) {
  validatePublicReviewCandidateFixtures(fixtures);

  const corrected = new Map();
  for (const { candidate, sourceFile } of fixtures.candidates) {
    if (candidate.source.sourceType === CORRECT_SOURCE_TYPE) {
      corrected.set(candidate.id, sourceFile);
    }
  }

  const { rows } = await client.query(
    `
      select
        q.id,
        q.pattern_id,
        q.source_type,
        q.trust_level,
        q.record_state,
        q.working_version_id,
        q.published_version_id,
        wv.snapshot_json as working_snapshot,
        authoritative.id as authoritative_version_id,
        authoritative.snapshot_json as authoritative_snapshot,
        qvl.state as lifecycle_state,
        (
          select max(av.version_number)
          from question_versions av
          where av.question_id = q.id
        ) as max_version_number
      from questions q
      join question_versions wv on wv.id = q.working_version_id
      join question_version_lifecycle qvl
        on qvl.question_version_id = q.working_version_id
      join lateral (
        select av.id, av.snapshot_json
        from question_versions av
        where av.question_id = q.id
          and coalesce(
            av.generation_metadata_json ->> 'repairKind', ''
          ) <> 'provenance_reclassification'
        order by av.version_number desc
        limit 1
      ) authoritative on true
      where q.id = any($1::text[])
      order by q.id
    `,
    [[...corrected.keys()]],
  );

  const plan = {
    absent: [],
    alreadyCorrect: [],
    blocked: [],
    repairable: [],
  };
  const found = new Set();

  for (const row of rows) {
    found.add(row.id);
    const targetSnapshot = authoritativeTargetSnapshot(
      row.authoritative_snapshot,
    );
    const entry = {
      id: row.id,
      lifecycleState: row.lifecycle_state,
      nextVersionNumber: Number(row.max_version_number) + 1,
      publishedVersionId: row.published_version_id,
      sourceFile: corrected.get(row.id),
      targetSnapshot,
      workingVersionId: row.working_version_id,
    };

    const authoritativeSourceType = row.authoritative_snapshot?.sourceType;
    const linkedPattern =
      row.pattern_id ?? row.authoritative_snapshot?.patternId ?? null;
    if (linkedPattern) {
      plan.blocked.push({
        ...entry,
        reason: `A catalogued pattern (${linkedPattern}) is linked; pattern-derived provenance is evidenced and must not be reclassified.`,
      });
      continue;
    }
    if (
      authoritativeSourceType !== INCORRECT_SOURCE_TYPE &&
      authoritativeSourceType !== CORRECT_SOURCE_TYPE
    ) {
      plan.blocked.push({
        ...entry,
        reason: `The authoritative version claims ${authoritativeSourceType}, which this repair does not handle.`,
      });
      continue;
    }
    if (row.record_state !== "active") {
      plan.blocked.push({
        ...entry,
        reason: `The question record is ${row.record_state}; restore it before repairing provenance.`,
      });
      continue;
    }

    // Compares the whole snapshot, not just sourceType, so a prior repair that
    // dropped professor-edited content is detected and restored.
    if (canonicalJson(row.working_snapshot) === canonicalJson(targetSnapshot)) {
      plan.alreadyCorrect.push(entry);
      continue;
    }

    plan.repairable.push(entry);
  }

  for (const id of corrected.keys()) {
    if (!found.has(id)) {
      plan.absent.push({ id, sourceFile: corrected.get(id) });
    }
  }

  return plan;
}

export async function applyProvenanceRepair({
  client,
  dryRun,
  fixtures,
  only,
  target,
}) {
  await client.query("begin");

  try {
    const plan = await buildProvenanceRepairPlan(client, fixtures);
    const selected = only
      ? plan.repairable.filter((entry) => only.has(entry.id))
      : plan.repairable;

    if (only) {
      const missing = [...only].filter(
        (id) => !selected.some((entry) => entry.id === id),
      );
      if (missing.length > 0) {
        throw new ProvenanceRepairError(
          missing.map(
            (id) =>
              `${id} is not a repairable draft. It is either absent, already correct, or reported as blocked.`,
          ),
        );
      }
    }

    const repaired = [];
    if (!dryRun) {
      for (const entry of selected) {
        repaired.push(await repairOneDraft(client, entry));
      }
    }

    const report = {
      absent: plan.absent,
      alreadyCorrect: plan.alreadyCorrect.length,
      blocked: plan.blocked,
      committed: false,
      mode: dryRun ? "check" : "apply",
      repaired,
      selected: selected.map((entry) => entry.id),
      target,
    };

    if (dryRun) {
      await client.query("rollback");
      return report;
    }

    await client.query("commit");
    return { ...report, committed: true };
  } catch (error) {
    await rollbackQuietly(client);
    throw error;
  }
}

/**
 * Correcting provenance never rewrites an immutable snapshot. The mutable
 * questions projection is corrected, then a new immutable version is appended
 * with parent lineage and submitted back into the review queue, so prior
 * approvals stay attached to the version they were granted for.
 */
async function repairOneDraft(client, entry) {
  await client.query(
    `select
       set_config('app.current_user_id', $1, true),
       set_config('app.current_creation_method', 'imported', true),
       set_config('app.suppress_question_version', 'true', true)`,
    [PROVENANCE_REPAIR_ACTOR],
  );
  await client.query(
    `update questions
     set source_type = $2
     where id = $1
       and source_type = $3
       and pattern_id is null`,
    [entry.id, CORRECT_SOURCE_TYPE, INCORRECT_SOURCE_TYPE],
  );
  await client.query(
    "select set_config('app.suppress_question_version', 'false', true)",
  );

  const generationMetadata = {
    correctedFromSourceType: INCORRECT_SOURCE_TYPE,
    correctedToSourceType: CORRECT_SOURCE_TYPE,
    repairKind: "provenance_reclassification",
    sourceFile: entry.sourceFile,
    supersededVersionId: String(entry.workingVersionId),
  };

  const versionResult = await client.query(
    `
      insert into question_versions (
        question_id,
        version_number,
        parent_version_id,
        snapshot_json,
        content_hash,
        created_by_user_id,
        creation_method,
        schema_version,
        generation_metadata_json
      )
      select
        $1,
        $2,
        $3,
        $6::jsonb,
        md5($6::jsonb::text),
        $4,
        'imported',
        2,
        $5::jsonb
      returning id
    `,
    [
      entry.id,
      entry.nextVersionNumber,
      entry.workingVersionId,
      PROVENANCE_REPAIR_ACTOR,
      JSON.stringify(generationMetadata),
      JSON.stringify(entry.targetSnapshot),
    ],
  );

  const versionId = versionResult.rows[0]?.id;
  if (!versionId) {
    throw new ProvenanceRepairError([
      `Failed to append a corrected immutable version for ${entry.id}.`,
    ]);
  }

  await client.query(
    `
      select *
      from app_transition_question_version(
        $1,
        $2,
        'submit',
        $3,
        $4,
        'draft',
        null,
        'Provenance corrected to generated_original; these drafts come from ad-hoc generator templates, not a catalogued question pattern.',
        $5,
        null,
        $6::jsonb
      )
    `,
    [
      entry.id,
      versionId,
      PROVENANCE_REPAIR_ACTOR,
      PROVENANCE_REPAIR_ACTOR_DISPLAY,
      `provenance-repair:${entry.id}`,
      JSON.stringify(generationMetadata),
    ],
  );

  return {
    id: entry.id,
    previousVersionId: String(entry.workingVersionId),
    previousLifecycleState: entry.lifecycleState,
    versionId: String(versionId),
  };
}

async function rollbackQuietly(client) {
  try {
    await client.query("rollback");
  } catch {
    // The transaction is already gone; the original error is what matters.
  }
}
