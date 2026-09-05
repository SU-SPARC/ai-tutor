#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CREDENTIAL_SPECS,
  DatabaseCustodyError,
  LEGACY_OWNER_DATABASE_VARIABLES,
  expectedCustodyTarget,
  productionAuthorization,
  productionMutationPrerequisites,
  requiredSafeLabel,
  summarizeTopology,
} from "./lib/database-custody.mjs";
import {
  assertDatabaseTargetFingerprint,
  fingerprintDatabaseUrl,
  safeHash,
  writeIntegrityEvidence,
} from "./lib/database-integrity-evidence.mjs";
import { loadMigrations } from "./lib/database-migrations.mjs";
import { runSupabaseQuery } from "./apply-production-database-custody.mjs";
import {
  inspectCredential,
  readVercelCredentialPlacement,
} from "./verify-production-database-custody.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const GITHUB_REPOSITORY = "SU-SPARC/ai-tutor";
const GITHUB_ENVIRONMENT = "Production";

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printUsage();
    return;
  }
  const authorization = productionAuthorization(process.env);
  const custody = productionMutationPrerequisites(process.env);
  const expected = expectedCustodyTarget(process.env);
  assertConfirmations(options, authorization, expected);
  const reviewerLogin = requiredSafeLabel(
    process.env.CUSTODY_SECOND_REVIEWER_GITHUB_LOGIN,
    "CUSTODY_SECOND_REVIEWER_GITHUB_LOGIN",
  );
  const providerProject = await readProviderProject(expected);
  await assertPoolerResolves(providerProject.poolerHost);
  const migrations = await loadMigrations(
    path.join(repositoryRoot, "db/migrations"),
  );
  const preflight = readCredentialRotationPreflight({
    expected,
    migrations,
    providerProjectRef: providerProject.ref,
  });
  const githubProtection = readGitHubEnvironmentProtection(reviewerLogin);

  const passwords = Object.fromEntries(
    CREDENTIAL_SPECS.map((spec) => [spec.key, generatePassword()]),
  );
  const urls = Object.fromEntries(
    CREDENTIAL_SPECS.map((spec) => [
      spec.key,
      buildRoleDatabaseUrl({
        password: passwords[spec.key],
        poolerHost: providerProject.poolerHost,
        projectRef: providerProject.ref,
        roleName: spec.roleName,
        transactionPooler: spec.key === "runtime",
      }),
    ]),
  );
  for (const url of Object.values(urls)) {
    assertDatabaseTargetFingerprint(fingerprintDatabaseUrl(url), expected);
  }

  let credentialsEnabled = false;
  try {
    runSecretSql({
      providerProjectRef: providerProject.ref,
      sql: credentialRotationSql(passwords),
    });
    credentialsEnabled = true;
    const { credentials, rls } = await inspectCredentialsWithRetry({
      expected,
      migrations,
      urls,
    });

    for (const spec of CREDENTIAL_SPECS.filter(
      (credential) => credential.key !== "runtime",
    )) {
      setGitHubEnvironmentSecret(spec.environmentName, urls[spec.key]);
    }
    setVercelRuntimeCredential(urls.runtime);
    removeLegacyVercelOwnerCredentials();

    const githubSecrets = readGitHubEnvironmentSecretMetadata();
    const expectedOperatorSecrets = CREDENTIAL_SPECS.filter(
      (credential) => credential.key !== "runtime",
    ).map((credential) => credential.environmentName);
    if (
      expectedOperatorSecrets.some(
        (name) => !githubSecrets.some((secret) => secret.name === name),
      )
    ) {
      throw new DatabaseCustodyError(
        "The protected operator secret store is incomplete.",
        "operator_secret_store_incomplete",
      );
    }
    const vercel = readVercelCredentialPlacement({ phase: "post-rotation" });
    const topology = summarizeTopology({ credentials, expected, rls, vercel });
    if (topology.status !== "passed") {
      throw new DatabaseCustodyError(
        "Post-rotation target, role, RLS, or placement verification failed.",
        "post_rotation_verification_failed",
      );
    }

    const evidence = {
      artifactVersion: 1,
      audit: "production_database_credential_rotation",
      authorization,
      changeTicket: authorization.changeTicket,
      credentials,
      custody,
      expectedFingerprint: expected,
      generatedAt: new Date().toISOString(),
      operation: "credential_rotation",
      preflight,
      provider: {
        endpointKind: "pooler",
        hostHash: safeHash(providerProject.poolerHost),
        region: providerProject.region,
      },
      rls,
      status: "passed",
      storage: {
        githubEnvironment: GITHUB_ENVIRONMENT,
        operatorCredentialCount: expectedOperatorSecrets.length,
        rawCredentialDataRetained: false,
        requiredReviewerVerified: githubProtection.requiredReviewerVerified,
        selfReviewPrevented: githubProtection.selfReviewPrevented,
        vercel,
      },
      target: "production",
      topology,
    };
    await writeIntegrityEvidence(options.evidenceDir, evidence);
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    if (credentialsEnabled) {
      try {
        runSecretSql({
          providerProjectRef: providerProject.ref,
          sql: disableCredentialSql(),
        });
      } catch {
        // A later read-only inspection determines the fail-safe result without
        // echoing raw provider diagnostics or credential material.
      }
    }
    throw error;
  } finally {
    for (const key of Object.keys(passwords)) passwords[key] = undefined;
    for (const key of Object.keys(urls)) urls[key] = undefined;
  }
}

