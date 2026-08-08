export const INTEGRITY_REPAIR_LOCK_ID = 7_241_903_152;
export const SUPPORTED_INTEGRITY_TARGETS = Object.freeze([
  "production",
  "staging",
  "test",
]);
export const SUPPORTED_REPAIR_ACTIONS = Object.freeze([
  "quarantine-unsafe-questions",
  "reconcile-usage-totals",
]);

const SAMPLE_LIMIT = 20;

const AUDIT_CHECKS = Object.freeze([
  {
    description:
      "Questions must reference an existing topic; topic inference is never automatic.",
    id: "broken_question_topic_relationships",
    repairAction: null,
    severity: "critical",
    title: "Broken question-topic relationships",
    violationsSql: `
      select q.id::text as record_id
      from questions q
      left join topics t on t.id = q.topic_id
      where t.id is null
    `,
  },
  {
    description:
      "Approved public questions must include at least one nonblank ordered solution step.",
    id: "missing_solution_steps",
    repairAction: "quarantine-unsafe-questions",
    severity: "high",
    title: "Missing solution steps",
    violationsSql: `
      select q.id::text as record_id
      from questions q
      where q.visibility = 'public'
        and q.review_status = 'approved'
        and q.archived_at is null
        and not exists (
          select 1
          from solution_steps s
          where s.question_id = q.id
            and s.step_order > 0
            and btrim(s.body) <> ''
        )
    `,
  },
  {
    description:
      "Question identifiers must be globally unique even if a primary-key constraint was disabled or lost.",
    id: "duplicate_question_ids",
    repairAction: null,
    severity: "critical",
    title: "Duplicate question IDs",
    violationsSql: `
      select q.id::text as record_id
      from questions q
      group by q.id
      having count(*) > 1
    `,
  },
  {
    description:
      "Publication metadata must agree on visibility, approval, trust, reviewer identity, timestamps, and archive state.",
    id: "invalid_publication_states",
    repairAction: "quarantine-unsafe-questions",
    severity: "critical",
    title: "Invalid publication states",
    violationsSql: `
      select q.id::text as record_id
      from questions q
      where q.visibility is null
        or q.visibility not in ('public', 'private')
        or q.review_status is null
        or q.review_status not in (
          'approved',
          'needs_review',
          'rejected',
          'needs_edit',
          'needs_regeneration'
        )
        or q.trust_level is null
        or q.trust_level not in (
          'public_original',
          'professor_approved',
          'course_approved',
          'generated_unverified',
          'private_reference'
        )
        or (
          q.review_status <> 'needs_review'
          and (q.reviewed_by_user_id is null or q.reviewed_at is null)
        )
        or (
          q.visibility = 'public'
          and q.review_status = 'approved'
          and (
            q.trust_level not in (
              'public_original',
              'professor_approved',
              'course_approved'
            )
            or q.reviewed_by_user_id is null
            or q.reviewed_at is null
            or q.archived_at is not null
          )
        )
        or (
          q.visibility = 'private'
          and q.review_status = 'approved'
          and q.trust_level <> 'private_reference'
        )
        or (
          q.source_type in (
            'generated_original',
            'pattern_derived_original'
          )
          and (
            (
              q.review_status = 'approved'
              and q.trust_level <> 'professor_approved'
            )
            or (
              q.review_status <> 'approved'
              and q.trust_level <> 'generated_unverified'
            )
          )
        )
        or (q.archived_at is not null and q.visibility <> 'private')
        or (q.archived_at is not null and q.review_status = 'approved')
    `,
  },
  {
    description:
      "Every approved question must have immutable approval history attributed to its recorded reviewer.",
    id: "approved_questions_without_reviewer_history",
    repairAction: "quarantine-unsafe-questions",
    severity: "critical",
    title: "Approved questions without reviewer history",
    violationsSql: `
      select q.id::text as record_id
      from questions q
      where q.review_status = 'approved'
        and not exists (
          select 1
          from question_approval_history qah
          where qah.question_id = q.id
            and qah.decision = 'approved'
            and qah.reviewer_user_id = q.reviewed_by_user_id
            and qah.decided_at = q.reviewed_at
        )
    `,
  },
  {
    description:
      "Every lifecycle question must have a valid working pointer and at most one matching published pointer/state.",
    id: "invalid_question_lifecycle_pointers",
    repairAction: null,
    severity: "critical",
    title: "Invalid question lifecycle pointers",
    violationsSql: `
      select q.id::text as record_id
      from questions q
      where (
          q.working_version_id is not null
          or q.published_version_id is not null
          or exists (
            select 1 from question_version_lifecycle qvl
            where qvl.question_id = q.id
          )
        )
        and (
          q.working_version_id is null
          or not exists (
            select 1 from question_version_lifecycle working
            where working.question_id = q.id
              and working.question_version_id = q.working_version_id
          )
          or (
            q.published_version_id is null
            and exists (
              select 1 from question_version_lifecycle published
              where published.question_id = q.id
                and published.state = 'published'
            )
          )
          or (
            q.published_version_id is not null
            and not exists (
              select 1 from question_version_lifecycle published
              where published.question_id = q.id
                and published.question_version_id = q.published_version_id
                and published.state = 'published'
            )
          )
          or (
            select count(*)
            from question_version_lifecycle published
            where published.question_id = q.id
              and published.state = 'published'
          ) > 1
          or (q.record_state = 'archived' and q.published_version_id is not null)
        )
    `,
  },
  {
    description:
      "Generated drafts and unverified generated retrieval chunks must never appear in student-facing views.",
    id: "generated_drafts_student_visible",
    repairAction: null,
    severity: "critical",
    title: "Generated drafts accidentally student-visible",
    violationsSql: `
      select ('question:' || q.id)::text as record_id
      from questions q
      join app_public_questions visible on visible.id = q.id
      where q.source_type in (
          'generated_original',
          'pattern_derived_original'
        )
        and (
          q.review_status <> 'approved'
          or q.trust_level <> 'professor_approved'
        )
      union all
      select ('retrieval:' || rc.id)::text as record_id
      from retrieval_chunks rc
      join app_student_retrieval_chunks visible on visible.id = rc.id
      where rc.source_type in (
          'generated_original',
          'pattern_derived_original'
        )
        and (
          rc.review_status <> 'approved'
          or rc.trust_level = 'generated_unverified'
        )
    `,
  },
  {
    description:
      "Topic syllabus positions must be nonnegative and unique, including after constraint drift.",
    id: "topic_order_conflicts",
    repairAction: null,
    severity: "high",
    title: "Topic-order conflicts",
    violationsSql: `
      select t.id::text as record_id
      from topics t
      where t.sort_order < 0
         or exists (
           select 1
           from topics conflicting
           where conflicting.sort_order = t.sort_order
             and conflicting.id <> t.id
         )
    `,
  },
  {
    description:
      "Tutor sessions must retain exactly one valid identity and a recoverable question reference.",
    id: "orphaned_tutor_sessions",
    repairAction: null,
    severity: "high",
    title: "Orphaned tutor sessions",
    violationsSql: `
      select s.id::text as record_id
      from tutor_sessions s
      left join users u on u.id = s.user_id
      left join questions q on q.id = s.question_id
      where num_nonnulls(s.user_id, s.anonymous_user_id) <> 1
         or (s.user_id is not null and u.id is null)
         or s.question_id is null
         or q.id is null
    `,
  },
  {
    description:
      "Usage, token, attempt, progress, and reservation counters must be nonnegative and internally consistent.",
    id: "impossible_usage_counts",
    repairAction: "reconcile-usage-totals",
    severity: "high",
    title: "Impossible usage counts",
    violationsSql: `
      select (
        'ai_usage:' || au.scope || ':' || au.scope_key || ':' || au.date_key::text
      )::text as record_id
      from ai_usage au
      where au.interactions < 0
         or au.estimated_tokens < 0
         or au.llm_fallbacks < 0
         or au.llm_input_tokens < 0
         or au.llm_output_tokens < 0
         or au.llm_total_tokens < 0
         or au.estimated_llm_tokens < 0
         or au.cache_hits < 0
         or au.limit_blocks < 0
         or au.llm_total_tokens <> au.llm_input_tokens + au.llm_output_tokens
      union all
      select ('session:' || s.id)::text as record_id
      from tutor_sessions s
      where s.revealed_hints < 0
         or s.revealed_steps < 0
         or (
           s.question_id is not null
           and s.revealed_hints > (
             select count(*) from hints h where h.question_id = s.question_id
           )
         )
         or (
           s.question_id is not null
           and s.revealed_steps > (
             select count(*)
             from solution_steps step
             where step.question_id = s.question_id
           )
         )
         or s.llm_calls < 0
         or s.llm_input_tokens < 0
         or s.llm_output_tokens < 0
         or s.llm_total_tokens < 0
         or s.llm_total_tokens <> s.llm_input_tokens + s.llm_output_tokens
      union all
      select ('attempt:' || a.id::text)::text as record_id
      from attempts a
      where a.estimated_tokens < 0
      union all
      select ('progress:' || sp.id::text)::text as record_id
      from student_progress sp
      where sp.attempts_count < 0
         or sp.hints_revealed < 0
         or sp.steps_revealed < 0
      union all
      select ('reservation:' || r.id)::text as record_id
      from ai_llm_reservations r
      where r.status is null
         or r.status not in ('pending', 'settled', 'released')
         or r.reserved_total_tokens is null
         or r.reserved_total_tokens <= 0
         or coalesce(r.actual_input_tokens, 0) < 0
         or coalesce(r.actual_output_tokens, 0) < 0
         or coalesce(r.actual_total_tokens, 0) < 0
         or (
           r.actual_total_tokens is not null
           and r.actual_total_tokens <>
             coalesce(r.actual_input_tokens, 0) +
             coalesce(r.actual_output_tokens, 0)
         )
         or (r.status = 'pending' and r.actual_total_tokens is not null)
         or (r.status = 'settled' and r.actual_total_tokens is null)
    `,
  },
  {
    description:
      "Production-shaped data must not contain non-Production ledgers or explicit demo/test/fake/fixture/synthetic markers.",
    id: "test_demo_records_in_production",
    params: ({ target }) => [target],
    repairAction: null,
    severity: "critical",
    title: "Test/demo records in production-shaped data",
    violationsSql: `
      select ('schema_migration:' || sm.version::text)::text as record_id
      from schema_migrations sm
      where $1::text = 'production' and sm.target <> 'production'
      union all
      select ('content_import:' || aci.release_id)::text as record_id
      from approved_content_imports aci
      where $1::text = 'production' and aci.target <> 'production'
      union all
      select ('user:' || u.id)::text as record_id
      from users u
      where $1::text = 'production'
        and u.user_type = 'human'
        and concat_ws(
          ' ',
          u.id,
          u.identity_provider,
          u.external_subject,
          u.email,
          u.display_name
        ) ~* '(^|[^a-z])(demo|test|fake|fixture|synthetic)([^a-z]|$)'
      union all
      select ('session:' || s.id)::text as record_id
      from tutor_sessions s
      where $1::text = 'production'
        and coalesce(s.anonymous_user_id, '') ~*
          '(^|[^a-z])(demo|test|fake|fixture|synthetic)([^a-z]|$)'
      union all
      select ('question:' || q.id)::text as record_id
      from questions q
      where $1::text = 'production'
        and (
          concat_ws(' ', q.id, q.title) ~*
            '(^|[^a-z])(demo|test|fake|fixture|synthetic)([^a-z]|$)'
          or q.reviewed_by_user_id = 'system:schema-migration'
        )
      union all
      select ('audit:' || ae.id::text)::text as record_id
      from audit_events ae
      where $1::text = 'production'
        and ae.actor_subject ~*
          '(^|[^a-z])(demo|test|fake|fixture|synthetic)([^a-z]|$)'
    `,
  },
]);

