import "server-only"

import { getServerEnv, type ServerEnv } from "@/lib/env/server"

export type OperatingMode =
  | "local-demo"
  | "local-database"
  | "test-demo"
  | "test-database"
  | "preview-demo"
  | "preview-database"
  | "staging"
  | "production"

export type OperatingModePolicy = {
  allowDemoFallback: boolean
  indicatorLabel?: "Development" | "Local demo" | "Preview" | "Preview demo"
  mode: OperatingMode
  repositorySource: "database" | "demo"
}

export function getOperatingModePolicy() {
  return operatingModePolicyFor(getServerEnv())
}

export function operatingModePolicyFor(
  env: Pick<ServerEnv, "APP_DEMO_MODE" | "APP_ENV">,
): OperatingModePolicy {
  if (env.APP_ENV === "production") {
    return databasePolicy("production")
  }

  if (env.APP_ENV === "staging") {
    return databasePolicy("staging")
  }

  if (env.APP_ENV === "preview") {
    return env.APP_DEMO_MODE
      ? {
          allowDemoFallback: false,
          indicatorLabel: "Preview demo",
          mode: "preview-demo",
          repositorySource: "demo",
        }
      : {
          allowDemoFallback: false,
          indicatorLabel: "Preview",
          mode: "preview-database",
          repositorySource: "database",
        }
  }

  if (env.APP_ENV === "test") {
    return env.APP_DEMO_MODE
      ? demoPolicy("test-demo")
      : localDatabasePolicy("test-database")
  }

  return env.APP_DEMO_MODE
    ? {
        ...demoPolicy("local-demo"),
        indicatorLabel: "Local demo",
      }
    : {
        ...localDatabasePolicy("local-database"),
        indicatorLabel: "Development",
      }
}

function databasePolicy(
  mode: Extract<OperatingMode, "production" | "staging">,
): OperatingModePolicy {
  return {
    allowDemoFallback: false,
    mode,
    repositorySource: "database",
  }
}

function demoPolicy(
  mode: Extract<OperatingMode, "local-demo" | "test-demo">,
): OperatingModePolicy {
  return {
    allowDemoFallback: false,
    mode,
    repositorySource: "demo",
  }
}

function localDatabasePolicy(
  mode: Extract<OperatingMode, "local-database" | "test-database">,
): OperatingModePolicy {
  return {
    allowDemoFallback: true,
    mode,
    repositorySource: "database",
  }
}
