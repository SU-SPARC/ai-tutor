/**
 * Automatic release for a professor who runs one classroom.
 *
 * Publishing and releasing are separate gates (see the reducer): a published
 * question reaches the students of a section only once it is released there
 * and its week is open. A professor with exactly one active section has
 * nobody else to choose for, so the server releases what they publish to that
 * section by default, exactly as the builder's "Review N changes" would:
 * pinned to the published version, default delivery settings, appended at the
 * end of its week, and the week opened if it was closed.
 *
 * What it leaves alone: a professor with no active section or with several
 * (they keep choosing by hand); a question whose topic the course excludes; a
 * question the professor already placed in the section, released or held; a
 * week that is already open or scheduled (its opening time stands); and the
 * pin of a question that gets a newer published version (the section keeps
 * its version until the professor moves it).
 */

import type { CoursesAction } from "@/lib/courses/reducer";
import type {
  CourseSection,
  CoursesState,
  QuestionId,
  SectionId,
  TopicId,
} from "@/lib/courses/types";

export type AutoReleasePlan = {
  courseId: string;
  sectionId: SectionId;
  /** Closed (or missing) weeks the release opens, in course order. */
  openTopics: TopicId[];
  /** Questions to release, in the order they were published. */
  questionIds: QuestionId[];
};

/** The professor's single active section, or undefined with none or several. */
export function onlyActiveSection(
  state: CoursesState,
): CourseSection | undefined {
  const activeCourses = new Set(
    state.courses
      .filter((course) => course.status === "active")
      .map((course) => course.id),
  );
  const sections = state.sections.filter(
    (section) =>
      section.status === "active" && activeCourses.has(section.courseId),
  );
  return sections.length === 1 ? sections[0] : undefined;
}

/**
 * What releasing `questionIds` to the only section would do, or undefined
 * when there is no such section or nothing among them to release.
 */
export function planAutoRelease(
  state: CoursesState,
  questionIds: readonly QuestionId[],
): AutoReleasePlan | undefined {
  const section = onlyActiveSection(state);
  if (!section) {
    return undefined;
  }

  const topicPosition = new Map(
    state.courseTopics
      .filter((row) => row.courseId === section.courseId && row.included)
      .map((row) => [row.topicId, row.position]),
  );
  const placed = new Set(
    state.questionAvailability
      .filter((row) => row.sectionId === section.id)
      .map((row) => row.questionId),
  );

  const release: QuestionId[] = [];
  const topics = new Set<TopicId>();
  for (const questionId of questionIds) {
    if (release.includes(questionId) || placed.has(questionId)) {
      continue;
    }
    const question = state.bank.find(
      (candidate) => candidate.id === questionId,
    );
    if (
      !question ||
      question.state !== "published" ||
      question.publishedVersion === null ||
      !topicPosition.has(question.topicId)
    ) {
      continue;
    }
    release.push(questionId);
    topics.add(question.topicId);
  }
  if (release.length === 0) {
    return undefined;
  }

  const openTopics = [...topics]
    .filter((topicId) => {
      const row = state.topicAvailability.find(
        (candidate) =>
          candidate.sectionId === section.id && candidate.topicId === topicId,
      );
      return !row || row.state === "closed";
    })
    .sort(
      (left, right) =>
        (topicPosition.get(left) ?? 0) - (topicPosition.get(right) ?? 0),
    );

  return {
    courseId: section.courseId,
    sectionId: section.id,
    openTopics,
    questionIds: release,
  };
}

/** The builder actions that carry out a plan: open the weeks, then release. */
export function autoReleaseActions(
  plan: AutoReleasePlan,
  now: string,
): CoursesAction[] {
  return [
    ...plan.openTopics.map(
      (topicId): CoursesAction => ({
        type: "section/setTopicState",
        sectionId: plan.sectionId,
        topicId,
        state: "open",
        opensAt: null,
      }),
    ),
    {
      type: "section/applyReleaseChanges",
      sectionId: plan.sectionId,
      changes: plan.questionIds.map((questionId) => ({
        kind: "add" as const,
        questionId,
      })),
      now,
    },
  ];
}