export class IntegrityWorkflowError extends Error {
  constructor(message) {
    super(message);
    this.name = "IntegrityWorkflowError";
  }
}

export async function auditDatabaseIntegrity(client, { target }) {
  validateTarget(target);
  const checks = [];

  for (const definition of AUDIT_CHECKS) {
    const params = definition.params?.({ target }) ?? [];
    const countResult = await client.query(
      `with violations as (${definition.violationsSql})
       select count(*)::bigint as finding_count from violations`,
      params,
    );
    const count = Number(countResult.rows[0]?.finding_count ?? 0);
    let sampleIds = [];

    if (count > 0) {
      const samples = await client.query(
        `with violations as (${definition.violationsSql})
         select record_id from violations order by record_id limit ${SAMPLE_LIMIT}`,
        params,
      );
      sampleIds = samples.rows.map((row) => String(row.record_id));
    }

    checks.push({
      count,
      description: definition.description,
      id: definition.id,
      repairAction: definition.repairAction,
      sampleIds,
      severity: definition.severity,
      status: count === 0 ? "passed" : "findings",
      title: definition.title,
    });
  }

  const findings = checks.reduce((total, check) => total + check.count, 0);
  const failedChecks = checks.filter((check) => check.count > 0).length;

  return {
    checks,
    generatedAt: new Date().toISOString(),
    mode: "audit",
    readOnly: true,
    status: findings === 0 ? "clean" : "findings",
    summary: {
      failedChecks,
      findings,
      passedChecks: checks.length - failedChecks,
      totalChecks: checks.length,
    },
    target,
  };
}

