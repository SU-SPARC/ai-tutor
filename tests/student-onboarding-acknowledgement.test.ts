import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postgresMocks = vi.hoisted(() => ({
  queryPostgres: vi.fn(),
}));

vi.mock("@/lib/data/postgres", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/postgres")>()),
  queryPostgres: postgresMocks.queryPostgres,
}));

import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import {
  acknowledgeStudentOnboarding,
  hasAcknowledgedStudentOnboarding,
  resetStudentOnboardingForTests,
} from "@/lib/data/student-onboarding-repository";

describe("student onboarding acknowledgement storage", () => {
  it("reads only the acknowledgement state for the active user", async () => {
    const query = vi.fn(async () => [{ acknowledged: true }]);

    await expect(
      hasAcknowledgedStudentOnboarding(
        "user:student",
        query as DatabaseQueryExecutor,
      ),
    ).resolves.toBe(true);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "student_onboarding_acknowledged_at is not null as acknowledged",
      ),
      ["user:student"],
    );
  });

  it("sets the single timestamp once and keeps the original acknowledgement", async () => {
    const acknowledgedAt = new Date("2026-08-14T10:00:00.000Z");
    const query = vi.fn(async () => [
      { student_onboarding_acknowledged_at: acknowledgedAt },
    ]);

    await acknowledgeStudentOnboarding(
      "user:student",
      query as DatabaseQueryExecutor,
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /set student_onboarding_acknowledged_at\s*=\s*coalesce\(student_onboarding_acknowledged_at, now\(\)\)/,
      ),
      ["user:student"],
    );
  });

  it("fails closed when the active account no longer exists", async () => {
    const query = vi.fn(async () => []);

    await expect(
      acknowledgeStudentOnboarding(
        "user:missing",
        query as DatabaseQueryExecutor,
      ),
    ).rejects.toThrow("active student account was not found");
  });
});

describe("student onboarding acknowledgement without Postgres", () => {
  beforeEach(() => {
    resetStudentOnboardingForTests();
    postgresMocks.queryPostgres.mockReset();
    vi.stubEnv("APP_ENV", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the acknowledgement in memory in demo mode and never queries Postgres", async () => {
    vi.stubEnv("APP_DEMO_MODE", "true");

    await expect(
      hasAcknowledgedStudentOnboarding("ghost:student"),
    ).resolves.toBe(false);

    await acknowledgeStudentOnboarding("ghost:student");

    await expect(
      hasAcknowledgedStudentOnboarding("ghost:student"),
    ).resolves.toBe(true);
    // One student's acknowledgement is not another's.
    await expect(
      hasAcknowledgedStudentOnboarding("ghost:other"),
    ).resolves.toBe(false);
    expect(postgresMocks.queryPostgres).not.toHaveBeenCalled();
  });

  it("falls back to memory in local database mode when Postgres fails", async () => {
    vi.stubEnv("APP_DEMO_MODE", "false");
    postgresMocks.queryPostgres.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await expect(
      hasAcknowledgedStudentOnboarding("user:student"),
    ).resolves.toBe(false);
    await expect(
      acknowledgeStudentOnboarding("user:student"),
    ).resolves.toBeUndefined();
    await expect(
      hasAcknowledgedStudentOnboarding("user:student"),
    ).resolves.toBe(true);
  });

  it("does not fall back when an explicit database executor fails", async () => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    const query = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    });

    await expect(
      acknowledgeStudentOnboarding(
        "user:student",
        query as unknown as DatabaseQueryExecutor,
      ),
    ).rejects.toThrow("ECONNREFUSED");
  });
});
