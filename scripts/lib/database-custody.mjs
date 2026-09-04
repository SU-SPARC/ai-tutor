import { safeHash } from "./database-integrity-evidence.mjs";

export const CREDENTIAL_SPECS = Object.freeze([
  Object.freeze({
    environmentName: "DATABASE_URL",
    key: "runtime",
    roleName: "app_runtime",
  }),
  Object.freeze({
    environmentName: "MIGRATION_DATABASE_URL",
    key: "migration",
    roleName: "app_migrator",
  }),
  Object.freeze({
    environmentName: "INTEGRITY_DATABASE_URL",
    key: "integrityAudit",
    roleName: "integrity_audit",
  }),
  Object.freeze({
    environmentName: "BACKUP_DATABASE_URL",
    key: "backup",
    roleName: "backup_export",
  }),
]);

export const OPERATOR_DATABASE_VARIABLES = Object.freeze([
  "BACKUP_DATABASE_URL",
  "INTEGRITY_DATABASE_URL",
  "MIGRATION_DATABASE_URL",
]);

export const LEGACY_OWNER_DATABASE_VARIABLES = Object.freeze([
  "POSTGRES_PASSWORD",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_USER",
]);

export const FORBIDDEN_VERCEL_DATABASE_VARIABLES = Object.freeze([
  ...OPERATOR_DATABASE_VARIABLES,
  ...LEGACY_OWNER_DATABASE_VARIABLES,
]);

const SAFE_HASH_PATTERN = /^[0-9a-f]{16}$/;
const SAFE_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/+-]{1,199}$/;

export class DatabaseCustodyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "DatabaseCustodyError";
  }
}

export function requiredSafeLabel(value, name) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!SAFE_LABEL_PATTERN.test(normalized) || /:\/\//.test(normalized)) {
    throw new DatabaseCustodyError(
      `${name} must be a short non-secret institutional label.`,
      "invalid_authorization_label",
    );
  }
  return normalized;
}

export function productionAuthorization(environment) {
  const owner = requiredSafeLabel(
    environment.CUSTODY_NAMED_OWNER,
    "CUSTODY_NAMED_OWNER",
  );
  const secondReviewer = requiredSafeLabel(
    environment.CUSTODY_SECOND_REVIEWER,
    "CUSTODY_SECOND_REVIEWER",
  );
  const changeTicket = requiredSafeLabel(
    environment.CUSTODY_CHANGE_TICKET,
    "CUSTODY_CHANGE_TICKET",
  );
  if (owner.toLocaleLowerCase() === secondReviewer.toLocaleLowerCase()) {
    throw new DatabaseCustodyError(
      "The named owner and second reviewer must be different people.",
      "authorization_not_independent",
    );
  }
  if (
    environment.CUSTODY_OWNER_AUTHORIZED !== "true" ||
    environment.CUSTODY_SECOND_REVIEWER_AUTHORIZED !== "true"
  ) {
    throw new DatabaseCustodyError(
      "Both named authorization confirmations must equal true.",
      "authorization_unconfirmed",
    );
  }
  return {
    changeTicket,
    ownerFingerprint: safeHash(owner),
    ownerRole: "production_owner",
    secondReviewerFingerprint: safeHash(secondReviewer),
    secondReviewerRole: "independent_second_reviewer",
  };
}

export function productionMutationPrerequisites(environment) {
  const institutionalOrganization = requiredSafeLabel(
    environment.CUSTODY_INSTITUTIONAL_ORGANIZATION,
    "CUSTODY_INSTITUTIONAL_ORGANIZATION",
  );
  const recoveryAdministrators = [
    {
      mfaVerified: environment.CUSTODY_RECOVERY_ADMIN_1_MFA_VERIFIED === "true",
      name: requiredSafeLabel(
        environment.CUSTODY_RECOVERY_ADMIN_1,
        "CUSTODY_RECOVERY_ADMIN_1",
      ),
    },
    {
      mfaVerified: environment.CUSTODY_RECOVERY_ADMIN_2_MFA_VERIFIED === "true",
      name: requiredSafeLabel(
        environment.CUSTODY_RECOVERY_ADMIN_2,
        "CUSTODY_RECOVERY_ADMIN_2",
      ),
    },
  ];
  if (
    recoveryAdministrators[0].name.toLocaleLowerCase() ===
    recoveryAdministrators[1].name.toLocaleLowerCase()
  ) {
    throw new DatabaseCustodyError(
      "Recovery administrators must be two different named people.",
      "recovery_administrators_not_distinct",
    );
  }
  if (
    !recoveryAdministrators.every((administrator) => administrator.mfaVerified)
  ) {
    throw new DatabaseCustodyError(
      "Both named recovery administrators must have individually verified MFA.",
      "recovery_administrator_mfa_unverified",
    );
  }
  if (environment.CUSTODY_PROVIDER_OWNERSHIP_VERIFIED !== "true") {
    throw new DatabaseCustodyError(
      "Institutional provider ownership must be independently verified.",
      "provider_ownership_unverified",
    );
  }
  return {
    administratorCount: recoveryAdministrators.length,
    administrators: recoveryAdministrators.map((administrator) => ({
      administratorFingerprint: safeHash(administrator.name),
      mfa: "verified",
      role: "recovery_administrator",
    })),
    mfaEnabledAdministratorCount: recoveryAdministrators.length,
    organizationFingerprint: safeHash(institutionalOrganization),
    ownership: "institutionally_verified",
  };
}

