import type { Metadata } from "next";

import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { ProfessorCourseFilter } from "@/components/professor/professor-course-filter";
import { getSelectedCourse } from "@/lib/course-selection";
import { ProfessorContentAvailabilityPanel } from "@/components/professor/professor-content-availability-panel";
import { getContentAvailabilityDashboard } from "@/lib/data/data-store";
import {
  requireProfessorReview,
  requirePageAccess,
} from "@/lib/auth/authorization";

export const metadata: Metadata = {
  title: "What students see",
};

export default async function ProfessorAvailabilityPage() {
  const authorization = await requirePageAccess(
    requireProfessorReview,
    "/professor/availability",
  );
  const { course, courses } = await getSelectedCourse();
  const initialDashboard = await getContentAvailabilityDashboard(
    authorization,
    { courseId: course.id },
  );

  return (
    <ProfessorPageShell
      title="What students see"
      breadcrumbs={[
        { label: "Home", href: "/professor" },
        { label: "What students see" },
      ]}
      description="Choose when students can see each topic or question."
      courseFilter={
        <ProfessorCourseFilter
          courses={courses}
          returnTo="/professor/availability"
          selectedCourseId={course.id}
        />
      }
      notice={
        initialDashboard.mode === "demo"
          ? "Demo: changes on this page are not saved."
          : undefined
      }
    >
      <ProfessorContentAvailabilityPanel initialDashboard={initialDashboard} />
    </ProfessorPageShell>
  );
}
