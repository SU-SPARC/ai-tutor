import type {
  IntegrityAuditReport,
  IntegrityCheck,
  IntegrityTarget,
} from "./database-integrity.mjs";
import type {
  MigrationClient,
  MigrationStatus,
} from "./database-migrations.mjs";

export type SafeDatabaseFingerprint = {
  connectedDatabaseName?: string;
  connectedRoleHash?: string;
  databaseName: string;
  endpointKind: "direct" | "other" | "pooler";
  hostHash: string;
  projectIdentityHash?: string;
  provider: string;
  roleHash: string;
};

export type ExpectedDatabaseFingerprint = Pick<
  SafeDatabaseFingerprint,
  "databaseName" | "projectIdentityHash" | "provider"
> & { projectIdentityHash: string };

export type NotRunIntegrityEvidence = {
  artifactVersion: 1;
  audit: "production_database_integrity";
  credential: "INTEGRITY_DATABASE_URL";
  generatedAt: string;
  readOnly: true;
  reason: { code: string; message: string };
  status: "not_run";
  target: IntegrityTarget;
  writesAttempted: 0;
};

export type CompletedIntegrityEvidence = {
  artifactVersion: 1;
  audit: "production_database_integrity";
  checks: IntegrityCheck[];
  credentialAttestation: {
    defaultTransactionReadOnly: true;
    forbiddenPrivilegeCount: 0;
    selectOnly: true;
  };
  databaseFingerprint: SafeDatabaseFingerprint;
  expectedFingerprint?: ExpectedDatabaseFingerprint;
  generatedAt: string;
  migrationLedger: ReturnType<typeof summarizeMigrationStatus>;
  mode: "audit";
  readOnly: true;
  status: IntegrityAuditReport["status"];
  summary: IntegrityAuditReport["summary"];
  target: IntegrityTarget;
  writesAttempted: 0;
};

export class IntegrityEvidenceError extends Error {
  code: string;
}

export function safeHash(value: unknown): string;
export function fingerprintDatabaseUrl(
  databaseUrl: string,
): SafeDatabaseFingerprint;
export function expectedTargetFingerprint(
  environment: Readonly<Record<string, string | undefined>>,
): ExpectedDatabaseFingerprint;
export function assertDatabaseTargetFingerprint(
  actual: Pick<
    SafeDatabaseFingerprint,
    "databaseName" | "projectIdentityHash" | "provider"
  >,
  expected: ExpectedDatabaseFingerprint,
): void;
export function connectedDatabaseFingerprint(
  client: MigrationClient,
  urlFingerprint: SafeDatabaseFingerprint,
): Promise<SafeDatabaseFingerprint>;
export function attestSelectOnlyCredential(client: MigrationClient): Promise<{
  defaultTransactionReadOnly: true;
  forbiddenPrivilegeCount: 0;
  selectOnly: true;
}>;
export function summarizeMigrationStatus(status: MigrationStatus): {
  appliedCount: number;
  issueCount: number;
  issueTypes: string[];
  ledgerFingerprint: string;
  pendingCount: number;
  state: MigrationStatus["state"];
  totalCount: number;
};
export function createNotRunEvidence(options: {
  generatedAt: string;
  reasonCode: string;
  target: IntegrityTarget;
}): NotRunIntegrityEvidence;
export function createCompletedEvidence(options: {
  audit: IntegrityAuditReport;
  credentialAttestation: CompletedIntegrityEvidence["credentialAttestation"];
  databaseFingerprint: SafeDatabaseFingerprint;
  expectedFingerprint?: ExpectedDatabaseFingerprint;
  migrationStatus: MigrationStatus;
}): CompletedIntegrityEvidence;
export function writeIntegrityEvidence(
  evidenceDirectory: string,
  evidence: NotRunIntegrityEvidence | CompletedIntegrityEvidence,
): Promise<string>;
