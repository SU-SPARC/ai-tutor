import type { Migration } from "./lib/database-migrations.mjs";
import type { CustodyCredentialSpec } from "./lib/database-custody.mjs";

export function main(args?: string[]): Promise<void>;
export function parseArguments(args: string[]): {
  help?: boolean;
  json?: boolean;
  evidenceDir?: string;
  phase?: "pre-rotation" | "post-rotation";
};
export function inspectCredential(input: {
  databaseUrl: string;
  expected: {
    databaseName: string;
    projectIdentityHash: string;
    provider: string;
  };
  migrations: Migration[];
  spec: CustodyCredentialSpec;
}): Promise<Record<string, unknown>>;
export function readVercelCredentialPlacement(options?: {
  environment?: Record<string, string | undefined>;
  phase?: "pre-rotation" | "post-rotation";
  spawnSyncImpl?: (...args: unknown[]) => unknown;
}): Record<string, unknown>;
export function readRoleAttestation(client: {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<Record<string, unknown>>;
export function readRlsEvidence(client: {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<Record<string, unknown>>;
