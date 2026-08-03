import "server-only";

export const APP_ENVIRONMENTS = [
  "development",
  "test",
  "preview",
  "staging",
  "production",
] as const;

export const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type ProcessEnvironment = Readonly<Record<string, string | undefined>>;

type ServerEnvBase = {
  ANONYMOUS_COOKIE_DAYS: number;
  ANONYMOUS_ID_SECRET?: string;
  ANONYMOUS_PILOT_ENABLED: boolean;
  APP_DEMO_MODE: boolean;
  APP_ENV: AppEnvironment;
  APP_URL: string;
  AUTH_CLIENT_ID?: string;
  AUTH_CLIENT_SECRET?: string;
  AUTH_ENABLED: boolean;
  AUTH_ISSUER_URL?: string;
  AUTH_OIDC_ENABLED: boolean;
  AUTH_SESSION_SECRET?: string;
  AUTH_TEST_MODE: boolean;
  DATABASE_URL?: string;
  ERROR_TRACKING_DSN?: string;
  IS_DEPLOYED_ENVIRONMENT: boolean;
  IS_PRODUCTION: boolean;
  LEGACY_ANONYMOUS_MIGRATION_ENABLED: boolean;
  LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT?: string;
  LOG_LEVEL: LogLevel;
  RATE_LIMIT_MAX_REQUESTS: number;
  RATE_LIMIT_WINDOW_SECONDS: number;
};

type EnabledAiServerEnv = {
  AI_ENABLED: true;
  AI_MODEL: string;
  AI_PROVIDER: "openrouter";
  MAX_LLM_OUTPUT_TOKENS: number;
  OPENROUTER_API_KEY: string;
};

type DisabledAiServerEnv = {
  AI_ENABLED: false;
  AI_MODEL?: string;
  AI_PROVIDER?: "openrouter";
  MAX_LLM_OUTPUT_TOKENS?: number;
  OPENROUTER_API_KEY?: string;
};

export type ServerEnv = ServerEnvBase &
  (EnabledAiServerEnv | DisabledAiServerEnv);

const DEFAULTS = {
  AI_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free",
  ANONYMOUS_COOKIE_DAYS: 30,
  APP_URL: "http://localhost:3000",
  MAX_LLM_OUTPUT_TOKENS: 400,
  RATE_LIMIT_MAX_REQUESTS: 20,
  RATE_LIMIT_WINDOW_SECONDS: 60,
} as const;

const STRICT_ENVIRONMENTS = new Set<AppEnvironment>(["staging", "production"]);

const SERVER_SECRET_NAMES = [
  "ANONYMOUS_ID_SECRET",
  "AUTH_CLIENT_SECRET",
  "AUTH_SESSION_SECRET",
  "DATABASE_URL",
  "ERROR_TRACKING_DSN",
  "OPENROUTER_API_KEY",
] as const;

export class ServerEnvironmentValidationError extends Error {
  readonly environment: AppEnvironment;
  readonly issues: readonly string[];

