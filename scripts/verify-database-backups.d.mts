export type BackupVerificationOptions =
  | { help: true }
  | {
      evidenceDir?: string;
      help?: false;
      json: boolean;
      target: string;
    };

export function parseArguments(args: string[]): BackupVerificationOptions;
export function main(args?: string[]): Promise<void>;
