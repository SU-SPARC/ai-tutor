import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycleMocks = vi.hoisted(() => ({
  setReserveDisposition: vi.fn(),
}));

vi.mock("@/lib/data/data-store", () => ({
  setQuestionReserveDisposition: lifecycleMocks.setReserveDisposition,
}));

import { POST } from "@/app/api/professor/questions/[id]/reserve/route";
import {
  QUESTION_RESERVE_REASONS,
  questionReserveReasonLabel,
} from "@/lib/tutor/professor-question-reserve";
import {
  QuestionLifecycleConflictError,
  QuestionPublicationBlockedError,
} from "@/lib/tutor/question-lifecycle";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

describe("professor question reserve API", () => {
  beforeEach(() => {
    lifecycleMocks.setReserveDisposition.mockReset();
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

  it("does not accept a reason code on release or practice toggles", async () => {
    for (const action of ["release", "allow_practice", "disallow_practice"]) {
      const response = await request({
        action,
        expectedWorkingVersionId: 12,
        reasonCode: "repetitive",
      });
      expect(response.status).toBe(422);
    }
  });

  it("maps repeated practice-toggle state to conflict", async () => {
    lifecycleMocks.setReserveDisposition.mockRejectedValueOnce(
      new QuestionLifecycleConflictError(
        "This question is already allowed for similar practice.",
      ),
    );

    const response = await request({
      action: "allow_practice",
      expectedWorkingVersionId: 12,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "This question is already allowed for similar practice.",
    });
  });

  it("returns structured quality blockers when practice cannot be allowed", async () => {
    lifecycleMocks.setReserveDisposition.mockRejectedValueOnce(
      new QuestionPublicationBlockedError([
        {
          code: "invalid_source_classification",
          message: "Private-reference content cannot be student practice.",
        },
      ]),
    );

    const response = await request({
      action: "allow_practice",
      expectedWorkingVersionId: 12,
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      reasons: [
        expect.objectContaining({ code: "invalid_source_classification" }),
      ],
    });
  });

  it("passes one idempotency key through practice-toggle replays", async () => {
    const question = { questionId: "question:test" };
    lifecycleMocks.setReserveDisposition.mockResolvedValue(question);

    const first = await request(
      {
        action: "disallow_practice",
        expectedWorkingVersionId: 12,
      },
      { "Idempotency-Key": "practice-toggle-once" },
    );
    const replay = await request(
      {
        action: "disallow_practice",
        expectedWorkingVersionId: 12,
      },
      { "Idempotency-Key": "practice-toggle-once" },
    );

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(lifecycleMocks.setReserveDisposition).toHaveBeenCalledTimes(2);
    expect(lifecycleMocks.setReserveDisposition).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ idempotencyKey: "practice-toggle-once" }),
    );
  });
});

function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return POST(
    new Request("http://test/api/professor/questions/question:test/reserve", {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json", ...headers },
      method: "POST",
    }),
    { params: Promise.resolve({ id: "question:test" }) },
  );
}