export function parseArguments(args) {
  if (args.includes("--help") || args.includes("-h")) return { help: true };
  const options = { confirmProduction: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--confirm-production") {
      options.confirmProduction = true;
    } else if (argument === "--confirm-project-hash") {
      options.confirmProjectHash = requiredArgumentValue(
        args,
        ++index,
        argument,
      );
    } else if (argument === "--change-ticket") {
      options.changeTicket = requiredArgumentValue(args, ++index, argument);
    } else if (argument === "--evidence-dir") {
      options.evidenceDir = requiredArgumentValue(args, ++index, argument);
    } else {
      throw new DatabaseCustodyError(
        `Unknown custody-rotation option: ${argument}.`,
        "invalid_option",
      );
    }
  }
  if (!options.evidenceDir) {
    throw new DatabaseCustodyError(
      "--evidence-dir is required for credential rotation.",
      "evidence_directory_required",
    );
  }
  return options;
}

export function assertConfirmations(options, authorization, expected) {
  if (!options.confirmProduction) {
    throw new DatabaseCustodyError(
      "Production credential rotation requires --confirm-production.",
      "production_confirmation_required",
    );
  }
  if (options.confirmProjectHash !== expected.projectIdentityHash) {
    throw new DatabaseCustodyError(
      "The independently confirmed project fingerprint does not match.",
      "project_confirmation_mismatch",
    );
  }
  if (
    requiredSafeLabel(options.changeTicket, "--change-ticket") !==
    authorization.changeTicket
  ) {
    throw new DatabaseCustodyError(
      "The command and authorization change tickets differ.",
      "change_ticket_mismatch",
    );
  }
}

export function buildRoleDatabaseUrl({
  password,
  poolerHost,
  projectRef,
  roleName,
  transactionPooler,
}) {
  const url = new URL("postgresql://placeholder@placeholder/postgres");
  url.hostname = poolerHost;
  url.port = transactionPooler ? "6543" : "5432";
  url.username = `${roleName}.${projectRef}`;
  url.password = password;
  url.searchParams.set("sslmode", "require");
  if (transactionPooler) {
    url.searchParams.set("pgbouncer", "true");
    url.searchParams.set("connection_limit", "1");
  }
  return url.toString();
}

