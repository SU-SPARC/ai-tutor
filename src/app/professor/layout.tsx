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
import {
  getProfessorQuestionReviewDashboard,
  listInstructorStudents,
} from "@/lib/data/data-store";
import { getProfessorQuestionFeedbackDashboard } from "@/lib/data/question-feedback-repository";

export const dynamic = "force-dynamic";

/**
 * Live counts for the workspace rail: questions waiting on review, open
 * student reports, and students with any practice. Best effort: the rail is
 * navigation, so a failed read leaves that row without a number instead of
 * failing the page. The three reads run in parallel; the student read asks
 * for one row because only the total is shown (no identity is resolved).
 */
async function loadRailCounts(
  authorization: ProfessorAuthorization,
): Promise<ProfessorRailCounts | undefined> {
  const [review, feedback, students] = await Promise.allSettled([
    getProfessorQuestionReviewDashboard(authorization),
    getProfessorQuestionFeedbackDashboard(authorization),
    listInstructorStudents(authorization, { limit: 1 }),
  ]);

  const counts: ProfessorRailCounts = {};
  if (review.status === "fulfilled") {
    counts.review = review.value.topics.reduce(
      (sum, topic) => sum + topic.needsReview,
      0,
    );
  }
  if (feedback.status === "fulfilled") {
    counts.feedback = feedback.value.counts.open;
  }
  if (students.status === "fulfilled") {
    counts.students = students.value.total;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

export default async function ProfessorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const authorization = await requirePageAccess(requireProfessor, "/professor");
  const counts = await loadRailCounts(authorization);

  // Course/section state is client-side for this demo, and the header's
  // course switcher needs it too, so the provider wraps the whole workspace.
  // The rail lives here (not in each page) so it persists across navigation.
  return (
    <CoursesStoreProvider>
      <ThreeColumn
        rail={<ProfessorRail counts={counts} />}
        railLabel="Workspace"
        drawerOpen={false}
        mainClassName="lg:py-8"
      >
        {children}
      </ThreeColumn>
    </CoursesStoreProvider>
  );
}
