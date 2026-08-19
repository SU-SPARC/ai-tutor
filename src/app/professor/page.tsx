import Link from "next/link";
import { Upload } from "lucide-react";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorWorkspaceOverviewPanel } from "@/components/professor/professor-workspace-overview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  requirePageAccess,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import {
  getContentAvailabilityDashboard,
  getProfessorQuestionReviewDashboard,
  getQuestionLifecycleDashboard,
} from "@/lib/data/data-store";
import {
  summarizeProfessorWorkspace,
  type ProfessorWorkspaceOverview,
} from "@/lib/professor/workspace-overview";

/**
 * The overview reads three dashboards. Before it did so this page could not
 * fail, so a read failure degrades to the shell and its navigation rather
 * than taking the whole workspace entry point down with it.
 */
async function loadOverview(): Promise<ProfessorWorkspaceOverview | undefined> {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor",
  );
  try {
    const [availability, lifecycle, review] = await Promise.all([
      getContentAvailabilityDashboard(authorization),
      getQuestionLifecycleDashboard(authorization),
      getProfessorQuestionReviewDashboard(authorization),
    ]);
    return summarizeProfessorWorkspace({ availability, lifecycle, review });
  } catch {
    return undefined;
  }
}

export default async function ProfessorPage() {
  const overview = await loadOverview();
  const needsReview = overview?.totalNeedsReview ?? 0;

  return (
    <ProfessorPageShell
      title="Professor workspace"
      description={
        needsReview > 0
          ? `${needsReview} ${needsReview === 1 ? "question is" : "questions are"} waiting on your review. Approval and student release are separate steps, so nothing reaches a student until you release it.`
          : "Approval and student release are separate steps, so nothing reaches a student until you release it."
      }
      aside={
        <>
          <Button asChild variant="outline">
            <Link href="/professor/upload">
              <Upload className="h-4 w-4" />
              Upload material
            </Link>
          </Button>
          <Button asChild>
            <Link href="/professor/review">Start reviewing</Link>
          </Button>
        </>
      }
    >
      {overview ? (
        <ProfessorWorkspaceOverviewPanel overview={overview} />
      ) : (
        <Alert>
          <AlertDescription>
            The workspace summary could not be loaded, so the counts below are
            unavailable. Every section is still reachable from the navigation
            above.
          </AlertDescription>
        </Alert>
      )}
    </ProfessorPageShell>
  );
}