export function assertPreRotationState(row, migrations) {
  const applied = Array.isArray(row?.migration_rows) ? row.migration_rows : [];
  if (
    row?.database_name !== "postgres" ||
    applied.length !== migrations.length ||
    applied.some((recorded, index) => {
      const migration = migrations[index];
      return (
        Number(recorded?.version) !== migration.version ||
        recorded?.filename !== migration.filename ||
        recorded?.checksum !== migration.checksum ||
        recorded?.target !== "production"
      );
    })
  ) {
    throw new DatabaseCustodyError(
      "The immutable Production migration ledger differs.",
      "migration_preflight_failed",
    );
  }
  const roles = Array.isArray(row?.role_rows) ? row.role_rows : [];
  const expectedRoles = new Map(
    CREDENTIAL_SPECS.map((spec) => [spec.roleName, spec.key]),
  );
  if (
    roles.length !== expectedRoles.size ||
    roles.some((role) => {
      const key = expectedRoles.get(role.name);
      const expectedBypass = key === "integrityAudit" || key === "backup";
      return (
        !key ||
        role.can_login ||
        role.superuser ||
        role.create_database ||
        role.create_role ||
        role.replication ||
        Boolean(role.bypass_rls) !== expectedBypass ||
        Number(role.member_of_count) !== 0 ||
        (expectedBypass && !role.default_read_only)
      );
    }) ||
    Number(row?.table_count) <= 0 ||
    Number(row?.rls_table_count) !== Number(row?.table_count) ||
    Number(row?.runtime_policy_count) !== Number(row?.table_count) ||
    Number(row?.temporary_audit_role_count) !== 0 ||
    Number(row?.migrator_owned_relation_count) !==
      Number(row?.relation_count) ||
    Number(row?.migrator_owned_routine_count) !== Number(row?.routine_count)
  ) {
    throw new DatabaseCustodyError(
      "The NOLOGIN role or RLS preflight differs from the reviewed boundary.",
      "role_preflight_failed",
    );
  }
  return {
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
    noLoginRoleCount: roles.length,
    rlsTableCount: Number(row.rls_table_count),
    runtimePolicyCount: Number(row.runtime_policy_count),
    tableCount: Number(row.table_count),
    temporaryAuditRoleCount: 0,
  };
}

async function readProviderProject(expected) {
  const linked = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "supabase/.temp/linked-project.json"),
      "utf8",
    ),
  );
  const ref = String(linked?.ref ?? "");
  if (
    !/^[a-z]{20}$/.test(ref) ||
    safeHash(ref) !== expected.projectIdentityHash
  ) {
    throw new DatabaseCustodyError(
      "The linked provider project differs from Production.",
      "database_target_mismatch",
    );
  }
  const projects = parseJsonCommand(
    "supabase",
    ["projects", "list", "--output", "json"],
    "provider_project_metadata_unavailable",
  );
  const project = (Array.isArray(projects) ? projects : []).find(
    (candidate) => candidate.id === ref || candidate.ref === ref,
  );
  const region = String(project?.region ?? "");
  if (!/^[a-z]+-[a-z]+-[0-9]+$/.test(region)) {
    throw new DatabaseCustodyError(
      "The provider region is unavailable.",
      "provider_region_unavailable",
    );
  }
  return {
    poolerHost: `aws-0-${region}.pooler.supabase.com`,
    ref,
    region,
  };
}

async function assertPoolerResolves(hostname) {
  try {
    await lookup(hostname);
  } catch {
    throw new DatabaseCustodyError(
      "The provider pooler endpoint did not resolve.",
      "provider_pooler_unavailable",
    );
  }
}

