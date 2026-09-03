import { spawnSync } from "node:child_process";

import {
  safeHash,
  writeIntegrityEvidence,
} from "./database-integrity-evidence.mjs";

export const SUPABASE_MANAGEMENT_API_URL = "https://api.supabase.com";
export const BACKUP_FRESHNESS_LIMIT_HOURS = 36;
export const MINIMUM_RECOVERY_ADMINISTRATORS = 2;
export const SUPABASE_PLAN_DAILY_BACKUP_RETENTION_DAYS = Object.freeze({
  enterprise: 30,
  free: 0,
  pro: 7,
  team: 14,
});

const SUPABASE_PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const SAFE_HASH_PATTERN = /^[0-9a-f]{16}$/;
const HOUR_MS = 60 * 60 * 1000;

export class BackupVerificationError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.name = "BackupVerificationError";
  }
}

export function expectedBackupTarget(environment) {
  const provider = optionalValue(environment.BACKUP_EXPECTED_PROVIDER);
  const projectIdentityHash = optionalValue(
    environment.BACKUP_EXPECTED_PROJECT_HASH,
  );
  const databaseName = optionalValue(environment.BACKUP_EXPECTED_DATABASE_NAME);

  if (!provider || !projectIdentityHash || !databaseName) {
    throw new BackupVerificationError(
      "Production backup verification requires the expected provider, project hash, and database name.",
      "expected_target_unavailable",
    );
  }
  if (provider !== "supabase") {
    throw new BackupVerificationError(
      "Only the Supabase provider is supported by the backup verification command.",
      "unsupported_provider",
    );
  }
  if (!SAFE_HASH_PATTERN.test(projectIdentityHash)) {
    throw new BackupVerificationError(
      "Expected project hash must be a 16-character lowercase hexadecimal safe fingerprint.",
      "invalid_expected_project_hash",
    );
  }
  return { databaseName, projectIdentityHash, provider };
}

export function backupVerificationInputs(environment) {
  const accessToken = optionalValue(environment.SUPABASE_ACCESS_TOKEN);
  const projectRef = optionalValue(environment.BACKUP_PROVIDER_PROJECT_REF);
  if (!accessToken || !projectRef) {
    throw new BackupVerificationError(
      "SUPABASE_ACCESS_TOKEN and BACKUP_PROVIDER_PROJECT_REF are required; no provider request was attempted.",
      "credential_unavailable",
    );
  }
  if (!SUPABASE_PROJECT_REF_PATTERN.test(projectRef)) {
    throw new BackupVerificationError(
      "BACKUP_PROVIDER_PROJECT_REF must be a Supabase project reference.",
      "invalid_project_reference",
    );
  }
  const expected = expectedBackupTarget(environment);
  if (safeHash(projectRef) !== expected.projectIdentityHash) {
    throw new BackupVerificationError(
      "Provider project safe fingerprint differs from the expected Production project.",
      "database_target_mismatch",
    );
  }
  return { accessToken, expected, projectRef };
}

export async function fetchSupabaseBackupConfiguration({
  accessToken,
  baseUrl = SUPABASE_MANAGEMENT_API_URL,
  fetchImpl = globalThis.fetch,
  projectRef,
  timeoutMs = 15_000,
}) {
  const request = async (pathname, { optional = false } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        method: "GET",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (optional) {
        return null;
      }
      throw new BackupVerificationError(
        `Supabase Management API ${describeRequest(pathname)} request failed: ${error?.name ?? "network error"}.`,
        "provider_api_unreachable",
      );
    }
    if (!response.ok) {
      if (optional) {
        return null;
      }
      throw new BackupVerificationError(
        `Supabase Management API returned HTTP ${response.status} for the ${describeRequest(pathname)} request.`,
        "provider_api_error",
      );
    }
    return response.json();
  };

  const project = await request(`/v1/projects/${projectRef}`);
  const backups = await request(`/v1/projects/${projectRef}/database/backups`);
  const organizationSlug = optionalValue(project?.organization_id);
  const organization = organizationSlug
    ? await request(
        `/v1/organizations/${encodeURIComponent(organizationSlug)}`,
        {
          optional: true,
        },
      )
    : null;
  const members = organizationSlug
    ? await request(
        `/v1/organizations/${encodeURIComponent(organizationSlug)}/members`,
        { optional: true },
      )
    : null;

  return { backups, members, organization, project };
}

