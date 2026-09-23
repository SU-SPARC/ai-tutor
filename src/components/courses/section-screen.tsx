"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { RefreshCw } from "lucide-react";

import { CourseNotFound } from "@/components/courses/course-not-found";
import { useCoursesStore } from "@/components/courses/courses-store";
import { SectionProgressPanel } from "@/components/courses/section-progress-panel";
import { SectionSettingsPanel } from "@/components/courses/section-settings-panel";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import {
  coursePath,
  courseSectionPath,
  courseTopicsPath,
  coursesIndexPath,
} from "@/lib/courses/paths";
import {
  getCourse,
  getSection,
  sectionMembers,
  sectionProgress,
} from "@/lib/courses/selectors";
import { cn } from "@/lib/utils";

type TabKey = "progress" | "settings";

export function SectionScreen(props: { courseId: string; sectionId: string }) {
  // `?tab=` picks the panel, so the component that reads it is suspended per
  // Next's search-param rule.
  return (
    <Suspense fallback={null}>
      <SectionScreenInner {...props} />
    </Suspense>
  );
}

function SectionScreenInner({
  courseId,
  sectionId,
}: {
  courseId: string;
  sectionId: string;
}) {
  const { state, dispatch } = useCoursesStore();
  const searchParams = useSearchParams();
  const tab: TabKey =
    searchParams.get("tab") === "settings" ? "settings" : "progress";
  const [regenerated, setRegenerated] = useState(false);

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

  function handleRegenerate() {
    const confirmed = window.confirm(
      "Regenerate the join code? Anyone still holding the old code or link will not be able to join.",
    );
    if (!confirmed) {
      return;
    }
    dispatch({ type: "section/regenerateJoinCode", sectionId });
    setRegenerated(true);
  }

  const tabs: { key: TabKey | "availability"; href: string; label: string }[] =
    [
      {
        key: "progress",
        href: courseSectionPath(courseId, sectionId),
        label: "Progress",
      },
      {
        // Availability is S3 with this section pre-selected, not a local panel:
        // releasing questions belongs with the whole course's topic list.
        key: "availability",
        href: courseTopicsPath(courseId, sectionId),
        label: "Availability",
      },
      {
        key: "settings",
        href: courseSectionPath(courseId, sectionId, "settings"),
        label: "Settings",
      },
    ];

  return (
    <ProfessorPageShell
      aside={
        <div className="flex flex-col items-start gap-1">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Join code</span>
            <span className="rounded-md border border-border px-3 py-1.5 font-mono text-sm">
              {section.joinCode}
            </span>
            <Button
              aria-label="Regenerate the join code"
              onClick={handleRegenerate}
              size="sm"
              variant="outline"
            >
              <RefreshCw className="h-4 w-4" />
              Regenerate
            </Button>
          </div>
          {regenerated ? (
            <span className="text-xs text-success">
              New code {section.joinCode} — the old one no longer works.
            </span>
          ) : null}
        </div>
      }
      breadcrumbs={breadcrumbs}
      description={`${members.length} students joined · identities are hashed; you see codes, not names`}
      title={`${section.label} · ${section.meetingTime}`}
    >
      <nav
        aria-label="Section tabs"
        className="flex flex-wrap items-center gap-1 border-b pb-3 text-sm"
      >
        {tabs.map((entry) => {
          const active = entry.key === tab;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              href={entry.href}
              key={entry.key}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      {tab === "settings" ? (
        <SectionSettingsPanel
          onRegenerateJoinCode={handleRegenerate}
          section={section}
        />
      ) : (
        <SectionProgressPanel
          members={members}
          progress={progress}
          section={section}
        />
      )}
    </ProfessorPageShell>
  );
}