  constructor(environment: AppEnvironment, issues: string[]) {
    super(
      [
        `Server environment validation failed for ${environment}:`,
        ...issues.map((issue) => `- ${issue}`),
      ].join("\n"),
    );
    this.name = "ServerEnvironmentValidationError";
    this.environment = environment;
    this.issues = issues;
  }
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

export function parseServerEnv(input: ProcessEnvironment): ServerEnv {
  const issues: string[] = [];
  const APP_ENV = resolveAppEnvironment(input, issues);
  const strict = STRICT_ENVIRONMENTS.has(APP_ENV);
  const production = APP_ENV === "production";
  const local = APP_ENV === "development" || APP_ENV === "test";
  const deployed = ["preview", "staging", "production"].includes(APP_ENV);
  const previewUrl = urlFromVercelHostname(input.VERCEL_URL);
  const rawAppUrl =
    optionalString(input.APP_URL) ??
    (APP_ENV === "preview" ? previewUrl : undefined) ??
    (local ? DEFAULTS.APP_URL : undefined);
  const APP_URL = parseHttpUrl("APP_URL", rawAppUrl, issues, {
    requireHttps: deployed,
    required: true,
  });
  const DATABASE_URL = parsePostgresUrl(
    optionalString(input.DATABASE_URL),
    issues,
    strict,
  );
  const AUTH_TEST_MODE = parseBoolean(
    "AUTH_TEST_MODE",
    input.AUTH_TEST_MODE,
    issues,
    { defaultValue: false },
  );
  const oidcConfigured = [
    input.AUTH_ISSUER_URL,
    input.AUTH_CLIENT_ID,
    input.AUTH_CLIENT_SECRET,
  ].some((value) => Boolean(optionalString(value)));
  const AUTH_ISSUER_URL = parseHttpUrl(
    "AUTH_ISSUER_URL",
    optionalString(input.AUTH_ISSUER_URL),
    issues,
    {
      oidcIssuer: true,
      preserveExact: true,
      requireHttps: deployed,
      required: strict || oidcConfigured,
    },
  );
  const AUTH_CLIENT_ID = parseString(
    "AUTH_CLIENT_ID",
    input.AUTH_CLIENT_ID,
    issues,
    { required: strict || oidcConfigured },
  );
  const AUTH_CLIENT_SECRET = parseString(
    "AUTH_CLIENT_SECRET",
    input.AUTH_CLIENT_SECRET,
    issues,
    { required: strict || oidcConfigured },
  );
  const AUTH_SESSION_SECRET = parseString(
    "AUTH_SESSION_SECRET",
    input.AUTH_SESSION_SECRET,
    issues,
    {
      minimumLength:
        strict || oidcConfigured || AUTH_TEST_MODE ? 32 : undefined,
      required:
        strict ||
        oidcConfigured ||
        AUTH_TEST_MODE ||
        Boolean(input.AUTH_SESSION_SECRET),
    },
  );
  const AUTH_OIDC_ENABLED = Boolean(
    AUTH_ISSUER_URL &&
    AUTH_CLIENT_ID &&
    AUTH_CLIENT_SECRET &&
    AUTH_SESSION_SECRET,
  );
  const AUTH_ENABLED = AUTH_OIDC_ENABLED || AUTH_TEST_MODE;
  const ANONYMOUS_PILOT_ENABLED = parseBoolean(
    "ANONYMOUS_PILOT_ENABLED",
    input.ANONYMOUS_PILOT_ENABLED,
    issues,
    {
      defaultValue: local,
      required: deployed,
    },
  );
  const ANONYMOUS_ID_SECRET = parseString(
    "ANONYMOUS_ID_SECRET",
    input.ANONYMOUS_ID_SECRET,
    issues,
    {
      minimumLength: ANONYMOUS_PILOT_ENABLED ? 32 : undefined,
      required: ANONYMOUS_PILOT_ENABLED && deployed,
    },
  );
  const ANONYMOUS_COOKIE_DAYS = parsePositiveInteger(
    "ANONYMOUS_COOKIE_DAYS",
    input.ANONYMOUS_COOKIE_DAYS,
    issues,
    {
      defaultValue: local ? DEFAULTS.ANONYMOUS_COOKIE_DAYS : undefined,
      required: ANONYMOUS_PILOT_ENABLED && deployed,
    },
  );
  const LEGACY_ANONYMOUS_MIGRATION_ENABLED = parseBoolean(
    "LEGACY_ANONYMOUS_MIGRATION_ENABLED",
    input.LEGACY_ANONYMOUS_MIGRATION_ENABLED,
    issues,
    { defaultValue: false },
  );
  const LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT = parseIsoTimestamp(
    "LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT",
    input.LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT,
    issues,
    LEGACY_ANONYMOUS_MIGRATION_ENABLED,
  );
  const ERROR_TRACKING_DSN = parseHttpUrl(
    "ERROR_TRACKING_DSN",
    optionalString(input.ERROR_TRACKING_DSN),
    issues,
    {
      requireHttps: strict,
      required: strict,
    },
  );
  const APP_DEMO_MODE = parseBoolean(
    "APP_DEMO_MODE",
    input.APP_DEMO_MODE,
    issues,
    {
      defaultValue: !strict,
      required: strict,
    },
  );
  const OPENROUTER_API_KEY = optionalString(input.OPENROUTER_API_KEY);
  const AI_ENABLED = parseBoolean("AI_ENABLED", input.AI_ENABLED, issues, {
    defaultValue: !strict && Boolean(OPENROUTER_API_KEY),
    required: strict,
  });
  const AI_PROVIDER = parseAiProvider(
    input.AI_PROVIDER,
    issues,
    AI_ENABLED,
    strict,
  );
  const AI_MODEL = parseString("AI_MODEL", input.AI_MODEL, issues, {
    defaultValue: !strict ? DEFAULTS.AI_MODEL : undefined,
    required: AI_ENABLED && strict,
  });
  const MAX_LLM_OUTPUT_TOKENS = parsePositiveInteger(
    "MAX_LLM_OUTPUT_TOKENS",
    input.MAX_LLM_OUTPUT_TOKENS,
    issues,
    {
      defaultValue: !strict ? DEFAULTS.MAX_LLM_OUTPUT_TOKENS : undefined,
      required: AI_ENABLED && strict,
    },
  );
  const RATE_LIMIT_MAX_REQUESTS = parsePositiveInteger(
    "RATE_LIMIT_MAX_REQUESTS",
    input.RATE_LIMIT_MAX_REQUESTS,
    issues,
    {
      defaultValue: !strict ? DEFAULTS.RATE_LIMIT_MAX_REQUESTS : undefined,
      required: strict,
    },
  );
  const RATE_LIMIT_WINDOW_SECONDS = parsePositiveInteger(
    "RATE_LIMIT_WINDOW_SECONDS",
    input.RATE_LIMIT_WINDOW_SECONDS,
    issues,
    {
      defaultValue: !strict ? DEFAULTS.RATE_LIMIT_WINDOW_SECONDS : undefined,
      required: strict,
    },
  );
  const LOG_LEVEL = parseLogLevel(input.LOG_LEVEL, issues, APP_ENV, strict);

  assertNoPublicSecrets(input, issues);

  if (deployed && optionalString(input.ADMIN_SECRET)) {
    issues.push(
      "ADMIN_SECRET is no longer supported; use authenticated application roles.",
    );
  }

  if (deployed && AUTH_TEST_MODE) {
    issues.push("AUTH_TEST_MODE must not be enabled in deployed environments.");
  }

  if (LEGACY_ANONYMOUS_MIGRATION_ENABLED && !ANONYMOUS_PILOT_ENABLED) {
    issues.push(
      "LEGACY_ANONYMOUS_MIGRATION_ENABLED requires ANONYMOUS_PILOT_ENABLED.",
    );
  }

  if (strict && APP_DEMO_MODE) {
    issues.push("APP_DEMO_MODE must be false in staging and production.");
  }

  if (AI_ENABLED && !OPENROUTER_API_KEY) {
    issues.push(
      "OPENROUTER_API_KEY is required when AI_ENABLED is true and AI_PROVIDER is openrouter.",
    );
  }

  if (issues.length > 0) {
    throw new ServerEnvironmentValidationError(APP_ENV, uniqueIssues(issues));
  }

  const base: ServerEnvBase = {
    ANONYMOUS_COOKIE_DAYS:
      ANONYMOUS_COOKIE_DAYS ?? DEFAULTS.ANONYMOUS_COOKIE_DAYS,
    ANONYMOUS_ID_SECRET,
    ANONYMOUS_PILOT_ENABLED,
    APP_DEMO_MODE,
    APP_ENV,
    APP_URL: APP_URL!,
    AUTH_CLIENT_ID,
    AUTH_CLIENT_SECRET,
    AUTH_ENABLED,
    AUTH_ISSUER_URL,
    AUTH_OIDC_ENABLED,
    AUTH_SESSION_SECRET,
    AUTH_TEST_MODE,
    DATABASE_URL,
    ERROR_TRACKING_DSN,
    IS_DEPLOYED_ENVIRONMENT: deployed,
    IS_PRODUCTION: production,
    LEGACY_ANONYMOUS_MIGRATION_ENABLED,
    LEGACY_ANONYMOUS_MIGRATION_EXPIRES_AT,
    LOG_LEVEL: LOG_LEVEL!,
    RATE_LIMIT_MAX_REQUESTS: RATE_LIMIT_MAX_REQUESTS!,
    RATE_LIMIT_WINDOW_SECONDS: RATE_LIMIT_WINDOW_SECONDS!,
  };

  if (AI_ENABLED) {
    return {
      ...base,
      AI_ENABLED: true,
      AI_MODEL: AI_MODEL!,
      AI_PROVIDER: AI_PROVIDER!,
      MAX_LLM_OUTPUT_TOKENS: MAX_LLM_OUTPUT_TOKENS!,
      OPENROUTER_API_KEY: OPENROUTER_API_KEY!,
    };
  }

  return {
    ...base,
    AI_ENABLED: false,
    AI_MODEL,
    AI_PROVIDER,
    MAX_LLM_OUTPUT_TOKENS,
    OPENROUTER_API_KEY,
  };
}

function resolveAppEnvironment(
  input: ProcessEnvironment,
  issues: string[],
): AppEnvironment {
  const explicit = optionalString(input.APP_ENV);

  if (explicit) {
    if (isAppEnvironment(explicit)) {
      return explicit;
    }

    issues.push(`APP_ENV must be one of: ${APP_ENVIRONMENTS.join(", ")}.`);
    return "development";
  }

  if (input.NODE_ENV === "test") {
    return "test";
  }

  if (input.VERCEL_ENV === "preview") {
    return "preview";
  }

  if (input.VERCEL_ENV === "production") {
    return "production";
  }

  if (input.VERCEL_ENV === "development") {
    return "development";
  }

  if (
    input.NODE_ENV === "production" &&
    input.NEXT_PHASE !== "phase-production-build"
  ) {
    return "production";
  }

  return "development";
}

function isAppEnvironment(value: string): value is AppEnvironment {
  return (APP_ENVIRONMENTS as readonly string[]).includes(value);
}

function parseString(
  name: string,
  value: string | undefined,
  issues: string[],
  options: {
    defaultValue?: string;
    minimumLength?: number;
    required?: boolean;
  } = {},
) {
  const parsed = optionalString(value) ?? options.defaultValue;

  if (!parsed) {
    if (options.required) {
      issues.push(`${name} is required.`);
    }
    return undefined;
  }

  if (options.minimumLength && parsed.length < options.minimumLength) {
    issues.push(
      `${name} must be at least ${options.minimumLength} characters long.`,
    );
    return undefined;
  }

  return parsed;
}

function parseBoolean(
  name: string,
  value: string | undefined,
  issues: string[],
  options: {
    defaultValue: boolean;
    required?: boolean;
  },
) {
  const parsed = optionalString(value)?.toLowerCase();

  if (!parsed) {
    if (options.required) {
      issues.push(`${name} must be explicitly set to true or false.`);
    }
    return options.defaultValue;
  }

  if (["1", "true", "yes", "on"].includes(parsed)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(parsed)) {
    return false;
  }

  issues.push(`${name} must be a boolean (true or false).`);
  return options.defaultValue;
}

function parsePositiveInteger(
  name: string,
  value: string | undefined,
  issues: string[],
  options: {
    defaultValue?: number;
    required?: boolean;
  },
) {
  const parsedValue = optionalString(value);

  if (!parsedValue) {
    if (options.required) {
      issues.push(`${name} is required and must be a positive integer.`);
    }
    return options.defaultValue;
  }

  const parsed = Number(parsedValue);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    issues.push(`${name} must be a positive integer.`);
    return options.defaultValue;
  }