export async function runReadOnlyIntegrityAudit(client, { target }) {
  await client.query(
    "begin transaction isolation level repeatable read read only",
  );
  try {
    await client.query("set local statement_timeout = '60s'");
    const report = await auditDatabaseIntegrity(client, { target });
    await client.query("commit");
    return report;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the audit failure.
    }
    throw error;
  }
}

export async function assertIntegrityDatabaseTarget(client, target) {
  validateTarget(target);
  const result = await client.query(`
    select array_agg(distinct target order by target) as targets
    from schema_migrations
  `);
  const declaredTargets = result.rows[0]?.targets ?? [];
  if (declaredTargets.length !== 1 || String(declaredTargets[0]) !== target) {
    const label =
      declaredTargets.length === 0 ? "none" : declaredTargets.join(", ");
    throw new IntegrityWorkflowError(
      `Integrity target ${target} does not match migration-ledger target(s): ${label}.`,
    );
  }
}

export async function repairDatabaseIntegrity(
  client,
  {
    actions,
    actorUserId,
    changeTicket,
    confirmProduction = false,
    confirmRepair = false,
    target,
  },
) {
  validateTarget(target);
  const selectedActions = uniqueRepairActions(actions);
  requireNonblank("INTEGRITY_REPAIR_ACTOR_USER_ID", actorUserId);
  requireNonblank("INTEGRITY_REPAIR_CHANGE_TICKET", changeTicket);

  if (!confirmRepair) {
    throw new IntegrityWorkflowError(
      "Repair execution requires explicit confirmation.",
    );
  }

  if (target === "production" && !confirmProduction) {
    throw new IntegrityWorkflowError(
      "Production repair requires --confirm-production.",
    );
  }

  await client.query("begin");
  try {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '60s'");
    await client.query("select pg_advisory_xact_lock($1::bigint)", [
      INTEGRITY_REPAIR_LOCK_ID,
    ]);
    await assertIntegrityDatabaseTarget(client, target);
    await assertHumanRepairActor(client, actorUserId);
    await client.query("select set_config('app.current_user_id', $1, true)", [
      actorUserId,
    ]);

    const before = await auditDatabaseIntegrity(client, { target });
    const repairs = [];
    for (const action of selectedActions) {
      const result = await applyRepairAction(client, action, {
        actorUserId,
        changeTicket,
      });
      repairs.push(result);
      await recordRepairAuditEvent(client, {
        action,
        actorUserId,
        changeTicket,
        changedRows: result.changedRows,
        target,
      });
    }
    const after = await auditDatabaseIntegrity(client, { target });
    await client.query("commit");

    return {
      actions: repairs,
      after,
      before,
      changeTicket,
      mode: "repair",
      repairActorUserId: actorUserId,
      status:
        after.summary.findings === 0
          ? "repaired"
          : "repaired_with_remaining_findings",
      target,
    };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Preserve the original integrity/repair failure.
    }
    throw error;
  }
}

