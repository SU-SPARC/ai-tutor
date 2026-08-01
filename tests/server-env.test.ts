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

  it("falls back to localhost when a deployed Preview has no derivable URL", () => {
    const env = parseServerEnv({
      APP_ENV: "preview",
    });

    expect(env.APP_URL).toBe("http://localhost:3000");
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
    expect(env.AI_MODEL).toBe("nvidia/nemotron-3-ultra-550b-a55b:free");
  });

  it("deploys production with only OPENROUTER_API_KEY and AI_MODEL set", () => {
    const env = parseServerEnv({
      APP_ENV: "production",
      AI_MODEL: "approved/model",
      OPENROUTER_API_KEY: "test-openrouter-key",
    });

    expect(env).toMatchObject({
      AI_ENABLED: true,
      AI_MODEL: "approved/model",
      AI_PROVIDER: "openrouter",
      APP_DEMO_MODE: true,
      APP_ENV: "production",
      APP_URL: "http://localhost:3000",
      OPENROUTER_API_KEY: "test-openrouter-key",
    });
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AUTH_ISSUER_URL).toBeUndefined();
    expect(env.ERROR_TRACKING_DSN).toBeUndefined();
  });

  it("leaves production undeployed-AI with only APP_ENV set", () => {
    const env = parseServerEnv({ APP_ENV: "production" });

    expect(env.AI_ENABLED).toBe(false);
    expect(env.APP_DEMO_MODE).toBe(true);
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("still requires OPENROUTER_API_KEY when AI is enabled", () => {
    expect(() =>
      parseServerEnv({
        AI_ENABLED: "true",
        AI_MODEL: "approved/model",
        APP_ENV: "production",
        OPENROUTER_API_KEY: "",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "OPENROUTER_API_KEY is required when AI_ENABLED is true and AI_PROVIDER is openrouter.",
        ]),
      }),
    );
  });

  it("rejects an unsupported AI_PROVIDER even outside strict environments", () => {
    expect(() =>
      parseServerEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "anthropic",
        OPENROUTER_API_KEY: "test-openrouter-key",
      }),
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          "AI_PROVIDER must be openrouter for the current integration.",
        ]),
      }),
    );
  });

  it("rejects server secrets exposed through NEXT_PUBLIC aliases", () => {
    const exposedValue = "do-not-render-this-value";

    try {
      parseServerEnv({
        NODE_ENV: "test",
        NEXT_PUBLIC_DATABASE_URL: exposedValue,
        NEXT_PUBLIC_OPENROUTER_API_KEY: exposedValue,
      });
      throw new Error("Expected public secret validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerEnvironmentValidationError);
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

    vi.stubEnv("OPENROUTER_API_KEY", "");

    expect(() => register()).toThrowError(/OPENROUTER_API_KEY is required/);
  });
});

function strictEnvironment(
  environment: "production" | "staging",
): ProcessEnvironment {
  return {
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
    AUTH_SESSION_SECRET: "a-test-session-secret-with-32-characters",
    DATABASE_URL: "postgresql://user:password@database.example.edu/tutor",
    ERROR_TRACKING_DSN: "https://errors.example.edu/project",
    LOG_LEVEL: "info",
    MAX_LLM_OUTPUT_TOKENS: "250",
    OPENROUTER_API_KEY: "test-openrouter-key",
    RATE_LIMIT_MAX_REQUESTS: "40",
    RATE_LIMIT_WINDOW_SECONDS: "60",
  };
}
