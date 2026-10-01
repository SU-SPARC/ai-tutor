import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { requireStudent } from "@/lib/auth/authorization";
import {
  COURSE_SELECTION_COOKIE,
  DEFAULT_PLATFORM_COURSES,
  isCourseIdShape,
  resolveCourseId,
} from "@/lib/course-catalog";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import { demoContentRepository } from "@/lib/data/demo-repository";
import type { ContentRepository, CourseScope } from "@/lib/data/repository";
import { getStudentProgress } from "@/lib/data/student-progress";
import {
  createTutorSession,
  recordTutorSessionAttemptOutcome,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository";
import type { Topic, TutorQuestion } from "@/lib/types";
import {
  authorizationForStudentOwner,
  mockPrincipal,
  resetAuthMocks,
  TEST_STUDENT,
} from "./auth-test-helpers";

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  cookiesSet: [] as Array<{
    name: string;
    options: Record<string, unknown>;
    value: string;
  }>,
  practiceProps: undefined as Record<string, unknown> | undefined,
  redirect: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "ai-tutor-course" && mocks.cookieValue !== undefined
        ? { name, value: mocks.cookieValue }
        : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      mocks.cookiesSet.push({ name, options, value });
      mocks.cookieValue = value;
    },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: () => undefined }),
}));

vi.mock("@/components/tutor/practice-workspace", async () => {
  const { createElement: element } = await import("react");
  return {
    PracticeWorkspace: (props: Record<string, unknown>) => {
      mocks.practiceProps = props;
      return element("div", { "data-practice-workspace": true });
    },
  };
});

import { selectCourseAction, syncSelectedCourseAction } from "@/app/courses/actions";
import CoursesPage from "@/app/courses/page";
import LearnPage from "@/app/learn/page";
import PracticePage from "@/app/practice/page";
import PracticeQuestionPage from "@/app/practice/[questionId]/page";
import { CourseSelectionSync } from "@/components/course/course-selection-sync";
import { getSelectedCourse } from "@/lib/course-selection";

const PS_COURSE = "probability-statistics";
const CALCULUS_COURSE = "calculus-1";
const PS_QUESTION = "dice-sum-eight";
// Test-only Calculus I fixtures. They exist only in this file's repository to
// prove isolation; they are not course content.
const CALC_TOPIC: Topic = {
  active: true,
  courseId: CALCULUS_COURSE,
  description: "Isolation test fixture.",
  id: "test-only-calculus-topic",
  moduleRef: "Test",
  order: 1,
  title: "Test-only Calculus topic",
  weekNumber: 1,
};

class RedirectSignal extends Error {
  constructor(readonly destination: string) {
    super(`Redirected to ${destination}`);
  }
}

/** The demo repository plus one Calculus I topic and question. */
async function twoCourseRepository(): Promise<ContentRepository> {
  const probabilityQuestion = (await demoContentRepository.getQuestionById(
    PS_QUESTION,
  ))!;
  const testQuestion: TutorQuestion = {
    ...probabilityQuestion,
    id: "test-only-calculus-question",
    prompt: "Isolation test prompt.",
    title: "Test-only Calculus question",
    topicId: CALC_TOPIC.id,
  };
  const courseOf = (topicId: string, topics: Topic[]) =>
    topics.find((topic) => topic.id === topicId)?.courseId;

  const repository: ContentRepository = {
    ...demoContentRepository,
    async getQuestionById(questionId) {
      return questionId === testQuestion.id
        ? testQuestion
        : demoContentRepository.getQuestionById(questionId);
    },
    async getApprovedQuestionById(questionId) {
      return repository.getQuestionById(questionId);
    },
    async listQuestions(scope?: CourseScope) {
      const topics = await repository.listTopics();
      return [
        ...(await demoContentRepository.listQuestions()),
        testQuestion,
      ].filter(
        (question) =>
          !scope?.courseId ||
          courseOf(question.topicId, topics) === scope.courseId,
      );
    },
    async getApprovedQuestions(scope?: CourseScope) {
      return repository.listQuestions(scope);
    },
    async listQuestionsByTopic(topicId) {
      return (await repository.listQuestions()).filter(
        (question) => question.topicId === topicId,
      );
    },
    async listTopics(scope?: CourseScope) {
      const topics = [...(await demoContentRepository.listTopics()), CALC_TOPIC];
      return scope?.courseId
        ? topics.filter((topic) => topic.courseId === scope.courseId)
        : topics;
    },
    async getTopics(scope?: CourseScope) {
      return repository.listTopics(scope);
    },
  };
  return repository;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookieValue = undefined;
  mocks.cookiesSet.length = 0;
  mocks.practiceProps = undefined;
  mocks.redirect.mockImplementation((destination: string) => {
    throw new RedirectSignal(destination);
  });
  resetTutorSessionsForTests();
  mockPrincipal(TEST_STUDENT);
  vi.stubEnv("APP_DEMO_MODE", "true");
  vi.stubEnv("ANONYMOUS_PILOT_ENABLED", "true");
});

