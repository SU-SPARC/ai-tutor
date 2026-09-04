#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DatabaseCustodyError,
  expectedCustodyTarget,
  productionAuthorization,
  productionMutationPrerequisites,
  requiredSafeLabel,
} from "./lib/database-custody.mjs";
import { parseFirstJsonValue } from "./lib/database-backup-evidence.mjs";
import {
  safeHash,
  writeIntegrityEvidence,
} from "./lib/database-integrity-evidence.mjs";
import { loadMigrations } from "./lib/database-migrations.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TEMPORARY_AUDIT_ROLE_PATTERN = /^integrity_audit_[0-9a-f]{16}$/;

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }
  const authorization = productionAuthorization(process.env);
  const custody = productionMutationPrerequisites(process.env);
  const expected = expectedCustodyTarget(process.env);
  assertCommandConfirmations(options, authorization, expected);
  const providerProjectRef = await readLinkedProviderProject(expected);
  const migrations = await loadMigrations(
    path.join(repositoryRoot, "db/migrations"),
  );
  const preflight = await readProductionPreflight({
    migrations,
    providerProjectRef,
    spawnSyncImpl: spawnSync,
  });

  const operationResult =
    options.operation === "provision"
      ? await provisionRoles({ providerProjectRef, spawnSyncImpl: spawnSync })
      : await removeTemporaryAuditRole({
          confirmRoleHash: options.confirmRoleHash,
          environment: process.env,
          providerProjectRef,
          spawnSyncImpl: spawnSync,
        });

  const evidence = {
    artifactVersion: 1,
    authorization,
    audit: "production_database_custody_change",
    changeTicket: authorization.changeTicket,
    custody,
    expectedFingerprint: expected,
    generatedAt: new Date().toISOString(),
    operation: options.operation,
    preflight,
    result: operationResult,
    status: "passed",
    target: "production",
  };
  await writeIntegrityEvidence(options.evidenceDir, evidence);
  printReport(evidence, options.json);
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = { confirmProduction: false, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--operation") {
      options.operation = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else if (argument === "--confirm-project-hash") {
      options.confirmProjectHash = requiredArgumentValue(
        args,
        ++index,
        argument,
      );
    } else if (argument === "--change-ticket") {
      options.changeTicket = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--confirm-role-hash") {
      options.confirmRoleHash = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--evidence-dir") {
      options.evidenceDir = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new DatabaseCustodyError(
        `Unknown custody-operation option: ${argument}.`,
        "invalid_option",
      );
    }
  }
  if (!new Set(["provision", "cleanup-expired-audit"]).has(options.operation)) {
    throw new DatabaseCustodyError(
      "--operation must be provision or cleanup-expired-audit.",
      "invalid_operation",
    );
  }
  if (!options.evidenceDir) {
    throw new DatabaseCustodyError(
      "--evidence-dir is required for every Production mutation.",
      "evidence_directory_required",
    );
  }
  if (
    options.operation === "cleanup-expired-audit" &&
    !/^[0-9a-f]{16}$/.test(options.confirmRoleHash ?? "")
  ) {
    throw new DatabaseCustodyError(
      "Cleanup requires the independently reviewed temporary role hash.",
      "role_hash_confirmation_required",
    );
  }
  return options;
}

export function assertCommandConfirmations(options, authorization, expected) {
  const ticket = requiredSafeLabel(options.changeTicket, "--change-ticket");
  if (!options.confirmProduction) {
    throw new DatabaseCustodyError(
      "Production mutation requires --confirm-production.",
      "production_confirmation_required",
    );
  }
  if (options.confirmProjectHash !== expected.projectIdentityHash) {
    throw new DatabaseCustodyError(
      "The independently confirmed project fingerprint does not match.",
      "project_confirmation_mismatch",
    );
  }
  if (ticket !== authorization.changeTicket) {
    throw new DatabaseCustodyError(
      "The command and authorization change tickets differ.",
      "change_ticket_mismatch",
    );
  }
}

