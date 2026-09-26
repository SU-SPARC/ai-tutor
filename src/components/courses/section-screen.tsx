"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";

import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { CourseScreenSkeleton } from "@/components/courses/course-screen-skeleton";
import { plural, sectionName } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
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
        { label: known ? known.label : "Section" },
      ]}
      description="Loading this section."
      shape="section"
      title={known ? sectionName(known) : "Section"}
    />
  );
}

/**
 * The section's views as underlined link tabs: each one is its own URL, and
 * Availability leaves for the topic builder (pre-scoped to this section),
 * which the arrow icon says.
 */
function SectionViewNav({
  items,
}: {
  items: { key: string; href: string; label: string; current: boolean; leaves?: boolean }[];
}) {
  return (
    <LinkTabs label="Section views">
      {items.map((item) => (
        <LinkTab current={item.current} href={item.href} key={item.key}>
          {item.label}
          {item.leaves ? (
            <ArrowUpRight aria-hidden="true" className="size-4" />
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
    { label: section && belongs ? section.label : "Section" },
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

  function regenerate() {
    const action = { type: "section/regenerateJoinCode", sectionId } as const;
    // The reducer is pure, so the new code is known before it is stored.
    const nextCode = getSection(coursesReducer(state, action), sectionId)
      ?.joinCode;
    dispatch(action);
    toast({
      title: nextCode ? `New join code ${nextCode}` : "Join code regenerated",
      description: "The old code no longer works.",
      tone: "success",
    });
  }

  return (
    <ProfessorPageShell
      aside={
        <Button
          onClick={() => setConfirmingRegenerate(true)}
          type="button"
          variant="secondary"
        >
          <RefreshCw aria-hidden="true" />
          Regenerate join code
        </Button>
      }
      breadcrumbs={breadcrumbs}
      description={`${plural(members.length, "student")} joined; the roster shows hashed codes, not names.`}
      notice={
        <span className="inline-flex items-baseline gap-2">
          Join code
          <span className="type-mono text-ink">{section.joinCode}</span>
        </span>
      }
      title={sectionName(section)}
    >
      <SectionViewNav
        items={[
          {
            key: "progress",
            href: courseSectionPath(courseId, sectionId),
            label: "Progress",
            current: tab === "progress",
          },
          {
            // Availability is S3 with this section pre-selected, not a local
            // panel: releasing belongs with the whole course's topic list.
            key: "availability",
            href: courseTopicsPath(courseId, sectionId),
            label: "Availability",
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
        confirmLabel="Regenerate code"
        description={`Anyone still holding ${section.joinCode} will not be able to join ${section.label}. Students who already joined stay in the section.`}
        onConfirm={regenerate}
        onOpenChange={setConfirmingRegenerate}
        open={confirmingRegenerate}
        title="Regenerate the join code?"
      />
    </ProfessorPageShell>
  );
}
