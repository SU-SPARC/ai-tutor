export type BackupExportOptions =
  | { help: true }
  | {
      help?: false;
      json: boolean;
      manifestDir?: string;
      output: string;
      pgDump?: string;
      target: string;
    };

export function parseArguments(args: string[]): BackupExportOptions;
export function main(args?: string[]): Promise<void>;
