export type CustodyCredentialSpec = {
  environmentName: string;
  key: "runtime" | "migration" | "integrityAudit" | "backup";
  roleName: string;
};
export type CustodyEnvironment = Record<string, string | undefined>;

export const CREDENTIAL_SPECS: readonly CustodyCredentialSpec[];
export const FORBIDDEN_VERCEL_DATABASE_VARIABLES: readonly string[];
export const LEGACY_OWNER_DATABASE_VARIABLES: readonly string[];
export const OPERATOR_DATABASE_VARIABLES: readonly string[];

export class DatabaseCustodyError extends Error {
  code: string;
  constructor(message: string, code: string);
}

export function requiredSafeLabel(value: unknown, name: string): string;
export function productionAuthorization(environment: CustodyEnvironment): {
  changeTicket: string;
  ownerFingerprint: string;
  ownerRole: string;
  secondReviewerFingerprint: string;
  secondReviewerRole: string;
};
export function productionMutationPrerequisites(
  environment: CustodyEnvironment,
): {
  administratorCount: number;
  administrators: Array<{
    administratorFingerprint: string;
    mfa: "verified";
    role: "recovery_administrator";
  }>;
  mfaEnabledAdministratorCount: number;
  organizationFingerprint: string;
  ownership: "institutionally_verified";
};
export function expectedCustodyTarget(environment: CustodyEnvironment): {
  databaseName: "postgres";
  projectIdentityHash: string;
  provider: "supabase";
};
export function credentialInputs(
  environment: CustodyEnvironment,
): Record<CustodyCredentialSpec["key"], string>;
export function summarizeVercelCredentialPlacement(
  entries: unknown[],
  options?: { phase?: "pre-rotation" | "post-rotation" },
): {
  forbiddenCredentialCount: number;
  forbiddenCredentialsPresent: string[];
  legacyOwnerCredentialCount: number;
  legacyOwnerCredentialsPresent: string[];
  operatorCredentialCount: number;
  operatorCredentialsPresent: string[];
  phase: "pre-rotation" | "post-rotation";
  runtimeCredentialPresent: boolean;
  runtimeCredentialScopes: string[];
  runtimeProductionOnly: boolean;
  status: "passed" | "failed";
};
export function roleViolations(
  spec: CustodyCredentialSpec,
  attestation: Record<string, unknown>,
): string[];
export function summarizeTopology(
  input: Record<string, unknown>,
): Record<string, unknown>;
