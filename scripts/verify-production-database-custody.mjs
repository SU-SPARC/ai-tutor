#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import {
  CREDENTIAL_SPECS,
  DatabaseCustodyError,
  credentialInputs,
  expectedCustodyTarget,
  requiredSafeLabel,
  roleViolations,
  summarizeTopology,
  summarizeVercelCredentialPlacement,
} from "./lib/database-custody.mjs";
import {
  assertDatabaseTargetFingerprint,
  connectedDatabaseFingerprint,
  fingerprintDatabaseUrl,
  safeHash,
  summarizeMigrationStatus,
  writeIntegrityEvidence,
} from "./lib/database-integrity-evidence.mjs";
import { parseFirstJsonValue } from "./lib/database-backup-evidence.mjs";
import {
  getMigrationStatus,
  loadMigrations,
  normalizeMigrationDatabaseUrl,
} from "./lib/database-migrations.mjs";

const { Pool } = pg;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PROTECTED_RUNTIME_TABLES = Object.freeze([
  "approved_content_imports",
  "question_patterns",
  "retrieval_chunks",
  "roles",
  "schema_migrations",
  "student_progress",
  "topics",
]);
const RUNTIME_FUNCTIONS = Object.freeze([
  "app_answer_number(text,boolean)",
  "app_answer_parse_tokens(text[],integer,integer)",
  "app_answer_spec_failures(jsonb)",
  "app_publication_json_item_text(jsonb)",
  "app_publication_numeric_answer_matches(text,double precision,double precision)",
  "app_question_publication_gate_failures(text,bigint,text)",
  "app_question_snapshot(text)",
  "app_record_question_version(text)",
  "app_record_question_version_inspection(text,bigint,text)",
  "app_transition_question_version(text,bigint,text,text,text,text,text,text,text,text,jsonb)",
  "app_user_can_review(text)",
]);
const RUNTIME_WRITE_PRIVILEGES = new Set(
  Object.entries({
    DELETE: ["hints", "misconceptions", "solution_steps"],
    INSERT: [
      "ai_llm_reservations",
      "ai_response_cache",
      "ai_usage",
      "anonymous_identity_claims",
      "attempts",
      "audit_events",
      "feedback_reports",
      "hints",
      "misconceptions",
      "question_approval_history",
      "question_lifecycle_events",
      "question_reserve_events",
      "question_student_availability",
      "question_version_inspections",
      "question_version_lifecycle",
      "question_versions",
      "questions",
      "solution_steps",
      "student_content_availability_events",
      "topic_student_availability",
      "tutor_sessions",
      "user_roles",
      "users",
    ],
    UPDATE: [
      "ai_llm_reservations",
      "ai_response_cache",
      "ai_usage",
      "attempts",
      "feedback_reports",
      "question_student_availability",
      "question_version_lifecycle",
      "questions",
      "topic_student_availability",
      "tutor_sessions",
      "user_roles",
      "users",
    ],
  }).flatMap(([privilege, tables]) =>
    tables.map((table) => `${table}:${privilege}`),
  ),
);

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }

  const expected = expectedCustodyTarget(process.env);
  const changeTicket = requiredSafeLabel(
    process.env.CUSTODY_CHANGE_TICKET,
    "CUSTODY_CHANGE_TICKET",
  );
  const urls = credentialInputs(process.env);
  const migrations = await loadMigrations(
    path.join(repositoryRoot, "db/migrations"),
  );
  const vercel = readVercelCredentialPlacement({ phase: options.phase });
  const credentials = {};
  let rls;

  for (const spec of CREDENTIAL_SPECS) {
    const inspection = await inspectCredential({
      databaseUrl: urls[spec.key],
      expected,
      migrations,
      spec,
    });
    credentials[spec.key] = inspection.credential;
    if (inspection.rls) rls = inspection.rls;
  }

  if (!rls) {
    throw new DatabaseCustodyError(
      "The runtime RLS inspection did not run.",
      "rls_inspection_unavailable",
    );
  }

  const topology = summarizeTopology({ credentials, expected, rls, vercel });
  const evidence = {
    artifactVersion: 1,
    audit: "production_database_custody",
    changeTicket,
    credentials,
    expectedFingerprint: expected,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    phase: options.phase,
    rls,
    status: topology.status,
    target: "production",
    topology,
    vercel,
    writesAttempted: 0,
  };
  if (options.evidenceDir) {
    await writeIntegrityEvidence(options.evidenceDir, evidence);
  }
  printReport(evidence, options.json);
  if (evidence.status !== "passed") process.exitCode = 2;
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = { json: false, phase: "post-rotation" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--evidence-dir") {
      options.evidenceDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--phase") {
      options.phase = requiredArgumentValue(args, ++index, argument);
    } else {
      throw new DatabaseCustodyError(
        `Unknown custody-verification option: ${argument}.`,
        "invalid_option",
      );
    }
  }
  if (!new Set(["pre-rotation", "post-rotation"]).has(options.phase)) {
    throw new DatabaseCustodyError(
      "--phase must be pre-rotation or post-rotation.",
      "invalid_verification_phase",
    );
  }
  return options;
}

