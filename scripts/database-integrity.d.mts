import type {
  IntegrityRepairAction,
  IntegrityTarget,
} from "./lib/database-integrity.mjs";

export function main(args?: string[]): Promise<void>;
export function parseArguments(args: string[]):
  | { help: true }
  | {
      actions: IntegrityRepairAction[];
      confirmProduction: boolean;
      confirmRepair: boolean;
      help?: false;
      json: boolean;
      mode: "audit" | "repair";
      target: IntegrityTarget;
    };
