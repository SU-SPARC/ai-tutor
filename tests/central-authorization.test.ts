import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthenticationRequiredError,
  AuthorizationDeniedError,
  ResourceNotFoundError,
  createStudentAuthorizationForTests,
  currentAuthenticatedUser,
  hasPermission,
  isOwnedBy,
  isPublishedContent,
  isRetrievalEligibleContent,
  isStudentSafeRetrievalContent,
  requireAuthenticatedUser,
  requireAnalyticsAccess,
  requireOwnership,
  requireProfessor,
  requireProfessorReview,
  requirePublishedContent,
  requireStudent,
  reviewerAttribution,
  toCurrentUserDto,
  type AuthorizationPermission,
} from "@/lib/auth/authorization";
import {
  toProfessorAnalyticsDto,
  toProfessorReviewCandidateDto,
} from "@/lib/api/professor-dtos";
import { toTutorSessionDto } from "@/lib/api/tutor-session-dto";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import { demoContentRepository } from "@/lib/data/demo-repository";
import {
  createTutorSession,
  getTutorSession,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import { buildProfessorAnalyticsDashboard } from "@/lib/tutor/professor-tools";
import { retrieveTutorContext } from "@/lib/tutor/retrieval";
import type {
  RetrievalChunk,
  ReviewMetadata,
  SourceMetadata,
} from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

afterEach(() => {
  resetAuthMocks();
  resetTutorSessionsForTests();
  vi.unstubAllEnvs();
});

describe("central role authorization", () => {
  it("resolves the current active user and exposes a minimum profile DTO", async () => {
    mockPrincipal(TEST_PROFESSOR);

    await expect(currentAuthenticatedUser()).resolves.toEqual(TEST_PROFESSOR);
    expect(toCurrentUserDto(TEST_PROFESSOR)).toEqual({
      displayName: TEST_PROFESSOR.displayName,
      email: TEST_PROFESSOR.email,
    });
    expect(toCurrentUserDto(TEST_PROFESSOR)).not.toHaveProperty("roles");
    expect(toCurrentUserDto(TEST_PROFESSOR)).not.toHaveProperty("userId");
  });

  it("denies authenticated requirements when no session exists", async () => {
    mockPrincipal(undefined);

    for (const requirement of [
      requireAuthenticatedUser,
      requireStudent,
      requireProfessor,
      requireProfessorReview,
      requireAnalyticsAccess,
    ]) {
      await expect(requirement()).rejects.toBeInstanceOf(
        AuthenticationRequiredError,
      );
    }
  });

  it("applies the student and professor permission matrix", async () => {
    mockPrincipal(TEST_STUDENT);
    await expect(requireAuthenticatedUser()).resolves.toBe(TEST_STUDENT);
    await expect(requireStudent()).resolves.toMatchObject({
      permission: "student",
    });
    await expect(requireProfessor()).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    await expect(requireProfessorReview()).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    await expect(requireAnalyticsAccess()).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );

    mockPrincipal(TEST_PROFESSOR);
    await expect(requireAuthenticatedUser()).resolves.toBe(TEST_PROFESSOR);
    await expect(requireStudent()).resolves.toMatchObject({
      permission: "student",
    });
    for (const requirement of [
      requireProfessor,
      requireProfessorReview,
      requireAnalyticsAccess,
    ]) {
      await expect(requirement()).resolves.toMatchObject({
        permission: "professor",
        principal: TEST_PROFESSOR,
      });
    }
  });

  it("denies unknown permissions by default", () => {
    expect(
      hasPermission(
        TEST_PROFESSOR,
        "unregistered-permission" as AuthorizationPermission,
      ),
    ).toBe(false);
  });
});

