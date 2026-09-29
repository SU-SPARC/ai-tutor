"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { BuilderBankPane } from "@/components/courses/builder-bank-pane";
import {
  BuilderReleasedPane,
  buildBuilderGroups,
} from "@/components/courses/builder-released-pane";
import { ConfirmDialog } from "@/components/courses/confirm-dialog";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { CourseScreenSkeleton } from "@/components/courses/course-screen-skeleton";
import {
  formatShortDate,
  plural,
  sectionLabelText,
  sectionName,
} from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
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
import { SEED_NOW } from "@/lib/courses/demo-seed";
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

/** How long a toast with Undo stays up: long enough to read and reach. */
export const UNDO_TOAST_MS = 15_000;

export const CHOOSE_QUESTIONS_TITLE = "Choose questions";
const DESCRIPTION = "Pick which questions students in each section can see.";

type ReviewTarget =
  | { kind: "staged" }
  | { kind: "copy"; sectionId: SectionId; changes: StagedReleaseChange[] };

/** Where the professor tried to go while changes were not saved yet. */
type PendingLeave =
  | { kind: "href"; href: string; count: number }
  | { kind: "section"; sectionId: SectionId; count: number };

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
      title={CHOOSE_QUESTIONS_TITLE}
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
    { label: CHOOSE_QUESTIONS_TITLE },
  ];
}

/** "show 2, hide 1" — the waiting changes in the professor's words. */
function stagedBreakdown(adds: number, removes: number) {
  const parts: string[] = [];
  if (adds > 0) {
    parts.push(`show ${adds}`);
  }
  if (removes > 0) {
    parts.push(`hide ${removes}`);
  }
  return parts.join(", ");
}

/**
 * The toast after saving, worded by what students can actually see: a week
 * that is still closed means "saved, not visible yet", never "they see it now".
 */
function appliedMessage(summary: AppliedSummary) {
  const section = sectionLabelText(summary.sectionLabel);
  const sentences: string[] = [];

  const visible = summary.weeks.filter((week) => week.state === "open");
  const visibleCount = visible.reduce((sum, week) => sum + week.addedCount, 0);
  if (visibleCount > 0) {
    const which =
      visible.length === 1 ? `Week ${visible[0].weekNumber} question` : "new question";
    sentences.push(`${section} can now see ${plural(visibleCount, which)}.`);
  }

  for (const week of summary.weeks.filter((entry) => entry.state !== "open")) {
    const when =
      week.state === "scheduled" && week.opensAt
        ? `when Week ${week.weekNumber} opens (${formatShortDate(week.opensAt)})`
        : `when you open Week ${week.weekNumber}`;
    sentences.push(
      `Saved. ${section} will see ${week.addedCount === 1 ? "this" : "these"} ${when}.`,
    );
  }

  if (summary.removed > 0) {
    sentences.push(
      `${plural(summary.removed, "question")} ${
        summary.removed === 1 ? "is" : "are"
      } now hidden from ${section}.`,
    );
  }
  if (summary.skipped > 0) {
    sentences.push(
      `${plural(summary.skipped, "question")} that ${
        summary.skipped === 1 ? "is" : "are"
      } not approved yet ${summary.skipped === 1 ? "was" : "were"} left out.`,
    );
  }

  const [title = `Saved for ${section}.`, ...rest] = sentences;
  return { title, description: rest.length > 0 ? rest.join(" ") : undefined };
}

