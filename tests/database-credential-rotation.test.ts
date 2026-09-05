import { describe, expect, it } from "vitest";

import {
  assertConfirmations,
  assertPreRotationState,
  buildRoleDatabaseUrl,
  parseArguments,
} from "../scripts/rotate-production-database-credentials.mjs";
import {
  fingerprintDatabaseUrl,
  safeHash,
} from "../scripts/lib/database-integrity-evidence.mjs";

const projectRef = "abcdefghijklmnopqrst";
const expected = {
  databaseName: "postgres",
  projectIdentityHash: safeHash(projectRef),
  provider: "supabase",
};

describe("production credential rotation", () => {
  it("constructs role-specific pooled URLs without changing the target", () => {
    const runtime = buildRoleDatabaseUrl({
      password: "test-only-Aa1!",
      poolerHost: "aws-0-us-east-1.pooler.supabase.com",
      projectRef,
      roleName: "app_runtime",
      transactionPooler: true,
    });
    const migration = buildRoleDatabaseUrl({
      password: "test-only-Bb2!",
      poolerHost: "aws-0-us-east-1.pooler.supabase.com",
      projectRef,
      roleName: "app_migrator",
      transactionPooler: false,
    });
    expect(fingerprintDatabaseUrl(runtime)).toMatchObject({
      databaseName: "postgres",
      endpointKind: "pooler",
      projectIdentityHash: expected.projectIdentityHash,
      provider: "supabase",
    });
    expect(new URL(runtime).port).toBe("6543");
    expect(new URL(runtime).searchParams.get("pgbouncer")).toBe("true");
    expect(new URL(migration).port).toBe("5432");
    expect(new URL(migration).searchParams.has("pgbouncer")).toBe(false);
  });

  it("requires explicit Production, project, ticket, and evidence confirmations", () => {
    const options = parseArguments([
      "--confirm-production",
      "--confirm-project-hash",
      expected.projectIdentityHash,
      "--change-ticket",
      "DB-CUSTODY-124",
      "--evidence-dir",
      "docs/evidence/database-custody",
    ]);
    expect(() =>
      assertConfirmations(
        options,
        { changeTicket: "DB-CUSTODY-124" },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertConfirmations(
        { ...options, confirmProduction: false },
        { changeTicket: "DB-CUSTODY-124" },
        expected,
      ),
    ).toThrow(/Production/);
  });

  it("accepts only the immutable ledger and four verified NOLOGIN roles", () => {
    const migrations = [
      {
        checksum: "a",
        destructive: false,
        destructiveDirective: false,
        destructiveReasons: [],
        filename: "001_a.sql",
        sql: "",
        version: 1,
      },
    ];
    const row = {
      database_name: "postgres",
      migration_rows: [
        {
          checksum: "a",
          filename: "001_a.sql",
          target: "production",
          version: 1,
        },
      ],
      migrator_owned_relation_count: 29,
      migrator_owned_routine_count: 8,
      relation_count: 29,
      rls_table_count: 29,
      role_rows: [
        role("app_runtime", false, false),
        role("app_migrator", false, false),
        role("integrity_audit", true, true),
        role("backup_export", true, true),
      ],
      routine_count: 8,
      runtime_policy_count: 29,
      table_count: 29,
      temporary_audit_role_count: 0,
    };
    expect(assertPreRotationState(row, migrations)).toMatchObject({
      migrationCount: 1,
      noLoginRoleCount: 4,
      temporaryAuditRoleCount: 0,
    });
    expect(() =>
      assertPreRotationState(
        {
          ...row,
          role_rows: [
            { ...row.role_rows[0], can_login: true },
            ...row.role_rows.slice(1),
          ],
        },
        migrations,
      ),
    ).toThrow(/NOLOGIN/);
  });
});

function role(name: string, bypassRls: boolean, defaultReadOnly: boolean) {
  return {
    bypass_rls: bypassRls,
    can_login: false,
    create_database: false,
    create_role: false,
    default_read_only: defaultReadOnly,
    member_of_count: 0,
    name,
    replication: false,
    superuser: false,
  };
}