describe("central ownership and publication policies", () => {
  it("conceals resources owned by another user or anonymous browser", () => {
    const student = createStudentAuthorizationForTests({
      kind: "user",
      userId: TEST_STUDENT.userId,
    });
    const sameOwner = { kind: "user" as const, userId: TEST_STUDENT.userId };
    const otherOwner = {
      kind: "user" as const,
      userId: "user:another-student",
    };

    expect(isOwnedBy(student, sameOwner)).toBe(true);
    expect(isOwnedBy(student, otherOwner)).toBe(false);
    expect(isOwnedBy(student, TEST_ANONYMOUS_OWNER)).toBe(false);
    expect(() => requireOwnership(student, otherOwner)).toThrow(
      ResourceNotFoundError,
    );
  });

  it("publishes only approved, public, trusted content", () => {
    const published = publicationRecord(
      "approved",
      "public",
      "professor_approved",
    );
    const draft = publicationRecord(
      "needs_review",
      "public",
      "generated_unverified",
    );
    const privateContent = publicationRecord(
      "approved",
      "private",
      "private_reference",
    );

    expect(isPublishedContent(published)).toBe(true);
    expect(isPublishedContent(draft)).toBe(false);
    expect(isPublishedContent(privateContent)).toBe(false);
    expect(requirePublishedContent(published)).toBe(published);
    expect(() => requirePublishedContent(draft)).toThrow(ResourceNotFoundError);
  });

  it("keeps raw private retrieval server-side and permits only its safe summary downstream", () => {
    const rawPrivate = privateRetrievalChunk(
      "Private source body",
      "Approved safe summary",
    );
    const sanitizedPrivate = privateRetrievalChunk(
      "Approved safe summary",
      "Approved safe summary",
    );

    expect(isRetrievalEligibleContent(rawPrivate)).toBe(true);
    expect(isStudentSafeRetrievalContent(rawPrivate)).toBe(false);
    expect(isStudentSafeRetrievalContent(sanitizedPrivate)).toBe(true);
  });

  it("requires a professor grant for internal draft retrieval", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const professorReview = await requireProfessorReview();

    await expect(
      retrieveTutorContext("draft question", {
        audience: "admin_dev",
      }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    await expect(
      retrieveTutorContext("draft question", {
        professorAuthorization: professorReview,
        audience: "admin_dev",
      }),
    ).resolves.toBeDefined();
  });
});

describe("authorized repository boundaries and DTOs", () => {
  it("requires grants at repository entry points and derives the reviewer from the grant", async () => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    mockPrincipal(TEST_PROFESSOR);
    const reviewAuthorization = await requireProfessorReview();
    const queue = await demoContentRepository.getReviewQueue(
      reviewAuthorization,
      { status: "needs_review" },
    );

    expect(queue.length).toBeGreaterThan(0);
    expect(reviewerAttribution(reviewAuthorization)).toEqual({
      displayName: TEST_PROFESSOR.displayName,
      userId: TEST_PROFESSOR.userId,
    });
    await expect(
      demoContentRepository.getReviewQueue({} as never),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    const query = vi.fn();
    const databaseRepository = createDatabaseContentRepository(
      "postgres://unused.invalid/authorization-test",
      query,
    );
    await expect(
      databaseRepository.getAdminQuestions({} as never),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(query).not.toHaveBeenCalled();
  });

  it("enforces ownership in the tutor repository gateway", async () => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    const ownerA = createStudentAuthorizationForTests({
      kind: "anonymous",
      anonymousId: "anon:owner-a",
    });
    const ownerB = createStudentAuthorizationForTests({
      kind: "anonymous",
      anonymousId: "anon:owner-b",
    });
    const session = await createTutorSession(ownerA, "dice-sum-eight");

    await expect(getTutorSession(ownerA, session.id)).resolves.toMatchObject({
      id: session.id,
    });
    await expect(getTutorSession(ownerB, session.id)).resolves.toBeUndefined();
    await expect(
      createTutorSession({} as never, "dice-sum-eight"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("serializes only fields required by each browser workflow", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const reviewAuthorization = await requireProfessorReview();
    const analyticsAuthorization = await requireAnalyticsAccess();
    const [candidate] =
      await demoContentRepository.getReviewQueue(reviewAuthorization);
    const [practice, reviewQueue] = await Promise.all([
      demoContentRepository.getProfessorPracticeAnalytics(
        analyticsAuthorization,
      ),
      demoContentRepository.getReviewQueue(analyticsAuthorization),
    ]);
    const candidateDto = toProfessorReviewCandidateDto(candidate);
    const analyticsDto = toProfessorAnalyticsDto(
      buildProfessorAnalyticsDashboard({
        mode: "demo",
        practice,
        reviewQueue,
      }),
    );
    const sessionDto = toTutorSessionDto({
      id: "session:test",
      questionId: "dice-sum-eight",
    });

    expect(sessionDto).toEqual({
      id: "session:test",
      questionId: "dice-sum-eight",
    });
    expect(JSON.stringify(candidateDto)).not.toMatch(
      /matchTerms|patternIds|reviewedBy|visibility/,
    );
    expect(Object.keys(analyticsDto.practice).sort()).toEqual([
      "questions",
      "topics",
    ]);
    expect(analyticsDto.practice).not.toHaveProperty("commonMisconceptions");
    expect(analyticsDto.practice).not.toHaveProperty(
      "generatedQuestionOutcomes",
    );
    expect(analyticsDto.practice).not.toHaveProperty("summary");
  });
});

function publicationRecord(
  status: ReviewMetadata["status"],
  visibility: SourceMetadata["visibility"],
  trustLevel: SourceMetadata["trustLevel"],
) {
  return {
    review: { status },
    source: {
      sourceType: "generated_original" as const,
      trustLevel,
      visibility,
    },
  };
}

function privateRetrievalChunk(
  body: string,
  llmSafeSummary: string,
): RetrievalChunk {
  return {
    body,
    chunkType: "pattern",
    conceptTags: [],
    formulaRefs: [],
    id: "private:test",
    keywords: [],
    llmSafeSummary,
    priorityTier: "private_reference",
    review: { status: "approved" },
    source: {
      sourceType: "private_reference_pattern",
      trustLevel: "private_reference",
      visibility: "private",
    },
    title: "Private test chunk",
    topicId: "conditional-probability",
  };
}