async function readLinkedProviderProject(expected) {
  let linked;
  try {
    linked = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "supabase/.temp/linked-project.json"),
        "utf8",
      ),
    );
  } catch {
    throw new DatabaseCustodyError(
      "The workspace has no valid linked Supabase project metadata.",
      "provider_project_unlinked",
    );
  }
  const providerProjectRef = String(linked?.ref ?? "");
  if (
    !/^[a-z]{20}$/.test(providerProjectRef) ||
    safeHash(providerProjectRef) !== expected.projectIdentityHash
  ) {
    throw new DatabaseCustodyError(
      "The linked provider project fingerprint differs from Production.",
      "database_target_mismatch",
    );
  }
  return providerProjectRef;
}

async function readProductionPreflight({
  migrations,
  providerProjectRef,
  spawnSyncImpl,
}) {
  const output = runSupabaseQuery({
    providerProjectRef,
    spawnSyncImpl,
    sql: `begin transaction read only;
      select current_database() as database_name,
        (select json_agg(json_build_object(
          'version', version,
          'filename', filename,
          'checksum', checksum,
          'target', target
        ) order by version) from schema_migrations) as migration_rows;
      rollback;`,
  });
  const row = output.rows?.[0];
  const applied = Array.isArray(row?.migration_rows) ? row.migration_rows : [];
  if (
    row?.database_name !== "postgres" ||
    applied.length !== migrations.length
  ) {
    throw new DatabaseCustodyError(
      "Production preflight database or migration count differs.",
      "migration_preflight_failed",
    );
  }
  for (const [index, migration] of migrations.entries()) {
    const recorded = applied[index];
    if (
      Number(recorded?.version) !== migration.version ||
      recorded?.filename !== migration.filename ||
      recorded?.checksum !== migration.checksum ||
      recorded?.target !== "production"
    ) {
      throw new DatabaseCustodyError(
        "Production migration history differs from the immutable repository history.",
        "migration_preflight_failed",
      );
    }
  }
  return {
    databaseName: "postgres",
    ledgerFingerprint: safeHash(
      applied
        .map(
          (entry) =>
            `${entry.version}:${entry.filename}:${entry.checksum}:${entry.target}`,
        )
        .join("|"),
    ),
    migrationCount: applied.length,
    migrationState: "current",
    targetRows: "production",
  };
}

async function provisionRoles({ providerProjectRef, spawnSyncImpl }) {
  const runtimeSql = await readFile(
    path.join(repositoryRoot, "db/roles/app_runtime.sql"),
    "utf8",
  );
  const operatorSql = await readFile(
    path.join(repositoryRoot, "db/roles/production_operator_roles.sql"),
    "utf8",
  );
  runSupabaseQuery({
    providerProjectRef,
    spawnSyncImpl,
    sql: `begin;\n${runtimeSql}\n${operatorSql}\ncommit;`,
  });
  const output = runSupabaseQuery({
    providerProjectRef,
    spawnSyncImpl,
    sql: `begin transaction read only;
      select
        (select count(*)::int from pg_roles where rolname in
          ('app_runtime', 'app_migrator', 'integrity_audit', 'backup_export'))
          as role_count,
        (select count(*)::int from pg_roles where rolname in
          ('app_runtime', 'app_migrator', 'integrity_audit', 'backup_export')
          and rolcanlogin) as login_role_count,
        (select count(*)::int from pg_roles where rolname in
          ('app_runtime', 'app_migrator', 'integrity_audit', 'backup_export')
          and (rolsuper or rolcreatedb or rolcreaterole or rolreplication))
          as administrative_role_count,
        (select count(*)::int from pg_roles where rolname in
          ('app_runtime', 'app_migrator') and rolbypassrls)
          as unexpected_bypass_role_count,
        (select count(*)::int from pg_roles where rolname in
          ('integrity_audit', 'backup_export') and rolbypassrls)
          as read_all_role_count,
        (select count(*)::int from pg_roles where rolname in
          ('integrity_audit', 'backup_export')
          and coalesce(
            'default_transaction_read_only=on' = any(rolconfig), false
          )) as read_only_role_count,
        (select count(*)::int from pg_auth_members membership
          join pg_roles member_role on member_role.oid = membership.member
          where member_role.rolname in
            ('app_runtime', 'app_migrator', 'integrity_audit', 'backup_export'))
          as role_membership_count,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r', 'p')) as table_count,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r', 'p') and c.relrowsecurity)
          as rls_table_count,
        (select count(*)::int from pg_policies
          where schemaname = 'public'
          and policyname = 'app_runtime_full_access'
          and cmd = 'ALL'
          and permissive = 'PERMISSIVE'
          and roles @> array['app_runtime']::name[]
          and regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g') = 'true'
          and regexp_replace(coalesce(with_check, ''), '[()[:space:]]', '', 'g') = 'true')
          as runtime_policy_count;
      rollback;`,
  });
  const row = output.rows?.[0] ?? {};
  const passed =
    Number(row.role_count) === 4 &&
    Number(row.login_role_count) === 0 &&
    Number(row.administrative_role_count) === 0 &&
    Number(row.unexpected_bypass_role_count) === 0 &&
    Number(row.read_all_role_count) === 2 &&
    Number(row.read_only_role_count) === 2 &&
    Number(row.role_membership_count) === 0 &&
    Number(row.table_count) > 0 &&
    Number(row.rls_table_count) === Number(row.table_count) &&
    Number(row.runtime_policy_count) === Number(row.table_count);
  if (!passed) {
    throw new DatabaseCustodyError(
      "Post-provision role or RLS verification failed.",
      "role_provision_verification_failed",
    );
  }
  return {
    administrativeRoleCount: 0,
    loginCredentialsCreated: 0,
    loginRoleCount: 0,
    provisionedRoles: [
      "app_runtime",
      "app_migrator",
      "integrity_audit",
      "backup_export",
    ],
    readAllRoleCount: 2,
    readOnlyRoleCount: 2,
    rlsTableCount: Number(row.rls_table_count),
    roleMembershipCount: 0,
    runtimePolicyCount: Number(row.runtime_policy_count),
    tableCount: Number(row.table_count),
  };
}

