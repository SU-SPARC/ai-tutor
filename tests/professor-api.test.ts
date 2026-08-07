import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import followingSyllabusReviewCandidateData from "../data/demo/following-syllabus-review-candidates.json";
import nextSyllabusReviewCandidateData from "../data/demo/next-syllabus-review-candidates.json";
import nextUncoveredSyllabusReviewCandidateData from "../data/demo/next-uncovered-syllabus-review-candidates.json";
import topicData from "../data/demo/topics.json";
import { GET as getAnalytics } from "@/app/api/professor/analytics/route";
import {
  GET as getReviewQueue,
  PATCH as patchReviewQueue,
  POST as postReviewQueue,
} from "@/app/api/professor/review/route";
import { POST as uploadGeneratedReview } from "@/app/api/professor/upload/route";
import { resetReviewQueueForTests } from "@/lib/data/data-store";
import type {
  ProfessorAnalyticsDashboard,
  ProfessorTopicReviewProgress,
  ReviewCandidate,
} from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const followingSyllabusCandidates =
  followingSyllabusReviewCandidateData as unknown as ReviewCandidate[];
const nextSyllabusCandidates =
  nextSyllabusReviewCandidateData as unknown as ReviewCandidate[];
const nextUncoveredSyllabusCandidates =
  nextUncoveredSyllabusReviewCandidateData as unknown as ReviewCandidate[];