export async function inspectCredential({
  databaseUrl,
  expected,
  migrations,
  spec,
}) {
  const urlFingerprint = fingerprintDatabaseUrl(databaseUrl);
  assertDatabaseTargetFingerprint(urlFingerprint, expected);
  const pool = new Pool({
    application_name: `ai-tutor-custody-${spec.key}`,
    connectionString: normalizeMigrationDatabaseUrl(databaseUrl),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
    max: 1,
    options: "-c default_transaction_read_only=on",
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("begin isolation level repeatable read read only");
    await client.query("set local statement_timeout = '60s'");
    const databaseFingerprint = await connectedDatabaseFingerprint(
      client,
      urlFingerprint,
    );
    if (databaseFingerprint.connectedDatabaseName !== expected.databaseName) {
      throw new DatabaseCustodyError(
        "A credential connected to the wrong database.",
        "database_target_mismatch",
      );
    }
    const migrationStatus = await getMigrationStatus(client, migrations);
    const migrationLedger = {
      ...summarizeMigrationStatus(migrationStatus),
      targets: [
        ...new Set(migrationStatus.applied.map((entry) => entry.target)),
      ].sort(),
    };
    const attestation = await readRoleAttestation(client);
    const violations = roleViolations(spec, attestation);
    const credential = {
      credential: spec.environmentName,
      databaseFingerprint,
      migrationLedger,
      role: {
        ...attestation,
        expectedRole: spec.roleName,
        expectedRoleHash: fingerprintRole(spec.roleName),
        violations,
      },
    };
    const rls = spec.key === "runtime" ? await readRlsEvidence(client) : null;
    await client.query("rollback");
    return { credential, rls };
  } catch (error) {
    if (client) await client.query("rollback").catch(() => {});
    if (error instanceof DatabaseCustodyError) throw error;
    const databaseCode = /^[0-9A-Z]{5}$/.test(String(error?.code ?? ""))
      ? String(error.code)
      : "unavailable";
    throw new DatabaseCustodyError(
      `The ${spec.key} credential probe failed with database code ${databaseCode}.`,
      "credential_probe_failed",
    );
  } finally {
    client?.release();
    await pool.end();
  }
}

export async function readRoleAttestation(client) {
  const result = await client.query(
    `select
       r.rolsuper as superuser,
       r.rolcreatedb as create_database,
       r.rolcreaterole as create_role,
       r.rolreplication as replication,
       r.rolbypassrls as bypass_rls,
       r.rolcanlogin as can_login,
       (select count(*)::int from pg_auth_members membership
        where membership.member = r.oid) as role_membership_count,
       coalesce(
         'default_transaction_read_only=on' = any(r.rolconfig),
         false
       ) as default_read_only,
       has_database_privilege(current_user, current_database(), 'CREATE')
         as database_create,
       has_schema_privilege(current_user, 'public', 'CREATE') as schema_create,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'm')
       ) as relation_count,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'm')
           and c.relowner = r.oid
       ) as owned_relation_count,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p', 'v', 'm')
           and not has_table_privilege(current_user, c.oid, 'SELECT')
       ) as table_select_missing_count,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p')
           and (
             has_table_privilege(current_user, c.oid, 'INSERT')
             or has_table_privilege(current_user, c.oid, 'UPDATE')
             or has_table_privilege(current_user, c.oid, 'DELETE')
             or has_table_privilege(current_user, c.oid, 'TRUNCATE')
             or has_table_privilege(current_user, c.oid, 'REFERENCES')
             or has_table_privilege(current_user, c.oid, 'TRIGGER')
           )
       ) as relation_write_count,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind in ('r', 'p')
           and c.relname = any($1::text[])
           and (
             has_table_privilege(current_user, c.oid, 'INSERT')
             or has_table_privilege(current_user, c.oid, 'UPDATE')
             or has_table_privilege(current_user, c.oid, 'DELETE')
             or has_table_privilege(current_user, c.oid, 'TRUNCATE')
             or has_table_privilege(current_user, c.oid, 'REFERENCES')
             or has_table_privilege(current_user, c.oid, 'TRIGGER')
           )
       ) as protected_write_count,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'S'
           and not has_sequence_privilege(current_user, c.oid, 'USAGE')
       ) as sequence_usage_missing_count,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'S'
           and not has_sequence_privilege(current_user, c.oid, 'SELECT')
       ) as sequence_select_missing_count,
       (
         select count(*)::int
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relkind = 'S'
           and has_sequence_privilege(current_user, c.oid, 'UPDATE')
       ) as sequence_write_count,
       (select count(*)::int from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public') as routine_count,
       (select count(*)::int from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proowner = r.oid)
         as owned_routine_count,
       (select count(*)::int from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosecdef
          and has_function_privilege(current_user, p.oid, 'EXECUTE'))
         as security_definer_execute_count,
       (select count(*)::int from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and has_function_privilege(current_user, p.oid, 'EXECUTE'))
         as executable_routine_count,
       (select count(*)::int from unnest($2::text[]) signature
        where to_regprocedure(signature) is null
          or not has_function_privilege(
            current_user,
            to_regprocedure(signature),
            'EXECUTE'
          )) as missing_runtime_function_count,
       current_user as role_name
     from pg_roles r
     where r.rolname = current_user`,
    [PROTECTED_RUNTIME_TABLES, RUNTIME_FUNCTIONS],
  );
  const row = result.rows[0];
  if (!row) {
    throw new DatabaseCustodyError(
      "Connected role metadata is unavailable.",
      "role_metadata_unavailable",
    );
  }
  const runtimeGrantRows = await client.query(`
    select table_name, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee = current_user
      and privilege_type in (
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      )
  `);
  const actualRuntimeWrites = new Set(
    runtimeGrantRows.rows.map(
      (grant) => `${grant.table_name}:${grant.privilege_type}`,
    ),
  );
  return {
    bypassRls: Boolean(row.bypass_rls),
    canLogin: Boolean(row.can_login),
    createDatabase: Boolean(row.create_database),
    createRole: Boolean(row.create_role),
    databaseCreate: Boolean(row.database_create),
    defaultReadOnly: Boolean(row.default_read_only),
    executableRoutineCount: Number(row.executable_routine_count),
    missingRuntimeFunctionCount: Number(row.missing_runtime_function_count),
    missingRuntimeWriteCount: [...RUNTIME_WRITE_PRIVILEGES].filter(
      (grant) => !actualRuntimeWrites.has(grant),
    ).length,
    ownedRelationCount: Number(row.owned_relation_count),
    ownedRoutineCount: Number(row.owned_routine_count),
    protectedWriteCount: Number(row.protected_write_count),
    relationCount: Number(row.relation_count),
    relationWriteCount: Number(row.relation_write_count),
    replication: Boolean(row.replication),
    roleMembershipCount: Number(row.role_membership_count),
    roleHash: fingerprintRole(row.role_name),
    routineCount: Number(row.routine_count),
    schemaCreate: Boolean(row.schema_create),
    securityDefinerExecuteCount: Number(row.security_definer_execute_count),
    sequenceSelectMissingCount: Number(row.sequence_select_missing_count),
    sequenceUsageMissingCount: Number(row.sequence_usage_missing_count),
    sequenceWriteCount: Number(row.sequence_write_count),
    superuser: Boolean(row.superuser),
    tableSelectMissingCount: Number(row.table_select_missing_count),
    unexpectedRuntimeWriteCount: [...actualRuntimeWrites].filter(
      (grant) => !RUNTIME_WRITE_PRIVILEGES.has(grant),
    ).length,
  };
}

export async function readRlsEvidence(client) {
  const result = await client.query(`
    select
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      count(p.policyname) filter (
        where p.roles && array['public', 'anon', 'authenticated']::name[]
      )::int as data_api_policy_count,
      count(p.policyname) filter (
        where p.policyname = 'app_runtime_full_access'
          and p.cmd = 'ALL'
          and p.permissive = 'PERMISSIVE'
          and p.roles @> array['app_runtime']::name[]
          and regexp_replace(coalesce(p.qual, ''), '[()[:space:]]', '', 'g') = 'true'
          and regexp_replace(coalesce(p.with_check, ''), '[()[:space:]]', '', 'g') = 'true'
      )::int as valid_runtime_policy_count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policies p
      on p.schemaname = n.nspname and p.tablename = c.relname
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    group by c.relname, c.relrowsecurity
    order by c.relname
  `);
  const tables = result.rows.map((row) => ({
    dataApiPolicyCount: Number(row.data_api_policy_count),
    rlsEnabled: Boolean(row.rls_enabled),
    runtimePolicyValid: Number(row.valid_runtime_policy_count) === 1,
    table: String(row.table_name),
  }));
  const grants = await client.query(`
    select
      (select count(*)::int
       from information_schema.role_table_grants
       where table_schema = 'public'
         and grantee in ('PUBLIC', 'anon', 'authenticated'))
        as table_grant_count,
      (select count(*)::int
       from information_schema.routine_privileges
       where specific_schema = 'public'
         and grantee in ('PUBLIC', 'anon', 'authenticated'))
        as routine_grant_count,
      (select count(*)::int
       from information_schema.usage_privileges
       where object_schema = 'public'
         and grantee in ('PUBLIC', 'anon', 'authenticated'))
        as usage_grant_count,
      (select count(*)::int from pg_roles
       where rolname in ('anon', 'authenticated')
         and (
           has_schema_privilege(rolname, 'public', 'USAGE')
           or has_schema_privilege(rolname, 'public', 'CREATE')
         )) as schema_grant_count
  `);
  const dataApiGrantCount =
    Number(grants.rows[0]?.table_grant_count ?? 0) +
    Number(grants.rows[0]?.routine_grant_count ?? 0) +
    Number(grants.rows[0]?.usage_grant_count ?? 0) +
    Number(grants.rows[0]?.schema_grant_count ?? 0);
  const passed =
    tables.length > 0 &&
    tables.every(
      (table) =>
        table.rlsEnabled &&
        table.runtimePolicyValid &&
        table.dataApiPolicyCount === 0,
    ) &&
    dataApiGrantCount === 0;
  return {
    dataApiGrantCount,
    status: passed ? "passed" : "failed",
    tableCount: tables.length,
    tables,
  };
}

export function readVercelCredentialPlacement({
  environment = process.env,
  phase = "post-rotation",
  spawnSyncImpl = spawnSync,
} = {}) {
  const result = spawnSyncImpl("vercel", ["env", "ls", "--json"], {
    encoding: "utf8",
    env: Object.fromEntries(
      ["HOME", "LANG", "NO_COLOR", "PATH", "VERCEL_TOKEN"].flatMap((name) =>
        environment[name] ? [[name, environment[name]]] : [],
      ),
    ),
    stdio: "pipe",
  });
  if (result?.error || result?.status !== 0) {
    throw new DatabaseCustodyError(
      "Vercel application environment metadata is unavailable.",
      "vercel_metadata_unavailable",
    );
  }
  const parsed = parseFirstJsonValue(result.stdout);
  const entries = Array.isArray(parsed)
    ? parsed
    : (parsed?.envs ?? parsed?.variables ?? parsed?.results ?? []);
  return summarizeVercelCredentialPlacement(entries, { phase });
}

function fingerprintRole(value) {
  return safeHash(String(value ?? "unknown"));
}

function requiredArgumentValue(args, index, option) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new DatabaseCustodyError(
      `${option} requires a value.`,
      "invalid_option",
    );
  }
  return value;
}

