export function main(
  args?: string[],
  dependencies?: {
    environment?: Record<string, string | undefined>;
    fetchImpl?: (
      input: string,
      init?: Record<string, unknown>,
    ) => Promise<{ ok: boolean; status: number }>;
    now?: Date;
  },
): Promise<Record<string, unknown> | undefined>;
export function parseArguments(args: string[]): Record<string, unknown>;
export function sendAlert(input: {
  evidence: Record<string, unknown>;
  fetchImpl: (
    input: string,
    init?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; status: number }>;
  webhookUrl: string;
}): Promise<{ delivered: boolean; status: number | null }>;
