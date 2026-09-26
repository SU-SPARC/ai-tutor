import type { Metadata } from "next";
import Link from "next/link";

import { CoursesHubCard } from "@/components/courses/courses-hub-card";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorWorkspaceOverviewPanel } from "@/components/professor/professor-workspace-overview";
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

export const metadata: Metadata = {
  title: "Workspace",
};

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
        overview
          ? needsReview > 0
            ? `${needsReview} ${needsReview === 1 ? "question is" : "questions are"} waiting on your review.`
            : "Nothing is waiting on your review."
          : "The workspace summary could not be loaded."
      }
      notice={
        overview
          ? undefined
          : "Counts are unavailable until the next load; every section still opens."
      }
      aside={
        <>
          <Button asChild variant="secondary">
            <Link href="/professor/upload">Upload material</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/professor/questions?tab=intake">Add question</Link>
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-10">
        <ProfessorWorkspaceOverviewPanel overview={overview} />
        <section
          aria-labelledby="overview-courses-heading"
          className="flex flex-col gap-4"
        >
          <h2 id="overview-courses-heading" className="type-h2 text-ink">
            Courses
          </h2>
          <CoursesHubCard />
        </section>
      </div>
    </ProfessorPageShell>
  );
}
