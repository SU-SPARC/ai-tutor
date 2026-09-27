"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useMemo, useState } from "react";
import { CircleCheck, Info } from "lucide-react";

import { AddQuestionMenu } from "@/components/courses/add-question-menu";
import { CourseNotFound } from "@/components/courses/course-not-found";
import { CourseScreenSkeleton } from "@/components/courses/course-screen-skeleton";
import { plural } from "@/components/courses/course-status";
import { useCoursesStore } from "@/components/courses/courses-store";
import { QuestionPreviewDrawer } from "@/components/courses/question-preview-drawer";
import {
  TopicQuestionTable,
  type QuestionRow,
} from "@/components/courses/topic-question-table";
import {
  WriteQuestionForm,
  type WrittenQuestionDraft,
} from "@/components/courses/write-question-form";
import { ProfessorPageShell } from "@/components/professor/professor-page-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SEED_NOW } from "@/lib/courses/demo-seed";
import { topicShortLabel } from "@/lib/courses/format";
import {
  coursePath,
  courseTopicsPath,
  coursesIndexPath,
} from "@/lib/courses/paths";
import {
  bankQuestionsForTopic,
  getCourse,
  listSections,
  questionReleaseMap,
  questionReleasedSections,
} from "@/lib/courses/selectors";
import type {
  BankQuestion,
  CoursesState,
  QuestionLifecycleState,
} from "@/lib/courses/types";

type FilterKey = "all" | QuestionLifecycleState;

const FILTER_ORDER: FilterKey[] = [
  "all",
  "published",
  "approved",
  "needs_review",
  "draft",
  "unpublished",
];

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "All",
  published: "Published",
  approved: "Approved",
  needs_review: "Needs review",
  draft: "Draft",
  unpublished: "Unpublished",
};

/**
 * Local helper: `bank/addDraft` needs an id, and no shared action or selector
 * mints one. Ids reach `/professor/questions/[qid]`, so the slug is restricted
 * to the characters `isProfessorQuestionId` accepts.
 */
function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Local helper: first `${topicId}-${slug}-${n}` that no bank question uses. */
function uniqueDraftId(state: CoursesState, topicId: string, title: string) {
  const slug = slugify(title) || "question";
  const taken = new Set(state.bank.map((question) => question.id));
  let index = 1;
  let candidate = `${topicId}-${slug}-${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${topicId}-${slug}-${index}`;
  }
  return candidate;
}

export function TopicDetailScreen(props: {
  courseId: string;
  topicId: string;
}) {
  // `?question=` drives the drawer and the row highlight, so the screen that
  // reads it is suspended per Next's search-param rule.
  return (
    <Suspense fallback={<TopicDetailFallback {...props} />}>
      <TopicDetailScreenInner {...props} />
    </Suspense>
  );
}

/** The header block from the seed, so it does not change when the table arrives. */
function TopicDetailFallback({
  courseId,
  topicId,
}: {
  courseId: string;
  topicId: string;
}) {
  const { state } = useCoursesStore();
  const course = getCourse(state, courseId);
  const topic = state.topics.find((candidate) => candidate.id === topicId);
  const overlay = state.courseTopics.find(
    (row) => row.courseId === courseId && row.topicId === topicId,
  );
  return (
    <CourseScreenSkeleton
      breadcrumbs={[
        { href: coursesIndexPath(), label: "Courses" },
        {
          href: coursePath(courseId),
          label: course ? `${course.code} ${course.term}` : "Course",
        },
        { href: courseTopicsPath(courseId), label: "Topic builder" },
        {
          label: topic
            ? (overlay?.displayLabel ?? topicShortLabel(topic))
            : "Topic",
        },
      ]}
      description="Loading this topic's questions."
      shape="topic"
      title={topic ? topic.title : "Topic"}
    />
  );
}