export async function removeTemporaryAuditRole({
  confirmRoleHash,
  environment,
  providerProjectRef,
  spawnSyncImpl,
}) {
  const candidates =
    runSupabaseQuery({
      providerProjectRef,
      spawnSyncImpl,
      sql: `begin transaction read only;
      select r.rolname, r.rolvaliduntil, r.rolsuper, r.rolcreatedb,
        r.rolcreaterole, r.rolreplication,
        (select count(*)::int from pg_stat_activity a
         where a.usename = r.rolname) as active_session_count,
        (select count(*)::int from pg_class c
         where c.relowner = r.oid) as owned_relation_count,
        (select count(*)::int from pg_proc p
         where p.proowner = r.oid) as owned_routine_count,
        (select count(*)::int from pg_namespace n
         where n.nspowner = r.oid) as owned_schema_count,
        (select count(*)::int from pg_type t
         where t.typowner = r.oid) as owned_type_count,
        (select count(*)::int from pg_database d
         where d.datdba = r.oid) as owned_database_count,
        (select count(*)::int from pg_auth_members m
         where m.member = r.oid or m.roleid = r.oid)
          as role_membership_count
      from pg_roles r
      where r.rolname ~ '^integrity_audit_[0-9a-f]{16}$'
      order by r.rolname;
      rollback;`,
    }).rows ?? [];
  const matches = candidates.filter(
    (candidate) => safeHash(String(candidate.rolname)) === confirmRoleHash,
  );
  if (candidates.length !== 1 || matches.length !== 1) {
    throw new DatabaseCustodyError(
      "Exactly one temporary audit role must match the reviewed fingerprint.",
      "temporary_role_target_mismatch",
    );
  }
  const candidate = matches[0];
  const roleName = String(candidate.rolname);
  if (
    !TEMPORARY_AUDIT_ROLE_PATTERN.test(roleName) ||
    Number(candidate.active_session_count) !== 0 ||
    Boolean(candidate.rolsuper) ||
    Boolean(candidate.rolcreatedb) ||
    Boolean(candidate.rolcreaterole) ||
    Boolean(candidate.rolreplication) ||
    Number(candidate.owned_relation_count) !== 0 ||
    Number(candidate.owned_routine_count) !== 0 ||
    Number(candidate.owned_schema_count) !== 0 ||
    Number(candidate.owned_type_count) !== 0 ||
    Number(candidate.owned_database_count) !== 0 ||
    Number(candidate.role_membership_count) !== 0
  ) {
    throw new DatabaseCustodyError(
      "The selected temporary audit role is not safe to remove.",
      "temporary_role_not_removable",
    );
  }
  const parsedValidUntil = candidate.rolvaliduntil
    ? Date.parse(String(candidate.rolvaliduntil))
    : Number.NaN;
  const hasFiniteExpiry = Number.isFinite(parsedValidUntil);
  if (hasFiniteExpiry && parsedValidUntil > Date.now()) {
    throw new DatabaseCustodyError(
      "The selected temporary audit role has not expired.",
      "temporary_role_not_expired",
    );
  }
  if (
    !hasFiniteExpiry &&
    environment.CUSTODY_ALLOW_UNBOUNDED_AUDIT_CLEANUP !== "true"
  ) {
    throw new DatabaseCustodyError(
      "An unbounded legacy audit role requires explicit cleanup confirmation.",
      "unbounded_role_confirmation_required",
    );
  }
  const quotedRole = `"${roleName}"`;
  const output = runSupabaseQuery({
    providerProjectRef,
    spawnSyncImpl,
    sql: `begin;
      grant ${quotedRole} to postgres;
      drop owned by ${quotedRole};
      drop role ${quotedRole};
      commit;
      select count(*)::int as remaining_count from pg_roles
      where rolname ~ '^integrity_audit_[0-9a-f]{16}$';`,
  });
  const remainingTemporaryAuditRoleCount = Number(
    output.rows?.[0]?.remaining_count ?? -1,
  );
  if (remainingTemporaryAuditRoleCount !== 0) {
    throw new DatabaseCustodyError(
      "Temporary audit role cleanup did not reach the reviewed zero-role state.",
      "temporary_role_cleanup_incomplete",
    );
  }
  return {
    removedRole: "temporary_integrity_audit",
    removedRoleHash: confirmRoleHash,
    remainingTemporaryAuditRoleCount,
  };
}