function readCredentialRotationPreflight({
  expected,
  migrations,
  providerProjectRef,
}) {
  const output = runSupabaseQuery({
    providerProjectRef,
    spawnSyncImpl: spawnSync,
    sql: `begin transaction read only;
      select current_database() as database_name,
        (select json_agg(json_build_object(
          'version', version, 'filename', filename, 'checksum', checksum,
          'target', target
        ) order by version) from schema_migrations) as migration_rows,
        (select json_agg(json_build_object(
          'name', r.rolname, 'can_login', r.rolcanlogin,
          'superuser', r.rolsuper, 'create_database', r.rolcreatedb,
          'create_role', r.rolcreaterole, 'replication', r.rolreplication,
          'bypass_rls', r.rolbypassrls,
          'default_read_only', coalesce(
            'default_transaction_read_only=on' = any(r.rolconfig), false
          ),
          'member_of_count', (select count(*)::int from pg_auth_members m
            where m.member = r.oid)
        ) order by r.rolname) from pg_roles r where r.rolname in
          ('app_runtime','app_migrator','integrity_audit','backup_export'))
          as role_rows,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r','p')) as table_count,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r','p') and c.relrowsecurity)
          as rls_table_count,
        (select count(*)::int from pg_policies where schemaname = 'public'
          and policyname = 'app_runtime_full_access') as runtime_policy_count,
        (select count(*)::int from pg_roles where rolname ~
          '^integrity_audit_[0-9a-f]{16}$') as temporary_audit_role_count,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r','p','v','m')) as relation_count,
        (select count(*)::int from pg_class c join pg_namespace n
          on n.oid = c.relnamespace where n.nspname = 'public'
          and c.relkind in ('r','p','v','m')
          and c.relowner = 'app_migrator'::regrole)
          as migrator_owned_relation_count,
        (select count(*)::int from pg_proc p join pg_namespace n
          on n.oid = p.pronamespace where n.nspname = 'public')
          as routine_count,
        (select count(*)::int from pg_proc p join pg_namespace n
          on n.oid = p.pronamespace where n.nspname = 'public'
          and p.proowner = 'app_migrator'::regrole)
          as migrator_owned_routine_count;
      rollback;`,
  });
  const preflight = assertPreRotationState(output.rows?.[0], migrations);
  return { ...preflight, expectedFingerprint: expected };
}

function readGitHubEnvironmentProtection(reviewerLogin) {
  const environment = parseJsonCommand(
    "gh",
    ["api", `repos/${GITHUB_REPOSITORY}/environments/${GITHUB_ENVIRONMENT}`],
    "operator_secret_store_unavailable",
  );
  const reviewerRules = (environment?.protection_rules ?? []).filter(
    (rule) => rule.type === "required_reviewers",
  );
  const requiredReviewerVerified = reviewerRules.some((rule) =>
    (rule.reviewers ?? []).some(
      (reviewer) =>
        reviewer.type === "User" &&
        reviewer.reviewer?.login?.toLowerCase() === reviewerLogin.toLowerCase(),
    ),
  );
  const selfReviewPrevented = reviewerRules.some(
    (rule) => rule.prevent_self_review === true,
  );
  if (!requiredReviewerVerified || !selfReviewPrevented) {
    throw new DatabaseCustodyError(
      "The operator secret store lacks the required independent review.",
      "operator_secret_store_unprotected",
    );
  }
  return { requiredReviewerVerified, selfReviewPrevented };
}

function generatePassword() {
  return `${randomBytes(36).toString("base64url")}Aa1!`;
}

function credentialRotationSql(passwords) {
  const statements = CREDENTIAL_SPECS.map(
    (spec) =>
      `alter role ${spec.roleName} login password '${sqlLiteral(passwords[spec.key])}' valid until 'infinity';`,
  );
  return `begin;\n${statements.join("\n")}\ncommit;`;
}