describe("professor admin APIs", () => {
  beforeEach(() => {
    resetReviewQueueForTests();
    mockPrincipal(TEST_PROFESSOR);
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("protects review queue reads and returns generated drafts only after auth", async () => {
    mockPrincipal(undefined);
    const unauthenticated = await getReviewQueue(
      new Request("http://test/api/professor/review"),
    );
    mockPrincipal(TEST_PROFESSOR);
    const authenticated = await getReviewQueue(authedRequest());
    const payload = (await authenticated.json()) as {
      candidates: ReviewCandidate[];
    };

    expect(unauthenticated.status).toBe(401);
    expect(authenticated.status).toBe(200);
    expect(payload.candidates.length).toBeGreaterThan(0);
    expect(
      payload.candidates.every(
        (candidate) =>
          candidate.review.status === "needs_review" &&
          candidate.source.trustLevel === "generated_unverified",
      ),
    ).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(
      /sourceItemIds|privatePhraseHashes|sourceNumberSets|sourceStoryFamilies|source page/i,
    );
  });

  it("returns topics in syllabus fixture order and filters the queue to one needs-review topic", async () => {
    const topicId = "introduction-probability-venn-diagrams";
    const response = await getReviewQueue(
      new Request(
        `http://test/api/professor/review?status=needs_review&topicId=${topicId}`,
      ),
    );
    const payload = (await response.json()) as {
      candidates: ReviewCandidate[];
      topicProgress: ProfessorTopicReviewProgress;
      topics: Array<{ id: string; title: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.topics).toEqual(
      topicData.map(({ id, title }) => ({ id, title })),
    );
    expect(payload.candidates).toHaveLength(20);
    expect(
      payload.candidates.every(
        (candidate) =>
          candidate.topicId === topicId &&
          candidate.review.status === "needs_review" &&
          candidate.source.trustLevel === "generated_unverified" &&
          ["generated_original", "pattern_derived_original"].includes(
            candidate.source.sourceType,
          ),
      ),
    ).toBe(true);
    expect(payload.topicProgress).toEqual({
      approved: 0,
      needsReview: 20,
      rejected: 0,
      remaining: 20,
      topicId,
      totalDrafts: 20,
    });
  });

  it("updates selected-topic counts while keeping resolved drafts out of the queue", async () => {
    const topicId = "introduction-probability-venn-diagrams";
    const initial = await selectedTopicQueue(topicId);
    const [approvedCandidate, rejectedCandidate] = initial.candidates;

    const approved = await patchReviewQueue(
      authedRequest({
        action: "approve",
        candidateId: approvedCandidate.id,
        reviewPriority: "priority",
      }),
    );
    const rejected = await patchReviewQueue(
      authedRequest({
        action: "reject",
        candidateId: rejectedCandidate.id,
      }),
    );
    const updated = await selectedTopicQueue(topicId);

    expect(approved.status).toBe(200);
    expect(rejected.status).toBe(200);
    expect(updated.candidates).toHaveLength(18);
    expect(
      updated.candidates.every(
        (candidate) =>
          candidate.topicId === topicId &&
          candidate.review.status === "needs_review",
      ),
    ).toBe(true);
    expect(updated.topicProgress).toEqual({
      approved: 1,
      needsReview: 18,
      rejected: 1,
      remaining: 18,
      topicId,
      totalDrafts: 20,
    });
  });

  it("denies anonymous and student approval and rejection without changing review state", async () => {
    const [approvalCandidate, rejectionCandidate] = await firstCandidates(2);

    mockPrincipal(undefined);
    const anonymousApproval = await patchReviewQueue(
      mutationRequest(
        {
          action: "approve",
          candidateId: approvalCandidate.id,
          reviewPriority: "priority",
        },
        "PATCH",
      ),
    );
    const anonymousRejection = await postReviewQueue(
      legacySecretMutationRequest(
        {
          action: "reject",
          candidateId: rejectionCandidate.id,
        },
        "POST",
      ),
    );

    mockPrincipal(TEST_STUDENT);
    const studentApproval = await patchReviewQueue(
      mutationRequest(
        {
          action: "approve",
          candidateId: approvalCandidate.id,
          reviewPriority: "priority",
        },
        "PATCH",
      ),
    );
    const studentRejection = await postReviewQueue(
      mutationRequest(
        {
          action: "reject",
          candidateId: rejectionCandidate.id,
        },
        "POST",
      ),
    );

    mockPrincipal(TEST_PROFESSOR);
    const unchangedResponse = await getReviewQueue(authedRequest());
    const unchangedPayload = (await unchangedResponse.json()) as {
      candidates: ReviewCandidate[];
    };
    const unchangedById = new Map(
      unchangedPayload.candidates.map((candidate) => [candidate.id, candidate]),
    );

    expect(anonymousApproval.status).toBe(401);
    expect(anonymousRejection.status).toBe(401);
    expect(studentApproval.status).toBe(403);
    expect(studentRejection.status).toBe(403);
    expect(unchangedResponse.status).toBe(200);
    expect(unchangedById.get(approvalCandidate.id)?.review.status).toBe(
      "needs_review",
    );
    expect(unchangedById.get(rejectionCandidate.id)?.review.status).toBe(
      "needs_review",
    );
  });

  it("makes all 60 next-syllabus drafts available in the protected review workflow", async () => {
    const expectedIds = new Set(
      nextSyllabusCandidates.map((candidate) => candidate.id),
    );
    const response = await getReviewQueue(authedRequest());
    const payload = (await response.json()) as {
      candidates: ReviewCandidate[];
    };
    const returnedIds = new Set(
      payload.candidates.map((candidate) => candidate.id),
    );

    expect(response.status).toBe(200);
    expect(
      [...expectedIds].every((candidateId) => returnedIds.has(candidateId)),
    ).toBe(true);
    expect(expectedIds.size).toBe(60);

    for (const topicId of [
      "conditional-probability",
      "random-variables",
      "binomial-models",
    ]) {
      const filtered = await getReviewQueue(
        new Request(
          `http://test/api/professor/review?status=needs_review&topicId=${topicId}`,
        ),
      );
      const filteredPayload = (await filtered.json()) as {
        candidates: ReviewCandidate[];
      };
      const expectedTopicIds = new Set(
        nextSyllabusCandidates
          .filter((candidate) => candidate.topicId === topicId)
          .map((candidate) => candidate.id),
      );

      expect(filtered.status).toBe(200);
      expect(
        filteredPayload.candidates.filter((candidate) =>
          expectedTopicIds.has(candidate.id),
        ),
      ).toHaveLength(20);
    }
  });

  it("makes all 60 following-syllabus drafts available only in the protected review workflow", async () => {
    const expectedIds = new Set(
      followingSyllabusCandidates.map((candidate) => candidate.id),
    );
    const response = await getReviewQueue(authedRequest());
    const payload = (await response.json()) as {
      candidates: ReviewCandidate[];
    };
    const returnedIds = new Set(
      payload.candidates.map((candidate) => candidate.id),
    );

    expect(response.status).toBe(200);
    expect(expectedIds.size).toBe(60);
    expect(
      [...expectedIds].every((candidateId) => returnedIds.has(candidateId)),
    ).toBe(true);

    for (const topicId of [
      "continuous-random-variables",
      "normal-standardization",
      "moment-generating-functions-joint-distributions",
    ]) {
      const filtered = await getReviewQueue(
        new Request(
          `http://test/api/professor/review?status=needs_review&topicId=${topicId}`,
        ),
      );
      const filteredPayload = (await filtered.json()) as {
        candidates: ReviewCandidate[];
      };
      const expectedTopicIds = new Set(
        followingSyllabusCandidates
          .filter((candidate) => candidate.topicId === topicId)
          .map((candidate) => candidate.id),
      );

      expect(filtered.status).toBe(200);
      expect(
        filteredPayload.candidates.filter((candidate) =>
          expectedTopicIds.has(candidate.id),
        ),
      ).toHaveLength(20);
    }
  });

  it("makes all 60 next-uncovered drafts available only in the protected review workflow", async () => {
    const expectedIds = new Set(
      nextUncoveredSyllabusCandidates.map((candidate) => candidate.id),
    );
    const response = await getReviewQueue(authedRequest());
    const payload = (await response.json()) as {
      candidates: ReviewCandidate[];
    };
    const returnedIds = new Set(
      payload.candidates.map((candidate) => candidate.id),
    );

    expect(response.status).toBe(200);
    expect(expectedIds.size).toBe(60);
    expect(
      [...expectedIds].every((candidateId) => returnedIds.has(candidateId)),
    ).toBe(true);

    for (const topicId of [
      "independent-random-variables-sums-correlation",
      "chebyshev-law-large-numbers",
      "central-limit-theorem",
    ]) {
      const filtered = await getReviewQueue(
        new Request(
          `http://test/api/professor/review?status=needs_review&topicId=${topicId}`,
        ),
      );
      const filteredPayload = (await filtered.json()) as {
        candidates: ReviewCandidate[];
      };
      const expectedTopicIds = new Set(
        nextUncoveredSyllabusCandidates
          .filter((candidate) => candidate.topicId === topicId)
          .map((candidate) => candidate.id),
      );

      expect(filtered.status).toBe(200);
      expect(
        filteredPayload.candidates.filter((candidate) =>
          expectedTopicIds.has(candidate.id),
        ),
      ).toHaveLength(20);
    }
  });

  it("requires priority before approving selected generated drafts", async () => {
    const [first, second] = await firstCandidates(2);
    const blocked = await patchReviewQueue(
      authedRequest({
        action: "approve",
        candidateIds: [first.id, second.id],
      }),
    );

    expect(blocked.status).toBe(400);

    const prioritized = await patchReviewQueue(
      authedRequest({
        candidateIds: [first.id, second.id],
        reviewPriority: "priority",
      }),
    );
    const priorityPayload = (await prioritized.json()) as {
      candidates: ReviewCandidate[];
    };

    expect(prioritized.status).toBe(200);
    expect(
      priorityPayload.candidates.every(
        (candidate) => candidate.review.reviewPriority === "priority",
      ),
    ).toBe(true);

    const approved = await patchReviewQueue(
      authedRequest({
        action: "approve",
        candidateIds: [first.id, second.id],
      }),
    );
    const approvedPayload = (await approved.json()) as {
      candidates: ReviewCandidate[];
    };

    expect(approved.status).toBe(200);
    expect(
      approvedPayload.candidates.every(
        (candidate) =>
          candidate.review.status === "approved" &&
          candidate.source.trustLevel === "professor_approved",
      ),
    ).toBe(true);
  });

  it("updates review status, topic, difficulty, priority, and notes", async () => {
    const [first, second, third] = await firstCandidates(3);
    const rejected = await patchReviewQueue(
      authedRequest({ action: "reject", candidateId: first.id }),
    );
    const edited = await patchReviewQueue(
      authedRequest({
        action: "needs_edit",
        candidateId: second.id,
        difficulty: "challenge",
        notes: "Tighten wording before approval.",
        reviewPriority: "priority",
        topicId: "binomial-models",
      }),
    );
    const regeneration = await patchReviewQueue(
      authedRequest({
        action: "request_regeneration",
        candidateId: third.id,
      }),
    );
    const rejectedPayload = (await rejected.json()) as {
      candidate: ReviewCandidate;
    };
    const editedPayload = (await edited.json()) as {
      candidate: ReviewCandidate;
    };
    const regenerationPayload = (await regeneration.json()) as {
      candidate: ReviewCandidate;
    };

    expect(rejectedPayload.candidate.review.status).toBe("rejected");
    expect(editedPayload.candidate).toMatchObject({
      difficulty: "challenge",
      review: {
        notes: "Tighten wording before approval.",
        reviewPriority: "priority",
        status: "needs_edit",
      },
      topicId: "binomial-models",
    });
    expect(regenerationPayload.candidate.review.status).toBe(
      "needs_regeneration",
    );
  });

  it("validates generated-review uploads and rejects private-source signals", async () => {
    const valid = await uploadGeneratedReview(
      authedRequest(validUploadPayload()),
    );
    const validPayload = (await valid.json()) as {
      candidates: ReviewCandidate[];
      nonDurable: boolean;
    };

    expect(valid.status).toBe(200);
    expect(validPayload.nonDurable).toBe(true);
    expect(validPayload.candidates[0]).toMatchObject({
      id: "uploaded-generated-review",
      review: { status: "needs_review" },
      source: { trustLevel: "generated_unverified" },
    });

    const privateKeys = await uploadGeneratedReview(
      authedRequest({
        questions: [
          {
            ...validUploadPayload().questions[0],
            sourceItemIds: ["private-source-1"],
          },
        ],
      }),
    );
    const copiedSource = await uploadGeneratedReview(
      authedRequest({
        questions: [
          {
            ...validUploadPayload().questions[0],
            questionText: "This was copied from a textbook page.",
          },
        ],
      }),
    );

    expect(privateKeys.status).toBe(400);
    expect(copiedSource.status).toBe(400);
  });

  it("returns protected analytics without raw answers or private source fields", async () => {
    mockPrincipal(undefined);
    const unauthenticated = await getAnalytics();
    mockPrincipal(TEST_PROFESSOR);
    const authenticated = await getAnalytics();
    const payload = (await authenticated.json()) as {
      analytics: ProfessorAnalyticsDashboard;
    };
    const serialized = JSON.stringify(payload);

    expect(unauthenticated.status).toBe(401);
    expect(authenticated.status).toBe(200);
    expect(payload.analytics).toMatchObject({
      instructor: {
        mode: "demo",
        totals: {
          generatedQuestionsApproved: expect.any(Number),
          generatedQuestionsRejected: expect.any(Number),
          totalAttempts: expect.any(Number),
          totalTutorSessions: expect.any(Number),
        },
      },
      review: {
        totalBacklog: expect.any(Number),
      },
    });
    expect(
      payload.analytics.instructor.mostPracticedTopics.length,
    ).toBeGreaterThan(0);
    expect(
      payload.analytics.instructor.mostMissedQuestions.length,
    ).toBeGreaterThan(0);
    expect(
      payload.analytics.instructor.commonMisconceptions.length,
    ).toBeGreaterThan(0);
    expect(serialized).not.toMatch(
      /answerPreview|acceptedAnswers|privatePhraseHashes|sourceItemIds|rawText|extractedText|anonymousStudentId|sessionId|private chunk|source page/i,
    );
  });
});

async function firstCandidates(count: number) {
  const response = await getReviewQueue(authedRequest());
  const payload = (await response.json()) as {
    candidates: ReviewCandidate[];
  };
  return payload.candidates.slice(0, count);
}

async function selectedTopicQueue(topicId: string) {
  const response = await getReviewQueue(
    new Request(
      `http://test/api/professor/review?status=needs_review&topicId=${topicId}`,
    ),
  );
  const payload = (await response.json()) as {
    candidates: ReviewCandidate[];
    topicProgress: ProfessorTopicReviewProgress;
  };

  expect(response.status).toBe(200);
  return payload;
}

function authedRequest(body?: unknown) {
  return new Request("http://test/api/professor/review", {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
    },
    method: body ? "PATCH" : "GET",
  });
}

function mutationRequest(body: unknown, method: "PATCH" | "POST") {
  return new Request("http://test/api/professor/review", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method,
  });
}

function legacySecretMutationRequest(body: unknown, method: "PATCH" | "POST") {
  const request = mutationRequest(body, method);
  request.headers.set("x-professor-token", "legacy-shared-secret");
  return request;
}

function validUploadPayload() {
  return {
    questions: [
      {
        difficulty: "foundational",
        finalAnswer: "0.25",
        hints: ["Identify the relevant event."],
        id: "uploaded-generated-review",
        misconceptions: [
          {
            feedback: "Use the conditioned sample space before dividing.",
            hook: "full sample space",
            id: "uses-full-space",
          },
        ],
        originalityNote: "Original generated item from an abstract pattern.",
        patternId: "pattern-upload-test",
        questionText:
          "A generated campus survey item has 8 successes out of 32 trials. What proportion is successful?",
        reviewStatus: "needs_review",
        solutionSteps: ["Divide 8 by 32 to get 0.25."],
        sourceType: "generated_original",
        topic: "Basic probability",
        topicId: "basic-probability",
        trustLevel: "generated_unverified",
      },
    ],
  };
}
