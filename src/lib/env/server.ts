import "server-only"

type ServerEnv = {
  ADMIN_SECRET?: string
  AI_MODEL: string
  APP_DEMO_MODE: boolean
  DATABASE_URL?: string
  MAX_LLM_OUTPUT_TOKENS: number
  OPENROUTER_API_KEY?: string
  RATE_LIMIT_MAX_REQUESTS: number
  RATE_LIMIT_WINDOW_SECONDS: number
}

const DEFAULTS = {
  AI_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free",
  APP_DEMO_MODE: true,
  MAX_LLM_OUTPUT_TOKENS: 400,
  RATE_LIMIT_MAX_REQUESTS: 20,
  RATE_LIMIT_WINDOW_SECONDS: 60,
} as const

export function getServerEnv(): ServerEnv {
  return {
    ADMIN_SECRET: optionalString(process.env.ADMIN_SECRET),
    AI_MODEL: optionalString(process.env.AI_MODEL) ?? DEFAULTS.AI_MODEL,
    APP_DEMO_MODE: parseBoolean(
      process.env.APP_DEMO_MODE,
      DEFAULTS.APP_DEMO_MODE,
    ),
    DATABASE_URL: optionalString(process.env.DATABASE_URL),
    MAX_LLM_OUTPUT_TOKENS: parsePositiveInteger(
      process.env.MAX_LLM_OUTPUT_TOKENS,
      DEFAULTS.MAX_LLM_OUTPUT_TOKENS,
    ),
    OPENROUTER_API_KEY: optionalString(process.env.OPENROUTER_API_KEY),
    RATE_LIMIT_MAX_REQUESTS: parsePositiveInteger(
      process.env.RATE_LIMIT_MAX_REQUESTS,
      DEFAULTS.RATE_LIMIT_MAX_REQUESTS,
    ),
    RATE_LIMIT_WINDOW_SECONDS: parsePositiveInteger(
      process.env.RATE_LIMIT_WINDOW_SECONDS,
      DEFAULTS.RATE_LIMIT_WINDOW_SECONDS,
    ),
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
