export function main(args?: string[]): Promise<void>;
export function parseArguments(args: string[]): {
  help?: boolean;
  evidenceDir?: string;
  confirmDeploymentHash?: string;
};
export function runSmoke(input: {
  baseUrl: URL;
  fetchImpl?: typeof fetch;
  requireDatabase: boolean;
}): Promise<{
  authorizationBoundaryCheckCount: number;
  checks: number;
  databaseHealth: "passed";
  databaseRequired: boolean;
  privacyBoundaryCheckCount: number;
  publishedQuestionCount: number;
  status: "passed";
}>;
export function createProductionSmokeEvidence(input: {
  baseUrl: URL;
  changeTicket: string;
  confirmDeploymentHash: string;
  expectedDeploymentHash: string;
  generatedAt: string;
  results: Record<string, unknown>;
}): Record<string, unknown>;