export function formatIntegrityReport(report) {
  const lines = [
    `Database integrity ${report.mode}: ${report.status}`,
    `Target: ${report.target}`,
  ];

  if (report.mode === "repair") {
    lines.push(`Change ticket: ${report.changeTicket}`);
    lines.push(`Repair actor: ${report.repairActorUserId}`);
    for (const action of report.actions) {
      lines.push(`- REPAIR ${action.action}: ${action.changedRows} row(s)`);
    }
    lines.push(`Pre-repair findings: ${report.before.summary.findings}`);
    lines.push("Post-repair audit:");
    lines.push(...formatAuditChecks(report.after));
    return lines.join("\n");
  }

  lines.push(...formatAuditChecks(report));
  return lines.join("\n");
}

function formatAuditChecks(audit) {
  const lines = [
    `Checks: ${audit.summary.passedChecks} passed, ${audit.summary.failedChecks} with findings`,
    `Findings: ${audit.summary.findings}`,
  ];
  for (const check of audit.checks) {
    const label = check.count === 0 ? "PASS" : check.severity.toUpperCase();
    lines.push(`- [${label}] ${check.title}: ${check.count}`);
    if (check.sampleIds.length > 0) {
      lines.push(`  Sample IDs: ${check.sampleIds.join(", ")}`);
    }
    if (check.count > 0) {
      lines.push(`  ${check.description}`);
      lines.push(
        `  Repair: ${check.repairAction ?? "report-only; owner decision required"}`,
      );
    }
  }
  return lines;
}

