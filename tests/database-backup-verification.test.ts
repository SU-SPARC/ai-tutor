import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BACKUP_FRESHNESS_LIMIT_HOURS,
  BackupVerificationError,
  type SupabaseBackupConfiguration,
  backupVerificationInputs,
  createBackupNotRunEvidence,
  fetchSupabaseBackupConfiguration,
  summarizeBackupConfiguration,
  writeBackupEvidence,
} from "../scripts/lib/database-backup-evidence.mjs";
import { safeHash } from "../scripts/lib/database-integrity-evidence.mjs";
import { parseArguments } from "../scripts/verify-database-backups.mjs";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
const projectRef = "abcdefghijklmnopqrst";
const accessToken = "sbp_do_not_print_this_token";
const expected = {
  databaseName: "postgres",
  projectIdentityHash: safeHash(projectRef),
  provider: "supabase",
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function healthyConfiguration(now: Date): SupabaseBackupConfiguration {
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  return {
    backups: {
      backups: [
        { inserted_at: twoHoursAgo.toISOString(), status: "COMPLETED" },
        {
          inserted_at: new Date(now.getTime() - 26 * 3600 * 1000).toISOString(),
          status: "COMPLETED",
        },
      ],
      physical_backup_data: {
        earliest_physical_backup_date_unix: Math.floor(
          (now.getTime() - 6 * 24 * 3600 * 1000) / 1000,
        ),
        latest_physical_backup_date_unix: Math.floor(
          twoHoursAgo.getTime() / 1000,
        ),
      },
      pitr_enabled: true,
      region: "eu-central-1",
      walg_enabled: true,
    },
    members: [
      {
        email: "owner-one@example.invalid",
        mfa_enabled: true,
        role_name: "Owner",
        user_name: "Owner One",
      },
      {
        email: "owner-two@example.invalid",
        mfa_enabled: true,
        role_name: "Owner",
        user_name: "Owner Two",
      },
    ],
    organization: {
      id: "org-slug-secret",
      name: "Example University",
      plan: "pro",
    },
    project: {
      database: {
        host: `db.${projectRef}.supabase.co`,
        postgres_engine: "17",
        release_channel: "ga",
        version: "17.4.1.054",
      },
      id: projectRef,
      name: "ai-tutor-production",
      organization_id: "org-slug-secret",
      region: "eu-central-1",
      status: "ACTIVE_HEALTHY",
    },
  };
}

describe("provider backup verification", () => {
  it("fails closed without a token, reference, or expected target", () => {
    expect(() => backupVerificationInputs({})).toThrow(BackupVerificationError);
    expect(() => backupVerificationInputs({})).toThrow(
      expect.objectContaining({ code: "credential_unavailable" }),
    );
    expect(() =>
      backupVerificationInputs({
        BACKUP_PROVIDER_PROJECT_REF: projectRef,
        SUPABASE_ACCESS_TOKEN: accessToken,
      }),
    ).toThrow(expect.objectContaining({ code: "expected_target_unavailable" }));
    expect(() =>
      backupVerificationInputs({
        BACKUP_EXPECTED_DATABASE_NAME: "postgres",
        BACKUP_EXPECTED_PROJECT_HASH: "0".repeat(16),
        BACKUP_EXPECTED_PROVIDER: "supabase",
        BACKUP_PROVIDER_PROJECT_REF: projectRef,
        SUPABASE_ACCESS_TOKEN: accessToken,
      }),
    ).toThrow(expect.objectContaining({ code: "database_target_mismatch" }));

    const inputs = backupVerificationInputs({
      BACKUP_EXPECTED_DATABASE_NAME: "postgres",
      BACKUP_EXPECTED_PROJECT_HASH: expected.projectIdentityHash,
      BACKUP_EXPECTED_PROVIDER: "supabase",
      BACKUP_PROVIDER_PROJECT_REF: projectRef,
      SUPABASE_ACCESS_TOKEN: accessToken,
    });
    expect(inputs).toEqual({ accessToken, expected, projectRef });
  });

  it("reads the provider configuration with GET requests and tolerates missing ownership data", async () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const configuration = healthyConfiguration(now);
    const requests: Array<{
      init?: { headers: Record<string, string>; method: string };
      url: string;
    }> = [];
    const fetchImpl = vi.fn(
      async (
        url: string,
        init?: { headers: Record<string, string>; method: string },
      ) => {
        requests.push({ init, url });
        const body = url.includes("/database/backups")
          ? configuration.backups
          : url.endsWith("/members")
            ? null
            : url.includes("/organizations/")
              ? configuration.organization
              : configuration.project;
        return {
          json: async () => body,
          ok: body !== null,
          status: body === null ? 403 : 200,
        };
      },
    );

    const result = await fetchSupabaseBackupConfiguration({
      accessToken,
      baseUrl: "https://api.example.invalid",
      fetchImpl,
      projectRef,
    });

    expect(result.project).toEqual(configuration.project);
    expect(result.backups).toEqual(configuration.backups);
    expect(result.organization).toEqual(configuration.organization);
    expect(result.members).toBeNull();
    expect(requests.map((request) => request.url)).toEqual([
      `https://api.example.invalid/v1/projects/${projectRef}`,
      `https://api.example.invalid/v1/projects/${projectRef}/database/backups`,
      "https://api.example.invalid/v1/organizations/org-slug-secret",
      "https://api.example.invalid/v1/organizations/org-slug-secret/members",
    ]);
    for (const request of requests) {
      expect(request.init?.method).toBe("GET");
      expect(request.init?.headers.authorization).toBe(`Bearer ${accessToken}`);
    }
  });

  it("rejects provider errors without echoing the project reference", async () => {
    const fetchImpl = vi.fn(async () => ({
      json: async () => ({}),
      ok: false,
      status: 401,
    }));
    let failure: unknown;
    try {
      await fetchSupabaseBackupConfiguration({
        accessToken,
        fetchImpl,
        projectRef,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(BackupVerificationError);
    expect(String((failure as Error).message)).toContain("HTTP 401");
    expect(String((failure as Error).message)).not.toContain(projectRef);
  });

  it("verifies a healthy configuration and records only sanitized fields", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const evidence = summarizeBackupConfiguration({
      configuration: healthyConfiguration(now),
      expected,
      generatedAt: now.toISOString(),
    });

    expect(evidence).toMatchObject({
      audit: "production_database_backups",
      automatedBackups: {
        dailyBackupCount: 2,
        freshnessLimitHours: BACKUP_FRESHNESS_LIMIT_HOURS,
        latestDailyBackupStatus: "COMPLETED",
        latestRecoveryPointAt: "2026-09-03T10:00:00.000Z",
        pitrEnabled: true,
        recoveryPointAgeHours: 2,
        retentionDays: 7,
        retentionSource: "provider_plan_default",
        successfulDailyBackupCount: 2,
        walgEnabled: true,
      },
      findings: [],
      organization: {
        identityHash: safeHash("org-slug-secret"),
        memberCount: 2,
        mfaEnabledCount: 2,
        ownerCount: 2,
        plan: "pro",
        verified: true,
      },
      project: {
        identityHash: expected.projectIdentityHash,
        postgresVersion: "17.4.1.054",
        region: "eu-central-1",
        status: "ACTIVE_HEALTHY",
      },
      readOnly: true,
      status: "verified",
      target: "production",
      writesAttempted: 0,
    });
    const serialized = JSON.stringify(evidence);
    for (const secret of [
      projectRef,
      accessToken,
      "org-slug-secret",
      "owner-one@example.invalid",
      "Owner One",
      "ai-tutor-production",
      "supabase.co",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("reports missing backups, weak retention, and ownership gaps as findings", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const healthy = healthyConfiguration(now);
    const weak: SupabaseBackupConfiguration = {
      backups: {
        backups: [{ inserted_at: "2026-08-01T00:00:00Z", status: "FAILED" }],
        physical_backup_data: {},
        pitr_enabled: false,
        region: "eu-central-1",
        walg_enabled: false,
      },
      members: [
        {
          email: "solo@example.invalid",
          mfa_enabled: false,
          role_name: "Owner",
        },
      ],
      organization: { id: "org-slug-secret", name: "x", plan: "free" },
      project: { ...healthy.project, status: "INACTIVE" },
    };

    const evidence = summarizeBackupConfiguration({
      configuration: weak,
      expected,
      generatedAt: now.toISOString(),
    });

    expect(evidence.status).toBe("findings");
    expect(evidence.findings.map((finding) => finding.code)).toEqual([
      "no_successful_provider_backup",
      "retention_below_policy",
      "project_not_healthy",
      "insufficient_recovery_administrators",
      "mfa_not_enforced",
    ]);
    expect(evidence.summary).toEqual({ criticalFindings: 2, findingCount: 5 });

    const stale: SupabaseBackupConfiguration = {
      ...healthy,
      backups: {
        backups: [{ inserted_at: "2026-08-30T00:00:00Z", status: "COMPLETED" }],
        physical_backup_data: {},
        pitr_enabled: false,
        walg_enabled: false,
      },
      members: null,
      organization: { id: "org-slug-secret", name: "x", plan: "unknown-tier" },
    };
    const staleEvidence = summarizeBackupConfiguration({
      configuration: stale,
      expected,
      generatedAt: now.toISOString(),
    });
    expect(staleEvidence.findings.map((finding) => finding.code)).toEqual([
      "latest_backup_stale",
      "retention_unverified",
      "ownership_unverified",
    ]);
  });

  it("refuses a configuration for a different project", () => {
    const healthy = healthyConfiguration(new Date());
    const configuration: SupabaseBackupConfiguration = {
      ...healthy,
      project: { ...healthy.project, id: "zzzzzzzzzzzzzzzzzzzz" },
    };
    expect(() =>
      summarizeBackupConfiguration({ configuration, expected }),
    ).toThrow(expect.objectContaining({ code: "database_target_mismatch" }));
  });

  it("writes NOT RUN evidence and exits 3 when the token is unavailable", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "backup-verification-test-"),
    );
    temporaryDirectories.push(directory);
    const notRun = createBackupNotRunEvidence({
      generatedAt: "2026-09-03T12:34:56.789Z",
      reasonCode: "credential_unavailable",
      target: "production",
    });
    const written = await writeBackupEvidence(directory, notRun);
    expect(path.basename(written)).toBe(
      "2026-09-03T12-34-56-789Z-production-not_run.json",
    );

    const cliDirectory = await mkdtemp(
      path.join(os.tmpdir(), "backup-verification-cli-test-"),
    );
    temporaryDirectories.push(cliDirectory);
    const environment = { ...process.env };
    delete environment.SUPABASE_ACCESS_TOKEN;
    delete environment.BACKUP_PROVIDER_PROJECT_REF;
    let failure: unknown;
    try {
      await execFileAsync(
        process.execPath,
        [
          "scripts/verify-database-backups.mjs",
          "--json",
          "--evidence-dir",
          cliDirectory,
        ],
        { cwd: process.cwd(), env: environment },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 3 });
    const files = await readdir(cliDirectory);
    expect(files).toHaveLength(1);
    const saved = JSON.parse(
      await readFile(path.join(cliDirectory, files[0]), "utf8"),
    );
    expect(saved).toMatchObject({
      credential: "SUPABASE_ACCESS_TOKEN",
      reason: { code: "credential_unavailable" },
      status: "not_run",
      writesAttempted: 0,
    });
  });

  it("parses only the supported command options", () => {
    expect(parseArguments(["--json", "--evidence-dir", "out"])).toEqual({
      evidenceDir: "out",
      json: true,
      target: "production",
    });
    expect(() => parseArguments(["--target", "Prod!"])).toThrow(/lowercase/i);
    expect(() => parseArguments(["--restore"])).toThrow(/Unknown/);
  });
});