// The authenticated Supabase CLI keeps its access token in the operating
// system keychain. Driving the CLI lets the verification run without the token
// ever entering this process or a shell variable.
export function runSupabaseCli(
  args,
  { cliCommand = "supabase", environment = process.env, spawnSyncImpl } = {},
) {
  const spawn = spawnSyncImpl ?? spawnSync;
  const result = spawn(cliCommand, [...args, "--output", "json"], {
    encoding: "utf8",
    env: Object.fromEntries(
      ["HOME", "LANG", "PATH", "SUPABASE_ACCESS_TOKEN", "TMPDIR"].flatMap(
        (name) => (environment[name] ? [[name, environment[name]]] : []),
      ),
    ),
    stdio: "pipe",
  });
  if (result?.error) {
    throw new BackupVerificationError(
      "Supabase CLI is unavailable on this host.",
      "provider_cli_unavailable",
    );
  }
  if (result?.status !== 0) {
    throw new BackupVerificationError(
      `Supabase CLI ${args.slice(0, 2).join(" ")} command failed with exit ${result?.status ?? "unknown"}.`,
      "provider_cli_error",
    );
  }
  return parseFirstJsonValue(result.stdout);
}

export function parseFirstJsonValue(output) {
  const text = String(output ?? "");
  const starts = ["[", "{"]
    .map((character) => text.indexOf(character))
    .filter((index) => index >= 0);
  const ends = ["]", "}"]
    .map((character) => text.lastIndexOf(character))
    .filter((index) => index >= 0);
  if (starts.length === 0 || ends.length === 0) {
    throw new BackupVerificationError(
      "Supabase CLI returned no JSON output.",
      "provider_cli_output_unparseable",
    );
  }
  try {
    return JSON.parse(text.slice(Math.min(...starts), Math.max(...ends) + 1));
  } catch {
    throw new BackupVerificationError(
      "Supabase CLI returned output that is not valid JSON.",
      "provider_cli_output_unparseable",
    );
  }
}

export function resolveProjectByHash(projects, projectIdentityHash) {
  const matches = (Array.isArray(projects) ? projects : []).filter(
    (project) => safeHash(String(project?.id ?? "")) === projectIdentityHash,
  );
  if (matches.length !== 1) {
    throw new BackupVerificationError(
      matches.length === 0
        ? "No listed provider project matches the expected Production project fingerprint."
        : "More than one listed provider project matches the expected fingerprint.",
      "database_target_mismatch",
    );
  }
  return matches[0];
}

export function fetchSupabaseBackupConfigurationViaCli({
  cliCommand,
  environment,
  expected,
  spawnSyncImpl,
}) {
  const options = { cliCommand, environment, spawnSyncImpl };
  const projects = runSupabaseCli(["projects", "list"], options);
  const project = resolveProjectByHash(projects, expected.projectIdentityHash);
  const backups = runSupabaseCli(
    ["backups", "list", "--project-ref", String(project.id)],
    options,
  );
  let organization = null;
  try {
    const organizations = runSupabaseCli(["orgs", "list"], options);
    organization =
      (Array.isArray(organizations) ? organizations : []).find(
        (entry) =>
          String(entry?.id ?? "") === String(project?.organization_id ?? ""),
      ) ?? null;
  } catch {
    organization = null;
  }
  return {
    accessMethod: "supabase_cli",
    backups,
    members: null,
    organization,
    project,
  };
}

