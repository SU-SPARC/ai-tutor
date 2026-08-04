import { afterEach, describe, expect, it, vi } from "vitest";

const dataStoreMocks = vi.hoisted(() => ({
  getProfessorTopicReviewProgress: vi.fn(),
  getReviewQueue: vi.fn(),
  listTopics: vi.fn(),
  updateReviewCandidates: vi.fn(),
}));

vi.mock("@/lib/data/data-store", () => dataStoreMocks);

import { PATCH as patchReviewQueue } from "@/app/api/professor/review/route";
import { reviewerAttribution } from "@/lib/auth/authorization";
import { reviewCandidates } from "@/lib/data/demo-data";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

afterEach(() => {
  resetAuthMocks();
  vi.clearAllMocks();
});

describe("authenticated review attribution", () => {
  it("rejects a direct student mutation even when the request spoofs admin role and reviewer fields", async () => {
    mockPrincipal(TEST_STUDENT);

    const response = await patchReviewQueue(
      new Request("http://test/api/professor/review", {
        body: JSON.stringify({
          action: "approve",
          candidateId: "candidate:test",
          reviewedBy: "Spoofed Administrator",
          reviewedByUserId: "user:spoofed-admin",
          roles: ["professor", "admin"],
        }),
        headers: {
          "Content-Type": "application/json",
          "x-professor-token": "obsolete-shared-secret",
        },
        method: "PATCH",
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(403);
    expect(dataStoreMocks.getReviewQueue).not.toHaveBeenCalled();
    expect(dataStoreMocks.updateReviewCandidates).not.toHaveBeenCalled();
    expect(body).not.toMatch(/candidate:test|spoofed|obsolete-shared-secret/i);
  });

  it("ignores client reviewer and role fields in favor of the session", async () => {
    mockPrincipal(TEST_PROFESSOR);
    dataStoreMocks.updateReviewCandidates.mockResolvedValue([
      { ...reviewCandidates[0], id: "candidate:test" },
    ]);

    const response = await patchReviewQueue(
      new Request("http://test/api/professor/review", {
        body: JSON.stringify({
          action: "reject",
          candidateId: "candidate:test",
          reviewedBy: "Spoofed Reviewer",
          reviewedByUserId: "user:spoofed-reviewer",
          roles: ["admin"],
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(response.status).toBe(200);
    const [authorization, update] =
      dataStoreMocks.updateReviewCandidates.mock.calls[0];
    expect(reviewerAttribution(authorization)).toEqual({
      displayName: TEST_PROFESSOR.displayName,
      userId: TEST_PROFESSOR.userId,
    });
    expect(update).toEqual({
      action: "reject",
      candidateIds: ["candidate:test"],
      difficulty: undefined,
      notes: undefined,
      reviewPriority: undefined,
      topicId: undefined,
    });
  });
});