async function applyRepairAction(client, action, context) {
  if (action === "quarantine-unsafe-questions") {
    const result = await client.query(
      `
        with candidates as (
          select q.id
          from questions q
          where (
              select count(*)
              from questions duplicate
              where duplicate.id = q.id
            ) = 1
            and (
              (
                q.review_status <> 'needs_review'
                and (
                  q.reviewed_by_user_id is null
                  or q.reviewed_at is null
                )
              )
              or (
                q.source_type in (
                  'generated_original',
                  'pattern_derived_original'
                )
                and (
                  (
                    q.review_status = 'approved'
                    and q.trust_level <> 'professor_approved'
                  )
                  or (
                    q.review_status <> 'approved'
                    and q.trust_level <> 'generated_unverified'
                  )
                )
              )
              or (q.archived_at is not null and q.visibility <> 'private')
              or (
                q.archived_at is not null
                and q.review_status = 'approved'
              )
              or (
                q.visibility = 'public'
                and q.review_status = 'approved'
                and not exists (
                  select 1 from solution_steps s
                  where s.question_id = q.id
                    and s.step_order > 0
                    and btrim(s.body) <> ''
                )
              )
              or (
                q.visibility = 'public'
                and q.review_status = 'approved'
                and (
                  q.trust_level not in (
                    'public_original',
                    'professor_approved',
                    'course_approved'
                  )
                  or q.reviewed_by_user_id is null
                  or q.reviewed_at is null
                  or q.archived_at is not null
                )
              )
              or (
                q.visibility = 'private'
                and q.review_status = 'approved'
                and q.trust_level <> 'private_reference'
              )
              or (
                q.review_status = 'approved'
                and not exists (
                  select 1
                  from question_approval_history qah
                  where qah.question_id = q.id
                    and qah.decision = 'approved'
                    and qah.reviewer_user_id = q.reviewed_by_user_id
                    and qah.decided_at = q.reviewed_at
                )
              )
            )
          for update of q
        )
        update questions q
        set visibility = 'private',
            review_status = 'needs_edit',
            trust_level = case
              when q.source_type in (
                'generated_original',
                'pattern_derived_original'
              ) then 'generated_unverified'
              else q.trust_level
            end,
            reviewed_by = $1,
            reviewed_by_user_id = $1,
            reviewed_at = now(),
            review_notes = concat_ws(
              E'\\n',
              nullif(q.review_notes, ''),
              $2::text
            ),
            updated_at = now()
        from candidates c
        where q.id = c.id
        returning q.id
      `,
      [
        context.actorUserId,
        `Integrity quarantine authorized by ${context.changeTicket}.`,
      ],
    );
    return {
      action,
      changedRows: result.rows.length,
      description:
        "Moved unsafe questions out of student visibility and into needs-edit review; no content was deleted.",
    };
  }

  if (action === "reconcile-usage-totals") {
    const aiUsage = await client.query(`
      update ai_usage
      set llm_total_tokens = llm_input_tokens + llm_output_tokens,
          updated_at = now()
      where llm_input_tokens >= 0
        and llm_output_tokens >= 0
        and llm_total_tokens <>
          llm_input_tokens + llm_output_tokens
      returning scope_key
    `);
    const sessions = await client.query(`
      update tutor_sessions
      set llm_total_tokens = llm_input_tokens + llm_output_tokens,
          updated_at = now()
      where llm_input_tokens >= 0
        and llm_output_tokens >= 0
        and llm_total_tokens <>
          llm_input_tokens + llm_output_tokens
      returning id
    `);
    const reservations = await client.query(`
      update ai_llm_reservations
      set actual_total_tokens =
            coalesce(actual_input_tokens, 0) +
            coalesce(actual_output_tokens, 0),
          updated_at = now()
      where status = 'settled'
        and coalesce(actual_input_tokens, 0) >= 0
        and coalesce(actual_output_tokens, 0) >= 0
        and actual_total_tokens is distinct from
          coalesce(actual_input_tokens, 0) +
          coalesce(actual_output_tokens, 0)
      returning id
    `);
    return {
      action,
      changedRows:
        aiUsage.rows.length + sessions.rows.length + reservations.rows.length,
      description:
        "Recomputed total-token fields only when nonnegative component counters were authoritative.",
    };
  }

  throw new IntegrityWorkflowError(`Unsupported repair action: ${action}.`);
}

