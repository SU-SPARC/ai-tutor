export type BackupCustodyPolicy = {
  cadenceHours: number;
  encryption: string;
  freshnessLimitHours: number;
  minimumInstitutionalOwners: number;
  providerEvidenceMaxAgeDays: number;
  recoveryPointObjectiveHours: number;
  recoveryTimeObjectiveHours: number;
  retentionDays: number;
};

export type CustodyStore = {
  archivesDir: string;
  directory: string;
  ledgerPath: string;
  manifestsDir: string;
  stagingDir: string;
};

export type LedgerArchive = {
  ciphertextSha256: string;
  encryptedBytes: number;
  name: string;
  plaintextBytes: number;
  plaintextSha256: string;
  recipientKeyFingerprint: string;
};

export type LedgerEntry = {
  actor?: string;
  archive?: LedgerArchive;
  changeTicket?: string;
  custodyRegion?: string | null;
  error?: { code: string };
  ledgerFingerprint?: string;
  ownership?: CustodyOwnership;
  prunedArchives?: string[];
  recordedAt?: string;
  recoveryPointAt?: string;
  retentionDays?: number;
  runId: string;
  status: "completed" | "failed" | "pruned" | "started";
  target?: string;
};

export type CustodyOwnership = {
  institutionalOwnerFingerprints: string[];
  missing: string[];
  operatorFingerprint: string | null;
  status: "not_distinct" | "not_recorded" | "recorded";
};

export type CustodyFinding = {
  code: string;
  detail: string;
  severity: "critical" | "high" | "medium";
};

export type ProviderVerificationSummary = {
  findingCodes: string[];
  generatedAt: string;
  latestRecoveryPointAt: string | null;
  pitrEnabled: boolean;
  region: string | null;
  status: string;
};

export type CustodyEvaluation = {
  counts: {
    completed: number;
    failed: number;
    overdueForPruning: number;
    runs: number;
  };
  findings: CustodyFinding[];
  latestBackup: {
    ageHours: number;
    archiveSha256: string;
    encryptedBytes: number;
    plaintextSha256: string;
    recipientKeyFingerprint: string;
    recoveryPointAt: string | null;
    runId: string;
  } | null;
  missingDays: string[];
  status: "findings" | "verified";
};

export type EnvelopeHeader = {
  cipher: string;
  ephemeralPublicKey: string;
  iv: string;
  kdf: string;
  plaintextBytes: number;
  plaintextSha256: string;
  recipientKeyFingerprint: string;
  v: number;
};

export type AcceptanceRecord = {
  acceptor: { fingerprint: string; role: string };
  artifact: "recovery_objective_acceptance";
  artifactVersion: 1;
  changeTicket: string;
  generatedAt: string;
  measured: { recoveryPointAgeHours: number; recoveryTimeHours: number };
  objectives: {
    recoveryPointObjectiveHours: number;
    recoveryTimeObjectiveHours: number;
  };
  restoreEvidence: Record<string, unknown>;
  status: "accepted" | "rejected";
  target: "production";
  withinObjectives: boolean;
  writesAttempted: 0;
};

export const BACKUP_ENVELOPE_MAGIC: string;
export const BACKUP_ENVELOPE_VERSION: 1;
export const BACKUP_ENVELOPE_CIPHER: "aes-256-gcm";
export const BACKUP_ENVELOPE_KDF: "x25519-hkdf-sha256";
export const BACKUP_ENVELOPE_INFO: string;
export const BACKUP_CUSTODY_LEDGER: string;
export const BACKUP_ARCHIVE_SUFFIX: ".dump.enc";
export const BACKUP_CUSTODY_STATUS_AUDIT: "production_backup_custody_status";
export const BACKUP_ACCEPTANCE_ROLES: readonly string[];
export const BACKUP_CUSTODY_POLICY: BackupCustodyPolicy;

export class BackupCustodyError extends Error {
  code: string;
  constructor(message: string, code: string);
}

export function generateBackupKeyPair(): {
  fingerprint: string;
  privateKey: string;
  publicKey: string;
};
export function importBackupPublicKey(value: unknown): {
  fingerprint: string;
  key: import("node:crypto").KeyObject;
};
export function importBackupPrivateKey(value: unknown): {
  fingerprint: string;
  key: import("node:crypto").KeyObject;
};
export function sha256File(
  filePath: string,
): Promise<{ bytes: number; sha256: string }>;
export function encryptBackupArchive(input: {
  inputPath: string;
  outputPath: string;
  publicKey: string;
}): Promise<{
  ciphertextSha256: string;
  encryptedBytes: number;
  headerBytes: number;
  plaintextBytes: number;
  plaintextSha256: string;
  recipientKeyFingerprint: string;
}>;
export function readBackupEnvelopeHeader(filePath: string): Promise<{
  header: EnvelopeHeader;
  headerBuffer: Buffer;
  headerBytes: number;
}>;
export function decryptBackupArchive(input: {
  inputPath: string;
  outputPath: string;
  privateKey: string;
}): Promise<{
  plaintextBytes: number;
  plaintextSha256: string;
  recipientKeyFingerprint: string;
}>;
export function resolveCustodyStore(input: {
  environment: Record<string, string | undefined>;
  repositoryRoot: string;
}): CustodyStore;
export function ensureCustodyStore(store: CustodyStore): Promise<CustodyStore>;
export function newBackupRunId(now?: Date): string;
export function backupArchiveName(runId: string, target: string): string;
export function appendLedgerEntry(
  store: CustodyStore,
  entry: Record<string, unknown>,
): Promise<LedgerEntry>;
export function readLedger(
  store: CustodyStore,
): Promise<{ entries: LedgerEntry[]; malformedLines: number }>;
export function parseLedger(text: string): {
  entries: LedgerEntry[];
  malformedLines: number;
};
export function requiredSafeLabel(value: unknown, name: string): string;
export function optionalSafeLabel(
  value: unknown,
  name: string,
): string | undefined;
export function backupCustodyOwnership(
  environment: Record<string, string | undefined>,
): CustodyOwnership;
export function completedRuns(entries: LedgerEntry[]): LedgerEntry[];
export function selectArchivesToPrune(input: {
  entries: LedgerEntry[];
  now?: Date;
  policy?: BackupCustodyPolicy;
}): LedgerEntry[];
export function evaluateBackupCustody(input: {
  approvedKeyFingerprint?: string | null;
  archives?: Map<string, { sha256: string; sizeBytes: number }>;
  entries: LedgerEntry[];
  malformedLines?: number;
  now?: Date;
  ownership?: CustodyOwnership | null;
  policy?: BackupCustodyPolicy;
  providerEvidence?: ProviderVerificationSummary | null;
}): CustodyEvaluation;
export function inventoryArchives(
  store: CustodyStore,
  entries: LedgerEntry[],
): Promise<Map<string, { sha256: string; sizeBytes: number }>>;
export function latestProviderVerification(
  evidenceDir: string,
): Promise<ProviderVerificationSummary | null>;
export function createAcceptanceRecord(input: {
  acceptedBy: unknown;
  changeTicket: unknown;
  generatedAt?: string;
  objectives: {
    recoveryPointObjectiveHours: number;
    recoveryTimeObjectiveHours: number;
  };
  restoreEvidence: Record<string, unknown> & {
    recoveryPoint?: { ageAtExerciseMs?: number };
    recoveryTime?: { measuredMs?: number };
  };
  role: string;
}): AcceptanceRecord;
export function sanitizeErrorCode(error: unknown): string;
