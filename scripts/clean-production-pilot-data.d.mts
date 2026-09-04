import type {
  CleanupManifest,
  SanitizedInventory,
} from "./lib/pilot-data-cleanup.mjs";

export function main(args?: string[]): Promise<void>;
export function parseArguments(args: string[]): Record<string, unknown>;
export function assertBeforeMatchesManifest(
  before: SanitizedInventory,
  manifest: CleanupManifest,
): void;
export function loadBackupEvidence(evidencePath: string): Promise<{
  evidence: Record<string, unknown>;
  summary: {
    archiveSha256: string;
    integrityAuditStatus: string | null;
    recoveryPointAt: string | null;
    restoreEvidenceGeneratedAt: string;
    validationStatus: string | null;
  };
}>;
export function loadRehearsalEvidence(
  evidencePath: string,
  context: {
    backup: { summary: { archiveSha256: string } };
    manifestSha256: string;
  },
): Promise<Record<string, unknown> & { cleanupSqlSha256?: string }>;
export function runOwnerSql(input: {
  providerProjectRef: string;
  spawnSyncImpl?: (...args: unknown[]) => unknown;
  sql: string;
}): unknown;