function printReport(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`Production database custody: ${report.status.toUpperCase()}`);
  console.log(`Verification phase: ${report.phase}`);
  console.log(`Target agreement: ${report.topology.targetAgreement}`);
  console.log(`Ledger agreement: ${report.topology.ledgerAgreement}`);
  console.log(`Distinct roles: ${report.topology.distinctRoleCount}/4`);
  console.log(`RLS/policy tables: ${report.rls.tableCount}`);
  console.log(`Vercel credential placement: ${report.vercel.status}`);
}

function printUsage() {
  console.log(`Usage:
  npm run db:custody:verify -- --phase <pre-rotation|post-rotation> --json

Required credentials (inject from their separate approved stores):
  DATABASE_URL, MIGRATION_DATABASE_URL, INTEGRITY_DATABASE_URL,
  BACKUP_DATABASE_URL

Required non-secret evidence:
  CUSTODY_CHANGE_TICKET
  CUSTODY_EXPECTED_PROVIDER=supabase
  CUSTODY_EXPECTED_PROJECT_HASH=<16-character safe fingerprint>
  CUSTODY_EXPECTED_DATABASE_NAME=postgres

The verifier forces read-only transactions, compares all four target and
ledger fingerprints, attests each role, checks every Production table's RLS
and app_runtime policy. Both phases confirm operator credentials are absent
from every Vercel application environment. The default post-rotation phase
also requires the runtime credential to be Production-only and all legacy
owner credentials to be absent. It never prints a URL, host,
username, password, token, or raw provider project reference.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof DatabaseCustodyError
        ? error.code
        : "verification_failed";
    console.error(`Production database custody verification failed: ${code}.`);
    process.exitCode = 1;
  });
}
