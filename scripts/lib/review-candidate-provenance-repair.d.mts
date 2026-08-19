import type {
  ImportClient,
  PublicReviewCandidateFixtures,
  ReviewCandidateImportReport,
} from "./review-candidate-import.d.mts";

export type ProvenanceRepairEntry = {
  id: string;
  lifecycleState: string;
  nextVersionNumber: number;
  publishedVersionId: string | null;
  sourceFile: string;
  targetSnapshot: Record<string, unknown>;
  workingVersionId: string;
};

export type ProvenanceRepairBlockedEntry = ProvenanceRepairEntry & {
  reason: string;
};

export type ProvenanceRepairPlan = {
  absent: { id: string; sourceFile: string }[];
  alreadyCorrect: ProvenanceRepairEntry[];
  blocked: ProvenanceRepairBlockedEntry[];
  repairable: ProvenanceRepairEntry[];
};

export type ProvenanceRepairReport = {
  absent: { id: string; sourceFile: string }[];
  alreadyCorrect: number;
  blocked: ProvenanceRepairBlockedEntry[];
  committed: boolean;
  mode: "apply" | "check";
  repaired: {
    id: string;
    previousLifecycleState: string;
    previousVersionId: string;
    versionId: string;
  }[];
  selected: string[];
  target: ReviewCandidateImportReport["target"];
};

export class ProvenanceRepairError extends Error {
  issues: string[];
}

export const PROVENANCE_REPAIR_LOCK_ID: number;
export const PROVENANCE_REPAIR_ACTOR: string;
export const PROVENANCE_REPAIR_ACTOR_DISPLAY: string;

export function loadPublicReviewCandidateFixtures(
  repositoryRoot: string,
): Promise<PublicReviewCandidateFixtures>;

export function buildProvenanceRepairPlan(
  client: ImportClient,
  fixtures: PublicReviewCandidateFixtures,
): Promise<ProvenanceRepairPlan>;

export function applyProvenanceRepair(options: {
  client: ImportClient;
  dryRun: boolean;
  fixtures: PublicReviewCandidateFixtures;
  only?: Set<string>;
  target: ReviewCandidateImportReport["target"];
}): Promise<ProvenanceRepairReport>;
