export function main(args?: string[]): Promise<void>;
export function parseArguments(args: string[]): Record<string, unknown>;
export function assertCommandConfirmations(
  options: Record<string, unknown>,
  authorization: Record<string, unknown>,
  expected: Record<string, unknown>,
): void;
export function runSupabaseQuery(input: {
  providerProjectRef: string;
  spawnSyncImpl: (...args: unknown[]) => unknown;
  sql: string;
}): Record<string, unknown>;
export function removeTemporaryAuditRole(input: {
  confirmRoleHash: string;
  environment: Record<string, string | undefined>;
  providerProjectRef: string;
  spawnSyncImpl: (...args: unknown[]) => unknown;
}): Promise<Record<string, unknown>>;