async function assertHumanRepairActor(client, actorUserId) {
  const result = await client.query(
    `
      select exists (
        select 1
        from users u
        join user_roles ur on ur.user_id = u.id
        where u.id = $1
          and u.user_type = 'human'
          and u.status = 'active'
          and ur.role_id = 'professor'
          and ur.revoked_at is null
          and (ur.expires_at is null or ur.expires_at > now())
      ) as authorized
    `,
    [actorUserId],
  );
  if (!result.rows[0]?.authorized) {
    throw new IntegrityWorkflowError(
      "Repair actor must be an active human professor.",
    );
  }
}

async function recordRepairAuditEvent(
  client,
  { action, actorUserId, changeTicket, changedRows, target },
) {
  await client.query(
    `
      insert into audit_events (
        actor_user_id,
        actor_subject,
        action,
        entity_type,
        entity_id,
        outcome,
        metadata_json
      )
      values ($1, $1, 'database_integrity_repair', 'database', $2, 'success', $3::jsonb)
    `,
    [
      actorUserId,
      target,
      JSON.stringify({ action, changeTicket, changedRows }),
    ],
  );
}

function uniqueRepairActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new IntegrityWorkflowError(
      "Repair mode requires at least one explicit --action.",
    );
  }
  const unique = [...new Set(actions)];
  for (const action of unique) {
    if (!SUPPORTED_REPAIR_ACTIONS.includes(action)) {
      throw new IntegrityWorkflowError(
        `Unsupported repair action: ${action}. Supported actions: ${SUPPORTED_REPAIR_ACTIONS.join(", ")}.`,
      );
    }
  }
  return unique;
}

function validateTarget(target) {
  if (!SUPPORTED_INTEGRITY_TARGETS.includes(target)) {
    throw new IntegrityWorkflowError(
      `Integrity target must be one of: ${SUPPORTED_INTEGRITY_TARGETS.join(", ")}.`,
    );
  }
}

function requireNonblank(label, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new IntegrityWorkflowError(`${label} is required.`);
  }
}
