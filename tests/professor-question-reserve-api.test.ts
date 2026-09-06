import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/professor/questions/[id]/reserve/route";
import {
  QUESTION_RESERVE_REASONS,
  questionReserveReasonLabel,
} from "@/lib/tutor/professor-question-reserve";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

describe("professor question reserve API", () => {
  beforeEach(() => {
    mockPrincipal(TEST_PROFESSOR);
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("exposes every supported professor-friendly reason label", () => {
    expect(QUESTION_RESERVE_REASONS).toEqual([
      { label: "Repetitive", value: "repetitive" },
      { label: "Save for later", value: "save_for_later" },
      { label: "Future topic", value: "future_topic" },
      { label: "Extra practice", value: "extra_practice" },
      { label: "Other", value: "other" },
    ]);
    expect(questionReserveReasonLabel("future_topic")).toBe("Future topic");
  });

  it("rejects unsupported reasons and requires a note for Other", async () => {
    const invalid = await request({
      action: "reserve",
      expectedWorkingVersionId: 12,
      reasonCode: "professor_rejected",
    });
    const other = await request({
      action: "reserve",
      expectedWorkingVersionId: 12,
      reasonCode: "other",
    });

    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toEqual({
      error: "Select a supported Save for later reason.",
    });
    expect(other.status).toBe(422);
    await expect(other.json()).resolves.toEqual({
      error: "Other requires an audit note.",
    });
  });

  it("does not accept a reason code on release", async () => {
    const response = await request({
      action: "release",
      expectedWorkingVersionId: 12,
      reasonCode: "repetitive",
    });
    expect(response.status).toBe(422);
  });
});

function request(body: Record<string, unknown>) {
  return POST(
    new Request("http://test/api/professor/questions/question:test/reserve", {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: "question:test" }) },
  );
}