export function summarizeBackupConfiguration({
  configuration,
  expected,
  generatedAt = new Date().toISOString(),
  target = "production",
}) {
  const { backups, members, organization, project } = configuration;
  const projectIdentityHash = safeHash(String(project?.id ?? ""));
  if (projectIdentityHash !== expected.projectIdentityHash) {
    throw new BackupVerificationError(
      "Provider project safe fingerprint differs from the expected Production project.",
      "database_target_mismatch",
    );
  }

  const plan = normalizePlan(organization?.plan);
  const retentionDays =
    plan && plan in SUPABASE_PLAN_DAILY_BACKUP_RETENTION_DAYS
      ? SUPABASE_PLAN_DAILY_BACKUP_RETENTION_DAYS[plan]
      : null;
  const dailyBackups = Array.isArray(backups?.backups) ? backups.backups : [];
  const successfulDailyBackups = dailyBackups.filter(
    (backup) => String(backup?.status ?? "").toUpperCase() === "COMPLETED",
  );
  const latestDailyBackup = latestByInsertedAt(dailyBackups);
  const latestSuccessfulDailyBackupAt = latestIso(
    successfulDailyBackups.map((backup) => backup.inserted_at),
  );
  const physical = backups?.physical_backup_data ?? null;
  const earliestPhysicalBackupAt = unixToIso(
    physical?.earliest_physical_backup_date_unix,
  );
  const latestPhysicalBackupAt = unixToIso(
    physical?.latest_physical_backup_date_unix,
  );
  const pitrEnabled = Boolean(backups?.pitr_enabled);
  const walgEnabled = Boolean(backups?.walg_enabled);
  const latestRecoveryPointAt = latestIso([
    latestSuccessfulDailyBackupAt,
    latestPhysicalBackupAt,
  ]);
  const nowMs = Date.parse(generatedAt);
  const recoveryPointAgeHours = latestRecoveryPointAt
    ? round((nowMs - Date.parse(latestRecoveryPointAt)) / HOUR_MS)
    : null;

  const memberList = Array.isArray(members) ? members : null;
  const ownership = {
    administratorCount: countRole(memberList, "administrator"),
    memberCount: memberList ? memberList.length : null,
    mfaEnabledCount: memberList
      ? memberList.filter((member) => Boolean(member?.mfa_enabled)).length
      : null,
    ownerCount: countRole(memberList, "owner"),
    verified: memberList !== null,
  };

  const findings = [];
  if (!latestRecoveryPointAt) {
    findings.push({
      code: "no_successful_provider_backup",
      detail:
        "The provider reports neither a completed daily backup nor a physical recovery point.",
      severity: "critical",
    });
  } else if (recoveryPointAgeHours > BACKUP_FRESHNESS_LIMIT_HOURS) {
    findings.push({
      code: "latest_backup_stale",
      detail: `The latest provider recovery point is older than ${BACKUP_FRESHNESS_LIMIT_HOURS} hours.`,
      severity: "critical",
    });
  }
  if (retentionDays === null) {
    findings.push({
      code: "retention_unverified",
      detail:
        "The organization plan did not map to a documented provider retention window; confirm retention in the provider console.",
      severity: "high",
    });
  } else if (retentionDays < 7) {
    findings.push({
      code: "retention_below_policy",
      detail:
        "The provider plan retains fewer than seven days of automated backups.",
      severity: "critical",
    });
  }
  if (project?.status && project.status !== "ACTIVE_HEALTHY") {
    findings.push({
      code: "project_not_healthy",
      detail: `Provider project status is ${String(project.status)}.`,
      severity: "high",
    });
  }
  if (!ownership.verified) {
    findings.push({
      code: "ownership_unverified",
      detail:
        "The organization membership could not be read; institutional recovery administrators are unverified.",
      severity: "high",
    });
  } else {
    if ((ownership.ownerCount ?? 0) < MINIMUM_RECOVERY_ADMINISTRATORS) {
      findings.push({
        code: "insufficient_recovery_administrators",
        detail: `Fewer than ${MINIMUM_RECOVERY_ADMINISTRATORS} organization owners can recover the project.`,
        severity: "high",
      });
    }
    if ((ownership.mfaEnabledCount ?? 0) < (ownership.memberCount ?? 0)) {
      findings.push({
        code: "mfa_not_enforced",
        detail:
          "At least one organization member can administer backups without multi-factor authentication.",
        severity: "high",
      });
    }
  }

  return {
    accessMethod: configuration.accessMethod ?? "management_api",
    artifactVersion: 1,
    audit: "production_database_backups",
    automatedBackups: {
      dailyBackupCount: dailyBackups.length,
      earliestPhysicalBackupAt,
      freshnessLimitHours: BACKUP_FRESHNESS_LIMIT_HOURS,
      latestDailyBackupStatus: latestDailyBackup
        ? String(latestDailyBackup.status ?? "unknown").toUpperCase()
        : null,
      latestPhysicalBackupAt,
      latestRecoveryPointAt,
      latestSuccessfulDailyBackupAt,
      pitrEnabled,
      recoveryPointAgeHours,
      retentionDays,
      retentionSource:
        retentionDays === null ? "unknown" : "provider_plan_default",
      successfulDailyBackupCount: successfulDailyBackups.length,
      walgEnabled,
    },
    credential: "SUPABASE_ACCESS_TOKEN",
    expectedFingerprint: expected,
    findings,
    generatedAt,
    organization: {
      identityHash: organization?.id ? safeHash(String(organization.id)) : null,
      plan: plan ?? null,
      ...ownership,
    },
    project: {
      identityHash: projectIdentityHash,
      postgresEngine: optionalValue(project?.database?.postgres_engine) ?? null,
      postgresVersion: optionalValue(project?.database?.version) ?? null,
      region: optionalValue(project?.region) ?? null,
      releaseChannel: optionalValue(project?.database?.release_channel) ?? null,
      status: optionalValue(project?.status) ?? null,
    },
    provider: "supabase",
    readOnly: true,
    status: findings.length === 0 ? "verified" : "findings",
    summary: {
      criticalFindings: findings.filter(
        (finding) => finding.severity === "critical",
      ).length,
      findingCount: findings.length,
    },
    target,
    writesAttempted: 0,
  };
}

