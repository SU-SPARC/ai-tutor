import { createHash } from "node:crypto";

import { safeHash } from "./database-integrity-evidence.mjs";

export const PILOT_CLEANUP_ARTIFACT = "production_pilot_data_cleanup";
export const PILOT_CLEANUP_MANIFEST_VERSION = 1;
export const PILOT_CLEANUP_LOCK_ID = 7_241_903_153;
export const PILOT_CLEANUP_AUDIT_ACTION = "production_pilot_data_cleanup";
export const SUPPORTED_RETENTION_DECISIONS = Object.freeze([
  "retain-audit-events-remove-synthetic-graph",
]);

// Every approval is a distinct named person. Only safe fingerprints of the
// names enter evidence; the names themselves never do.
export const APPROVAL_ROLES = Object.freeze([
  Object.freeze({
    approvedVariable: "PILOT_CLEANUP_DATA_OWNER_APPROVED",
    key: "dataOwner",
    nameVariable: "PILOT_CLEANUP_DATA_OWNER",
    role: "professor_data_owner",
  }),
  Object.freeze({
    approvedVariable: "PILOT_CLEANUP_PRIVACY_REVIEWER_APPROVED",
    key: "privacyReviewer",
    nameVariable: "PILOT_CLEANUP_PRIVACY_REVIEWER",
    role: "privacy_retention_reviewer",
  }),
  Object.freeze({
    approvedVariable: "PILOT_CLEANUP_IT_OPERATOR_APPROVED",
    key: "itOperator",
    nameVariable: "PILOT_CLEANUP_IT_OPERATOR",
    role: "it_operator",
  }),
  Object.freeze({
    approvedVariable: "PILOT_CLEANUP_SECOND_REVIEWER_APPROVED",
    key: "secondReviewer",
    nameVariable: "PILOT_CLEANUP_SECOND_REVIEWER",
    role: "independent_second_reviewer",
  }),
]);

// Deletion order respects every foreign key in the schema. Each table is
// addressed only by its complete primary key; the manifest never carries a
// predicate, pattern, range, or wildcard.
export const CLEANUP_TABLES = Object.freeze([
  Object.freeze({ keys: ["id"], table: "feedback_reports", types: ["bigint"] }),
  Object.freeze({
    keys: ["id"],
    table: "ai_llm_reservations",
    types: ["text"],
  }),
  Object.freeze({ keys: ["id"], table: "student_progress", types: ["bigint"] }),
  Object.freeze({ keys: ["id"], table: "attempts", types: ["bigint"] }),
  Object.freeze({ keys: ["id"], table: "tutor_sessions", types: ["text"] }),
  Object.freeze({
    keys: ["scope", "scope_key", "date_key"],
    table: "ai_usage",
    types: ["text", "text", "date"],
  }),
  Object.freeze({
    keys: ["id"],
    table: "ai_response_cache",
    types: ["bigint"],
  }),
  Object.freeze({
    keys: ["user_id", "role_id"],
    table: "user_roles",
    types: ["text", "text"],
  }),
  Object.freeze({ keys: ["id"], table: "users", types: ["text"] }),
  Object.freeze({
    keys: ["question_version_id", "professor_user_id"],
    table: "question_version_inspections",
    types: ["bigint", "text"],
  }),
  Object.freeze({
    keys: ["id"],
    table: "question_lifecycle_events",
    types: ["bigint"],
  }),
  Object.freeze({
    keys: ["question_version_id"],
    table: "question_version_lifecycle",
    types: ["bigint"],
  }),
  Object.freeze({ keys: ["id"], table: "hints", types: ["bigint"] }),
  Object.freeze({ keys: ["id"], table: "solution_steps", types: ["bigint"] }),
  Object.freeze({
    keys: ["question_id", "id"],
    table: "misconceptions",
    types: ["text", "text"],
  }),
  Object.freeze({
    keys: ["id"],
    table: "question_versions",
    types: ["bigint"],
  }),
  Object.freeze({ keys: ["id"], table: "questions", types: ["text"] }),
]);

// Append-only guards that must yield, inside the single cleanup transaction,
// for the approved synthetic graph and for the referential SET NULL that
// PostgreSQL applies to retained audit rows when a synthetic actor is removed.
export const SUSPENDED_TRIGGERS = Object.freeze([
  Object.freeze({
    table: "question_versions",
    trigger: "question_versions_immutable",
  }),
  Object.freeze({
    table: "question_lifecycle_events",
    trigger: "question_lifecycle_events_immutable",
  }),
  Object.freeze({
    table: "question_version_inspections",
    trigger: "question_version_inspections_immutable",
  }),
  Object.freeze({ table: "audit_events", trigger: "audit_events_immutable" }),
  // This guard returns NEW, which is null on DELETE, so it silently skips the
  // row instead of raising; it must be suspended explicitly.
  Object.freeze({
    table: "question_version_lifecycle",
    trigger: "question_version_lifecycle_guard",
  }),
  Object.freeze({ table: "hints", trigger: "hints_record_question_version" }),
  Object.freeze({
    table: "solution_steps",
    trigger: "solution_steps_record_question_version",
  }),
  Object.freeze({
    table: "misconceptions",
    trigger: "misconceptions_record_question_version",
  }),
]);

export const INVENTORY_TABLES = Object.freeze([
  "ai_llm_reservations",
  "ai_response_cache",
  "ai_usage",
  "anonymous_identity_claims",
  "approved_content_imports",
  "attempts",
  "audit_events",
  "feedback_reports",
  "hints",
  "misconceptions",
  "question_approval_history",
  "question_lifecycle_events",
  "question_patterns",
  "question_student_availability",
  "question_version_inspections",
  "question_version_lifecycle",
  "question_versions",
  "questions",
  "retrieval_chunks",
  "roles",
  "schema_migrations",
  "solution_steps",
  "student_content_availability_events",
  "student_progress",
  "topic_student_availability",
  "topics",
  "tutor_sessions",
  "user_roles",
  "users",
]);

const MARKER_PATTERN = "(^|[^a-z])(demo|test|fake|fixture|synthetic)([^a-z]|$)";
const TEXT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,199}$/;
const BIGINT_KEY_PATTERN = /^[1-9][0-9]{0,17}$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/+-]{1,199}$/;
const SAFE_HASH_PATTERN = /^[0-9a-f]{16}$/;
const TEMPORARY_ROLE_PATTERN = /^(integrity_audit|backup_export)_[0-9a-f]{16}$/;
const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,199}$/;

export class PilotCleanupError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "PilotCleanupError";
  }
}

export function requiredSafeLabel(value, name) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_LABEL_PATTERN.test(normalized) || /:\/\//.test(normalized)) {
    throw new PilotCleanupError(
      `${name} must be a short non-secret label.`,
      "invalid_label",
    );
  }
  return normalized;
}

export function cleanupChangeContext(environment) {
  const changeTicket = requiredSafeLabel(
    environment.PILOT_CLEANUP_CHANGE_TICKET,
    "PILOT_CLEANUP_CHANGE_TICKET",
  );
  const retentionDecision = String(
    environment.PILOT_CLEANUP_RETENTION_DECISION ?? "",
  ).trim();
  if (!SUPPORTED_RETENTION_DECISIONS.includes(retentionDecision)) {
    throw new PilotCleanupError(
      `PILOT_CLEANUP_RETENTION_DECISION must be one of: ${SUPPORTED_RETENTION_DECISIONS.join(", ")}.`,
      "retention_decision_required",
    );
  }
  const actorUserId = String(
    environment.PILOT_CLEANUP_ACTOR_USER_ID ?? "",
  ).trim();
  if (!USER_ID_PATTERN.test(actorUserId)) {
    throw new PilotCleanupError(
      "PILOT_CLEANUP_ACTOR_USER_ID must name the active human professor recorded on the cleanup audit row.",
      "actor_required",
    );
  }
  return { actorUserId, changeTicket, retentionDecision };
}

