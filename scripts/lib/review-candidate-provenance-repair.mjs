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
 * The current working version is the authoritative content. Professor
 * revisions and approve-with-difficulty edits always create a new working
 * version, while the `questions`/`hints` projection is deliberately left
 * stale by the revision endpoint, so corrected content is copied from the
 * working version's own immutable snapshot with only `sourceType` changed.
 * It is never rebuilt from `app_question_snapshot()` and never taken from an
 * older version, so nothing a professor revised or approved is reverted.
 */
function correctedSnapshot(snapshot) {
  return { ...snapshot, sourceType: CORRECT_SOURCE_TYPE };
}

/**
 * A draft is repairable only when the committed fixture says the truthful
 * classification is generated_original, its current working version still
 * claims pattern-derived provenance, no catalogued pattern is linked
 * anywhere, and lifecycle history holds no earlier repair for it. A working
 * version that already claims generated_original is reported as already
 * correct and never touched, even when older versions in its history still
 * carry the legacy classification or an inherited repair marker. Anything
 * else is reported and left untouched.
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
        q.record_state,
        q.working_version_id,
        q.published_version_id,
        wv.snapshot_json as working_snapshot,
        qvl.state as lifecycle_state,
        (
          select max(av.version_number)
          from question_versions av
          where av.question_id = q.id
        ) as max_version_number,
        (
          select count(*)::int
          from question_lifecycle_events history
          where history.question_id = q.id
            and history.action = 'submit'
            and history.actor_user_id = $2
            and history.idempotency_key = 'provenance-repair:' || q.id
        ) as prior_repair_submits
      from questions q
      join question_versions wv on wv.id = q.working_version_id
      join question_version_lifecycle qvl
        on qvl.question_version_id = q.working_version_id
      where q.id = any($1::text[])
      order by q.id
    `,
    [[...corrected.keys()], PROVENANCE_REPAIR_ACTOR],
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
    const workingSnapshot = row.working_snapshot ?? {};
    const entry = {
      id: row.id,
      lifecycleState: row.lifecycle_state,
      nextVersionNumber: Number(row.max_version_number) + 1,
      publishedVersionId: row.published_version_id,
      sourceFile: corrected.get(row.id),
      targetSnapshot: correctedSnapshot(workingSnapshot),
      workingVersionId: row.working_version_id,
    };

    const workingSourceType = workingSnapshot.sourceType;
    const linkedPattern = row.pattern_id ?? workingSnapshot.patternId ?? null;
    if (linkedPattern) {
      plan.blocked.push({
        ...entry,
        reason: `A catalogued pattern (${linkedPattern}) is linked; pattern-derived provenance is evidenced and must not be reclassified.`,
      });
      continue;
    }
    if (workingSourceType === CORRECT_SOURCE_TYPE) {
      // The working version is what the professor reviews, approves, and
      // publishes. Its history may still hold the legacy classification or a
      // marker inherited from an earlier repair; neither is a reason to
      // append another version on top of corrected, possibly approved content.
      plan.alreadyCorrect.push(entry);
      continue;
    }
    if (workingSourceType !== INCORRECT_SOURCE_TYPE) {
      plan.blocked.push({
        ...entry,
        reason: `The working version claims ${workingSourceType}, which this repair does not handle.`,
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
    if (Number(row.prior_repair_submits) > 0) {
      plan.blocked.push({
        ...entry,
        reason:
          "Lifecycle history already records a provenance repair for this question, yet the working version still claims pattern-derived provenance; review the version history manually instead of repairing it again.",
      });
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
 * approvals stay attached to the version they were granted for. The lifecycle
 * idempotency key is one per question, and the database replays a reused key
 * as a no-op, so a repeat repair is refused here rather than left as a draft.
 */
async function repairOneDraft(client, entry) {
  const idempotencyKey = `provenance-repair:${entry.id}`;
  const priorRepair = await client.query(
    `select 1
     from question_lifecycle_events
     where question_id = $1 and idempotency_key = $2
     limit 1`,
    [entry.id, idempotencyKey],
  );
  if (priorRepair.rows.length > 0) {
    throw new ProvenanceRepairError([
      `${entry.id} already carries a provenance-repair lifecycle event; refusing to append a second correction.`,
    ]);
  }

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

  const submitted = await client.query(
    `
      select result_question_version_id, result_state
      from app_transition_question_version(
        $1,
        $2,
        'submit',
        $3,
        $4,
        'draft',
        null,
        'Provenance corrected to generated_original because no approved catalogued pattern ID is linked to this immutable version.',
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
      idempotencyKey,
      JSON.stringify(generationMetadata),
    ],
  );
  const outcome = submitted.rows[0];
  if (
    !outcome ||
    Number(outcome.result_question_version_id) !== Number(versionId) ||
    outcome.result_state !== "needs_review"
  ) {
    throw new ProvenanceRepairError([
      `${entry.id}: corrected version ${versionId} did not reach needs_review (state ${outcome?.result_state ?? "unknown"}); the transaction is rolled back.`,
    ]);
  }

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
