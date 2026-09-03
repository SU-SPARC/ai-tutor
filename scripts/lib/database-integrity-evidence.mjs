import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SAFE_HASH_LENGTH = 16;
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export class IntegrityEvidenceError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "IntegrityEvidenceError";
  }
}

export function safeHash(value) {
  return createHash("sha256")
    .update(String(value))
    .digest("hex")
    .slice(0, SAFE_HASH_LENGTH);
}

export function fingerprintDatabaseUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new IntegrityEvidenceError(
      "Integrity database URL is not a valid URL.",
      "invalid_database_url",
    );
  }
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new IntegrityEvidenceError(
      "Integrity database URL must use the PostgreSQL protocol.",
      "invalid_database_protocol",
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const username = decodeURIComponent(parsed.username);
  const directSupabaseProject = hostname.match(
    /^db[.]([a-z0-9]+)[.]supabase[.]co$/i,
  )?.[1];
  const pooledSupabaseProject = username.match(/^[^.]+[.]([a-z0-9]+)$/i)?.[1];
  const provider =
    hostname.endsWith(".supabase.co") || hostname.endsWith(".supabase.com")
      ? "supabase"
      : hostname === "localhost" || hostname === "127.0.0.1"
        ? "local"
        : "unclassified";
  const providerProject =
    provider === "supabase"
      ? (directSupabaseProject ?? pooledSupabaseProject)
      : undefined;

  return {
    databaseName: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    endpointKind: hostname.includes("pooler.supabase.com")
      ? "pooler"
      : hostname.startsWith("db.")
        ? "direct"
        : "other",
    hostHash: safeHash(hostname),
    projectIdentityHash: providerProject
      ? safeHash(providerProject)
      : undefined,
    provider,
    roleHash: safeHash(username),
  };
}

export function expectedTargetFingerprint(environment) {
  const provider = optionalValue(environment.INTEGRITY_EXPECTED_PROVIDER);
  const projectIdentityHash = optionalValue(
    environment.INTEGRITY_EXPECTED_PROJECT_HASH,
  );
  const databaseName = optionalValue(
    environment.INTEGRITY_EXPECTED_DATABASE_NAME,
  );

  if (!provider || !projectIdentityHash || !databaseName) {
    throw new IntegrityEvidenceError(
      "Production integrity audit requires the expected provider, project hash, and database name.",
      "expected_target_unavailable",
    );
  }
  if (!/^[0-9a-f]{16}$/.test(projectIdentityHash)) {
    throw new IntegrityEvidenceError(
      "Expected project hash must be a 16-character lowercase hexadecimal safe fingerprint.",
      "invalid_expected_project_hash",
    );
  }
  return { databaseName, projectIdentityHash, provider };
}

export function assertDatabaseTargetFingerprint(actual, expected) {
  const mismatches = [];
  for (const key of ["provider", "projectIdentityHash", "databaseName"]) {
    if (actual[key] !== expected[key]) mismatches.push(key);
  }
  if (mismatches.length > 0) {
    throw new IntegrityEvidenceError(
      `Integrity credential safe fingerprint differs from Production in: ${mismatches.join(", ")}.`,
      "database_target_mismatch",
    );
  }
}

export async function connectedDatabaseFingerprint(client, urlFingerprint) {
  const result = await client.query(`
    select current_database() as database_name, current_user as role_name
  `);
  const row = result.rows[0] ?? {};
  return {
    ...urlFingerprint,
    connectedDatabaseName: String(row.database_name ?? ""),
    connectedRoleHash: safeHash(row.role_name ?? "unknown"),
  };
}

