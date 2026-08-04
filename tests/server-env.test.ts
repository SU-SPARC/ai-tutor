import { afterEach, describe, expect, it, vi } from "vitest";

import { register } from "@/instrumentation";
import {
  parseServerEnv,
  ServerEnvironmentValidationError,
  type ProcessEnvironment,
} from "@/lib/env/server";

describe("typed server environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses safe local development defaults without requiring secrets", () => {
    const env = parseServerEnv({ NODE_ENV: "development" });

    expect(env).toMatchObject({
      AI_ENABLED: false,
      AI_MODEL: "nvidia/nemotron-3-ultra-550b-a55b:free",
      APP_DEMO_MODE: true,
      APP_ENV: "development",
      APP_URL: "http://localhost:3000",
      IS_DEPLOYED_ENVIRONMENT: false,
      IS_PRODUCTION: false,
      LOG_LEVEL: "debug",
      MAX_LLM_OUTPUT_TOKENS: 400,
      RATE_LIMIT_MAX_REQUESTS: 20,
      RATE_LIMIT_WINDOW_SECONDS: 60,
    });
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("recognizes automated tests independently from local development", () => {
    const env = parseServerEnv({ NODE_ENV: "test" });

    expect(env.APP_ENV).toBe("test");
    expect(env.APP_DEMO_MODE).toBe(true);
    expect(env.LOG_LEVEL).toBe("silent");
    expect(env.IS_DEPLOYED_ENVIRONMENT).toBe(false);
  });

  it("infers Vercel Preview and derives its application URL", () => {
    const env = parseServerEnv({
      ANONYMOUS_PILOT_ENABLED: "false",
      VERCEL_ENV: "preview",
      VERCEL_URL: "preview-example.vercel.app",
    });

    expect(env).toMatchObject({
      APP_DEMO_MODE: true,
      APP_ENV: "preview",
      APP_URL: "https://preview-example.vercel.app",
      IS_DEPLOYED_ENVIRONMENT: true,
      IS_PRODUCTION: false,
      LOG_LEVEL: "info",
    });
  });

  it("does not use a localhost URL for a deployed Preview", () => {
    expect(() =>
      parseServerEnv({
        APP_ENV: "preview",
      }),
    ).toThrowError(/APP_URL is required/);
  });

  it("keeps a local production build in development defaults", () => {
    const env = parseServerEnv({
      NEXT_PHASE: "phase-production-build",
      NODE_ENV: "production",
    });

    expect(env.APP_ENV).toBe("development");
    expect(env.APP_DEMO_MODE).toBe(true);
  });

  it("parses a complete staging configuration without defaults", () => {
    const env = parseServerEnv(strictEnvironment("staging"));

    expect(env).toMatchObject({
      AI_ENABLED: true,
      AI_MODEL: "approved/model",
      AI_PROVIDER: "openrouter",
      APP_DEMO_MODE: false,
      APP_ENV: "staging",
      APP_URL: "https://staging.example.edu",
      IS_DEPLOYED_ENVIRONMENT: true,
      IS_PRODUCTION: false,
      LOG_LEVEL: "info",
      MAX_LLM_OUTPUT_TOKENS: 250,
      RATE_LIMIT_MAX_REQUESTS: 40,
      RATE_LIMIT_WINDOW_SECONDS: 60,
    });
  });

  it("accepts production with AI explicitly disabled", () => {
    const env = parseServerEnv({
      ...strictEnvironment("production"),
      AI_ENABLED: "false",
      AI_MODEL: undefined,
      AI_PROVIDER: undefined,
      MAX_LLM_OUTPUT_TOKENS: undefined,
      OPENROUTER_API_KEY: undefined,
    });

    expect(env.APP_ENV).toBe("production");
    expect(env.IS_PRODUCTION).toBe(true);
    expect(env.AI_ENABLED).toBe(false);
    expect(env.AI_MODEL).toBeUndefined();
  });

  it("reports every missing production boundary in one clear error", () => {
    expect(() =>
      parseServerEnv({
        APP_ENV: "production",
      }),
    ).toThrowError(ServerEnvironmentValidationError);

    try {
      parseServerEnv({ APP_ENV: "production" });
      throw new Error("Expected production validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerEnvironmentValidationError);
      expect(String(error)).toContain("APP_URL is required");
      expect(String(error)).toContain("DATABASE_URL is required");
      expect(String(error)).toContain("AUTH_ISSUER_URL is required");
      expect(String(error)).toContain("AUTH_CLIENT_ID is required");
      expect(String(error)).toContain("AUTH_CLIENT_SECRET is required");
      expect(String(error)).toContain("AUTH_SESSION_SECRET is required");
      expect(String(error)).toContain("ERROR_TRACKING_DSN is required");
      expect(String(error)).toContain("APP_DEMO_MODE must be explicitly set");
      expect(String(error)).toContain("AI_ENABLED must be explicitly set");
      expect(String(error)).toContain("LOG_LEVEL is required");
      expect(String(error)).toContain("RATE_LIMIT_MAX_REQUESTS is required");
      expect(String(error)).toContain("RATE_LIMIT_WINDOW_SECONDS is required");
    }
  });

  it("rejects demo mode and insecure URLs in strict environments", () => {
    expect(() =>
      parseServerEnv({
        ...strictEnvironment("production"),
        APP_DEMO_MODE: "true",
        APP_URL: "http://production.example.edu",
        AUTH_ISSUER_URL: "http://identity.example.edu",
        ERROR_TRACKING_DSN: "http://errors.example.edu/project",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "APP_DEMO_MODE must be false in staging and production.",
          "APP_URL must use https in deployed environments.",
          "AUTH_ISSUER_URL must use https in deployed environments.",
          "ERROR_TRACKING_DSN must use https in deployed environments.",
        ]),
      }),
    );
  });

  it.each([
    "https://user:password@tutor.example.edu",
    "https://tutor.example.edu/application",
    "https://tutor.example.edu?environment=production",
    "https://tutor.example.edu#configuration",
  ])(
    "rejects a deployed APP_URL that is not an exact origin: %s",
    (APP_URL) => {
      expect(() =>
        parseServerEnv({
          ...strictEnvironment("production"),
          APP_URL,
        }),
      ).toThrowError(/APP_URL must be an origin only/);
    },
  );

  it.each([
    "a-test-session-secret-with-32-characters",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "replace-this-placeholder-session-secret",
  ])("rejects a weak deployed session secret", (AUTH_SESSION_SECRET) => {
    expect(() =>
      parseServerEnv({
        ...strictEnvironment("production"),
        AUTH_SESSION_SECRET,
      }),
    ).toThrowError(/AUTH_SESSION_SECRET must be a high-entropy value/);
  });

  it("requires the application session and OIDC client secrets to differ", () => {
    const sharedSecret = "B7vQ2kX9mR4tL8wC6zH3pN5sY1dF0aGJ";

    expect(() =>
      parseServerEnv({
        ...strictEnvironment("production"),
        AUTH_CLIENT_SECRET: sharedSecret,
        AUTH_SESSION_SECRET: sharedSecret,
      }),
    ).toThrowError(/AUTH_SESSION_SECRET must differ from AUTH_CLIENT_SECRET/);
  });

  it("requires complete provider configuration when AI is enabled", () => {
    expect(() =>
      parseServerEnv({
        ...strictEnvironment("production"),
        AI_MODEL: "",
        AI_PROVIDER: "",
        MAX_LLM_OUTPUT_TOKENS: "",
        OPENROUTER_API_KEY: "",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "AI_PROVIDER is required when AI_ENABLED is true.",
          "AI_MODEL is required.",
          "MAX_LLM_OUTPUT_TOKENS is required and must be a positive integer.",
          "OPENROUTER_API_KEY is required when AI_ENABLED is true and AI_PROVIDER is openrouter.",
        ]),
      }),
    );
  });

  it("rejects server secrets exposed through NEXT_PUBLIC aliases", () => {
    const exposedValue = "do-not-render-this-value";

    try {
      parseServerEnv({
        NODE_ENV: "test",
        NEXT_PUBLIC_ADMIN_SECRET: exposedValue,
        NEXT_PUBLIC_DATABASE_URL: exposedValue,
        NEXT_PUBLIC_OPENROUTER_API_KEY: exposedValue,
      });
      throw new Error("Expected public secret validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerEnvironmentValidationError);
      expect(String(error)).toContain("NEXT_PUBLIC_ADMIN_SECRET");
      expect(String(error)).toContain("NEXT_PUBLIC_DATABASE_URL");
      expect(String(error)).toContain("NEXT_PUBLIC_OPENROUTER_API_KEY");
      expect(String(error)).not.toContain(exposedValue);
    }
  });

  it("validates the process environment from the Next.js startup hook", () => {
    for (const [name, value] of Object.entries(
      strictEnvironment("production"),
    )) {
      vi.stubEnv(name, value ?? "");
    }

    expect(() => register()).not.toThrow();

    vi.stubEnv("DATABASE_URL", "");

    expect(() => register()).toThrowError(/DATABASE_URL is required/);
  });
});

function strictEnvironment(
  environment: "production" | "staging",
): ProcessEnvironment {
  return {
    ANONYMOUS_PILOT_ENABLED: "false",
    AI_ENABLED: "true",
    AI_MODEL: "approved/model",
    AI_PROVIDER: "openrouter",
    APP_DEMO_MODE: "false",
    APP_ENV: environment,
    APP_URL:
      environment === "production"
        ? "https://tutor.example.edu"
        : "https://staging.example.edu",
    AUTH_CLIENT_ID: "tutor-client",
    AUTH_CLIENT_SECRET: "test-client-secret",
    AUTH_ISSUER_URL: "https://identity.example.edu",
    AUTH_SESSION_SECRET: "B7vQ2kX9mR4tL8wC6zH3pN5sY1dF0aGJ",
    DATABASE_URL: "postgresql://user:password@database.example.edu/tutor",
    ERROR_TRACKING_DSN: "https://errors.example.edu/project",
    LOG_LEVEL: "info",
    MAX_LLM_OUTPUT_TOKENS: "250",
    OPENROUTER_API_KEY: "test-openrouter-key",
    RATE_LIMIT_MAX_REQUESTS: "40",
    RATE_LIMIT_WINDOW_SECONDS: "60",
  };
}