  return parsed;
}

function parseIsoTimestamp(
  name: string,
  value: string | undefined,
  issues: string[],
  required: boolean,
) {
  const parsed = optionalString(value);

  if (!parsed) {
    if (required) {
      issues.push(`${name} is required.`);
    }
    return undefined;
  }

  if (Number.isNaN(Date.parse(parsed))) {
    issues.push(`${name} must be an ISO-8601 timestamp.`);
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function parseAiProvider(
  value: string | undefined,
  issues: string[],
  enabled: boolean,
  strict: boolean,
) {
  const parsed =
    optionalString(value)?.toLowerCase() ??
    (enabled && !strict ? "openrouter" : undefined);

  if (!parsed) {
    if (enabled) {
      issues.push("AI_PROVIDER is required when AI_ENABLED is true.");
    }
    return undefined;
  }

  if (parsed !== "openrouter") {
    issues.push("AI_PROVIDER must be openrouter for the current integration.");
    return undefined;
  }

  return parsed;
}

function parseLogLevel(
  value: string | undefined,
  issues: string[],
  environment: AppEnvironment,
  strict: boolean,
): LogLevel | undefined {
  const fallback: LogLevel =
    environment === "test"
      ? "silent"
      : environment === "preview"
        ? "info"
        : "debug";
  const parsed =
    optionalString(value)?.toLowerCase() ?? (!strict ? fallback : "");

  if (!parsed) {
    issues.push("LOG_LEVEL is required.");
    return undefined;
  }

  if (!(LOG_LEVELS as readonly string[]).includes(parsed)) {
    issues.push(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}.`);
    return undefined;
  }

  return parsed as LogLevel;
}

function parseHttpUrl(
  name: string,
  value: string | undefined,
  issues: string[],
  options: {
    oidcIssuer?: boolean;
    preserveExact?: boolean;
    requireHttps: boolean;
    required: boolean;
  },
) {
  if (!value) {
    if (options.required) {
      issues.push(`${name} is required and must be an absolute URL.`);
    }
    return undefined;
  }

  try {
    const parsed = new URL(value);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      issues.push(`${name} must use http or https.`);
      return undefined;
    }

    if (options.requireHttps && parsed.protocol !== "https:") {
      issues.push(`${name} must use https in deployed environments.`);
      return undefined;
    }

    if (
      options.oidcIssuer &&
      (parsed.username || parsed.password || parsed.search || parsed.hash)
    ) {
      issues.push(
        `${name} must not contain credentials, a query string, or a fragment.`,
      );
      return undefined;
    }

    return options.preserveExact ? value : parsed.toString().replace(/\/$/, "");
  } catch {
    issues.push(`${name} must be a valid absolute URL.`);
    return undefined;
  }
}

function parsePostgresUrl(
  value: string | undefined,
  issues: string[],
  required: boolean,
) {
  if (!value) {
    if (required) {
      issues.push("DATABASE_URL is required.");
    }
    return undefined;
  }

  try {
    const parsed = new URL(value);

    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
      issues.push("DATABASE_URL must use the postgres or postgresql scheme.");
      return undefined;
    }

    return value;
  } catch {
    issues.push("DATABASE_URL must be a valid Postgres connection URL.");
    return undefined;
  }
}

function assertNoPublicSecrets(input: ProcessEnvironment, issues: string[]) {
  for (const name of SERVER_SECRET_NAMES) {
    if (optionalString(input[`NEXT_PUBLIC_${name}`])) {
      issues.push(
        `NEXT_PUBLIC_${name} must not be defined because it would expose a server secret to the browser.`,
      );
    }
  }
}

function urlFromVercelHostname(value: string | undefined) {
  const hostname = optionalString(value);
  return hostname ? `https://${hostname}` : undefined;
}

function optionalString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueIssues(issues: string[]) {
  return [...new Set(issues)];
}
