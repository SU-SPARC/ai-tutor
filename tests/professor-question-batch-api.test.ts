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
    const anonymousPreview = await postBatch(validPreviewRequest(), false);
    mockPrincipal(TEST_STUDENT);
    const student = await postBatch(validBatchRequest());
    const studentPreview = await postBatch(validPreviewRequest(), false);

    expect(anonymous.status).toBe(401);
    expect(anonymousPreview.status).toBe(401);
    expect(student.status).toBe(403);
    expect(studentPreview.status).toBe(403);
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

  it("accepts a read-only publication preview without an idempotency key", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const response = await postBatch(validPreviewRequest(), false);

    expect(response.status).toBe(503);
  });

  it("limits dry-run preview to publication", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const response = await postBatch(
      {
        ...validPreviewRequest(),
        action: "reject",
        reasonCode: "poor_wording",
      },
      false,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/publication only/i),
    });
  });

  it("requires a note when a reject or revision batch selects Other", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const withoutNote = await postBatch({
      ...validBatchRequest(),
      action: "reject",
      reasonCode: "other",
    });
    const withNote = await postBatch({
      ...validBatchRequest(),
      action: "request_revision",
      note: "A course-specific issue not covered by the standard categories.",
      reasonCode: "other",
      revisionMethod: "manual",
    });

    expect(withoutNote.status).toBe(422);
    await expect(withoutNote.json()).resolves.toMatchObject({
      error: expect.stringMatching(/Other requires an audit note/i),
    });
    expect(withNote.status).toBe(503);
  });
});

function postBatch(body: unknown, withIdempotencyKey = true) {
  return batchReview(
    new Request("http://test/api/professor/questions/batch", {
      body: JSON.stringify(body),
      headers: withIdempotencyKey
        ? {
            "Content-Type": "application/json",
            "Idempotency-Key": "batch-api-test",
          }
        : { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

function validPreviewRequest() {
  return { ...validBatchRequest(), mode: "preview" };
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