afterEach(() => {
  setContentRepositoryForTests(undefined);
  vi.unstubAllEnvs();
  resetAuthMocks();
});

describe("course catalog", () => {
  it("defaults to Probability & Statistics and ignores unknown or inactive courses", () => {
    const courses = [...DEFAULT_PLATFORM_COURSES];

    expect(resolveCourseId(undefined, courses)).toBe(PS_COURSE);
    expect(resolveCourseId(null, courses)).toBe(PS_COURSE);
    expect(resolveCourseId(CALCULUS_COURSE, courses)).toBe(CALCULUS_COURSE);
    expect(resolveCourseId("no-such-course", courses)).toBe(PS_COURSE);
    expect(
      resolveCourseId(
        CALCULUS_COURSE,
        courses.map((course) =>
          course.id === CALCULUS_COURSE ? { ...course, active: false } : course,
        ),
      ),
    ).toBe(PS_COURSE);
  });

  it("accepts only lowercase slug course ids", () => {
    expect(isCourseIdShape("calculus-1")).toBe(true);
    expect(isCourseIdShape("Calculus 1")).toBe(false);
    expect(isCourseIdShape("../etc")).toBe(false);
    expect(isCourseIdShape("a".repeat(65))).toBe(false);
    expect(isCourseIdShape(undefined)).toBe(false);
  });
});

describe("remembering the selected course", () => {
  it("shows Probability & Statistics when nothing has been chosen", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const { course } = await getSelectedCourse();
    expect(course.id).toBe(PS_COURSE);
  });

  it("follows a stored choice and falls back from a stale or malformed cookie", async () => {
    setContentRepositoryForTests(await twoCourseRepository());

    mocks.cookieValue = CALCULUS_COURSE;
    expect((await getSelectedCourse()).course.id).toBe(CALCULUS_COURSE);

    mocks.cookieValue = "retired-course";
    expect((await getSelectedCourse()).course.id).toBe(PS_COURSE);

    mocks.cookieValue = "Not A Course!";
    expect((await getSelectedCourse()).course.id).toBe(PS_COURSE);
  });

  it("stores a valid choice as a server-readable cookie and returns where the student was", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const form = new FormData();
    form.set("courseId", CALCULUS_COURSE);
    form.set("returnTo", "/practice");

    await expect(selectCourseAction(form)).rejects.toMatchObject({
      destination: "/practice",
    });

    expect(mocks.cookiesSet).toHaveLength(1);
    expect(mocks.cookiesSet[0]).toMatchObject({
      name: COURSE_SELECTION_COOKIE,
      options: { httpOnly: true, path: "/", sameSite: "lax" },
      value: CALCULUS_COURSE,
    });
    expect((await getSelectedCourse()).course.id).toBe(CALCULUS_COURSE);
  });

  it("refuses an unknown course and never redirects off-site", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const unknown = new FormData();
    unknown.set("courseId", "no-such-course");
    await expect(selectCourseAction(unknown)).rejects.toMatchObject({
      destination: "/courses",
    });
    expect(mocks.cookiesSet).toEqual([]);

    const offSite = new FormData();
    offSite.set("courseId", PS_COURSE);
    offSite.set("returnTo", "//evil.example/steal");
    await expect(selectCourseAction(offSite)).rejects.toMatchObject({
      destination: "/learn",
    });
  });

  it("keeps the remembered course in step with a direct link without navigating", async () => {
    setContentRepositoryForTests(await twoCourseRepository());

    await syncSelectedCourseAction(CALCULUS_COURSE);
    await syncSelectedCourseAction("no-such-course");

    expect(mocks.cookiesSet.map((entry) => entry.value)).toEqual([
      CALCULUS_COURSE,
    ]);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("lists both courses, marks the current one, and says Calculus I is not set up yet", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const page = await CoursesPage({ searchParams: Promise.resolve({}) });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Probability &amp; Statistics");
    expect(markup).toContain("Calculus I");
    expect(markup).toContain("Current course");
    expect(markup).toContain("Choose");
    expect(markup).toContain("11 topics");
  });
});

