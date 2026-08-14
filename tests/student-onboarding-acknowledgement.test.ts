import { describe, expect, it, vi } from "vitest";

import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import {
  acknowledgeStudentOnboarding,
  hasAcknowledgedStudentOnboarding,
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
