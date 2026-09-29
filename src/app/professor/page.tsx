import type { Metadata } from "next";
import Link from "next/link";

import { CoursesHubCard } from "@/components/courses/courses-hub-card";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import {
  ProfessorWorkspaceOverviewPanel,
  professorHomeNextStep,
} from "@/components/professor/professor-workspace-overview";
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
  title: "Home",
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
  const next = professorHomeNextStep(overview);

  return (
    <ProfessorPageShell
      title="Home"
      description="Approving a question does not show it to students. You decide when students see it."
      notice={
        overview ? undefined : (
          <p className="type-body text-ink">
            Some numbers on this page couldn&apos;t be loaded. Every page
            still opens; reload to try again.
          </p>
        )
      }
      aside={
        <Button asChild variant="cta" size="lg" className="min-h-11">
          <Link href={next.href}>{next.label}</Link>
        </Button>
      }
    >
      <div data-tour="professor-home-title" className="flex flex-col gap-10">
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