function TopicDetailScreenInner({
  courseId,
  topicId,
}: {
  courseId: string;
  topicId: string;
}) {
  const { state, dispatch, hydrated } = useCoursesStore();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedQuestionId = searchParams.get("question");

  const [filter, setFilter] = useState<FilterKey>("all");
  const [writing, setWriting] = useState(false);
  const [savedDraftTitle, setSavedDraftTitle] = useState<string | null>(null);
  const [publishedNotes, setPublishedNotes] = useState<Record<string, number>>(
    {},
  );

  const course = getCourse(state, courseId);
  const topic = state.topics.find((candidate) => candidate.id === topicId);
  const overlay = state.courseTopics.find(
    (row) => row.courseId === courseId && row.topicId === topicId,
  );

  const questions = useMemo(
    () => (topic ? bankQuestionsForTopic(state, topicId) : []),
    [state, topic, topicId],
  );

  const courseSectionIds = useMemo(
    () => new Set(listSections(state, courseId).map((section) => section.id)),
    [state, courseId],
  );

  const rows: QuestionRow[] = useMemo(
    () =>
      questions.map((question) => ({
        question,
        releasedTo: questionReleasedSections(state, question.id)
          .filter((entry) => courseSectionIds.has(entry.section.id))
          .map((entry) => entry.section.label),
      })),
    [questions, state, courseSectionIds],
  );

  const counts = useMemo(() => {
    const tally: Record<FilterKey, number> = {
      all: questions.length,
      published: 0,
      approved: 0,
      needs_review: 0,
      draft: 0,
      unpublished: 0,
    };
    for (const question of questions) {
      tally[question.state] += 1;
    }
    return tally;
  }, [questions]);

  const visibleRows = useMemo(
    () =>
      filter === "all"
        ? rows
        : rows.filter((row) => row.question.state === filter),
    [rows, filter],
  );

  const selectedQuestion: BankQuestion | undefined = useMemo(
    () =>
      selectedQuestionId
        ? questions.find((question) => question.id === selectedQuestionId)
        : undefined,
    [questions, selectedQuestionId],
  );

  const selectedCourseGroup = useMemo(
    () =>
      selectedQuestion
        ? questionReleaseMap(state, selectedQuestion.id).find(
            (group) => group.course.id === courseId,
          )
        : undefined,
    [selectedQuestion, state, courseId],
  );

  const setSelectedQuestion = useCallback(
    (questionId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (questionId) {
        params.set("question", questionId);
      } else {
        params.delete("question");
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const handlePreview = useCallback(
    (questionId: string) => setSelectedQuestion(questionId),
    [setSelectedQuestion],
  );

  const handleClose = useCallback(
    () => setSelectedQuestion(null),
    [setSelectedQuestion],
  );

  const handlePublish = useCallback(
    (questionId: string) => {
      const question = state.bank.find(
        (candidate) => candidate.id === questionId,
      );
      if (!question) {
        return;
      }
      dispatch({ type: "bank/publish", questionId, now: SEED_NOW });
      setPublishedNotes((current) => ({
        ...current,
        [questionId]: question.latestVersion,
      }));
    },
    [dispatch, state.bank],
  );

  const handleWrite = useCallback(
    (draft: WrittenQuestionDraft) => {
      const id = uniqueDraftId(state, topicId, draft.title);
      dispatch({
        type: "bank/addDraft",
        question: { ...draft, id, topicId },
        now: SEED_NOW,
      });
      setWriting(false);
      setSavedDraftTitle(draft.title);
      setFilter("all");
      setSelectedQuestion(id);
    },
    [dispatch, state, topicId, setSelectedQuestion],
  );

  const courseLabel = course ? `${course.code} ${course.term}` : "Course";
  const shortLabel = topic
    ? (overlay?.displayLabel ?? topicShortLabel(topic))
    : "Topic";

  const breadcrumbs = [
    { href: coursesIndexPath(), label: "Courses" },
    { href: coursePath(courseId), label: courseLabel },
    { href: courseTopicsPath(courseId), label: "Topic builder" },
    { label: shortLabel },
  ];

  if ((!course || !topic) && !hydrated) {
    // A course created in this browser is not in the seed the server
    // rendered; wait for the saved demo before calling it missing.
    return (
      <CourseScreenSkeleton
        breadcrumbs={breadcrumbs}
        description="Loading this topic's questions."
        shape="topic"
        title="Topic"
      />
    );
  }

  if (!course || !topic) {
    return (
      <ProfessorPageShell
        breadcrumbs={breadcrumbs}
        description="Nothing was changed. Pick a topic from the course you are working in."
        title={!course ? "Course not found" : "Topic not found"}
      >
        <CourseNotFound what={!course ? "course" : "topic"} />
      </ProfessorPageShell>
    );
  }

  const releasedSectionCount = new Set(rows.flatMap((row) => row.releasedTo))
    .size;
  const excluded = overlay ? !overlay.included : true;

  const description = `Week ${topic.weekNumber} · ${plural(
    questions.length,
    "question",
  )} in the bank · released to ${plural(releasedSectionCount, "section")}.`;

  // "Unpublished" only appears when something is, or while it is selected.
  const visibleFilters = FILTER_ORDER.filter(
    (key) =>
      key !== "unpublished" || counts.unpublished > 0 || filter === key,
  );

  return (
    <ProfessorPageShell
      aside={<AddQuestionMenu onWriteItMyself={() => setWriting(true)} />}
      breadcrumbs={breadcrumbs}
      description={description}
      title={topic.title}
    >
      {excluded ? (
        <Alert role="note" variant="info">
          <Info aria-hidden="true" />
          <AlertTitle>Not in {course.code} · {course.term}&rsquo;s syllabus</AlertTitle>
          <AlertDescription>
            <p className="type-small max-w-prose text-ink-muted">
              Questions here cannot be released to this course&rsquo;s sections
              until the topic is included.{" "}
              <Link
                className="rounded-xs text-azure-500 underline underline-offset-2 hover:text-azure-700 focus-ring"
                href={coursePath(courseId)}
              >
                Edit the syllabus on the course overview
              </Link>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {savedDraftTitle ? (
        <Alert variant="success">
          <CircleCheck aria-hidden="true" />
          <AlertTitle>&ldquo;{savedDraftTitle}&rdquo; saved to the review queue</AlertTitle>
          <AlertDescription>
            <p className="type-small max-w-prose text-ink-muted">
              It is marked Needs review. Approve it, publish it, then release it
              to a section.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {writing ? (
        <WriteQuestionForm
          onCancel={() => setWriting(false)}
          onSubmit={handleWrite}
        />
      ) : null}

      <Tabs
        className="gap-3"
        onValueChange={(value) => setFilter(value as FilterKey)}
        value={filter}
      >
        <TabsList
          aria-label="Filter questions by state"
          className="max-w-full overflow-x-auto"
          variant="segmented"
        >
          {visibleFilters.map((key) => (
            <TabsTrigger count={counts[key]} key={key} value={key}>
              {FILTER_LABELS[key]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={filter}>
          <TopicQuestionTable
            caption={`${FILTER_LABELS[filter]} questions in ${topic.title}`}
            onPreview={handlePreview}
            onPublish={handlePublish}
            publishedNotes={publishedNotes}
            rows={visibleRows}
            selectedQuestionId={selectedQuestionId}
            topicId={topicId}
          />
        </TabsContent>
      </Tabs>

      {selectedQuestion ? (
        <QuestionPreviewDrawer
          courseGroup={selectedCourseGroup}
          onClose={handleClose}
          onPreview={handlePreview}
          onPublish={handlePublish}
          publishedNote={publishedNotes[selectedQuestion.id]}
          question={selectedQuestion}
          topicId={topicId}
        />
      ) : null}
    </ProfessorPageShell>
  );
}