export function cleanupApprovals(environment) {
  const names = [];
  const approvals = {};
  for (const spec of APPROVAL_ROLES) {
    const name = requiredSafeLabel(
      environment[spec.nameVariable],
      spec.nameVariable,
    );
    if (environment[spec.approvedVariable] !== "true") {
      throw new PilotCleanupError(
        `${spec.approvedVariable} must equal true; every deletion or anonymization needs the ${spec.role} approval.`,
        "approval_unconfirmed",
      );
    }
    names.push(name.toLocaleLowerCase());
    approvals[spec.key] = {
      approved: true,
      fingerprint: safeHash(name),
      role: spec.role,
    };
  }
  if (new Set(names).size !== names.length) {
    throw new PilotCleanupError(
      "The data owner, privacy reviewer, IT operator, and second reviewer must be four different named people.",
      "approvals_not_independent",
    );
  }
  return approvals;
}

export function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function sqlTextArray(values) {
  return `array[${values.map(sqlLiteral).join(", ")}]::text[]`;
}

function typedLiteral(value, type) {
  if (type === "bigint") return `${value}::bigint`;
  if (type === "date") return `${sqlLiteral(value)}::date`;
  return sqlLiteral(value);
}

function validateKeyValue(value, type, table, column) {
  const text = String(value ?? "");
  const valid =
    type === "bigint"
      ? BIGINT_KEY_PATTERN.test(text)
      : type === "date"
        ? DATE_KEY_PATTERN.test(text)
        : TEXT_KEY_PATTERN.test(text);
  if (!valid) {
    throw new PilotCleanupError(
      `${table}.${column} contains a value that is not an explicit ${type} record key.`,
      "invalid_record_key",
    );
  }
  return text;
}

export function recordKeyString(record, spec) {
  return spec.keys.map((column) => String(record[column])).join("");
}

export function validateCleanupManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new PilotCleanupError(
      "The cleanup manifest must be a JSON object.",
      "invalid_manifest",
    );
  }
  if (manifest.artifactVersion !== PILOT_CLEANUP_MANIFEST_VERSION) {
    throw new PilotCleanupError(
      "Unsupported cleanup manifest version.",
      "invalid_manifest",
    );
  }
  if (manifest.target !== "production") {
    throw new PilotCleanupError(
      "The cleanup manifest must target production.",
      "invalid_manifest",
    );
  }
  requiredSafeLabel(manifest.changeTicket, "manifest.changeTicket");
  if (!SUPPORTED_RETENTION_DECISIONS.includes(manifest.retentionDecision)) {
    throw new PilotCleanupError(
      "The cleanup manifest retention decision is not supported.",
      "invalid_manifest",
    );
  }
  if (!USER_ID_PATTERN.test(String(manifest.actorUserId ?? ""))) {
    throw new PilotCleanupError(
      "The cleanup manifest must name the actor user.",
      "invalid_manifest",
    );
  }
  const records = manifest.records;
  if (!records || typeof records !== "object" || Array.isArray(records)) {
    throw new PilotCleanupError(
      "The cleanup manifest must list explicit records per table.",
      "invalid_manifest",
    );
  }
  const knownTables = new Set(CLEANUP_TABLES.map((spec) => spec.table));
  for (const table of Object.keys(records)) {
    if (!knownTables.has(table)) {
      throw new PilotCleanupError(
        `The cleanup manifest addresses unsupported table ${table}.`,
        "invalid_manifest",
      );
    }
  }
  const normalized = {};
  let totalRecords = 0;
  for (const spec of CLEANUP_TABLES) {
    const rows = records[spec.table] ?? [];
    if (!Array.isArray(rows)) {
      throw new PilotCleanupError(
        `${spec.table} records must be an explicit array.`,
        "invalid_manifest",
      );
    }
    const seen = new Set();
    normalized[spec.table] = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new PilotCleanupError(
          `${spec.table} records must be key objects.`,
          "invalid_record_key",
        );
      }
      const extra = Object.keys(row).filter(
        (column) => !spec.keys.includes(column),
      );
      if (extra.length > 0) {
        throw new PilotCleanupError(
          `${spec.table} records may only carry primary-key columns.`,
          "invalid_record_key",
        );
      }
      const normalizedRow = {};
      spec.keys.forEach((column, index) => {
        normalizedRow[column] = validateKeyValue(
          row[column],
          spec.types[index],
          spec.table,
          column,
        );
      });
      const key = recordKeyString(normalizedRow, spec);
      if (seen.has(key)) {
        throw new PilotCleanupError(
          `${spec.table} lists a record twice.`,
          "invalid_record_key",
        );
      }
      seen.add(key);
      return normalizedRow;
    });
    totalRecords += normalized[spec.table].length;
  }
  if (totalRecords === 0) {
    throw new PilotCleanupError(
      "The cleanup manifest lists no records.",
      "invalid_manifest",
    );
  }

  const identities = manifest.identities ?? {};
  const listOf = (value, name, pattern = TEXT_KEY_PATTERN) => {
    if (!Array.isArray(value)) {
      throw new PilotCleanupError(
        `manifest.${name} must be an explicit array.`,
        "invalid_manifest",
      );
    }
    return value.map((entry) => {
      const text = String(entry ?? "");
      if (!pattern.test(text)) {
        throw new PilotCleanupError(
          `manifest.${name} contains an invalid identifier.`,
          "invalid_manifest",
        );
      }
      return text;
    });
  };
  const syntheticQuestionIds = listOf(
    identities.syntheticQuestionIds,
    "identities.syntheticQuestionIds",
  );
  const pilotTestUserIds = listOf(
    identities.pilotTestUserIds,
    "identities.pilotTestUserIds",
  );
  const staffTrialUserIds = listOf(
    identities.staffTrialUserIds,
    "identities.staffTrialUserIds",
  );
  const retainedUserIds = listOf(
    identities.retainedUserIds,
    "identities.retainedUserIds",
  );
  const temporaryRoles = Array.isArray(identities.temporaryRoles)
    ? identities.temporaryRoles.map((entry) => {
        const name = String(entry?.name ?? "");
        const hash = String(entry?.hash ?? "");
        if (!TEMPORARY_ROLE_PATTERN.test(name) || safeHash(name) !== hash) {
          throw new PilotCleanupError(
            "manifest.identities.temporaryRoles must list exact temporary role names with matching fingerprints.",
            "invalid_manifest",
          );
        }
        return { hash, name };
      })
    : [];
  const overlap = pilotTestUserIds.filter(
    (id) => staffTrialUserIds.includes(id) || retainedUserIds.includes(id),
  );
  if (
    overlap.length > 0 ||
    staffTrialUserIds.some((id) => !retainedUserIds.includes(id))
  ) {
    throw new PilotCleanupError(
      "Pilot-test users must be removed, staff trial users must be retained, and the two sets cannot overlap.",
      "invalid_manifest",
    );
  }
  if (
    pilotTestUserIds.includes(String(manifest.actorUserId)) ||
    !retainedUserIds.includes(String(manifest.actorUserId))
  ) {
    throw new PilotCleanupError(
      "The cleanup actor must be a retained user and can never be a removed identity.",
      "invalid_manifest",
    );
  }
  const removedUsers = normalized.users.map((row) => row.id);
  if (
    removedUsers.length !== pilotTestUserIds.length ||
    removedUsers.some((id) => !pilotTestUserIds.includes(id))
  ) {
    throw new PilotCleanupError(
      "The users listed for removal must be exactly the pilot-test identities.",
      "invalid_manifest",
    );
  }
  const removedQuestions = normalized.questions.map((row) => row.id);
  if (
    removedQuestions.length !== syntheticQuestionIds.length ||
    removedQuestions.some((id) => !syntheticQuestionIds.includes(id))
  ) {
    throw new PilotCleanupError(
      "The questions listed for removal must be exactly the synthetic-marked questions.",
      "invalid_manifest",
    );
  }

  const catalog = manifest.protectedCatalog ?? {};
  const publishedQuestionIds = listOf(
    catalog.publishedQuestionIds,
    "protectedCatalog.publishedQuestionIds",
  );
  if (publishedQuestionIds.length === 0) {
    throw new PilotCleanupError(
      "The protected published catalog cannot be empty.",
      "invalid_manifest",
    );
  }
  if (publishedQuestionIds.some((id) => syntheticQuestionIds.includes(id))) {
    throw new PilotCleanupError(
      "A published catalog question can never be a cleanup target.",
      "invalid_manifest",
    );
  }
  const expectedBeforeCounts = manifest.expectedBeforeCounts ?? {};
  for (const table of INVENTORY_TABLES) {
    if (!Number.isInteger(expectedBeforeCounts[table])) {
      throw new PilotCleanupError(
        `manifest.expectedBeforeCounts.${table} must be an integer.`,
        "invalid_manifest",
      );
    }
  }
  const ledger = manifest.ledger ?? {};
  if (
    !Number.isInteger(ledger.count) ||
    ledger.count <= 0 ||
    !SAFE_HASH_PATTERN.test(String(ledger.fingerprint ?? ""))
  ) {
    throw new PilotCleanupError(
      "manifest.ledger must record the migration count and fingerprint.",
      "invalid_manifest",
    );
  }

  return {
    actorUserId: String(manifest.actorUserId),
    artifactVersion: PILOT_CLEANUP_MANIFEST_VERSION,
    changeTicket: String(manifest.changeTicket).trim(),
    expectedBeforeCounts: Object.fromEntries(
      INVENTORY_TABLES.map((table) => [table, expectedBeforeCounts[table]]),
    ),
    identities: {
      pilotTestUserIds,
      retainedUserIds,
      staffTrialUserIds,
      syntheticQuestionIds,
      temporaryRoles,
    },
    ledger: {
      count: ledger.count,
      fingerprint: String(ledger.fingerprint),
      target: "production",
    },
    protectedCatalog: {
      publishedQuestionIds: [...publishedQuestionIds].sort(),
    },
    records: normalized,
    retentionDecision: manifest.retentionDecision,
    target: "production",
  };
}

