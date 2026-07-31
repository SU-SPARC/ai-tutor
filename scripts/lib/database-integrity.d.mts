import type { MigrationClient } from "./database-migrations.mjs";

export type IntegrityTarget = "production" | "staging" | "test";
export type IntegrityRepairAction =
  | "quarantine-unsafe-questions"
  | "reconcile-usage-totals";

export type IntegrityCheck = {
  count: number;
  description: string;
  id: string;
  repairAction: IntegrityRepairAction | null;
  sampleIds: string[];
  severity: "critical" | "high";
  status: "findings" | "passed";
  title: string;
};

export type IntegrityAuditReport = {
  checks: IntegrityCheck[];
  generatedAt: string;
  mode: "audit";
  readOnly: true;
  status: "clean" | "findings";
  summary: {
    failedChecks: number;
    findings: number;
    passedChecks: number;
    totalChecks: number;
  };
  target: IntegrityTarget;
};

export type IntegrityRepairReport = {
  actions: Array<{
    action: IntegrityRepairAction;
    changedRows: number;
    description: string;
  }>;
  after: IntegrityAuditReport;
  before: IntegrityAuditReport;
  changeTicket: string;
  mode: "repair";
  repairActorUserId: string;
  status: "repaired" | "repaired_with_remaining_findings";
  target: IntegrityTarget;
};

export const INTEGRITY_REPAIR_LOCK_ID: number;
export const SUPPORTED_INTEGRITY_TARGETS: readonly IntegrityTarget[];
export const SUPPORTED_REPAIR_ACTIONS: readonly IntegrityRepairAction[];

export class IntegrityWorkflowError extends Error {}

export function auditDatabaseIntegrity(
  client: MigrationClient,
  options: { target: IntegrityTarget },
): Promise<IntegrityAuditReport>;
export function runReadOnlyIntegrityAudit(
  client: MigrationClient,
  options: { target: IntegrityTarget },
): Promise<IntegrityAuditReport>;
export function assertIntegrityDatabaseTarget(
  client: MigrationClient,
  target: IntegrityTarget,
): Promise<void>;
export function repairDatabaseIntegrity(
  client: MigrationClient,
  options: {
    actions: IntegrityRepairAction[];
    actorUserId?: string;
    changeTicket?: string;
    confirmProduction?: boolean;
    confirmRepair?: boolean;
    target: IntegrityTarget;
  },
): Promise<IntegrityRepairReport>;
export function formatIntegrityReport(
  report: IntegrityAuditReport | IntegrityRepairReport,
): string;
