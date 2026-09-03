export const SUPABASE_MANAGEMENT_API_URL: string;
export const BACKUP_FRESHNESS_LIMIT_HOURS: number;
export const MINIMUM_RECOVERY_ADMINISTRATORS: number;
export const SUPABASE_PLAN_DAILY_BACKUP_RETENTION_DAYS: Readonly<
  Record<string, number>
>;

export class BackupVerificationError extends Error {
  code: string;
}

export type ExpectedBackupTarget = {
  databaseName: string;
  projectIdentityHash: string;
  provider: string;
};

export type BackupVerificationInputs = {
  accessToken: string;
  expected: ExpectedBackupTarget;
  projectRef: string;
};

export type SupabaseBackupConfiguration = {
  backups: Record<string, unknown> | null;
  members: Array<Record<string, unknown>> | null;
  organization: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
};

export type BackupFetchImpl = (
  url: string,
  init?: {
    headers: Record<string, string>;
    method: string;
    signal: AbortSignal;
  },
) => Promise<{ json(): Promise<unknown>; ok: boolean; status: number }>;

export type BackupFinding = {
  code: string;
  detail: string;
  severity: "critical" | "high";
};

export type BackupEvidence = {
  artifactVersion: 1;
  audit: "production_database_backups";
  automatedBackups: {
    dailyBackupCount: number;
    earliestPhysicalBackupAt: string | null;
    freshnessLimitHours: number;
    latestDailyBackupStatus: string | null;
    latestPhysicalBackupAt: string | null;
    latestRecoveryPointAt: string | null;
    latestSuccessfulDailyBackupAt: string | null;
    pitrEnabled: boolean;
    recoveryPointAgeHours: number | null;
    retentionDays: number | null;
    retentionSource: "provider_plan_default" | "unknown";
    successfulDailyBackupCount: number;
    walgEnabled: boolean;
  };
  credential: "SUPABASE_ACCESS_TOKEN";
  expectedFingerprint: ExpectedBackupTarget;
  findings: BackupFinding[];
  generatedAt: string;
  organization: {
    administratorCount: number | null;
    identityHash: string | null;
    memberCount: number | null;
    mfaEnabledCount: number | null;
    ownerCount: number | null;
    plan: string | null;
    verified: boolean;
  };
  project: {
    identityHash: string;
    postgresEngine: string | null;
    postgresVersion: string | null;
    region: string | null;
    releaseChannel: string | null;
    status: string | null;
  };
  provider: "supabase";
  readOnly: true;
  status: "findings" | "verified";
  summary: { criticalFindings: number; findingCount: number };
  target: string;
  writesAttempted: 0;
};

export type BackupNotRunEvidence = {
  artifactVersion: 1;
  audit: "production_database_backups";
  credential: "SUPABASE_ACCESS_TOKEN";
  generatedAt: string;
  provider: "supabase";
  readOnly: true;
  reason: { code: string; message: string };
  status: "not_run";
  target: string;
  writesAttempted: 0;
};

export function expectedBackupTarget(
  environment: Record<string, string | undefined>,
): ExpectedBackupTarget;
export function backupVerificationInputs(
  environment: Record<string, string | undefined>,
): BackupVerificationInputs;
export function fetchSupabaseBackupConfiguration(options: {
  accessToken: string;
  baseUrl?: string;
  fetchImpl?: BackupFetchImpl;
  projectRef: string;
  timeoutMs?: number;
}): Promise<SupabaseBackupConfiguration>;
export function summarizeBackupConfiguration(options: {
  configuration: SupabaseBackupConfiguration;
  expected: ExpectedBackupTarget;
  generatedAt?: string;
  target?: string;
}): BackupEvidence;
export function createBackupNotRunEvidence(options: {
  generatedAt: string;
  reasonCode: string;
  target: string;
}): BackupNotRunEvidence;
export function writeBackupEvidence(
  evidenceDirectory: string,
  evidence: BackupEvidence | BackupNotRunEvidence,
): Promise<string>;
