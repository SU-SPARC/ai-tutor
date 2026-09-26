"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { BuilderBankPane } from "@/components/courses/builder-bank-pane";
import {
  BuilderReleasedPane,
  buildBuilderGroups,
} from "@/components/courses/builder-released-pane";
import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { CourseScreenSkeleton } from "@/components/courses/course-screen-skeleton";
import { plural, sectionName } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { DemoResetButton } from "@/components/courses/demo-reset-button";
import {
  ReviewChangesModal,
  type AppliedSummary,
} from "@/components/courses/review-changes-modal";
import { useStagedChanges } from "@/components/courses/use-staged-changes";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";
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

const TITLE = "Topic builder";
const DESCRIPTION =
  "Choose which published questions each section can see; nothing changes until you apply.";

type ReviewTarget =
  | { kind: "staged" }
  | { kind: "copy"; sectionId: SectionId; changes: StagedReleaseChange[] };

/**
 * S3. `?section=` is read with `useSearchParams`, so the content sits inside a
 * Suspense boundary as Next requires.
 */
export function TopicsBuilderScreen({ courseId }: { courseId: string }) {
  return (
    <Suspense fallback={<BuilderFallback courseId={courseId} />}>
      <TopicsBuilderContent courseId={courseId} />
    </Suspense>
  );
}

/** Same frame, same two panes, still empty. */
function BuilderFallback({ courseId }: { courseId: string }) {
  const { state } = useCoursesStore();
  const course = getCourse(state, courseId);
  return (
    <CourseScreenSkeleton
      breadcrumbs={buildBreadcrumbs(courseId, course)}
      description={DESCRIPTION}
      shape="builder"
      title={TITLE}
    />
  );
}

function buildBreadcrumbs(courseId: string, course: Course | undefined) {
  return [
    { href: coursesIndexPath(), label: "Courses" },
    {
      href: coursePath(courseId),
      label: course ? `${course.code} ${course.term}` : "Course",
    },
    { label: TITLE },
  ];
}

function TopicsBuilderContent({ courseId }: { courseId: string }) {
  const { state, hydrated } = useCoursesStore();
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
   * panes and the review dialog cannot disagree about what a ⊖ means.
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

  const [review, setReview] = useState<ReviewTarget | null>(null);
  // The count is kept with the request so the dialog's wording does not
  // change underneath it while it closes.
  const [pendingSwitch, setPendingSwitch] = useState<{
    sectionId: SectionId;
    count: number;
    fromLabel: string;
  } | null>(null);
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

  // Switching sections leaves nothing behind: staging is per section.
  useEffect(() => {
    clearStaged();
  }, [sectionId, clearStaged]);

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

  const switchSection = (nextSectionId: SectionId) => {
    clearStaged();
    router.replace(courseTopicsPath(courseId, nextSectionId));
  };

  /** Staged changes belong to one section, so leaving asks first. */
  const requestSectionChange = (nextSectionId: string) => {
    if (!activeSection || nextSectionId === activeSection.id) {
      return;
    }
    if (stagedCount > 0) {
      setPendingSwitch({
        sectionId: nextSectionId,
        count: stagedCount,
        fromLabel: activeSection.label,
      });
      return;
    }
    switchSection(nextSectionId);
  };

  const handleApplied = (summary: AppliedSummary) => {
    toast({
      title: `${summary.sectionLabel}: released ${summary.added}, removed ${summary.removed}`,
      description: "Students in this section see the change now.",
      tone: "success",
    });
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
    if (!hydrated) {
      return (
        <CourseScreenSkeleton
          breadcrumbs={breadcrumbs}
          description={DESCRIPTION}
          shape="builder"
          title={TITLE}
        />
      );
    }
    return (
      <ProfessorPageShell
        breadcrumbs={breadcrumbs}
        description={DESCRIPTION}
        title={TITLE}
      >
        <CourseNotFound what="course" />
      </ProfessorPageShell>
    );
  }

  if (!activeSection) {
    return (
      <ProfessorPageShell
        aside={<DemoResetButton />}
        breadcrumbs={breadcrumbs}
        description={DESCRIPTION}
        title={TITLE}
      >
        <EmptyState
          action={
            <Button asChild variant="secondary">
              <Link href={coursePath(courseId)}>Go to course overview</Link>
            </Button>
          }
        >
          This course has no active sections. Releases are per section, so add
          one on the course overview first.
        </EmptyState>
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
  const pendingSection = sections.find(
    (section) => section.id === pendingSwitch?.sectionId,
  );
  const pendingCount = pendingSwitch?.count ?? stagedCount;

  return (
    <ProfessorPageShell
      aside={<DemoResetButton />}
      breadcrumbs={breadcrumbs}
      description={DESCRIPTION}
      title={TITLE}
    >
      <Tabs
        activationMode="manual"
        onValueChange={requestSectionChange}
        value={activeSection.id}
      >
        <TabsList aria-label="Section">
          {sections.map((section) => (
            <TabsTrigger key={section.id} value={section.id}>
              {sectionName(section)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent className="flex flex-col gap-4" value={activeSection.id}>
          <div className="grid items-start gap-4 lg:grid-cols-2 xl:gap-6">
            <BuilderReleasedPane
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
              onSetTopicOpen={setTopicOpen(setLeftOpen, leftOpenTopics)}
              onStageToggle={toggleStaged}
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
              onStageToggle={toggleStaged}
              openTopics={bankOpenTopics}
              releasedIds={releasedIds}
              sectionLabel={activeSection.label}
              staged={staged}
            />
          </div>

          {/* One live region that outlives the bar, so staging the first
              change is announced as well as the later ones. */}
          <p className="sr-only" role="status">
            {stagedCount > 0
              ? `${plural(stagedCount, "change")} staged for ${activeSection.label}: adding ${staged.addCount}, removing ${staged.removeCount}.`
              : ""}
          </p>
          {stagedCount > 0 ? (
            <div
              aria-label="Staged changes"
              className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-panel bg-azure-100 px-4 py-3"
              role="region"
            >
              <p className="type-small text-ink">
                <span className="type-body-strong">
                  {plural(stagedCount, "change")} staged for{" "}
                  {activeSection.label}
                </span>{" "}
                <span className="tabular text-ink-muted">
                  · adding {staged.addCount} · removing {staged.removeCount}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Button onClick={clearStaged} type="button" variant="ghost">
                  Discard
                </Button>
                <Button
                  onClick={() => setReview({ kind: "staged" })}
                  type="button"
                >
                  Review {plural(stagedCount, "change")}
                </Button>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>

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

      <ConfirmDialog
        cancelLabel="Keep editing"
        confirmLabel={`Discard and open ${pendingSection?.label ?? "section"}`}
        description={`Staged changes apply to one section. Switching discards the ${plural(
          pendingCount,
          "change",
        )} you staged for ${pendingSwitch?.fromLabel ?? activeSection.label}.`}
        onConfirm={() => {
          if (pendingSwitch) {
            switchSection(pendingSwitch.sectionId);
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPendingSwitch(null);
          }
        }}
        open={pendingSwitch !== null}
        title={`Discard ${plural(pendingCount, "staged change")}?`}
      />
    </ProfessorPageShell>
  );
}
