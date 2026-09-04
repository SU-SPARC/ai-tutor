export type CleanupTableSpec = {
  keys: string[];
  table: string;
  types: Array<"bigint" | "date" | "text">;
};

export type CleanupRecordKey = Record<string, string>;

export type CleanupManifest = {
  actorUserId: string;
  artifactVersion: 1;
  changeTicket: string;
  expectedBeforeCounts: Record<string, number>;
  identities: {
    pilotTestUserIds: string[];
    retainedUserIds: string[];
    staffTrialUserIds: string[];
    syntheticQuestionIds: string[];
    temporaryRoles: Array<{ hash: string; name: string }>;
  };
  ledger: { count: number; fingerprint: string; target: "production" };
  protectedCatalog: { publishedQuestionIds: string[] };
  records: Record<string, CleanupRecordKey[]>;
  retentionDecision: string;
  target: "production";
};

export type SanitizedInventory = {
  anonymousSessions: number;
  archivedQuestions: number;
  auditHistory: { contentHash: string; rowCount: number };
  cleanupAuditRows: number;
  counts: Record<string, number>;
  databaseName: string;
  disabledConstraintTriggers: number;
  disabledTriggers: number;
  humanUserFingerprints: string[];
  ledger: { count: number; fingerprint: string; targets: string[] };
  managedTriggerCount: number;
  markerFindings: {
    anonymousSessions: number;
    auditActors: number;
    humanUsers: number;
    nonProductionLedgers: number;
    questions: number;
  };
  observedAt: string;
  publishedCatalog: { count: number; fingerprint: string };
  sessionOwnerCount: number;
  temporaryRoles: Array<{
    bypassRls: boolean;
    expires: "bounded" | "unbounded";
    login: boolean;
    roleHash: string;
  }>;
};

export type CleanupApproval = {
  approved: true;
  fingerprint: string;
  role: string;
};

export const PILOT_CLEANUP_ARTIFACT: "production_pilot_data_cleanup";
export const PILOT_CLEANUP_MANIFEST_VERSION: 1;
export const PILOT_CLEANUP_LOCK_ID: number;
export const PILOT_CLEANUP_AUDIT_ACTION: "production_pilot_data_cleanup";
export const SUPPORTED_RETENTION_DECISIONS: readonly string[];
export const APPROVAL_ROLES: readonly {
  approvedVariable: string;
  key: string;
  nameVariable: string;
  role: string;
}[];
export const CLEANUP_TABLES: readonly CleanupTableSpec[];
export const SUSPENDED_TRIGGERS: readonly { table: string; trigger: string }[];
export const INVENTORY_TABLES: readonly string[];

export class PilotCleanupError extends Error {
  code: string;
  problems?: string[];
  constructor(message: string, code: string);
}

export function requiredSafeLabel(value: unknown, name: string): string;
export function cleanupChangeContext(
  environment: Record<string, string | undefined>,
): { actorUserId: string; changeTicket: string; retentionDecision: string };
export function cleanupApprovals(
  environment: Record<string, string | undefined>,
): Record<string, CleanupApproval>;
export function sqlLiteral(value: unknown): string;
export function sqlTextArray(values: string[]): string;
export function recordKeyString(
  record: CleanupRecordKey,
  spec: CleanupTableSpec,
): string;
export function validateCleanupManifest(manifest: unknown): CleanupManifest;
export function manifestSha256(manifestText: string): string;
export function serializeManifest(manifest: CleanupManifest): string;
export function buildInventorySql(): string;
export function buildPlanSql(input: {
  actorUserId: string;
  pilotTestUserIds: string[];
  staffTrialUserIds: string[];
  syntheticQuestionIds: string[];
}): string;
export function firstJsonColumn(
  output: unknown,
  column: string,
): Record<string, unknown>;
export function buildCleanupManifest(input: {
  changeTicket: string;
  context: {
    actorUserId: string;
    pilotTestUserIds: string[];
    staffTrialUserIds: string[];
    syntheticQuestionIds: string[];
  };
  plan: Record<string, unknown>;
  retentionDecision: string;
  temporaryRoleHashes?: string[];
}): CleanupManifest;
export function buildCleanupStatements(manifest: CleanupManifest): string[];
export function buildCleanupSql(manifest: CleanupManifest): string;
export function buildTemporaryRoleCleanupSql(role: {
  hash?: string;
  name: string;
}): string;
export function cleanupSqlSha256(sql: string): string;
export function sanitizeInventory(inventory: unknown): SanitizedInventory;
export function summarizeManifest(
  manifest: CleanupManifest,
  manifestText?: string,
): Record<string, unknown> & {
  identities: {
    pilotTestUserFingerprints: string[];
    retainedUserCount: number;
    staffTrialUserFingerprints: string[];
    syntheticQuestionFingerprints: string[];
    temporaryRoleHashes: string[];
  };
  sha256?: string;
  totalRecords: number;
};
export function expectedAfterCounts(
  manifest: CleanupManifest,
): Record<string, number>;
export function verifyCleanupOutcome(input: {
  after: SanitizedInventory;
  before: SanitizedInventory;
  manifest: CleanupManifest;
}): { problems: string[]; status: "failed" | "passed" };
