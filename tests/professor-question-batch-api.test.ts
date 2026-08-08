import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as batchReview } from "@/app/api/professor/questions/batch/route";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

describe("professor question batch API", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("denies anonymous and student batch actions", async () => {
    mockPrincipal(undefined);
    const anonymous = await postBatch(validBatchRequest());
    mockPrincipal(TEST_STUDENT);
    const student = await postBatch(validBatchRequest());

    expect(anonymous.status).toBe(401);
    expect(student.status).toBe(403);
  });

  it("does not expose a batch approval shortcut", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const response = await postBatch({
      ...validBatchRequest(),
      action: "approve",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/batch approval is not supported/i),
    });
  });

  it("requires multiple distinct optimistic-concurrency items", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const tooSmall = await postBatch({
      ...validBatchRequest(),
      items: [validBatchRequest().items[0]],
    });
    const duplicate = await postBatch({
      ...validBatchRequest(),
      items: [validBatchRequest().items[0], validBatchRequest().items[0]],
    });

    expect(tooSmall.status).toBe(400);
    expect(duplicate.status).toBe(400);
  });

  it("accepts a safe batch shape before enforcing read-only demo storage", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const response = await postBatch(validBatchRequest());

    expect(response.status).toBe(503);
  });
});

function postBatch(body: unknown) {
  return batchReview(
    new Request("http://test/api/professor/questions/batch", {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "batch-api-test",
      },
      method: "POST",
    }),
  );
}

function validBatchRequest() {
  return {
    action: "publish",
    items: [
      {
        expectedState: "approved",
        questionId: "batch-question-one",
        versionId: 101,
      },
      {
        expectedState: "approved",
        questionId: "batch-question-two",
        versionId: 102,
      },
    ],
  };
}
