import { describe, expect, it, vi } from "vitest";

import {
  CREDENTIAL_SPECS,
  DatabaseCustodyError,
  credentialInputs,
  expectedCustodyTarget,
  productionAuthorization,
  productionMutationPrerequisites,
  roleViolations,
  summarizeTopology,
  summarizeVercelCredentialPlacement,
} from "../scripts/lib/database-custody.mjs";
import { safeHash } from "../scripts/lib/database-integrity-evidence.mjs";
import {
  parseArguments as parseVerifyArguments,
  readVercelCredentialPlacement,
} from "../scripts/verify-production-database-custody.mjs";
import {
  assertCommandConfirmations,
  parseArguments as parseApplyArguments,
  removeTemporaryAuditRole,
  runSupabaseQuery,
} from "../scripts/apply-production-database-custody.mjs";

const expected = {
  databaseName: "postgres",
  projectIdentityHash: "a".repeat(16),
  provider: "supabase",
};

describe("production database custody gates", () => {
  it("requires two distinct named authorizers and retains fingerprints only", () => {
    const authorization = productionAuthorization({
      CUSTODY_CHANGE_TICKET: "DB-CUSTODY-124",
      CUSTODY_NAMED_OWNER: "Institutional Owner",
      CUSTODY_OWNER_AUTHORIZED: "true",
      CUSTODY_SECOND_REVIEWER: "Independent Reviewer",
      CUSTODY_SECOND_REVIEWER_AUTHORIZED: "true",
    });

    expect(authorization).toEqual({
      changeTicket: "DB-CUSTODY-124",
      ownerFingerprint: safeHash("Institutional Owner"),
      ownerRole: "production_owner",
      secondReviewerFingerprint: safeHash("Independent Reviewer"),
      secondReviewerRole: "independent_second_reviewer",
    });
    expect(JSON.stringify(authorization)).not.toMatch(
      /Institutional Owner|Independent Reviewer/,
    );
    expect(() =>
      productionAuthorization({
        CUSTODY_CHANGE_TICKET: "DB-CUSTODY-124",
        CUSTODY_NAMED_OWNER: "Same Person",
        CUSTODY_OWNER_AUTHORIZED: "true",
        CUSTODY_SECOND_REVIEWER: "Same Person",
        CUSTODY_SECOND_REVIEWER_AUTHORIZED: "true",
      }),
    ).toThrow(DatabaseCustodyError);
  });

  it("requires institutional custody and MFA for every recovery administrator", () => {
    const custody = productionMutationPrerequisites({
      CUSTODY_INSTITUTIONAL_ORGANIZATION: "University IT",
      CUSTODY_PROVIDER_OWNERSHIP_VERIFIED: "true",
      CUSTODY_RECOVERY_ADMIN_1: "Recovery Admin One",
      CUSTODY_RECOVERY_ADMIN_1_MFA_VERIFIED: "true",
      CUSTODY_RECOVERY_ADMIN_2: "Recovery Admin Two",
      CUSTODY_RECOVERY_ADMIN_2_MFA_VERIFIED: "true",
    });
    expect(custody).toEqual({
      administratorCount: 2,
      administrators: [
        {
          administratorFingerprint: safeHash("Recovery Admin One"),
          mfa: "verified",
          role: "recovery_administrator",
        },
        {
          administratorFingerprint: safeHash("Recovery Admin Two"),
          mfa: "verified",
          role: "recovery_administrator",
        },
      ],
      mfaEnabledAdministratorCount: 2,
      organizationFingerprint: safeHash("University IT"),
      ownership: "institutionally_verified",
    });
    expect(JSON.stringify(custody)).not.toMatch(
      /University IT|Recovery Admin One|Recovery Admin Two/,
    );
    expect(() =>
      productionMutationPrerequisites({
        CUSTODY_INSTITUTIONAL_ORGANIZATION: "University IT",
        CUSTODY_PROVIDER_OWNERSHIP_VERIFIED: "true",
        CUSTODY_RECOVERY_ADMIN_1: "Recovery Admin One",
        CUSTODY_RECOVERY_ADMIN_1_MFA_VERIFIED: "true",
        CUSTODY_RECOVERY_ADMIN_2: "Recovery Admin Two",
        CUSTODY_RECOVERY_ADMIN_2_MFA_VERIFIED: "false",
      }),
    ).toThrow(/MFA/);
    expect(() =>
      productionMutationPrerequisites({
        CUSTODY_INSTITUTIONAL_ORGANIZATION: "University IT",
        CUSTODY_PROVIDER_OWNERSHIP_VERIFIED: "false",
        CUSTODY_RECOVERY_ADMIN_1: "Recovery Admin One",
        CUSTODY_RECOVERY_ADMIN_1_MFA_VERIFIED: "true",
        CUSTODY_RECOVERY_ADMIN_2: "Recovery Admin Two",
        CUSTODY_RECOVERY_ADMIN_2_MFA_VERIFIED: "true",
      }),
    ).toThrow(/ownership/);
  });

  it("requires explicit matching command confirmations for mutations", () => {
    const options = parseApplyArguments([
      "--operation",
      "provision",
      "--confirm-production",
      "--confirm-project-hash",
      "a".repeat(16),
      "--change-ticket",
      "DB-CUSTODY-124",
      "--evidence-dir",
      "docs/evidence/database-custody",
    ]);
    expect(() =>
      assertCommandConfirmations(
        options,
        { changeTicket: "DB-CUSTODY-124" },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertCommandConfirmations(
        { ...options, confirmProjectHash: "b".repeat(16) },
        { changeTicket: "DB-CUSTODY-124" },
        expected,
      ),
    ).toThrow(/fingerprint/);
    expect(() =>
      parseApplyArguments([
        "--operation",
        "cleanup-expired-audit",
        "--confirm-production",
        "--confirm-project-hash",
        "a".repeat(16),
        "--change-ticket",
        "DB-CUSTODY-124",
        "--evidence-dir",
        "docs/evidence/database-custody",
      ]),
    ).toThrow(/role hash/);
  });

  it("captures provider command output without surfacing its stderr", () => {
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      stderr: "credential-like-provider-diagnostic",
      stdout: JSON.stringify({ rows: [{ remaining_count: 0 }] }),
    }));
    const result = runSupabaseQuery({
      providerProjectRef: "a".repeat(20),
      spawnSyncImpl,
      sql: "select 1",
    });
    expect(result).toEqual({ rows: [{ remaining_count: 0 }] });
    expect(JSON.stringify(result)).not.toContain("provider-diagnostic");
  });

  it("normalizes the provider CLI row-array response", () => {
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify([{ migration_count: 21 }]),
    }));
    const result = runSupabaseQuery({
      providerProjectRef: "a".repeat(20),
      spawnSyncImpl,
      sql: "select count(*)::int as migration_count from schema_migrations",
    });
    expect(result).toEqual({ rows: [{ migration_count: 21 }] });
  });

  it("removes only one expired, inactive, unowned, independently fingerprinted audit role with its provider-owner edge", async () => {
    const roleName = `integrity_audit_${"b".repeat(16)}`;
    const spawnSyncImpl = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stderr: "",
        stdout: JSON.stringify({
          rows: [
            {
              active_session_count: 0,
              owned_database_count: 0,
              owned_relation_count: 0,
              owned_routine_count: 0,
              owned_schema_count: 0,
              owned_type_count: 0,
              rolcreatedb: false,
              rolcreaterole: false,
              rolname: roleName,
              rolreplication: false,
              rolsuper: false,
              rolvaliduntil: "2020-01-01T00:00:00.000Z",
              provider_owner_membership_count: 1,
              role_membership_count: 1,
              unexpected_role_membership_count: 0,
            },
          ],
        }),
      })
      .mockReturnValueOnce({
        status: 0,
        stderr: "",
        stdout: JSON.stringify({ rows: [{ remaining_count: 0 }] }),
      });

    await expect(
      removeTemporaryAuditRole({
        confirmRoleHash: safeHash(roleName),
        environment: {},
        providerProjectRef: "a".repeat(20),
        spawnSyncImpl,
      }),
    ).resolves.toEqual({
      remainingTemporaryAuditRoleCount: 0,
      removedRole: "temporary_integrity_audit",
      removedRoleHash: safeHash(roleName),
    });
    expect(spawnSyncImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses audit-role cleanup when the role owns an object", async () => {
    const roleName = `integrity_audit_${"c".repeat(16)}`;
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({
        rows: [
          {
            active_session_count: 0,
            owned_database_count: 0,
            owned_relation_count: 1,
            owned_routine_count: 0,
            owned_schema_count: 0,
            owned_type_count: 0,
            rolcreatedb: false,
            rolcreaterole: false,
            rolname: roleName,
            rolreplication: false,
            rolsuper: false,
            rolvaliduntil: "2020-01-01T00:00:00.000Z",
            provider_owner_membership_count: 0,
            role_membership_count: 0,
            unexpected_role_membership_count: 0,
          },
        ],
      }),
    }));

    await expect(
      removeTemporaryAuditRole({
        confirmRoleHash: safeHash(roleName),
        environment: {},
        providerProjectRef: "a".repeat(20),
        spawnSyncImpl,
      }),
    ).rejects.toMatchObject({ code: "temporary_role_not_removable" });
    expect(spawnSyncImpl).toHaveBeenCalledTimes(1);
  });

  it("requires the exact expected Production target and four independent inputs", () => {
    expect(
      expectedCustodyTarget({
        CUSTODY_EXPECTED_DATABASE_NAME: "postgres",
        CUSTODY_EXPECTED_PROJECT_HASH: "a".repeat(16),
        CUSTODY_EXPECTED_PROVIDER: "supabase",
      }),
    ).toEqual(expected);
    expect(
      credentialInputs({
        BACKUP_DATABASE_URL: "backup-url",
        DATABASE_URL: "runtime-url",
        INTEGRITY_DATABASE_URL: "audit-url",
        MIGRATION_DATABASE_URL: "migration-url",
      }),
    ).toEqual({
      backup: "backup-url",
      integrityAudit: "audit-url",
      migration: "migration-url",
      runtime: "runtime-url",
    });
    expect(() =>
      credentialInputs({
        DATABASE_URL: "runtime-url",
        INTEGRITY_DATABASE_URL: "audit-url",
        MIGRATION_DATABASE_URL: "migration-url",
      }),
    ).toThrow(/BACKUP_DATABASE_URL/);
  });

  it("fails Vercel placement when an operator or legacy owner credential remains", () => {
    expect(
      summarizeVercelCredentialPlacement([
        { key: "DATABASE_URL", target: ["production"] },
        { key: "MIGRATION_DATABASE_URL", target: ["preview"] },
        { key: "POSTGRES_URL", target: ["production"] },
      ]),
    ).toMatchObject({
      forbiddenCredentialCount: 2,
      legacyOwnerCredentialCount: 1,
      operatorCredentialCount: 1,
      phase: "post-rotation",
      status: "failed",
    });
    expect(
      summarizeVercelCredentialPlacement([
        { key: "DATABASE_URL", target: ["production"] },
      ]),
    ).toEqual({
      forbiddenCredentialCount: 0,
      forbiddenCredentialsPresent: [],
      legacyOwnerCredentialCount: 0,
      legacyOwnerCredentialsPresent: [],
      operatorCredentialCount: 0,
      operatorCredentialsPresent: [],
      phase: "post-rotation",
      runtimeCredentialPresent: true,
      runtimeCredentialScopes: ["production"],
      runtimeProductionOnly: true,
      status: "passed",
    });
  });

  it("allows legacy owner placement only during target verification before rotation", () => {
    expect(
      summarizeVercelCredentialPlacement(
        [
          { key: "POSTGRES_URL", target: ["production"] },
          { key: "POSTGRES_PASSWORD", target: ["production"] },
        ],
        { phase: "pre-rotation" },
      ),
    ).toMatchObject({
      forbiddenCredentialCount: 0,
      legacyOwnerCredentialCount: 2,
      operatorCredentialCount: 0,
      phase: "pre-rotation",
      runtimeCredentialPresent: false,
      status: "passed",
    });
    expect(
      summarizeVercelCredentialPlacement(
        [{ key: "INTEGRITY_DATABASE_URL", target: ["production"] }],
        { phase: "pre-rotation" },
      ).status,
    ).toBe("failed");
    expect(parseVerifyArguments(["--phase", "pre-rotation"])).toMatchObject({
      phase: "pre-rotation",
    });
    expect(() => parseVerifyArguments(["--phase", "unsafe"])).toThrow(/phase/);
  });

  it("discards Vercel values and retains names-only placement evidence", () => {
    const spawnSyncImpl = vi.fn(() => ({
      status: 0,
      stderr: "",
      stdout: JSON.stringify([
        {
          key: "DATABASE_URL",
          target: ["production"],
          value: "sensitive-test-value",
        },
      ]),
    }));
    const result = readVercelCredentialPlacement({
      environment: { HOME: "/tmp", PATH: "/bin" },
      spawnSyncImpl,
    });
    expect(result.status).toBe("passed");
    expect(JSON.stringify(result)).not.toContain("sensitive-test-value");
  });

  it("enforces role-specific privilege boundaries", () => {
    const base = {
      bypassRls: false,
      canLogin: true,
      createDatabase: false,
      createRole: false,
      databaseCreate: false,
      defaultReadOnly: false,
      executableRoutineCount: 8,
      missingRuntimeFunctionCount: 0,
      missingRuntimeWriteCount: 0,
      ownedRelationCount: 0,
      ownedRoutineCount: 0,
      protectedWriteCount: 0,
      relationCount: 10,
      relationWriteCount: 5,
      replication: false,
      roleMembershipCount: 0,
      routineCount: 4,
      schemaCreate: false,
      securityDefinerExecuteCount: 0,
      sequenceSelectMissingCount: 0,
      sequenceUsageMissingCount: 0,
      sequenceWriteCount: 2,
      superuser: false,
      tableSelectMissingCount: 0,
      unexpectedRuntimeWriteCount: 0,
    };
    const runtime = CREDENTIAL_SPECS.find((spec) => spec.key === "runtime")!;
    expect(
      roleViolations(runtime, {
        ...base,
        roleHash: safeHash("app_runtime"),
      }),
    ).toEqual([]);
    expect(
      roleViolations(runtime, {
        ...base,
        bypassRls: true,
        protectedWriteCount: 1,
        roleMembershipCount: 1,
        roleHash: safeHash("postgres"),
      }),
    ).toEqual(
      expect.arrayContaining([
        "role_identity",
        "bypass_rls",
        "protected_relation_write",
        "role_membership",
      ]),
    );

    const audit = CREDENTIAL_SPECS.find(
      (spec) => spec.key === "integrityAudit",
    )!;
    expect(
      roleViolations(audit, {
        ...base,
        bypassRls: true,
        defaultReadOnly: true,
        relationWriteCount: 0,
        roleHash: safeHash("integrity_audit"),
        sequenceWriteCount: 0,
      }),
    ).toEqual([]);
  });

  it("passes only when targets, ledgers, roles, RLS, and Vercel all agree", () => {
    const credentials = Object.fromEntries(
      CREDENTIAL_SPECS.map((spec) => [
        spec.key,
        {
          databaseFingerprint: {
            connectedDatabaseName: "postgres",
            projectIdentityHash: expected.projectIdentityHash,
          },
          migrationLedger: {
            issueCount: 0,
            ledgerFingerprint: "ledger-fingerprint",
            pendingCount: 0,
            state: "current",
            targets: ["production"],
          },
          role: { roleHash: safeHash(spec.roleName), violations: [] },
        },
      ]),
    );
    expect(
      summarizeTopology({
        credentials,
        expected,
        rls: { status: "passed" },
        vercel: { status: "passed" },
      }),
    ).toMatchObject({
      distinctRoleCount: 4,
      ledgerAgreement: true,
      status: "passed",
      targetAgreement: true,
    });
  });
});