export function expectedCustodyTarget(environment) {
  const provider = String(environment.CUSTODY_EXPECTED_PROVIDER ?? "").trim();
  const projectIdentityHash = String(
    environment.CUSTODY_EXPECTED_PROJECT_HASH ?? "",
  ).trim();
  const databaseName = String(
    environment.CUSTODY_EXPECTED_DATABASE_NAME ?? "",
  ).trim();
  if (
    provider !== "supabase" ||
    !SAFE_HASH_PATTERN.test(projectIdentityHash) ||
    databaseName !== "postgres"
  ) {
    throw new DatabaseCustodyError(
      "The expected Production provider, project fingerprint, and database are required.",
      "expected_target_unavailable",
    );
  }
  return { databaseName, projectIdentityHash, provider };
}

export function credentialInputs(environment) {
  return Object.fromEntries(
    CREDENTIAL_SPECS.map((spec) => {
      const value = environment[spec.environmentName];
      if (typeof value !== "string" || !value.trim()) {
        throw new DatabaseCustodyError(
          `${spec.environmentName} is required; credentials are never substituted across roles.`,
          "credential_unavailable",
        );
      }
      return [spec.key, value];
    }),
  );
}

export function summarizeVercelCredentialPlacement(
  entries,
  { phase = "post-rotation" } = {},
) {
  if (!new Set(["pre-rotation", "post-rotation"]).has(phase)) {
    throw new DatabaseCustodyError(
      "Credential placement phase must be pre-rotation or post-rotation.",
      "invalid_verification_phase",
    );
  }
  const normalized = (Array.isArray(entries) ? entries : []).map((entry) => ({
    name: String(entry?.key ?? entry?.name ?? ""),
    scopes: normalizeVercelScopes(
      entry?.target ?? entry?.targets ?? entry?.environments,
    ),
  }));
  const names = new Set(normalized.map((entry) => entry.name).filter(Boolean));
  const operatorPresent = OPERATOR_DATABASE_VARIABLES.filter((name) =>
    names.has(name),
  );
  const legacyOwnerPresent = LEGACY_OWNER_DATABASE_VARIABLES.filter((name) =>
    names.has(name),
  );
  const forbiddenPresent =
    phase === "pre-rotation"
      ? operatorPresent
      : [...operatorPresent, ...legacyOwnerPresent];
  const runtimeEntries = normalized.filter(
    (entry) => entry.name === "DATABASE_URL",
  );
  const runtimeScopes = [
    ...new Set(runtimeEntries.flatMap((entry) => entry.scopes)),
  ].sort();
  const runtimeProductionOnly =
    runtimeEntries.length === 1 &&
    runtimeScopes.length === 1 &&
    runtimeScopes[0] === "production";
  const runtimePlacementValid =
    phase === "pre-rotation"
      ? runtimeEntries.length === 0 || runtimeProductionOnly
      : runtimeProductionOnly;
  return {
    forbiddenCredentialCount: forbiddenPresent.length,
    forbiddenCredentialsPresent: forbiddenPresent,
    legacyOwnerCredentialCount: legacyOwnerPresent.length,
    legacyOwnerCredentialsPresent: legacyOwnerPresent,
    operatorCredentialCount: operatorPresent.length,
    operatorCredentialsPresent: operatorPresent,
    phase,
    runtimeCredentialPresent: runtimeEntries.length === 1,
    runtimeCredentialScopes: runtimeScopes,
    runtimeProductionOnly,
    status:
      forbiddenPresent.length === 0 && runtimePlacementValid
        ? "passed"
        : "failed",
  };
}

function normalizeVercelScopes(value) {
  if (Array.isArray(value))
    return value.map(String).map((item) => item.toLowerCase());
  if (typeof value === "string" && value.trim()) return [value.toLowerCase()];
  return [];
}