export function createBackupNotRunEvidence({
  generatedAt,
  reasonCode,
  target,
}) {
  return {
    artifactVersion: 1,
    audit: "production_database_backups",
    credential: "SUPABASE_ACCESS_TOKEN",
    generatedAt,
    provider: "supabase",
    readOnly: true,
    reason: {
      code: reasonCode,
      message:
        reasonCode === "credential_unavailable"
          ? "Provider access token or project reference was unavailable; no provider request was attempted."
          : "Required safe target evidence was unavailable; no provider request was attempted.",
    },
    status: "not_run",
    target,
    writesAttempted: 0,
  };
}

export async function writeBackupEvidence(evidenceDirectory, evidence) {
  return writeIntegrityEvidence(evidenceDirectory, evidence);
}

function describeRequest(pathname) {
  if (pathname.includes("/database/backups")) {
    return "backup listing";
  }
  if (pathname.endsWith("/members")) {
    return "organization membership";
  }
  if (pathname.startsWith("/v1/organizations")) {
    return "organization";
  }
  return "project";
}

function normalizePlan(value) {
  const plan = optionalValue(value);
  return plan ? plan.toLowerCase() : undefined;
}

function countRole(members, role) {
  if (!members) {
    return null;
  }
  return members.filter(
    (member) => String(member?.role_name ?? "").toLowerCase() === role,
  ).length;
}

function latestByInsertedAt(backups) {
  let latest = null;
  for (const backup of backups) {
    const timestamp = Date.parse(backup?.inserted_at ?? "");
    if (Number.isNaN(timestamp)) {
      continue;
    }
    if (!latest || timestamp > Date.parse(latest.inserted_at)) {
      latest = backup;
    }
  }
  return latest;
}

function latestIso(values) {
  let latest = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      continue;
    }
    if (latest === null || timestamp > latest) {
      latest = timestamp;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}

function unixToIso(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function optionalValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