export async function attestSelectOnlyCredential(client) {
  const result = await client.query(`
    select
      current_setting('default_transaction_read_only')::boolean
        as default_transaction_read_only,
      r.rolsuper,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolreplication,
      r.rolbypassrls,
      has_database_privilege(
        current_user,
        current_database(),
        'CREATE'
      ) as database_create,
      has_database_privilege(
        current_user,
        current_database(),
        'TEMP'
      ) as database_temp,
      exists (
        select 1
        from pg_namespace namespace
        where namespace.nspname not in ('pg_catalog', 'information_schema')
          and namespace.nspname !~ '^pg_toast'
          and has_schema_privilege(current_user, namespace.oid, 'CREATE')
      ) as schema_create,
      exists (
        select 1
        from pg_class relation
        join pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname not in ('pg_catalog', 'information_schema')
          and namespace.nspname !~ '^pg_toast'
          and relation.relkind in ('r', 'p', 'v', 'm', 'f')
          and (
            has_table_privilege(current_user, relation.oid, 'INSERT')
            or has_table_privilege(current_user, relation.oid, 'UPDATE')
            or has_table_privilege(current_user, relation.oid, 'DELETE')
            or has_table_privilege(current_user, relation.oid, 'TRUNCATE')
            or has_table_privilege(current_user, relation.oid, 'TRIGGER')
          )
      ) as relation_write,
      exists (
        select 1
        from pg_class sequence
        join pg_namespace namespace on namespace.oid = sequence.relnamespace
        where namespace.nspname not in ('pg_catalog', 'information_schema')
          and namespace.nspname !~ '^pg_toast'
          and sequence.relkind = 'S'
          and (
            has_sequence_privilege(current_user, sequence.oid, 'USAGE')
            or has_sequence_privilege(current_user, sequence.oid, 'UPDATE')
          )
      ) as sequence_write,
      exists (
        select 1
        from pg_proc routine
        join pg_namespace namespace on namespace.oid = routine.pronamespace
        where namespace.nspname = 'public'
          and routine.prokind in ('f', 'p')
          and routine.prosecdef
          and has_function_privilege(current_user, routine.oid, 'EXECUTE')
      ) as security_definer_execute
    from pg_roles r
    where r.rolname = current_user
  `);
  const row = result.rows[0];
  if (!row) {
    throw new IntegrityEvidenceError(
      "Integrity credential role metadata is unavailable.",
      "credential_role_unavailable",
    );
  }

  const violations = [
    ["default_transaction_read_only", !row.default_transaction_read_only],
    ["superuser", row.rolsuper],
    ["create_database", row.rolcreatedb],
    ["create_role", row.rolcreaterole],
    ["replication", row.rolreplication],
    ["bypass_rls", row.rolbypassrls],
    ["database_create", row.database_create],
    ["database_temp", row.database_temp],
    ["schema_create", row.schema_create],
    ["relation_write", row.relation_write],
    ["sequence_write", row.sequence_write],
    ["security_definer_execute", row.security_definer_execute],
  ]
    .filter(([, failed]) => Boolean(failed))
    .map(([label]) => label);

  if (violations.length > 0) {
    throw new IntegrityEvidenceError(
      `Integrity credential is not SELECT-only: ${violations.join(", ")}.`,
      "credential_not_select_only",
    );
  }

  return {
    defaultTransactionReadOnly: true,
    forbiddenPrivilegeCount: 0,
    selectOnly: true,
  };
}

export function summarizeMigrationStatus(status) {
  return {
    appliedCount: status.applied.length,
    issueCount: status.issues.length,
    issueTypes: [...new Set(status.issues.map((issue) => issue.code))].sort(),
    ledgerFingerprint: safeHash(
      status.applied
        .map(
          (entry) =>
            `${entry.version}:${entry.filename}:${entry.checksum}:${entry.target}`,
        )
        .join("|"),
    ),
    pendingCount: status.pending.length,
    state: status.state,
    totalCount: status.total,
  };
}

export function createNotRunEvidence({ generatedAt, reasonCode, target }) {
  return {
    artifactVersion: 1,
    audit: "production_database_integrity",
    credential: "INTEGRITY_DATABASE_URL",
    generatedAt,
    readOnly: true,
    reason: {
      code: reasonCode,
      message:
        reasonCode === "credential_unavailable"
          ? "Dedicated SELECT-only integrity credential was unavailable; no database connection was attempted."
          : "Required safe target evidence was unavailable; no Production integrity queries were run.",
    },
    status: "not_run",
    target,
    writesAttempted: 0,
  };
}

export function createCompletedEvidence({
  audit,
  credentialAttestation,
  databaseFingerprint,
  expectedFingerprint,
  migrationStatus,
}) {
  return {
    artifactVersion: 1,
    audit: "production_database_integrity",
    checks: audit.checks,
    credentialAttestation,
    databaseFingerprint,
    expectedFingerprint,
    generatedAt: audit.generatedAt,
    migrationLedger: summarizeMigrationStatus(migrationStatus),
    mode: "audit",
    readOnly: true,
    status: audit.status,
    summary: audit.summary,
    target: audit.target,
    writesAttempted: 0,
  };
}

export async function writeIntegrityEvidence(evidenceDirectory, evidence) {
  const absoluteDirectory = path.resolve(evidenceDirectory);
  await mkdir(absoluteDirectory, { recursive: true });
  const timestamp = evidence.generatedAt.replace(/[:.]/g, "-");
  const filename = `${timestamp}-${evidence.target}-${evidence.status}.json`;
  const outputPath = path.join(absoluteDirectory, filename);
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return outputPath;
}

function optionalValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