export function runSupabaseQuery({ providerProjectRef, spawnSyncImpl, sql }) {
  const result = spawnSyncImpl(
    "supabase",
    [
      "db",
      "query",
      "--linked",
      "--project-ref",
      providerProjectRef,
      "--output",
      "json",
      sql,
    ],
    {
      encoding: "utf8",
      env: Object.fromEntries(
        ["HOME", "LANG", "PATH", "SUPABASE_ACCESS_TOKEN", "TMPDIR"].flatMap(
          (name) => (process.env[name] ? [[name, process.env[name]]] : []),
        ),
      ),
      stdio: "pipe",
    },
  );
  if (result?.error || result?.status !== 0) {
    throw new DatabaseCustodyError(
      "The authenticated provider database operation failed.",
      "provider_database_operation_failed",
    );
  }
  return parseFirstJsonValue(result.stdout);
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

function printReport(evidence, json) {
  if (json) {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }
  console.log(`Production custody operation: ${evidence.status.toUpperCase()}`);
  console.log(`Operation: ${evidence.operation}`);
  console.log(`Change ticket: ${evidence.changeTicket}`);
}

function printUsage() {
  console.log(`Usage:
  npm run db:custody:apply -- --operation provision \\
    --confirm-production --confirm-project-hash <safe hash> \\
    --change-ticket <ticket> --evidence-dir docs/evidence/database-custody

  npm run db:custody:apply -- --operation cleanup-expired-audit \\
    --confirm-production --confirm-project-hash <safe hash> \\
    --confirm-role-hash <safe hash> --change-ticket <ticket> \\
    --evidence-dir docs/evidence/database-custody

Every mutation requires distinct named owner and second-reviewer environment
attestations, independently verified institutional ownership, two or more MFA
recovery administrators recorded by safe fingerprint, the exact project
fingerprint, an immutable 21/21 Production ledger, and a change ticket.
Provisioning creates NOLOGIN roles and never creates, reads, prints, or stores
a credential.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof DatabaseCustodyError ? error.code : "operation_failed";
    console.error(`Production database custody operation failed: ${code}.`);
    process.exitCode = 1;
  });
}