export function manifestSha256(manifestText) {
  return createHash("sha256").update(manifestText).digest("hex");
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function buildInventorySql() {
  const counts = INVENTORY_TABLES.map(
    (table) => `'${table}', (select count(*) from ${table})`,
  ).join(",\n      ");
  const triggerNames = SUSPENDED_TRIGGERS.map((entry) =>
    sqlLiteral(entry.trigger),
  ).join(", ");
  return `select json_build_object(
    'database_name', current_database(),
    'observed_at', now(),
    'ledger', (select json_build_object(
      'count', count(*),
      'targets', coalesce(array_agg(distinct target), array[]::text[]),
      'rows', coalesce(string_agg(version::text || ':' || filename || ':' || checksum || ':' || target, '|' order by version), '')
    ) from schema_migrations),
    'counts', json_build_object(
      ${counts}
    ),
    'published_question_ids', (select coalesce(json_agg(id order by id), '[]'::json) from app_public_questions),
    'marker_findings', json_build_object(
      'questions', (select count(*) from questions q where concat_ws(' ', q.id, q.title) ~* ${sqlLiteral(MARKER_PATTERN)} or q.reviewed_by_user_id = 'system:schema-migration'),
      'human_users', (select count(*) from users u where u.user_type = 'human' and concat_ws(' ', u.id, u.identity_provider, u.external_subject, u.email, u.display_name) ~* ${sqlLiteral(MARKER_PATTERN)}),
      'anonymous_sessions', (select count(*) from tutor_sessions s where coalesce(s.anonymous_user_id, '') ~* ${sqlLiteral(MARKER_PATTERN)}),
      'audit_actors', (select count(*) from audit_events ae where ae.actor_subject ~* ${sqlLiteral(MARKER_PATTERN)}),
      'non_production_ledgers', (select count(*) from schema_migrations where target <> 'production') + (select count(*) from approved_content_imports where target <> 'production')
    ),
    'archived_questions', (select count(*) from questions where record_state = 'archived' or archived_at is not null),
    'anonymous_sessions', (select count(*) from tutor_sessions where anonymous_user_id is not null),
    'session_owner_hashes', (select coalesce(json_agg(encode(sha256(convert_to(owner, 'UTF8')), 'hex') order by owner), '[]'::json) from (select distinct coalesce(user_id, 'anonymous:' || anonymous_user_id) as owner from tutor_sessions) owners),
    'human_user_ids', (select coalesce(json_agg(id order by id), '[]'::json) from users where user_type = 'human'),
    'audit_snapshot', (select json_build_object(
      'row_count', count(*),
      'content_hash', md5(coalesce(string_agg(concat_ws('|', id::text, actor_subject, action, entity_type, entity_id, outcome, coalesce(request_id, ''), coalesce(metadata_json::text, ''), occurred_at::text, created_at::text), E'\\n' order by id), ''))
    ) from audit_events),
    'cleanup_audit_rows', (select count(*) from audit_events where action = ${sqlLiteral(PILOT_CLEANUP_AUDIT_ACTION)}),
    'temporary_roles', (select coalesce(json_agg(json_build_object(
      'name', r.rolname,
      'login', r.rolcanlogin,
      'bypassrls', r.rolbypassrls,
      'expires', r.rolvaliduntil
    ) order by r.rolname), '[]'::json) from pg_roles r where r.rolname ~ '^(integrity_audit|backup_export)_[0-9a-f]{16}$'),
    'disabled_triggers', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled <> 'O'),
    'disabled_constraint_triggers', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and t.tgisinternal and t.tgenabled not in ('O', 'A')),
    'managed_trigger_count', (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and t.tgname in (${triggerNames}))
  ) as inventory`;
}

export function buildPlanSql({
  actorUserId,
  pilotTestUserIds,
  staffTrialUserIds,
  syntheticQuestionIds,
}) {
  const synthetic = sqlTextArray(syntheticQuestionIds);
  const pilot = sqlTextArray(pilotTestUserIds);
  const staff = sqlTextArray(staffTrialUserIds);
  const targets = sqlTextArray([...pilotTestUserIds, ...staffTrialUserIds]);
  return `select json_build_object(
    'inventory', (${buildInventorySql().replace(/ as inventory$/, "")}),
    'synthetic_questions', (select coalesce(json_agg(json_build_object(
      'id', q.id,
      'record_state', q.record_state,
      'visibility', q.visibility,
      'review_status', q.review_status,
      'published_version_id', q.published_version_id,
      'working_version_id', q.working_version_id,
      'in_public_view', exists (select 1 from app_public_questions v where v.id = q.id),
      'marker_match', concat_ws(' ', q.id, q.title) ~* ${sqlLiteral(MARKER_PATTERN)},
      'versions', (select coalesce(json_agg(v.id order by v.id), '[]'::json) from question_versions v where v.question_id = q.id),
      'version_lifecycle', (select coalesce(json_agg(l.question_version_id order by l.question_version_id), '[]'::json) from question_version_lifecycle l where l.question_id = q.id),
      'lifecycle_events', (select coalesce(json_agg(e.id order by e.id), '[]'::json) from question_lifecycle_events e where e.question_id = q.id),
      'inspections', (select coalesce(json_agg(json_build_object('question_version_id', i.question_version_id, 'professor_user_id', i.professor_user_id) order by i.question_version_id, i.professor_user_id), '[]'::json) from question_version_inspections i where i.question_id = q.id),
      'hints', (select coalesce(json_agg(h.id order by h.id), '[]'::json) from hints h where h.question_id = q.id),
      'solution_steps', (select coalesce(json_agg(s.id order by s.id), '[]'::json) from solution_steps s where s.question_id = q.id),
      'misconceptions', (select coalesce(json_agg(m.id order by m.id), '[]'::json) from misconceptions m where m.question_id = q.id),
      'cache_rows', (select count(*) from ai_response_cache c where c.question_id = q.id),
      'retrieval_chunks', (select count(*) from retrieval_chunks r where r.question_id = q.id),
      'sessions', (select coalesce(json_agg(s.id order by s.id), '[]'::json) from tutor_sessions s where s.question_id = q.id),
      'attempts', (select count(*) from attempts a where a.question_id = q.id),
      'feedback', (select count(*) from feedback_reports f where f.question_id = q.id),
      'progress', (select count(*) from student_progress p where p.question_id = q.id),
      'availability', (select count(*) from question_student_availability x where x.question_id = q.id),
      'approval_history', (select count(*) from question_approval_history a where a.question_id = q.id),
      'audit_events', (select count(*) from audit_events ae where ae.entity_type = 'question' and ae.entity_id = q.id)
    ) order by q.id), '[]'::json) from questions q where q.id = any(${synthetic})),
    'target_users', (select coalesce(json_agg(json_build_object(
      'id', u.id,
      'user_type', u.user_type,
      'status', u.status,
      'pilot_test', u.id = any(${pilot}),
      'roles', (select coalesce(json_agg(ur.role_id order by ur.role_id), '[]'::json) from user_roles ur where ur.user_id = u.id),
      'academic_references', (select count(*) from question_versions v where v.created_by_user_id = u.id)
        + (select count(*) from questions q where q.reviewed_by_user_id = u.id)
        + (select count(*) from question_approval_history a where a.reviewer_user_id = u.id)
        + (select count(*) from question_lifecycle_events e where e.actor_user_id = u.id or e.requested_by_user_id = u.id or e.executed_by_user_id = u.id)
        + (select count(*) from question_version_inspections i where i.professor_user_id = u.id)
        + (select count(*) from question_patterns p where p.reviewed_by_user_id = u.id)
        + (select count(*) from approved_content_imports i where i.signed_by_user_id = u.id)
        + (select count(*) from topic_student_availability t where t.updated_by_user_id = u.id)
        + (select count(*) from question_student_availability x where x.updated_by_user_id = u.id)
        + (select count(*) from student_content_availability_events e where e.actor_user_id = u.id)
        + (select count(*) from anonymous_identity_claims c where c.claimed_by_user_id = u.id)
        + (select count(*) from user_roles ur where ur.granted_by_user_id = u.id or ur.revoked_by_user_id = u.id),
      'audit_events', (select count(*) from audit_events ae where ae.actor_user_id = u.id),
      'progress', (select coalesce(json_agg(p.id order by p.id), '[]'::json) from student_progress p where p.user_id = u.id)
    ) order by u.id), '[]'::json) from users u where u.id = any(${targets})),
    'sessions', (select coalesce(json_agg(json_build_object(
      'id', s.id,
      'user_id', s.user_id,
      'anonymous', s.anonymous_user_id is not null,
      'question_id', s.question_id,
      'attempts', (select coalesce(json_agg(a.id order by a.id), '[]'::json) from attempts a where a.session_id = s.id),
      'reservations', (select coalesce(json_agg(r.id order by r.id), '[]'::json) from ai_llm_reservations r where r.session_id = s.id),
      'feedback', (select coalesce(json_agg(f.id order by f.id), '[]'::json) from feedback_reports f where f.tutor_session_id = s.id),
      'progress', (select coalesce(json_agg(p.id order by p.id), '[]'::json) from student_progress p where p.last_attempt_id in (select a.id from attempts a where a.session_id = s.id))
    ) order by s.id), '[]'::json) from tutor_sessions s),
    'usage_rows', (select coalesce(json_agg(json_build_object('scope', u.scope, 'scope_key', u.scope_key, 'date_key', u.date_key::text) order by u.scope, u.scope_key, u.date_key), '[]'::json) from ai_usage u),
    'cache_rows', (select coalesce(json_agg(c.id order by c.id), '[]'::json) from ai_response_cache c),
    'feedback_rows', (select coalesce(json_agg(f.id order by f.id), '[]'::json) from feedback_reports f),
    'progress_rows', (select coalesce(json_agg(p.id order by p.id), '[]'::json) from student_progress p),
    'reservation_rows', (select coalesce(json_agg(r.id order by r.id), '[]'::json) from ai_llm_reservations r),
    'student_scope_owner_check', (select count(*) from ai_usage u where u.scope = 'student' and not exists (select 1 from ai_llm_reservations r join tutor_sessions s on s.id = r.session_id where r.student_key_hash = u.scope_key and s.user_id = any(${targets}))),
    'retained_user_ids', (select coalesce(json_agg(u.id order by u.id), '[]'::json) from users u where u.id <> all(${pilot})),
    'actor', (select json_build_object('exists', count(*) > 0, 'professor', bool_or(u.user_type = 'human' and u.status = 'active' and ur.role_id = 'professor' and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now()))) from users u left join user_roles ur on ur.user_id = u.id where u.id = ${sqlLiteral(actorUserId)}),
    'temporary_roles', (select coalesce(json_agg(json_build_object(
      'name', r.rolname,
      'login', r.rolcanlogin,
      'bypassrls', r.rolbypassrls,
      'superuser', r.rolsuper,
      'createdb', r.rolcreatedb,
      'createrole', r.rolcreaterole,
      'replication', r.rolreplication,
      'expires', r.rolvaliduntil,
      'active_sessions', (select count(*) from pg_stat_activity a where a.usename = r.rolname),
      'owned_objects', (select count(*) from pg_class c where c.relowner = r.oid) + (select count(*) from pg_proc p where p.proowner = r.oid) + (select count(*) from pg_namespace n where n.nspowner = r.oid) + (select count(*) from pg_database d where d.datdba = r.oid)
    ) order by r.rolname), '[]'::json) from pg_roles r where r.rolname ~ '^(integrity_audit|backup_export)_[0-9a-f]{16}$'),
    'staff_users_exist', (select count(*) from users u where u.id = any(${staff})) = ${staffTrialUserIds.length}
  ) as plan`;
}

function jsonRows(output) {
  if (Array.isArray(output)) return output;
  if (output && Array.isArray(output.rows)) return output.rows;
  return [];
}

export function firstJsonColumn(output, column) {
  const row = jsonRows(output)[0];
  const value = row?.[column];
  if (value === undefined || value === null) {
    throw new PilotCleanupError(
      `The database returned no ${column} result.`,
      "query_result_unavailable",
    );
  }
  return typeof value === "string" ? JSON.parse(value) : value;
}

export function buildCleanupManifest({
  changeTicket,
  context,
  plan,
  retentionDecision,
  temporaryRoleHashes = [],
}) {
  const inventory = plan.inventory;
  const syntheticIds = context.syntheticQuestionIds;
  const pilotIds = context.pilotTestUserIds;
  const staffIds = context.staffTrialUserIds;
  const approvedOwners = new Set([...pilotIds, ...staffIds]);
  const problems = [];

  if (
    !Array.isArray(inventory.ledger.targets) ||
    inventory.ledger.targets.length !== 1 ||
    inventory.ledger.targets[0] !== "production"
  ) {
    problems.push("ledger_target_not_production");
  }
  if (inventory.marker_findings.non_production_ledgers !== 0) {
    problems.push("non_production_ledger_rows");
  }
  const syntheticRows = plan.synthetic_questions ?? [];
  if (syntheticRows.length !== syntheticIds.length) {
    problems.push("synthetic_question_missing");
  }
  const records = Object.fromEntries(
    CLEANUP_TABLES.map((spec) => [spec.table, []]),
  );
  for (const question of syntheticRows) {
    if (
      question.record_state !== "archived" ||
      question.visibility !== "private" ||
      question.published_version_id !== null ||
      question.in_public_view ||
      !question.marker_match
    ) {
      problems.push(`synthetic_question_scope:${safeHash(question.id)}`);
    }
    if (
      Number(question.cache_rows) !== 0 ||
      Number(question.retrieval_chunks) !== 0 ||
      Number(question.attempts) !== 0 ||
      Number(question.feedback) !== 0 ||
      Number(question.progress) !== 0 ||
      Number(question.availability) !== 0 ||
      Number(question.approval_history) !== 0
    ) {
      problems.push(
        `synthetic_question_unexpected_graph:${safeHash(question.id)}`,
      );
    }
    for (const id of question.versions) {
      records.question_versions.push({ id: String(id) });
    }
    for (const id of question.version_lifecycle) {
      records.question_version_lifecycle.push({
        question_version_id: String(id),
      });
    }
    for (const id of question.lifecycle_events) {
      records.question_lifecycle_events.push({ id: String(id) });
    }
    for (const inspection of question.inspections) {
      records.question_version_inspections.push({
        professor_user_id: String(inspection.professor_user_id),
        question_version_id: String(inspection.question_version_id),
      });
    }
    for (const id of question.hints) records.hints.push({ id: String(id) });
    for (const id of question.solution_steps) {
      records.solution_steps.push({ id: String(id) });
    }
    for (const id of question.misconceptions) {
      records.misconceptions.push({ id: String(id), question_id: question.id });
    }
    records.questions.push({ id: question.id });
  }

  const targetUsers = plan.target_users ?? [];
  const foundUserIds = new Set(targetUsers.map((user) => user.id));
  for (const id of [...pilotIds, ...staffIds]) {
    if (!foundUserIds.has(id)) problems.push(`user_missing:${safeHash(id)}`);
  }
  for (const user of targetUsers) {
    if (user.pilot_test) {
      if (user.user_type !== "human") {
        problems.push(`pilot_user_not_human:${safeHash(user.id)}`);
      }
      if (Number(user.academic_references) !== 0) {
        problems.push(`pilot_user_owns_academic_history:${safeHash(user.id)}`);
      }
      for (const role of user.roles) {
        records.user_roles.push({ role_id: String(role), user_id: user.id });
      }
      records.users.push({ id: user.id });
    }
    for (const id of user.progress) {
      records.student_progress.push({ id: String(id) });
    }
  }

  const sessions = plan.sessions ?? [];
  const sessionIds = new Set();
  for (const session of sessions) {
    if (
      session.anonymous ||
      !session.user_id ||
      !approvedOwners.has(String(session.user_id))
    ) {
      problems.push(`session_not_pre_pilot:${safeHash(session.id)}`);
      continue;
    }
    sessionIds.add(session.id);
    records.tutor_sessions.push({ id: session.id });
    for (const id of session.attempts)
      records.attempts.push({ id: String(id) });
    for (const id of session.reservations) {
      records.ai_llm_reservations.push({ id: String(id) });
    }
    for (const id of session.feedback) {
      records.feedback_reports.push({ id: String(id) });
    }
    for (const id of session.progress) {
      records.student_progress.push({ id: String(id) });
    }
  }
  if (Number(inventory.anonymous_sessions) !== 0) {
    problems.push("anonymous_sessions_present");
  }
  if (Number(inventory.counts.anonymous_identity_claims) !== 0) {
    problems.push("anonymous_identity_claims_present");
  }
  if (Number(plan.student_scope_owner_check) !== 0) {
    problems.push("student_usage_without_pre_pilot_owner");
  }
  const feedbackIds = new Set(records.feedback_reports.map((row) => row.id));
  for (const id of plan.feedback_rows ?? []) {
    if (!feedbackIds.has(String(id))) {
      problems.push(`feedback_without_pre_pilot_session:${safeHash(id)}`);
    }
  }
  const reservationIds = new Set(
    records.ai_llm_reservations.map((row) => row.id),
  );
  for (const id of plan.reservation_rows ?? []) {
    if (!reservationIds.has(String(id))) {
      problems.push(`reservation_without_pre_pilot_session:${safeHash(id)}`);
    }
  }
  const progressIds = new Set(records.student_progress.map((row) => row.id));
  for (const id of plan.progress_rows ?? []) {
    if (!progressIds.has(String(id))) {
      problems.push(`progress_without_pre_pilot_owner:${safeHash(id)}`);
    }
  }
  records.student_progress = [...progressIds].map((id) => ({ id }));

  // AI usage counters and response-cache rows carry no student identity of
  // their own. They are listed explicitly only when every session owner in the
  // database is a pre-pilot identity, which the checks above establish.
  if (
    !problems.some((problem) => problem.startsWith("session_not_pre_pilot"))
  ) {
    for (const row of plan.usage_rows ?? []) {
      records.ai_usage.push({
        date_key: String(row.date_key),
        scope: String(row.scope),
        scope_key: String(row.scope_key),
      });
    }
    for (const id of plan.cache_rows ?? []) {
      records.ai_response_cache.push({ id: String(id) });
    }
  }

  if (!plan.actor?.exists || !plan.actor?.professor) {
    problems.push("actor_not_active_professor");
  }
  if (pilotIds.includes(context.actorUserId)) {
    problems.push("actor_is_removed_identity");
  }
  if (!plan.staff_users_exist) {
    problems.push("staff_user_missing");
  }

  const temporaryRoles = [];
  const roleRows = plan.temporary_roles ?? [];
  for (const hash of temporaryRoleHashes) {
    const matches = roleRows.filter((role) => safeHash(role.name) === hash);
    if (matches.length !== 1) {
      problems.push(`temporary_role_not_found:${hash}`);
      continue;
    }
    const role = matches[0];
    if (
      role.superuser ||
      role.createdb ||
      role.createrole ||
      role.replication ||
      Number(role.active_sessions) !== 0 ||
      Number(role.owned_objects) !== 0
    ) {
      problems.push(`temporary_role_not_removable:${hash}`);
      continue;
    }
    temporaryRoles.push({ hash, name: String(role.name) });
  }
  for (const role of roleRows) {
    if (!temporaryRoleHashes.includes(safeHash(role.name))) {
      problems.push(`temporary_role_unreviewed:${safeHash(role.name)}`);
    }
  }

  if (problems.length > 0) {
    const error = new PilotCleanupError(
      `The cleanup plan failed closed: ${problems.join(", ")}.`,
      "plan_rejected",
    );
    error.problems = problems;
    throw error;
  }

  const manifest = {
    actorUserId: context.actorUserId,
    artifactVersion: PILOT_CLEANUP_MANIFEST_VERSION,
    changeTicket,
    expectedBeforeCounts: Object.fromEntries(
      INVENTORY_TABLES.map((table) => [
        table,
        Number(inventory.counts[table] ?? 0),
      ]),
    ),
    identities: {
      pilotTestUserIds: [...pilotIds].sort(),
      retainedUserIds: [...(plan.retained_user_ids ?? [])].map(String).sort(),
      staffTrialUserIds: [...staffIds].sort(),
      syntheticQuestionIds: [...syntheticIds].sort(),
      temporaryRoles: temporaryRoles.sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    },
    ledger: {
      count: Number(inventory.ledger.count),
      fingerprint: safeHash(String(inventory.ledger.rows ?? "")),
      target: "production",
    },
    protectedCatalog: {
      publishedQuestionIds: [...(inventory.published_question_ids ?? [])]
        .map(String)
        .sort(),
    },
    records: Object.fromEntries(
      CLEANUP_TABLES.map((spec) => [
        spec.table,
        [...records[spec.table]].sort((a, b) =>
          recordKeyString(a, spec).localeCompare(recordKeyString(b, spec)),
        ),
      ]),
    ),
    retentionDecision,
    target: "production",
  };
  return validateCleanupManifest(manifest);
}

function keyPredicate(spec, rows) {
  if (spec.keys.length === 1) {
    const column = spec.keys[0];
    const type = spec.types[0];
    const arrayType =
      type === "bigint" ? "bigint[]" : type === "date" ? "date[]" : "text[]";
    return `${column} = any(array[${rows
      .map((row) => typedLiteral(row[column], type))
      .join(", ")}]::${arrayType})`;
  }
  const tuple = `(${spec.keys.join(", ")})`;
  const values = rows
    .map(
      (row) =>
        `(${spec.keys
          .map((column, index) => typedLiteral(row[column], spec.types[index]))
          .join(", ")})`,
    )
    .join(", ");
  return `${tuple} in (${values})`;
}

function raise(condition, message) {
  return `  if ${condition} then\n    raise exception 'PILOT_CLEANUP: ${message.replace(/'/g, "''")}';\n  end if;`;
}

export function buildCleanupStatements(manifest) {
  const validated = validateCleanupManifest(manifest);
  const synthetic = sqlTextArray(validated.identities.syntheticQuestionIds);
  const pilot = sqlTextArray(validated.identities.pilotTestUserIds);
  const retained = sqlTextArray(validated.identities.retainedUserIds);
  const catalog = sqlTextArray(validated.protectedCatalog.publishedQuestionIds);
  const owners = sqlTextArray([
    ...validated.identities.pilotTestUserIds,
    ...validated.identities.staffTrialUserIds,
  ]);
  const sessionRows = validated.records.tutor_sessions;
  const sessionPredicate =
    sessionRows.length > 0
      ? keyPredicate(
          CLEANUP_TABLES.find((s) => s.table === "tutor_sessions"),
          sessionRows,
        )
      : "false";
  const countChecks = INVENTORY_TABLES.map((table) =>
    raise(
      `(select count(*) from ${table}) <> ${validated.expectedBeforeCounts[table]}`,
      `${table} row count differs from the planned snapshot`,
    ),
  ).join("\n");
  const existenceChecks = CLEANUP_TABLES.filter(
    (spec) => validated.records[spec.table].length > 0,
  )
    .map((spec) =>
      raise(
        `(select count(*) from ${spec.table} where ${keyPredicate(spec, validated.records[spec.table])}) <> ${validated.records[spec.table].length}`,
        `${spec.table} target records are not all present`,
      ),
    )
    .join("\n");
  const questionSpec = CLEANUP_TABLES.find(
    (spec) => spec.table === "questions",
  );
  const questionRows = validated.records.questions;
  // The question row and its immutable versions reference each other, so the
  // question's version pointers are cleared first, then the versions go, then
  // the question row itself.
  const pointerReset =
    questionRows.length > 0
      ? `  update questions set working_version_id = null, published_version_id = null where ${keyPredicate(questionSpec, questionRows)};\n  get diagnostics affected = row_count;\n${raise(`affected <> ${questionRows.length}`, "questions pointer reset count differs")}`
      : "";
  const deletes = CLEANUP_TABLES.filter(
    (spec) => validated.records[spec.table].length > 0,
  )
    .map((spec) => {
      const expected = validated.records[spec.table].length;
      const predicate = keyPredicate(spec, validated.records[spec.table]);
      const prefix =
        spec.table === "question_versions" ? `${pointerReset}\n` : "";
      return `${prefix}  delete from ${spec.table} where ${predicate};\n  get diagnostics affected = row_count;\n${raise(
        `affected <> ${expected}`,
        `${spec.table} expected ${expected} row(s)`,
      )}`;
    })
    .join("\n");
  const afterCounts = Object.fromEntries(
    INVENTORY_TABLES.map((table) => {
      const removed = CLEANUP_TABLES.some((spec) => spec.table === table)
        ? validated.records[table].length
        : 0;
      return [table, validated.expectedBeforeCounts[table] - removed];
    }),
  );
  // The cleanup itself appends exactly one audit row.
  afterCounts.audit_events += 1;
  const afterChecks = INVENTORY_TABLES.map((table) =>
    raise(
      `(select count(*) from ${table}) <> ${afterCounts[table]}`,
      `${table} row count after cleanup differs from the plan`,
    ),
  ).join("\n");
  const removedCounts = Object.fromEntries(
    CLEANUP_TABLES.map((spec) => [
      spec.table,
      validated.records[spec.table].length,
    ]),
  );
  const auditMetadata = JSON.stringify({
    changeTicket: validated.changeTicket,
    ledgerFingerprint: validated.ledger.fingerprint,
    protectedCatalogCount:
      validated.protectedCatalog.publishedQuestionIds.length,
    protectedCatalogFingerprint: safeHash(
      validated.protectedCatalog.publishedQuestionIds.join("|"),
    ),
    removedRecords: removedCounts,
    retentionDecision: validated.retentionDecision,
    syntheticQuestionFingerprints:
      validated.identities.syntheticQuestionIds.map(safeHash),
    pilotTestUserFingerprints:
      validated.identities.pilotTestUserIds.map(safeHash),
  });
  const triggerNames = SUSPENDED_TRIGGERS.map((entry) =>
    sqlLiteral(entry.trigger),
  ).join(", ");

  const disableStatements = SUSPENDED_TRIGGERS.map(
    (entry) => `alter table ${entry.table} disable trigger ${entry.trigger};`,
  );
  const enableStatements = SUSPENDED_TRIGGERS.map(
    (entry) => `alter table ${entry.table} enable trigger ${entry.trigger};`,
  );
  return [
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '120s';",
    "set local app.lifecycle_write = 'allowed';",
    `select pg_advisory_xact_lock(${PILOT_CLEANUP_LOCK_ID}::bigint);`,
    `do $pilot_cleanup_preconditions$
declare
  catalog text[];
begin
${raise(`(select count(*) from schema_migrations) <> ${validated.ledger.count}`, "migration ledger count differs from the plan")}
${raise("exists (select 1 from schema_migrations where target <> 'production')", "migration ledger is not a production ledger")}
${raise(`(select left(encode(sha256(convert_to(coalesce(string_agg(version::text || ':' || filename || ':' || checksum || ':' || target, '|' order by version), ''), 'UTF8')), 'hex'), 16) from schema_migrations) <> ${sqlLiteral(validated.ledger.fingerprint)}`, "migration ledger fingerprint differs from the plan")}
${countChecks}
  select coalesce(array_agg(id order by id), array[]::text[]) into catalog from app_public_questions;
${raise(`catalog is distinct from ${catalog}`, "published catalog differs from the approved manifest")}
${raise(`exists (select 1 from questions q where q.id = any(${synthetic}) and (q.record_state <> 'archived' or q.visibility <> 'private' or q.published_version_id is not null or exists (select 1 from app_public_questions v where v.id = q.id)))`, "a synthetic question is not archived, private, and hidden")}
${raise(`exists (select 1 from questions q where q.id = any(${synthetic}) and concat_ws(' ', q.id, q.title) !~* ${sqlLiteral(MARKER_PATTERN)})`, "a synthetic question no longer carries an explicit marker")}
${raise(`exists (select 1 from users u where u.id = any(${pilot}) and u.id = any(${retained}))`, "a pilot-test user is also listed as retained")}
${raise(`exists (select 1 from users u where u.id = any(${pilot}) and u.user_type <> 'human')`, "a pilot-test identity is not a human account")}
${raise(`exists (select 1 from question_versions v where v.created_by_user_id = any(${pilot})) or exists (select 1 from questions q where q.reviewed_by_user_id = any(${pilot})) or exists (select 1 from question_approval_history a where a.reviewer_user_id = any(${pilot})) or exists (select 1 from question_lifecycle_events e where e.actor_user_id = any(${pilot}) or e.requested_by_user_id = any(${pilot}) or e.executed_by_user_id = any(${pilot})) or exists (select 1 from question_version_inspections i where i.professor_user_id = any(${pilot})) or exists (select 1 from question_patterns p where p.reviewed_by_user_id = any(${pilot})) or exists (select 1 from approved_content_imports i where i.signed_by_user_id = any(${pilot})) or exists (select 1 from anonymous_identity_claims c where c.claimed_by_user_id = any(${pilot}))`, "a pilot-test identity owns academic or claim history and cannot be removed")}
${raise(`exists (select 1 from tutor_sessions s where ${sessionPredicate} and (s.anonymous_user_id is not null or s.user_id is null or s.user_id <> all(${owners})))`, "a target session is not owned by an approved pre-pilot identity")}
${raise(`exists (select 1 from tutor_sessions s where not (${sessionPredicate}))`, "a session outside the approved manifest exists")}
${raise("exists (select 1 from tutor_sessions where anonymous_user_id is not null)", "anonymous student sessions exist")}
${raise(`exists (select 1 from users u join user_roles ur on ur.user_id = u.id where u.id = ${sqlLiteral(validated.actorUserId)} and u.user_type = 'human' and u.status = 'active' and ur.role_id = 'professor' and ur.revoked_at is null and (ur.expires_at is null or ur.expires_at > now())) = false`, "the cleanup actor is not an active human professor")}
${existenceChecks}
  create temp table pilot_cleanup_audit_snapshot on commit drop as
    select count(*)::bigint as row_count,
      md5(coalesce(string_agg(concat_ws('|', id::text, actor_subject, action, entity_type, entity_id, outcome, coalesce(request_id, ''), coalesce(metadata_json::text, ''), occurred_at::text, created_at::text), E'\\n' order by id), '')) as content_hash
    from audit_events;
end
$pilot_cleanup_preconditions$;`,
    ...disableStatements,
    `do $pilot_cleanup_deletes$
declare
  affected bigint;
begin
${deletes}
end
$pilot_cleanup_deletes$;`,
    ...enableStatements,
    `do $pilot_cleanup_postconditions$
declare
  catalog text[];
  snapshot record;
begin
${raise(`(select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and t.tgname in (${triggerNames}) and t.tgenabled = 'O') <> ${SUSPENDED_TRIGGERS.length}`, "an append-only guard was not re-enabled")}
${raise("exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relnamespace = 'public'::regnamespace and t.tgenabled not in ('O', 'A'))", "a trigger remains disabled")}
  select coalesce(array_agg(id order by id), array[]::text[]) into catalog from app_public_questions;
${raise(`catalog is distinct from ${catalog}`, "published catalog changed during cleanup")}
  select * into snapshot from pilot_cleanup_audit_snapshot;
${raise("(select count(*) from audit_events) <> snapshot.row_count", "retained audit history row count changed")}
${raise(`(select md5(coalesce(string_agg(concat_ws('|', id::text, actor_subject, action, entity_type, entity_id, outcome, coalesce(request_id, ''), coalesce(metadata_json::text, ''), occurred_at::text, created_at::text), E'\\n' order by id), '')) from audit_events) <> snapshot.content_hash`, "retained audit history content changed")}
${raise(`exists (select 1 from audit_events ae where ae.actor_user_id = any(${pilot}))`, "an audit row still points at a removed identity")}
${raise(`exists (select 1 from questions q where concat_ws(' ', q.id, q.title) ~* ${sqlLiteral(MARKER_PATTERN)} or q.reviewed_by_user_id = 'system:schema-migration')`, "a marker question remains")}
${raise(`exists (select 1 from users u where u.user_type = 'human' and concat_ws(' ', u.id, u.identity_provider, u.external_subject, u.email, u.display_name) ~* ${sqlLiteral(MARKER_PATTERN)})`, "a marker user remains")}
${raise(`exists (select 1 from users u where u.id = any(${pilot}))`, "a pilot-test identity remains")}
${raise(`exists (select 1 from questions q where q.id = any(${synthetic}))`, "a synthetic question remains")}
${raise(`(select count(*) from users u where u.id = any(${retained})) <> ${validated.identities.retainedUserIds.length}`, "a retained user is missing")}
  insert into audit_events (
    actor_user_id, actor_subject, action, entity_type, entity_id, outcome, metadata_json
  ) values (
    ${sqlLiteral(validated.actorUserId)}, ${sqlLiteral(validated.actorUserId)}, ${sqlLiteral(PILOT_CLEANUP_AUDIT_ACTION)}, 'database', 'production', 'success', ${sqlLiteral(auditMetadata)}::jsonb
  );
${afterChecks}
end
$pilot_cleanup_postconditions$;`,
    "commit;",
  ];
}

export function buildCleanupSql(manifest) {
  return `${buildCleanupStatements(manifest).join("\n")}\n`;
}

export function buildTemporaryRoleCleanupSql(role) {
  if (!TEMPORARY_ROLE_PATTERN.test(String(role?.name ?? ""))) {
    throw new PilotCleanupError(
      "Only an exact temporary audit or backup role name can be removed.",
      "invalid_manifest",
    );
  }
  const quoted = `"${role.name}"`;
  return `begin;
do $pilot_role_cleanup$
begin
${raise(`(select count(*) from pg_roles where rolname = ${sqlLiteral(role.name)}) <> 1`, "temporary role is not present")}
${raise(`(select count(*) from pg_stat_activity where usename = ${sqlLiteral(role.name)}) <> 0`, "temporary role has active sessions")}
${raise(`exists (select 1 from pg_roles where rolname = ${sqlLiteral(role.name)} and (rolsuper or rolcreatedb or rolcreaterole or rolreplication))`, "temporary role holds administrative attributes")}
end
$pilot_role_cleanup$;
grant ${quoted} to postgres;
drop owned by ${quoted};
drop role ${quoted};
commit;
select (select count(*) from pg_roles where rolname = ${sqlLiteral(role.name)}) as remaining_named_roles,
  (select count(*) from pg_roles where rolname ~ '^(integrity_audit|backup_export)_[0-9a-f]{16}$') as remaining_temporary_roles;
`;
}

export function cleanupSqlSha256(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

export function sanitizeInventory(inventory) {
  const counts = Object.fromEntries(
    INVENTORY_TABLES.map((table) => [
      table,
      Number(inventory?.counts?.[table] ?? 0),
    ]),
  );
  const published = [...(inventory?.published_question_ids ?? [])]
    .map(String)
    .sort();
  return {
    anonymousSessions: Number(inventory?.anonymous_sessions ?? 0),
    archivedQuestions: Number(inventory?.archived_questions ?? 0),
    auditHistory: {
      contentHash: safeHash(
        String(inventory?.audit_snapshot?.content_hash ?? ""),
      ),
      rowCount: Number(inventory?.audit_snapshot?.row_count ?? 0),
    },
    cleanupAuditRows: Number(inventory?.cleanup_audit_rows ?? 0),
    counts,
    databaseName: String(inventory?.database_name ?? ""),
    disabledConstraintTriggers: Number(
      inventory?.disabled_constraint_triggers ?? 0,
    ),
    disabledTriggers: Number(inventory?.disabled_triggers ?? 0),
    humanUserFingerprints: [...(inventory?.human_user_ids ?? [])]
      .map((id) => safeHash(String(id)))
      .sort(),
    ledger: {
      count: Number(inventory?.ledger?.count ?? 0),
      fingerprint: safeHash(String(inventory?.ledger?.rows ?? "")),
      targets: [...(inventory?.ledger?.targets ?? [])].map(String),
    },
    managedTriggerCount: Number(inventory?.managed_trigger_count ?? 0),
    markerFindings: {
      anonymousSessions: Number(
        inventory?.marker_findings?.anonymous_sessions ?? 0,
      ),
      auditActors: Number(inventory?.marker_findings?.audit_actors ?? 0),
      humanUsers: Number(inventory?.marker_findings?.human_users ?? 0),
      nonProductionLedgers: Number(
        inventory?.marker_findings?.non_production_ledgers ?? 0,
      ),
      questions: Number(inventory?.marker_findings?.questions ?? 0),
    },
    observedAt: String(inventory?.observed_at ?? ""),
    publishedCatalog: {
      count: published.length,
      fingerprint: safeHash(published.join("|")),
    },
    sessionOwnerCount: (inventory?.session_owner_hashes ?? []).length,
    temporaryRoles: (inventory?.temporary_roles ?? []).map((role) => ({
      bypassRls: Boolean(role.bypassrls),
      expires: role.expires ? "bounded" : "unbounded",
      login: Boolean(role.login),
      roleHash: safeHash(String(role.name)),
    })),
  };
}

export function summarizeManifest(manifest, manifestText) {
  const validated = validateCleanupManifest(manifest);
  return {
    actorFingerprint: safeHash(validated.actorUserId),
    changeTicket: validated.changeTicket,
    expectedBeforeCounts: validated.expectedBeforeCounts,
    identities: {
      pilotTestUserFingerprints:
        validated.identities.pilotTestUserIds.map(safeHash),
      retainedUserCount: validated.identities.retainedUserIds.length,
      staffTrialUserFingerprints:
        validated.identities.staffTrialUserIds.map(safeHash),
      syntheticQuestionFingerprints:
        validated.identities.syntheticQuestionIds.map(safeHash),
      temporaryRoleHashes: validated.identities.temporaryRoles.map(
        (role) => role.hash,
      ),
    },
    ledger: validated.ledger,
    protectedCatalog: {
      count: validated.protectedCatalog.publishedQuestionIds.length,
      fingerprint: safeHash(
        validated.protectedCatalog.publishedQuestionIds.join("|"),
      ),
    },
    recordCounts: Object.fromEntries(
      CLEANUP_TABLES.map((spec) => [
        spec.table,
        validated.records[spec.table].length,
      ]),
    ),
    recordFingerprints: Object.fromEntries(
      CLEANUP_TABLES.map((spec) => [
        spec.table,
        safeHash(
          validated.records[spec.table]
            .map((row) => recordKeyString(row, spec))
            .join("\n"),
        ),
      ]),
    ),
    retentionDecision: validated.retentionDecision,
    sha256: manifestText ? manifestSha256(manifestText) : undefined,
    totalRecords: CLEANUP_TABLES.reduce(
      (sum, spec) => sum + validated.records[spec.table].length,
      0,
    ),
  };
}

export function expectedAfterCounts(manifest) {
  const validated = validateCleanupManifest(manifest);
  const counts = Object.fromEntries(
    INVENTORY_TABLES.map((table) => {
      const removed = CLEANUP_TABLES.some((spec) => spec.table === table)
        ? validated.records[table].length
        : 0;
      return [table, validated.expectedBeforeCounts[table] - removed];
    }),
  );
  counts.audit_events += 1;
  return counts;
}

export function verifyCleanupOutcome({ after, before, manifest }) {
  const validated = validateCleanupManifest(manifest);
  const expected = expectedAfterCounts(validated);
  const problems = [];
  for (const table of INVENTORY_TABLES) {
    if (before.counts[table] !== validated.expectedBeforeCounts[table]) {
      problems.push(`before_count:${table}`);
    }
    if (after.counts[table] !== expected[table]) {
      problems.push(`after_count:${table}`);
    }
  }
  const catalogFingerprint = safeHash(
    validated.protectedCatalog.publishedQuestionIds.join("|"),
  );
  if (
    before.publishedCatalog.fingerprint !== catalogFingerprint ||
    after.publishedCatalog.fingerprint !== catalogFingerprint
  ) {
    problems.push("published_catalog");
  }
  if (
    after.auditHistory.rowCount !== before.auditHistory.rowCount + 1 ||
    after.cleanupAuditRows !== before.cleanupAuditRows + 1
  ) {
    problems.push("audit_history");
  }
  if (
    Object.values(after.markerFindings).some((count) => count !== 0) ||
    after.anonymousSessions !== 0 ||
    after.disabledTriggers !== 0 ||
    after.disabledConstraintTriggers !== 0 ||
    after.managedTriggerCount !== SUSPENDED_TRIGGERS.length
  ) {
    problems.push("residual_findings");
  }
  if (
    before.ledger.fingerprint !== validated.ledger.fingerprint ||
    after.ledger.fingerprint !== validated.ledger.fingerprint
  ) {
    problems.push("ledger");
  }
  const pilotHashes = new Set(
    validated.identities.pilotTestUserIds.map(safeHash),
  );
  if (after.humanUserFingerprints.some((hash) => pilotHashes.has(hash))) {
    problems.push("pilot_identity_remains");
  }
  return { problems, status: problems.length === 0 ? "passed" : "failed" };
}
