"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowRight } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { CourseScreenSkeleton } from "@/components/courses/course-screen-skeleton";
import {
  plural,
  sectionLabelText,
  sectionName,
} from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { JoinCodePanel } from "@/components/courses/join-code-panel";
import { SectionProgressPanel } from "@/components/courses/section-progress-panel";
import { SectionSettingsPanel } from "@/components/courses/section-settings-panel";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { LinkTab, LinkTabs } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import {
  coursePath,
  courseSectionPath,
  courseTopicsPath,
  coursesIndexPath,
} from "@/lib/courses/paths";
import { coursesReducer } from "@/lib/courses/reducer";
import {
  getCourse,
  getSection,
  sectionMembers,
  sectionProgress,
} from "@/lib/courses/selectors";

type TabKey = "progress" | "settings";

export function SectionScreen(props: { courseId: string; sectionId: string }) {
  // `?tab=` picks the panel, so the component that reads it is suspended per
  // Next's search-param rule. The fallback already knows the section from the
  // seed, so the header block does not change when the panel arrives.
  return (
    <Suspense fallback={<SectionFallback {...props} />}>
      <SectionScreenInner {...props} />
    </Suspense>
  );
}

function SectionFallback({
  courseId,
  sectionId,
}: {
  courseId: string;
  sectionId: string;
}) {
  const { state } = useCoursesStore();
  const course = getCourse(state, courseId);
  const section = getSection(state, sectionId);
  const known = section && section.courseId === courseId ? section : undefined;
  return (
    <CourseScreenSkeleton
      breadcrumbs={[
        { href: coursesIndexPath(), label: "Courses" },
        {
          href: coursePath(courseId),
          label: course ? `${course.code} ${course.term}` : "Course",
        },
        { label: known ? sectionLabelText(known) : "Section" },
      ]}
      description="Loading this section."
      shape="section"
      title={known ? sectionName(known) : "Section"}
    />
  );
}

/**
 * The section's views as underlined link tabs: each one is its own URL.
 * "Choose questions" leaves for that page (pre-scoped to this section), which
 * the arrow says in words for screen readers too.
 */
function SectionViewNav({
  items,
}: {
  items: {
    key: string;
    href: string;
    label: string;
    current: boolean;
    leaves?: boolean;
  }[];
}) {
  return (
    <LinkTabs label="Section pages">
      {items.map((item) => (
        <LinkTab current={item.current} href={item.href} key={item.key}>
          {item.label}
          {item.leaves ? (
            <>
              <ArrowRight aria-hidden="true" className="size-4" />
              <span className="sr-only"> (opens another page)</span>
            </>
          ) : null}
        </LinkTab>
      ))}
    </LinkTabs>
  );
}

function SectionScreenInner({
  courseId,
  sectionId,
}: {
  courseId: string;
  sectionId: string;
}) {
  const { state, dispatch, hydrated } = useCoursesStore();
  const searchParams = useSearchParams();
  const tab: TabKey =
    searchParams.get("tab") === "settings" ? "settings" : "progress";
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);

  const course = getCourse(state, courseId);
  const section = getSection(state, sectionId);
  const belongs = section?.courseId === courseId;

  const courseLabel = course ? `${course.code} ${course.term}` : "Course";
  const breadcrumbs = [
    { href: coursesIndexPath(), label: "Courses" },
    { href: coursePath(courseId), label: courseLabel },
    { label: section && belongs ? sectionLabelText(section) : "Section" },
  ];

  if (!course || !section || !belongs) {
    if (!hydrated) {
      // Sections created in this browser are not in the server's seed; wait
      // for the saved demo before calling this one missing.
      return (
        <CourseScreenSkeleton
          breadcrumbs={breadcrumbs}
          description="Loading this section."
          shape="section"
          title="Section"
        />
      );
    }
    return (
      <ProfessorPageShell
        breadcrumbs={breadcrumbs}
        description="Nothing was changed. Pick a section from the course you are working in."
        title={course ? "Section not found" : "Course not found"}
      >
        <CourseNotFound what={course ? "section" : "course"} />
      </ProfessorPageShell>
    );
  }

  const members = sectionMembers(state, sectionId);
  const progress = sectionProgress(state, sectionId, SEED_NOW);
  const label = sectionLabelText(section);

  function regenerate() {
    if (!section) {
      return;
    }
    const action = { type: "section/regenerateJoinCode", sectionId } as const;
    // The reducer is pure, so the new code is known before it is stored.
    const nextCode = getSection(coursesReducer(state, action), sectionId)
      ?.joinCode;
    dispatch(action);
    toast({
      title: nextCode
        ? `The new join code for ${label} is ${nextCode}.`
        : `${label} has a new join code.`,
      description: `The old code ${section.joinCode} no longer works. Students who already joined stay.`,
      tone: "success",
    });
  }

  return (
    <ProfessorPageShell
      aside={
        <Button asChild className="min-h-11" variant="cta">
          <Link href={courseTopicsPath(courseId, sectionId)}>
            Choose questions for this section
          </Link>
        </Button>
      }
      breadcrumbs={breadcrumbs}
      description={`${plural(members.length, "student has", "students have")} joined ${label}.`}
      title={sectionName(section)}
    >
      <JoinCodePanel code={section.joinCode} sectionLabel={label} />

      <SectionViewNav
        items={[
          {
            key: "progress",
            href: courseSectionPath(courseId, sectionId),
            label: "Progress",
            current: tab === "progress",
          },
          {
            // "Choose questions" is its own page with this section selected:
            // choosing belongs with the whole course's weeks.
            key: "choose",
            href: courseTopicsPath(courseId, sectionId),
            label: "Choose questions",
            current: false,
            leaves: true,
          },
          {
            key: "settings",
            href: courseSectionPath(courseId, sectionId, "settings"),
            label: "Settings",
            current: tab === "settings",
          },
        ]}
      />

      {tab === "settings" ? (
        <SectionSettingsPanel
          onRegenerateJoinCode={() => setConfirmingRegenerate(true)}
          section={section}
        />
      ) : (
        <SectionProgressPanel
          members={members}
          progress={progress}
          section={section}
        />
      )}

      <ConfirmDialog
        cancelLabel="Keep this code"
        confirmLabel="Make a new join code"
        description={`Students who already joined ${label} stay. Anyone who still has ${section.joinCode} will not be able to join with it.`}
        onConfirm={regenerate}
        onOpenChange={setConfirmingRegenerate}
        open={confirmingRegenerate}
        title={`Make a new join code for ${label}?`}
      />
    </ProfessorPageShell>
  );
}
