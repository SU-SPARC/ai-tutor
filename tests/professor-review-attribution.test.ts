import { afterEach, describe, expect, it, vi } from "vitest";

const dataStoreMocks = vi.hoisted(() => ({
  getProfessorTopicReviewProgress: vi.fn(),
  getReviewQueue: vi.fn(),
  listTopics: vi.fn(),
  updateReviewCandidates: vi.fn(),
}));

vi.mock("@/lib/data/data-store", () => dataStoreMocks);

import { PATCH as patchReviewQueue } from "@/app/api/professor/review/route";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

afterEach(() => {
  resetAuthMocks();
  vi.clearAllMocks();
});

describe("authenticated review attribution", () => {
  it("ignores client reviewer and role fields in favor of the session", async () => {
    mockPrincipal(TEST_PROFESSOR);
    dataStoreMocks.updateReviewCandidates.mockResolvedValue([
      { id: "candidate:test" },
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
    expect(dataStoreMocks.updateReviewCandidates).toHaveBeenCalledWith({
      action: "reject",
      candidateIds: ["candidate:test"],
      difficulty: undefined,
      notes: undefined,
      reviewPriority: undefined,
      reviewedBy: TEST_PROFESSOR.displayName,
      reviewedByUserId: TEST_PROFESSOR.userId,
      topicId: undefined,
    });
  });
});
