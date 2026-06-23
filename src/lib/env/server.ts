import "server-only"

type ServerEnv = {
  ADMIN_SECRET?: string
  APP_DEMO_MODE: boolean
  DATABASE_URL?: string
  MAX_DAILY_LLM_CALLS: number
  MAX_LLM_CALLS_PER_SESSION: number
  OPENAI_API_KEY?: string
  OPENAI_MODEL: string
}

const DEFAULTS = {
  APP_DEMO_MODE: true,
  MAX_DAILY_LLM_CALLS: 100,
  MAX_LLM_CALLS_PER_SESSION: 2,
  OPENAI_MODEL: "gpt-4.1-mini",
} as const

export function getServerEnv(): ServerEnv {
  return {
    ADMIN_SECRET: optionalString(process.env.ADMIN_SECRET),
    APP_DEMO_MODE: parseBoolean(
      process.env.APP_DEMO_MODE,
      DEFAULTS.APP_DEMO_MODE,
    ),
    DATABASE_URL: optionalString(process.env.DATABASE_URL),
    MAX_DAILY_LLM_CALLS: parsePositiveInteger(
      process.env.MAX_DAILY_LLM_CALLS,
      DEFAULTS.MAX_DAILY_LLM_CALLS,
    ),
    MAX_LLM_CALLS_PER_SESSION: parsePositiveInteger(
      process.env.MAX_LLM_CALLS_PER_SESSION,
      DEFAULTS.MAX_LLM_CALLS_PER_SESSION,
    ),
    OPENAI_API_KEY: optionalString(process.env.OPENAI_API_KEY),
    OPENAI_MODEL: optionalString(process.env.OPENAI_MODEL) ?? DEFAULTS.OPENAI_MODEL,
  }
}

function optionalString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false
  }

  return fallback
}

function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
