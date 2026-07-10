import "server-only"

type ServerEnv = {
  ADMIN_SECRET?: string
  APP_DEMO_MODE: boolean
  DATABASE_URL?: string
  LLM_CACHE_TTL_SECONDS: number
  MAX_DAILY_LLM_CALLS: number
  MAX_LLM_CALLS_PER_SESSION: number
  MAX_LLM_CALLS_PER_QUESTION_PER_DAY: number
  MAX_LLM_CALLS_PER_STUDENT_PER_DAY: number
  MAX_LLM_OUTPUT_TOKENS: number
  MAX_LLM_TOKENS_PER_SESSION: number
  MAX_TUTOR_INPUT_CHARS: number
  OPENAI_API_KEY?: string
  OPENAI_EMBEDDING_MODEL?: string
  OPENAI_MODEL: string
  USAGE_KEY_SECRET?: string
}

const DEFAULTS = {
  APP_DEMO_MODE: true,
  LLM_CACHE_TTL_SECONDS: 86_400,
  MAX_DAILY_LLM_CALLS: 100,
  MAX_LLM_CALLS_PER_SESSION: 3,
  MAX_LLM_CALLS_PER_QUESTION_PER_DAY: 3,
  MAX_LLM_CALLS_PER_STUDENT_PER_DAY: 5,
  MAX_LLM_OUTPUT_TOKENS: 180,
  MAX_LLM_TOKENS_PER_SESSION: 1200,
  MAX_TUTOR_INPUT_CHARS: 800,
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
    LLM_CACHE_TTL_SECONDS: parsePositiveInteger(
      process.env.LLM_CACHE_TTL_SECONDS,
      DEFAULTS.LLM_CACHE_TTL_SECONDS,
    ),
    MAX_DAILY_LLM_CALLS: parsePositiveInteger(
      process.env.MAX_DAILY_LLM_CALLS,
      DEFAULTS.MAX_DAILY_LLM_CALLS,
    ),
    MAX_LLM_CALLS_PER_SESSION: parsePositiveInteger(
      process.env.MAX_LLM_CALLS_PER_SESSION,
      DEFAULTS.MAX_LLM_CALLS_PER_SESSION,
    ),
    MAX_LLM_CALLS_PER_QUESTION_PER_DAY: parsePositiveInteger(
      process.env.MAX_LLM_CALLS_PER_QUESTION_PER_DAY,
      DEFAULTS.MAX_LLM_CALLS_PER_QUESTION_PER_DAY,
    ),
    MAX_LLM_CALLS_PER_STUDENT_PER_DAY: parsePositiveInteger(
      process.env.MAX_LLM_CALLS_PER_STUDENT_PER_DAY,
      DEFAULTS.MAX_LLM_CALLS_PER_STUDENT_PER_DAY,
    ),
    MAX_LLM_OUTPUT_TOKENS: parsePositiveInteger(
      process.env.MAX_LLM_OUTPUT_TOKENS,
      DEFAULTS.MAX_LLM_OUTPUT_TOKENS,
    ),
    MAX_LLM_TOKENS_PER_SESSION: parsePositiveInteger(
      process.env.MAX_LLM_TOKENS_PER_SESSION,
      DEFAULTS.MAX_LLM_TOKENS_PER_SESSION,
    ),
    MAX_TUTOR_INPUT_CHARS: parsePositiveInteger(
      process.env.MAX_TUTOR_INPUT_CHARS,
      DEFAULTS.MAX_TUTOR_INPUT_CHARS,
    ),
    OPENAI_API_KEY: optionalString(process.env.OPENAI_API_KEY),
    OPENAI_EMBEDDING_MODEL: optionalString(process.env.OPENAI_EMBEDDING_MODEL),
    OPENAI_MODEL:
      optionalString(process.env.OPENAI_MODEL) ?? DEFAULTS.OPENAI_MODEL,
    USAGE_KEY_SECRET: optionalString(process.env.USAGE_KEY_SECRET),
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