function disableCredentialSql() {
  return `begin;
    alter role app_runtime nologin password null;
    alter role app_migrator nologin password null;
    alter role integrity_audit nologin password null;
    alter role backup_export nologin password null;
    commit;`;
}

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function runSecretSql({ providerProjectRef, sql }) {
  const result = spawnSync(
    "supabase",
    [
      "db",
      "query",
      "--linked",
      "--project-ref",
      providerProjectRef,
      "--output",
      "json",
      "--file",
      "/dev/stdin",
    ],
    {
      encoding: "utf8",
      env: commandEnvironment(["SUPABASE_ACCESS_TOKEN"]),
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result?.error || result?.status !== 0) {
    throw new DatabaseCustodyError(
      "The provider credential operation failed.",
      "provider_credential_operation_failed",
    );
  }
}

async function inspectCredentialsWithRetry({ expected, migrations, urls }) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
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
      return { credentials, rls };
    } catch (error) {
      lastError = error;
      if (attempt < 4)
        await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw lastError;
}

function setGitHubEnvironmentSecret(name, value) {
  runCommand(
    "gh",
    [
      "secret",
      "set",
      name,
      "--env",
      GITHUB_ENVIRONMENT,
      "--repo",
      GITHUB_REPOSITORY,
    ],
    { input: value, errorCode: "operator_secret_store_write_failed" },
  );
}

function setVercelRuntimeCredential(value) {
  runCommand(
    "vercel",
    [
      "env",
      "add",
      "DATABASE_URL",
      "production",
      "--force",
      "--sensitive",
      "--yes",
      "--cwd",
      repositoryRoot,
      "--no-color",
    ],
    { input: `${value}\n`, errorCode: "runtime_secret_store_write_failed" },
  );
}

function removeLegacyVercelOwnerCredentials() {
  for (const name of LEGACY_OWNER_DATABASE_VARIABLES) {
    runCommand(
      "vercel",
      [
        "env",
        "rm",
        name,
        "production",
        "--yes",
        "--cwd",
        repositoryRoot,
        "--no-color",
      ],
      { errorCode: "legacy_owner_credential_removal_failed" },
    );
  }
}

function readGitHubEnvironmentSecretMetadata() {
  const parsed = parseJsonCommand(
    "gh",
    [
      "secret",
      "list",
      "--env",
      GITHUB_ENVIRONMENT,
      "--repo",
      GITHUB_REPOSITORY,
      "--json",
      "name,updatedAt",
    ],
    "operator_secret_store_metadata_unavailable",
  );
  return Array.isArray(parsed) ? parsed : [];
}

function parseJsonCommand(command, args, errorCode) {
  const stdout = runCommand(command, args, { errorCode });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new DatabaseCustodyError(
      "A required provider returned invalid metadata.",
      errorCode,
    );
  }
}

function runCommand(command, args, { errorCode, input } = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: commandEnvironment(["GH_TOKEN", "VERCEL_TOKEN"]),
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
  if (result?.error || result?.status !== 0) {
    throw new DatabaseCustodyError(
      "A required custody provider operation failed.",
      errorCode ?? "provider_operation_failed",
    );
  }
  return String(result.stdout ?? "");
}

function commandEnvironment(extraNames = []) {
  return Object.fromEntries(
    ["HOME", "LANG", "NO_COLOR", "PATH", "TMPDIR", ...extraNames].flatMap(
      (name) => (process.env[name] ? [[name, process.env[name]]] : []),
    ),
  );
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

function printUsage() {
  console.log(`Usage:
  npm run db:custody:rotate -- --confirm-production \\
    --confirm-project-hash <safe hash> --change-ticket <ticket> \\
    --evidence-dir docs/evidence/database-custody

This command requires the same named owner, independent reviewer, institutional
custody, and MFA attestations as db:custody:apply. It generates four unique
credentials in memory, sends password SQL only through stdin, verifies every
credential against the immutable Production ledger and exact role boundary,
stores operator credentials only in the protected GitHub Production
environment, stores only DATABASE_URL in Vercel Production, removes legacy
owner variables, and emits sanitized evidence only.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code =
      error instanceof DatabaseCustodyError ? error.code : "rotation_failed";
    console.error(`Production database credential rotation failed: ${code}.`);
    process.exitCode = 1;
  });
}
