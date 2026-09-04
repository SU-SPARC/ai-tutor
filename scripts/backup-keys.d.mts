export function main(
  args?: string[],
): Promise<Record<string, unknown> | undefined>;
export function parseArguments(args: string[]): Record<string, unknown>;
export function assertOutsideRepository(
  filePath: string,
  label: string,
): string;
export function resolvePrivateKey(
  environment: Record<string, string | undefined>,
): Promise<string>;
