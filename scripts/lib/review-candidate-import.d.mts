import type { ReviewCandidate, Topic } from "../../src/lib/types";

export type ImportClient = {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type ReviewCandidateFixture = {
  candidate: ReviewCandidate;
  sourceFile: string;
};

export type PublicReviewCandidateFixtures = {
  candidates: ReviewCandidateFixture[];
  topics: Topic[];
};

export type ReviewCandidateImportReport = {
  candidates: {
    inserted: number;
    preservedProfessorReviewed: number;
    skipped: number;
    total: number;
  };
  committed: boolean;
  mode: "apply" | "check";
  target: "development" | "production" | "staging" | "test";
  topics: {
    inserted: number;
    skipped: number;
    total: number;
    updated: number;
  };
};

export class ReviewCandidateImportValidationError extends Error {
  issues: string[];
}

export const REVIEW_CANDIDATE_IMPORT_LOCK_ID: number;
export const REVIEW_CANDIDATE_FILES: readonly string[];

export function resolveReviewCandidateDatabaseUrl(environment?: {
  DATABASE_URL?: string;
  POSTGRES_URL?: string;
}): string | undefined;

export function loadPublicReviewCandidateFixtures(
  repositoryRoot: string,
): Promise<PublicReviewCandidateFixtures>;

export function validatePublicReviewCandidateFixtures(
  fixtures: PublicReviewCandidateFixtures,
): PublicReviewCandidateFixtures;

export function importPublicReviewCandidates(options: {
  client: ImportClient;
  dryRun: boolean;
  fixtures: PublicReviewCandidateFixtures;
  target: ReviewCandidateImportReport["target"];
}): Promise<ReviewCandidateImportReport>;
