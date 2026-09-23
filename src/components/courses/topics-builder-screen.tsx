"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";

import { BuilderBankPane } from "@/components/courses/builder-bank-pane";
import {
  BuilderReleasedPane,
  buildBuilderGroups,
} from "@/components/courses/builder-released-pane";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { useCoursesStore } from "@/components/courses/courses-store";
import { DemoResetButton } from "@/components/courses/demo-reset-button";
import {
  ReviewChangesModal,
  type AppliedSummary,
} from "@/components/courses/review-changes-modal";
import { useStagedChanges } from "@/components/courses/use-staged-changes";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import {
  copyReleasedSetChanges,
  getCourse,
  listSections,
} from "@/lib/courses/selectors";
import {
  coursePath,
  courseTopicsPath,
  coursesIndexPath,
} from "@/lib/courses/paths";
import type {
  Course,
  QuestionId,
  SectionId,
  StagedReleaseChange,
  TopicId,
} from "@/lib/courses/types";

const DEFAULT_OPEN_TOPICS = 3;
const FLASH_MS = 5000;

const TITLE = "Build what students see";
const DESCRIPTION =
  "Released questions are visible to this section now. Only published versions can be released.";

type ReviewTarget =
  | { kind: "staged" }
  | { kind: "copy"; sectionId: SectionId; changes: StagedReleaseChange[] };

/**
 * S3 — the DeltaMath screen. `?section=` is read with `useSearchParams`, so the
 * content sits inside a Suspense boundary as Next requires.
 */
export function TopicsBuilderScreen({ courseId }: { courseId: string }) {
  return (
    <Suspense fallback={<BuilderFallback courseId={courseId} />}>
      <TopicsBuilderContent courseId={courseId} />
    </Suspense>
  );
}

/** Same frame, same two-column grid — only the panes are still empty. */
function BuilderFallback({ courseId }: { courseId: string }) {
  const { state } = useCoursesStore();
  const course = getCourse(state, courseId);
  return (
    <ProfessorPageShell
      title={TITLE}
      description={DESCRIPTION}
      breadcrumbs={buildBreadcrumbs(courseId, course)}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="min-h-64" />
        <Card className="min-h-64" />
      </div>
    </ProfessorPageShell>
  );
}

function buildBreadcrumbs(courseId: string, course: Course | undefined) {
  return [
    { href: coursesIndexPath(), label: "Courses" },
    {
      href: coursePath(courseId),
      label: course ? `${course.code} ${course.term}` : courseId,
    },
    { label: "Topics" },
  ];
}

