import { CoursesStoreProvider } from "@/components/courses/courses-store";
import {
  ProfessorRail,
  type ProfessorRailCounts,
} from "@/components/shell/app-rail";
import { ThreeColumn } from "@/components/shell/three-column";
import {
  requirePageAccess,
  requireProfessor,
  type ProfessorAuthorization,
} from "@/lib/auth/authorization";
import { getProfessorQuestionReviewDashboard } from "@/lib/data/data-store";

export const dynamic = "force-dynamic";

/**
 * The rail's one count: questions waiting for the professor's review. Best
 * effort: the rail is navigation, so a failed read leaves the row without a
 * count instead of failing the page. Totals (students, reports) are not
 * loaded; the rail shows a number only when something needs the professor.
 */
async function loadRailCounts(
  authorization: ProfessorAuthorization,
): Promise<ProfessorRailCounts | undefined> {
  try {
    const review = await getProfessorQuestionReviewDashboard(authorization);
    return {
      review: review.topics.reduce((sum, topic) => sum + topic.needsReview, 0),
    };
  } catch {
    return undefined;
  }
}

export default async function ProfessorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const authorization = await requirePageAccess(requireProfessor, "/professor");
  const counts = await loadRailCounts(authorization);

  // Course/section state is held by a client store backed by
  // /api/professor/courses, and the header's course switcher needs it too,
  // so the provider wraps the whole workspace.
  // The rail lives here (not in each page) so it persists across navigation.
  return (
    <CoursesStoreProvider>
      <ThreeColumn
        rail={<ProfessorRail counts={counts} />}
        railLabel="Professor pages"
        drawerOpen={false}
        mainClassName="lg:py-8"
      >
        {children}
      </ThreeColumn>
    </CoursesStoreProvider>
  );
}