describe("the learning pages follow the selected course", () => {
  it("shows the Probability & Statistics syllabus by default", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const markup = renderToStaticMarkup(await LearnPage());

    expect(markup).toContain("Introduction to Probability and Venn Diagrams");
    expect(markup).not.toContain("Test-only Calculus topic");
    expect(markup).toContain("Probability &amp; Statistics");
  });

  it("shows only Calculus I topics, or a not-yet-configured note, once selected", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    mocks.cookieValue = CALCULUS_COURSE;
    const withTopic = renderToStaticMarkup(await LearnPage());

    expect(withTopic).toContain("Test-only Calculus topic");
    expect(withTopic).not.toContain("Introduction to Probability");

    // Calculus I with nothing loaded yet is a legitimate, explained state.
    setContentRepositoryForTests({
      ...(await twoCourseRepository()),
      async listTopics(scope?: CourseScope) {
        const topics = await demoContentRepository.listTopics();
        return scope?.courseId
          ? topics.filter((topic) => topic.courseId === scope.courseId)
          : topics;
      },
      async getTopics(scope?: CourseScope) {
        return this.listTopics(scope);
      },
      async listQuestions(scope?: CourseScope) {
        return demoContentRepository.listQuestions(scope);
      },
      async getApprovedQuestions(scope?: CourseScope) {
        return demoContentRepository.listQuestions(scope);
      },
    });
    const empty = renderToStaticMarkup(await LearnPage());
    expect(empty).toContain("Calculus I content has not been added yet.");
    expect(empty).not.toContain("Introduction to Probability");
  });

  it("scopes the practice rail to the selected course", async () => {
    setContentRepositoryForTests(await twoCourseRepository());

    mocks.cookieValue = CALCULUS_COURSE;
    renderToStaticMarkup(
      await PracticePage({ searchParams: Promise.resolve({}) }),
    );
    const calculusTopics = mocks.practiceProps?.topics as Topic[];
    expect(calculusTopics.map((topic) => topic.id)).toEqual([CALC_TOPIC.id]);

    mocks.cookieValue = undefined;
    renderToStaticMarkup(
      await PracticePage({ searchParams: Promise.resolve({}) }),
    );
    const probabilityTopics = mocks.practiceProps?.topics as Topic[];
    expect(probabilityTopics).toHaveLength(11);
    expect(probabilityTopics.map((topic) => topic.id)).not.toContain(
      CALC_TOPIC.id,
    );
  });

  it("opens a direct question link in that question's own course", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    // The remembered course is Calculus I, but the link is a Probability &
    // Statistics question: the question decides.
    mocks.cookieValue = CALCULUS_COURSE;

    const element = (await PracticeQuestionPage({
      params: Promise.resolve({ questionId: PS_QUESTION }),
    })) as ReactElement<{ children: ReactElement[] }>;
    expect(isValidElement(element)).toBe(true);
    const [sync] = element.props.children as ReactElement<{
      courseId: string;
    }>[];

    expect(sync.type).toBe(CourseSelectionSync);
    expect(sync.props.courseId).toBe(PS_COURSE);
    renderToStaticMarkup(element);
    expect(mocks.practiceProps?.initialQuestionId).toBe(PS_QUESTION);
    const topics = mocks.practiceProps?.topics as Topic[];
    expect(topics.every((topic) => topic.courseId === PS_COURSE)).toBe(true);
  });

  it("does not ask to change the remembered course when the link already matches it", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const element = (await PracticeQuestionPage({
      params: Promise.resolve({ questionId: PS_QUESTION }),
    })) as ReactElement<{ children: unknown[] }>;

    expect(element.props.children[0]).toBeFalsy();
  });

  it("resolves a Calculus I question link to Calculus I", async () => {
    setContentRepositoryForTests(await twoCourseRepository());

    const element = (await PracticeQuestionPage({
      params: Promise.resolve({ questionId: "test-only-calculus-question" }),
    })) as ReactElement<{ children: ReactElement[] }>;
    const [sync] = element.props.children as ReactElement<{
      courseId: string;
    }>[];

    expect(sync.props.courseId).toBe(CALCULUS_COURSE);
    renderToStaticMarkup(element);
    expect(
      (mocks.practiceProps?.topics as Topic[]).map((topic) => topic.id),
    ).toEqual([CALC_TOPIC.id]);
  });
});

