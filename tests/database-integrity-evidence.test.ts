import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import {
  IntegrityEvidenceError,
  assertDatabaseTargetFingerprint,
  attestSelectOnlyCredential,
  createNotRunEvidence,
  expectedTargetFingerprint,
  fingerprintDatabaseUrl,
  safeHash,
  summarizeMigrationStatus,
  writeIntegrityEvidence,
} from "../scripts/lib/database-integrity-evidence.mjs";

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("database integrity evidence", () => {
  it("derives only safe Supabase target fingerprints", () => {
    const raw = [
      "postgresql:",
      "//",
      "audit-role.projectref",
      ":",
      "do-not-print",
      "@",
      "aws-0.pooler.supabase.com",
      ":6543/postgres?sslmode=require",
    ].join("");
    const fingerprint = fingerprintDatabaseUrl(raw);

    expect(fingerprint).toEqual({
      databaseName: "postgres",
      endpointKind: "pooler",
      hostHash: safeHash("aws-0.pooler.supabase.com"),
      projectIdentityHash: safeHash("projectref"),
      provider: "supabase",
      roleHash: safeHash("audit-role.projectref"),
    });
    const serialized = JSON.stringify(fingerprint);
    expect(serialized).not.toContain("do-not-print");
    expect(serialized).not.toContain("aws-0.pooler.supabase.com");
    expect(serialized).not.toContain("audit-role.projectref");
    expect(serialized).not.toContain("projectref");
  });

  it("requires and compares the expected Production identity", () => {
    const expected = expectedTargetFingerprint({
      INTEGRITY_EXPECTED_DATABASE_NAME: "postgres",
      INTEGRITY_EXPECTED_PROJECT_HASH: "0123456789abcdef",
      INTEGRITY_EXPECTED_PROVIDER: "supabase",
    });
    expect(() =>
      assertDatabaseTargetFingerprint(
        {
          databaseName: "postgres",
          projectIdentityHash: "0123456789abcdef",
          provider: "supabase",
        },
        expected,
      ),
    ).not.toThrow();
    expect(() =>
      assertDatabaseTargetFingerprint(
        {
          databaseName: "postgres",
          projectIdentityHash: "fedcba9876543210",
          provider: "supabase",
        },
        expected,
      ),
    ).toThrow(/projectIdentityHash/);
    expect(() => expectedTargetFingerprint({})).toThrow(
      /expected provider, project hash, and database name/i,
    );
  });

  it("fails closed when the credential has any effective write capability", async () => {
    const client = {
      async query() {
        return {
          rows: [
            {
              database_create: false,
              database_temp: true,
              default_transaction_read_only: true,
              relation_write: false,
              rolbypassrls: true,
              rolcreatedb: false,
              rolcreaterole: false,
              rolreplication: false,
              rolsuper: false,
              schema_create: false,
              security_definer_execute: true,
              sequence_write: false,
            },
          ],
        };
      },
    };

    await expect(attestSelectOnlyCredential(client)).rejects.toMatchObject({
      code: "credential_not_select_only",
      name: "IntegrityEvidenceError",
    });
  });

  it("accepts a default-read-only role with no effective write capability", async () => {
    const client = {
      async query() {
        return {
          rows: [
            {
              database_create: false,
              database_temp: true,
              default_transaction_read_only: true,
              relation_write: false,
              rolbypassrls: true,
              rolcreatedb: false,
              rolcreaterole: false,
              rolreplication: false,
              rolsuper: false,
              schema_create: false,
              security_definer_execute: false,
              sequence_write: false,
            },
          ],
        };
      },
    };

    await expect(attestSelectOnlyCredential(client)).resolves.toEqual({
      databaseTemporaryObjects: true,
      defaultTransactionReadOnly: true,
      forbiddenPrivilegeCount: 0,
      persistentDataSelectOnly: true,
      rowLevelSecurityBypass: true,
      selectOnly: true,
    });
  });

  it("summarizes migration checksums without ledger actors or deployment data", () => {
    const summary = summarizeMigrationStatus({
      applied: [
        {
          appliedAt: "2026-09-03T12:00:00.000Z",
          actor: "must-not-appear",
          changeTicket: null,
          checksum: "a".repeat(64),
          deploymentSha: "must-not-appear",
          destructiveApprovedBy: null,
          executionMs: 12,
          filename: "001_initial.sql",
          target: "production",
          version: 1,
        },
      ],
      issues: [],
      ledgerExists: true,
      pending: [],
      state: "current",
      total: 1,
    });

    expect(summary).toMatchObject({
      appliedCount: 1,
      issueCount: 0,
      pendingCount: 0,
      state: "current",
      totalCount: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("must-not-appear");
  });

  it("writes a timestamped sanitized NOT RUN artifact without a credential", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "integrity-evidence-test-"),
    );
    temporaryDirectories.push(directory);
    const evidence = createNotRunEvidence({
      generatedAt: "2026-09-03T12:34:56.789Z",
      reasonCode: "credential_unavailable",
      target: "production",
    });

    const outputPath = await writeIntegrityEvidence(directory, evidence);
    expect(path.basename(outputPath)).toBe(
      "2026-09-03T12-34-56-789Z-production-not_run.json",
    );
    const saved = JSON.parse(await readFile(outputPath, "utf8"));
    expect(saved).toMatchObject({
      credential: "INTEGRITY_DATABASE_URL",
      readOnly: true,
      status: "not_run",
      target: "production",
      writesAttempted: 0,
    });
    expect(JSON.stringify(saved)).not.toMatch(/postgres(?:ql)?:\/\//i);
  });

  it("runs the Production command fail-closed and persists NOT RUN evidence", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "integrity-cli-evidence-test-"),
    );
    temporaryDirectories.push(directory);
    const environment = { ...process.env };
    delete environment.INTEGRITY_DATABASE_URL;
    delete environment.INTEGRITY_EXPECTED_DATABASE_NAME;
    delete environment.INTEGRITY_EXPECTED_PROJECT_HASH;
    delete environment.INTEGRITY_EXPECTED_PROVIDER;

    let failure: unknown;
    try {
      await execFileAsync(
        process.execPath,
        [
          "scripts/database-integrity.mjs",
          "audit",
          "--target",
          "production",
          "--json",
          "--evidence-dir",
          directory,
        ],
        { cwd: process.cwd(), env: environment },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: 3 });
    const output = String((failure as { stdout?: string }).stdout ?? "");
    expect(output).toContain('"status": "not_run"');
    expect(output).not.toMatch(/postgres(?:ql)?:\/\//i);
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const saved = JSON.parse(
      await readFile(path.join(directory, files[0]), "utf8"),
    );
    expect(saved.reason.code).toBe("credential_unavailable");
  });

  it("uses errors that never echo an invalid input value", () => {
    const value = "definitely-not-a-secret-to-print";
    let caught: unknown;
    try {
      fingerprintDatabaseUrl(value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IntegrityEvidenceError);
    expect(String(caught)).not.toContain(value);
  });
});