export function roleViolations(spec, attestation) {
  const violations = [];
  const expectedRoleHash = safeHash(spec.roleName);
  if (attestation.roleHash !== expectedRoleHash)
    violations.push("role_identity");
  if (!attestation.canLogin) violations.push("login_disabled");
  for (const [label, value] of [
    ["superuser", attestation.superuser],
    ["create_database", attestation.createDatabase],
    ["create_role", attestation.createRole],
    ["replication", attestation.replication],
  ]) {
    if (value) violations.push(label);
  }
  if (attestation.roleMembershipCount) violations.push("role_membership");

  if (spec.key === "runtime") {
    if (attestation.bypassRls) violations.push("bypass_rls");
    if (attestation.databaseCreate || attestation.schemaCreate)
      violations.push("ddl_create");
    if (attestation.ownedRelationCount || attestation.ownedRoutineCount)
      violations.push("object_ownership");
    if (attestation.tableSelectMissingCount)
      violations.push("missing_table_select");
    if (attestation.sequenceUsageMissingCount)
      violations.push("missing_sequence_usage");
    if (attestation.protectedWriteCount)
      violations.push("protected_relation_write");
    if (attestation.missingRuntimeWriteCount)
      violations.push("missing_runtime_write");
    if (attestation.unexpectedRuntimeWriteCount)
      violations.push("unexpected_runtime_write");
    if (attestation.missingRuntimeFunctionCount)
      violations.push("missing_runtime_function");
    if (attestation.executableRoutineCount !== 5)
      violations.push("unexpected_runtime_function");
  } else if (spec.key === "migration") {
    if (attestation.bypassRls) violations.push("bypass_rls");
    if (!attestation.schemaCreate) violations.push("missing_schema_create");
    if (attestation.ownedRelationCount !== attestation.relationCount)
      violations.push("missing_relation_ownership");
    if (attestation.ownedRoutineCount !== attestation.routineCount)
      violations.push("missing_routine_ownership");
  } else {
    if (!attestation.bypassRls) violations.push("missing_rls_bypass");
    if (!attestation.defaultReadOnly)
      violations.push("default_read_only_disabled");
    if (attestation.databaseCreate || attestation.schemaCreate)
      violations.push("ddl_create");
    if (attestation.ownedRelationCount || attestation.ownedRoutineCount)
      violations.push("object_ownership");
    if (attestation.relationWriteCount) violations.push("relation_write");
    if (attestation.sequenceWriteCount) violations.push("sequence_write");
    if (attestation.securityDefinerExecuteCount)
      violations.push("security_definer_execute");
    if (attestation.tableSelectMissingCount)
      violations.push("missing_table_select");
    if (spec.key === "backup" && attestation.sequenceSelectMissingCount)
      violations.push("missing_sequence_select");
  }
  return violations;
}

export function summarizeTopology({ credentials, expected, rls, vercel }) {
  const inspections = CREDENTIAL_SPECS.map((spec) => credentials[spec.key]);
  const projectHashes = new Set(
    inspections.map(
      (inspection) => inspection.databaseFingerprint.projectIdentityHash,
    ),
  );
  const databaseNames = new Set(
    inspections.map(
      (inspection) => inspection.databaseFingerprint.connectedDatabaseName,
    ),
  );
  const ledgerFingerprints = new Set(
    inspections.map(
      (inspection) => inspection.migrationLedger.ledgerFingerprint,
    ),
  );
  const roleHashes = new Set(
    inspections.map((inspection) => inspection.role.roleHash),
  );
  const roleViolationCount = inspections.reduce(
    (sum, inspection) => sum + inspection.role.violations.length,
    0,
  );
  const everyLedgerCurrent = inspections.every(
    (inspection) =>
      inspection.migrationLedger.state === "current" &&
      inspection.migrationLedger.issueCount === 0 &&
      inspection.migrationLedger.pendingCount === 0 &&
      inspection.migrationLedger.targets.length === 1 &&
      inspection.migrationLedger.targets[0] === "production",
  );
  const targetAgreement =
    projectHashes.size === 1 &&
    projectHashes.has(expected.projectIdentityHash) &&
    databaseNames.size === 1 &&
    databaseNames.has(expected.databaseName);
  const passed =
    targetAgreement &&
    ledgerFingerprints.size === 1 &&
    everyLedgerCurrent &&
    roleHashes.size === CREDENTIAL_SPECS.length &&
    roleViolationCount === 0 &&
    rls.status === "passed" &&
    vercel.status === "passed";
  return {
    distinctRoleCount: roleHashes.size,
    everyLedgerCurrent,
    ledgerAgreement: ledgerFingerprints.size === 1,
    roleViolationCount,
    status: passed ? "passed" : "failed",
    targetAgreement,
  };
}