describe("progress stays with its course", () => {
  it("does not let Probability & Statistics work appear as Calculus I progress", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const authorization = authorizationForStudentOwner({
      kind: "user",
      userId: TEST_STUDENT.userId,
    });
    const session = await createTutorSession(authorization, PS_QUESTION);
    await recordTutorSessionAttemptOutcome(authorization, {
      estimatedTokens: 0,
      sessionId: session.id,
      source: "rule",
      verdict: "correct",
    });
    const student = await requireStudent();

    const probability = await getStudentProgress(student, {
      courseId: PS_COURSE,
    });
    const calculus = await getStudentProgress(student, {
      courseId: CALCULUS_COURSE,
    });
    const everything = await getStudentProgress(student);

    expect(probability.summary.completedQuestions).toBe(1);
    expect(probability.summary.topicsStarted).toBe(1);
    expect(calculus.summary).toMatchObject({
      completedQuestions: 0,
      inProgressQuestions: 0,
      topicsStarted: 0,
    });
    expect(calculus.questions).toEqual([]);
    expect(calculus.recentSessions).toEqual([]);
    expect(calculus.topics.map((topic) => topic.id)).toEqual([CALC_TOPIC.id]);
    expect(everything.summary.completedQuestions).toBe(1);
  });

  it("keeps each course's progress after switching back and forth", async () => {
    setContentRepositoryForTests(await twoCourseRepository());
    const authorization = authorizationForStudentOwner({
      kind: "user",
      userId: TEST_STUDENT.userId,
    });
    for (const questionId of [PS_QUESTION, "test-only-calculus-question"]) {
      const session = await createTutorSession(authorization, questionId);
      await recordTutorSessionAttemptOutcome(authorization, {
        estimatedTokens: 0,
        sessionId: session.id,
        source: "rule",
        verdict: "correct",
      });
    }
    const student = await requireStudent();

    const probabilityFirst = await getStudentProgress(student, {
      courseId: PS_COURSE,
    });
    const calculus = await getStudentProgress(student, {
      courseId: CALCULUS_COURSE,
    });
    const probabilityAgain = await getStudentProgress(student, {
      courseId: PS_COURSE,
    });

    expect(probabilityFirst.questions.map((q) => q.questionId)).toEqual([
      PS_QUESTION,
    ]);
    expect(calculus.questions.map((q) => q.questionId)).toEqual([
      "test-only-calculus-question",
    ]);
    expect(probabilityAgain).toEqual(probabilityFirst);
  });
});
