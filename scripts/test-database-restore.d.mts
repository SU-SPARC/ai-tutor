export function main(args?: string[]): Promise<void>
export function parseArguments(args: string[]): {
  archive?: string
  confirmation?: string
  help?: boolean
  json?: boolean
  mode?: "plan" | "restore" | "validate-only"
}
