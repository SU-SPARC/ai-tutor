import type { Migration } from "./lib/database-migrations.mjs";

export function main(args?: string[]): Promise<void>;
export function parseArguments(args: string[]): Record<string, unknown>;
export function assertConfirmations(
  options: Record<string, unknown>,
  authorization: Record<string, unknown>,
  expected: Record<string, unknown>,
): void;
export function buildRoleDatabaseUrl(input: {
  password: string;
  poolerHost: string;
  projectRef: string;
  roleName: string;
  transactionPooler: boolean;
}): string;
export function assertPreRotationState(
  row: Record<string, unknown>,
  migrations: Migration[],
): Record<string, unknown>;