function TopicsBuilderContent({ courseId }: { courseId: string }) {
  const { state } = useCoursesStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSectionId = searchParams.get("section");

  const course = getCourse(state, courseId);
  const sections = useMemo(
    () =>
      listSections(state, courseId).filter(
        (section) => section.status === "active",
      ),
    [state, courseId],
  );

  const activeSection =
    sections.find((section) => section.id === requestedSectionId) ??
    sections[0];
  const sectionId = activeSection?.id ?? "";

  const groups = useMemo(
    () => (sectionId ? buildBuilderGroups(state, sectionId) : []),
    [state, sectionId],
  );

  /**
   * Every question the section already has a row for — released or held. That
   * is exactly what `previewReleaseChanges` treats as removable, so the two
   * panes and the modal cannot disagree about what a ⊖ means.
   */
  const releasedIds = useMemo(
    () =>
      new Set<QuestionId>(
        state.questionAvailability
          .filter((row) => row.sectionId === sectionId)
          .map((row) => row.questionId),
      ),
    [state.questionAvailability, sectionId],
  );

  const staged = useStagedChanges(releasedIds);
  const {
    clear: clearStaged,
    count: stagedCount,
    toggle: toggleStaged,
    unstage: unstageOne,
  } = staged;

  const [flash, setFlash] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const [leftOpen, setLeftOpen] = useState<ReadonlySet<TopicId> | null>(null);
  const [bankOpen, setBankOpen] = useState<ReadonlySet<TopicId> | null>(null);

  const defaultOpen = useMemo(
    () =>
      new Set<TopicId>(
        groups.slice(0, DEFAULT_OPEN_TOPICS).map((group) => group.topic.id),
      ),
    [groups],
  );
  const leftOpenTopics = leftOpen ?? defaultOpen;
  const bankOpenTopics = bankOpen ?? defaultOpen;

  // A shareable URL always names the section, and a `?section=` that is not in
  // this course falls back to the first one rather than rendering empty panes.
  useEffect(() => {
    if (activeSection && requestedSectionId !== activeSection.id) {
      router.replace(courseTopicsPath(courseId, activeSection.id));
    }
  }, [activeSection, requestedSectionId, courseId, router]);

  useEffect(() => {
    if (!flash) {
      return;
    }
    const timer = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [flash]);

  // Switching sections leaves nothing behind: staging is per section.
  useEffect(() => {
    clearStaged();
  }, [sectionId, clearStaged]);

  // Staging something is "the next change", which retires the success line.
  const stageToggle = (questionId: QuestionId) => {
    setFlash(null);
    toggleStaged(questionId);
  };

  const setTopicOpen =
    (
      setter: (value: ReadonlySet<TopicId> | null) => void,
      current: ReadonlySet<TopicId>,
    ) =>
    (topicId: TopicId, open: boolean) => {
      const next = new Set(current);
      if (open) {
        next.add(topicId);
      } else {
        next.delete(topicId);
      }
      setter(next);
    };

  /** Returns false when the professor backed out, so the select can snap back. */
  const handleSectionChange = (nextSectionId: string) => {
    if (!activeSection || nextSectionId === activeSection.id) {
      return false;
    }
    if (
      stagedCount > 0 &&
      !window.confirm(
        `Discard ${stagedCount} staged ${
          stagedCount === 1 ? "change" : "changes"
        } for ${activeSection.label} and switch sections?`,
      )
    ) {
      return false;
    }
    clearStaged();
    setFlash(null);
    router.replace(courseTopicsPath(courseId, nextSectionId));
    return true;
  };

  const handleApplied = (summary: AppliedSummary) => {
    setFlash(
      `${summary.sectionLabel}: released ${summary.added}, removed ${summary.removed}. Students in this section see the change now.`,
    );
    if (summary.sectionId === sectionId) {
      clearStaged();
    }
    setReview(null);
  };

  const handleRemoveFromSet = (questionId: QuestionId) => {
    if (!review) {
      return;
    }
    if (review.kind === "staged") {
      unstageOne(questionId);
      return;
    }
    setReview({
      ...review,
      changes: review.changes.filter(
        (change) => change.questionId !== questionId,
      ),
    });
  };

  const breadcrumbs = buildBreadcrumbs(courseId, course);

  if (!course) {
    return (
      <ProfessorPageShell
        title={TITLE}
        description={DESCRIPTION}
        breadcrumbs={breadcrumbs}
      >
        <CourseNotFound what="course" />
      </ProfessorPageShell>
    );
  }

  if (!activeSection) {
    return (
      <ProfessorPageShell
        title={TITLE}
        description={DESCRIPTION}
        breadcrumbs={breadcrumbs}
        aside={<DemoResetButton />}
      >
        <Alert variant="info" className="max-w-2xl">
          <Info aria-hidden="true" />
          <AlertTitle>This course has no active sections</AlertTitle>
          <AlertDescription>
            <p>
              Releasing is scoped to a section, so there is nothing to build
              until one exists. Add a section on the course overview, then come
              back.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-2">
              <Link href={coursePath(courseId)}>Go to course overview</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </ProfessorPageShell>
    );
  }

  const otherSections = sections.filter(
    (section) => section.id !== activeSection.id,
  );
  const reviewSectionId =
    review?.kind === "copy" ? review.sectionId : activeSection.id;
  const reviewSection =
    sections.find((section) => section.id === reviewSectionId) ?? activeSection;
  const reviewChanges =
    review === null
      ? []
      : review.kind === "staged"
        ? staged.changes
        : review.changes;
  // A staged review with nothing left in it closes itself rather than showing
  // an empty preflight, so clearing the last blocked item ends the flow. A copy
  // still opens when it is empty — "the two sections already match" is an
  // answer the professor asked for.
  const reviewOpen =
    review !== null && (review.kind === "copy" || stagedCount > 0);

  return (
    <ProfessorPageShell
      title={TITLE}
      description={DESCRIPTION}
      breadcrumbs={breadcrumbs}
      aside={
        <>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Section:
            <NativeSelect
              className="h-10 w-[13rem]"
              value={activeSection.id}
              onChange={(event) => {
                // Cancelling the confirm leaves no state change to re-render
                // from, so the native value is put back by hand.
                if (!handleSectionChange(event.target.value)) {
                  event.target.value = activeSection.id;
                }
              }}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label} · {section.meetingTime}
                </option>
              ))}
            </NativeSelect>
          </label>
          <DemoResetButton />
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <BuilderReleasedPane
          flash={flash}
          groups={groups}
          onCopyTo={(targetSectionId) =>
            setReview({
              kind: "copy",
              sectionId: targetSectionId,
              changes: copyReleasedSetChanges(
                state,
                activeSection.id,
                targetSectionId,
              ),
            })
          }
          onDiscard={() => {
            clearStaged();
            setFlash(null);
          }}
          onReview={() => setReview({ kind: "staged" })}
          onSetTopicOpen={setTopicOpen(setLeftOpen, leftOpenTopics)}
          onStageToggle={stageToggle}
          openTopics={leftOpenTopics}
          otherSections={otherSections}
          sectionId={activeSection.id}
          sectionLabel={activeSection.label}
          staged={staged}
        />

        <BuilderBankPane
          courseId={courseId}
          groups={groups}
          onCollapseAll={() => setBankOpen(new Set())}
          onExpandAll={() =>
            setBankOpen(new Set(groups.map((group) => group.topic.id)))
          }
          onSetTopicOpen={setTopicOpen(setBankOpen, bankOpenTopics)}
          onStageToggle={stageToggle}
          openTopics={bankOpenTopics}
          releasedIds={releasedIds}
          sectionLabel={activeSection.label}
          staged={staged}
        />
      </div>

      <ReviewChangesModal
        changes={reviewChanges}
        onApplied={handleApplied}
        onClose={() => setReview(null)}
        onRemoveFromSet={handleRemoveFromSet}
        open={reviewOpen}
        otherSectionLabels={sections
          .filter((section) => section.id !== reviewSection.id)
          .map((section) => section.label)}
        sectionId={reviewSection.id}
        sectionLabel={reviewSection.label}
      />
    </ProfessorPageShell>
  );
}