function TopicsBuilderContent({ courseId }: { courseId: string }) {
  const { state, dispatch, hydrated } = useCoursesStore();
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
  const sectionText = activeSection ? sectionLabelText(activeSection) : "";

  const groups = useMemo(
    () => (sectionId ? buildBuilderGroups(state, sectionId) : []),
    [state, sectionId],
  );

  /**
   * Every question the section already has a row for — shown or paused. That
   * is exactly what `previewReleaseChanges` treats as removable, so the two
   * panes and the review dialog cannot disagree about what Remove means.
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
    restore: restoreStaged,
    toggle: toggleStaged,
  } = staged;

  const [review, setReview] = useState<ReviewTarget | null>(null);
  // The count is kept with the request so the dialog's wording does not
  // change underneath it while it closes.
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const [leftOpen, setLeftOpen] = useState<ReadonlySet<TopicId> | null>(null);
  const [bankOpen, setBankOpen] = useState<ReadonlySet<TopicId> | null>(null);

  // Undo on a toast outlives the render that created it; it must only put
  // changes back into the section they were made for.
  const sectionIdRef = useRef(sectionId);
  useEffect(() => {
    sectionIdRef.current = sectionId;
  }, [sectionId]);

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

  // Switching sections leaves nothing behind: waiting changes are per section.
  useEffect(() => {
    clearStaged();
  }, [sectionId, clearStaged]);

  /**
   * Never lose waiting changes silently. While any exist, closing the tab
   * asks the browser's own question, and every in-app link on the page (the
   * breadcrumbs, the rail, the header's course menu, the phone back bar,
   * "Add a question to this topic") asks ours first. One capturing listener
   * covers links this file does not render.
   */
  useEffect(() => {
    if (stagedCount === 0) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers need a returnValue to show the prompt.
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) {
        return;
      }
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) {
        // Leaving the site: the beforeunload prompt covers it.
        return;
      }
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPendingLeave({
        kind: "href",
        href: `${url.pathname}${url.search}${url.hash}`,
        count: stagedCount,
      });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [stagedCount]);

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

  /** Waiting changes belong to one section, so leaving it asks first. */
  const requestSectionChange = (nextSectionId: string) => {
    if (!activeSection || nextSectionId === activeSection.id) {
      return;
    }
    if (stagedCount > 0) {
      setPendingLeave({
        kind: "section",
        sectionId: nextSectionId,
        count: stagedCount,
      });
      return;
    }
    switchSection(nextSectionId);
  };

  const leaveWithoutSaving = () => {
    if (!pendingLeave) {
      return;
    }
    if (pendingLeave.kind === "section") {
      switchSection(pendingLeave.sectionId);
      return;
    }
    clearStaged();
    router.push(pendingLeave.href);
  };

  const discardAll = () => {
    const snapshot = staged.staged;
    const count = stagedCount;
    const forSectionId = sectionId;
    clearStaged();
    toast({
      title: `Discarded ${plural(count, "change")} for ${sectionText}.`,
      description: "Students were not affected.",
      action: {
        label: "Undo",
        onClick: () => {
          if (sectionIdRef.current === forSectionId) {
            restoreStaged(snapshot);
          }
        },
      },
      duration: UNDO_TOAST_MS,
    });
  };

  const undoApplied = (summary: AppliedSummary) => {
    const section = sectionLabelText(summary.sectionLabel);
    dispatch({
      type: "section/applyReleaseChanges",
      sectionId: summary.sectionId,
      changes: summary.applied.map((change) =>
        change.kind === "add"
          ? { kind: "remove", questionId: change.questionId }
          : { kind: "add", questionId: change.questionId },
      ),
      now: SEED_NOW,
    });
    for (const [questionId, delivery] of Object.entries(
      summary.previousDelivery,
    )) {
      dispatch({
        type: "section/updateDelivery",
        sectionId: summary.sectionId,
        questionId,
        patch: delivery,
      });
    }
    for (const week of summary.weeks) {
      if (week.openedNow) {
        dispatch({
          type: "section/setTopicState",
          sectionId: summary.sectionId,
          topicId: week.topicId,
          state: week.previousState,
          opensAt: week.previousOpensAt,
        });
      }
    }
    toast({
      title: `Undone. ${section} sees what it saw before.`,
      description:
        summary.removed > 0
          ? "Questions you had hidden are back, at the end of their week."
          : undefined,
      tone: "success",
    });
  };

  const handleApplied = (summary: AppliedSummary) => {
    const message = appliedMessage(summary);
    toast({
      title: message.title,
      description: message.description,
      tone: "success",
      action: { label: "Undo", onClick: () => undoApplied(summary) },
      duration: UNDO_TOAST_MS,
    });
    if (summary.sectionId === sectionId && review?.kind !== "copy") {
      clearStaged();
    }
    setReview(null);
  };

  const breadcrumbs = buildBreadcrumbs(courseId, course);

  if (!course) {
    if (!hydrated) {
      return (
        <CourseScreenSkeleton
          breadcrumbs={breadcrumbs}
          description={DESCRIPTION}
          shape="builder"
          title={CHOOSE_QUESTIONS_TITLE}
        />
      );
    }
    return (
      <ProfessorPageShell
        breadcrumbs={breadcrumbs}
        description={DESCRIPTION}
        title={CHOOSE_QUESTIONS_TITLE}
      >
        <CourseNotFound what="course" />
      </ProfessorPageShell>
    );
  }

  if (!activeSection) {
    return (
      <ProfessorPageShell
        breadcrumbs={breadcrumbs}
        description={DESCRIPTION}
        title={CHOOSE_QUESTIONS_TITLE}
      >
        <EmptyState
          action={
            <Button asChild className="min-h-11" variant="secondary">
              <Link href={coursePath(courseId)}>Go to the course page</Link>
            </Button>
          }
        >
          This course has no sections yet. Add a section on the course page
          first; then choose its questions here.
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
  // A staged review with nothing left in it closes itself. A copy still opens
  // when it is empty — "the two sections already match" is an answer the
  // professor asked for.
  const reviewOpen =
    review !== null && (review.kind === "copy" || stagedCount > 0);
  const pendingSection =
    pendingLeave?.kind === "section"
      ? sections.find((section) => section.id === pendingLeave.sectionId)
      : undefined;
  const pendingCount = pendingLeave?.count ?? stagedCount;
  const breakdown = stagedBreakdown(staged.addCount, staged.removeCount);

  return (
    <ProfessorPageShell
      breadcrumbs={breadcrumbs}
      description={DESCRIPTION}
      title={CHOOSE_QUESTIONS_TITLE}
    >
      <p className="type-body max-w-prose rounded-panel bg-surface-tint px-4 py-3 text-ink">
        Adding or removing questions waits for your review. Opening a week and
        delivery settings change right away.
      </p>

      <Tabs
        activationMode="manual"
        onValueChange={requestSectionChange}
        value={activeSection.id}
      >
        <TabsList aria-label="Section">
          {sections.map((section) => (
            <TabsTrigger className="min-h-11" key={section.id} value={section.id}>
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
              sectionLabel={sectionText}
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
              sectionLabel={sectionText}
              staged={staged}
            />
          </div>

          {/* One live region that outlives the bar, so the first waiting
              change is announced as well as the later ones. */}
          <p className="sr-only" role="status">
            {stagedCount > 0
              ? `Not saved yet: ${plural(stagedCount, "change")} for ${sectionText} (${breakdown}).`
              : ""}
          </p>
          {stagedCount > 0 ? (
            <div
              aria-label="Changes not saved yet"
              className="sticky bottom-3 z-20 flex flex-wrap items-center justify-between gap-3 rounded-panel bg-azure-100 px-4 py-3"
              role="region"
            >
              <p className="type-body-strong text-ink">
                Not saved yet: {plural(stagedCount, "change")} for{" "}
                {sectionText} ({breakdown})
              </p>
              <div className="flex flex-wrap items-center gap-6">
                <Button
                  className="min-h-11"
                  onClick={discardAll}
                  type="button"
                  variant="outline"
                >
                  Discard all {plural(stagedCount, "change")}
                </Button>
                <Button
                  className="min-h-11"
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
        open={reviewOpen}
        otherSectionLabels={sections
          .filter((section) => section.id !== reviewSection.id)
          .map((section) => section.label)}
        sectionId={reviewSection.id}
        sectionLabel={reviewSection.label}
        sourceSectionLabel={
          review?.kind === "copy" ? activeSection.label : undefined
        }
      />

      <ConfirmDialog
        cancelLabel="Keep editing"
        confirmLabel={
          pendingSection
            ? `Open ${sectionLabelText(pendingSection)} without saving`
            : "Leave without saving"
        }
        description={`You have ${plural(pendingCount, "change")} for ${sectionText} that ${
          pendingCount === 1 ? "is" : "are"
        } not saved yet. Students will not see ${pendingCount === 1 ? "it" : "them"}.`}
        destructive
        onConfirm={leaveWithoutSaving}
        onOpenChange={(open) => {
          if (!open) {
            setPendingLeave(null);
          }
        }}
        open={pendingLeave !== null}
        title="Leave without saving?"
      />
    </ProfessorPageShell>
  );
}
