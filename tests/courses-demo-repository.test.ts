import { describe, expect, it } from "vitest";
import type { StudentOwner } from "@/lib/auth/principal";
import {
  FALL_2026_COURSE_ID,
  FALL_2026_SECTION_01_ID,
  FALL_2026_SECTION_02_ID,
  createSeedState,
} from "@/lib/courses/demo-seed";
import {
  CoursesNotFoundError,
  CoursesValidationError,
  createDemoCoursesRepository,
  studentKeyForOwner,
} from "@/lib/data/courses-repository";

const GHOST = "user:ghost-professor";
const OTHER = "user:other-demo-professor";
const STUDENT: StudentOwner = { kind: "anonymous", anonymousId: "anon:demo" };

describe("demo courses repository", () => {
  it("seeds each professor from the demo seed with no active course", async () => {
    const repo = createDemoCoursesRepository();
    const state = await repo.loadProfessorState(GHOST);
    const seed = createSeedState();
    expect(state.activeCourseId).toBeNull();
    expect(state.courses).toEqual(seed.courses);
    expect(state.sections).toEqual(seed.sections);
    expect(state.questionAvailability).toEqual(seed.questionAvailability);
    expect(state.members).toEqual(seed.members);
  });

  it("applies reducer actions, keeps professors separate, and resets to the seed", async () => {
    const repo = createDemoCoursesRepository();
    let state = await repo.applyProfessorAction(GHOST, {
      type: "course/archive",
      courseId: FALL_2026_COURSE_ID,
    });
    expect(
      state.courses.find((course) => course.id === FALL_2026_COURSE_ID)?.status,
    ).toBe("archived");
    expect(
      (await repo.loadProfessorState(OTHER)).courses.find(
        (course) => course.id === FALL_2026_COURSE_ID,
      )?.status,
    ).toBe("active");

    const draftable = state.bank.find(
      (question) => question.state === "approved",
    );
    if (draftable) {
      state = await repo.applyProfessorAction(GHOST, {
        type: "bank/publish",
        questionId: draftable.id,
        now: "2026-09-15T00:00:00.000Z",
      });
      expect(
        state.bank.find((question) => question.id === draftable.id)?.state,
      ).toBe("published");
    }

    state = await repo.applyProfessorAction(GHOST, { type: "reset" });
    expect(state.courses).toEqual(createSeedState().courses);
    expect(state.activeCourseId).toBeNull();
    await expect(
      repo.applyProfessorAction(GHOST, {
        type: "course/setActive",
        courseId: FALL_2026_COURSE_ID,
      }),
    ).rejects.toBeInstanceOf(CoursesValidationError);
  });

  it("joins the printed demo codes, moves within a course, and leaves", async () => {
    const repo = createDemoCoursesRepository();
    const joined = await repo.joinSection(STUDENT, "k7q2m");
    expect(joined).toMatchObject({
      sectionId: FALL_2026_SECTION_01_ID,
      courseId: FALL_2026_COURSE_ID,
      courseCode: "MATH-255",
    });
    expect(await repo.joinSection(STUDENT, "K7Q-2M")).toEqual(joined);

    // The professor who opens the screens first claims the copy students joined.
    const state = await repo.loadProfessorState(GHOST);
    expect(
      state.members.filter(
        (member) => member.studentKey === studentKeyForOwner(STUDENT),
      ),
    ).toEqual([
      expect.objectContaining({ sectionId: FALL_2026_SECTION_01_ID }),
    ]);

    const moved = await repo.joinSection(STUDENT, "R4N-8X");
    expect(moved.sectionId).toBe(FALL_2026_SECTION_02_ID);
    expect((await repo.getStudentSection(STUDENT))?.sectionId).toBe(
      FALL_2026_SECTION_02_ID,
    );
    expect(
      (await repo.loadProfessorState(GHOST)).members.filter(
        (member) => member.studentKey === studentKeyForOwner(STUDENT),
      ),
    ).toEqual([
      expect.objectContaining({ sectionId: FALL_2026_SECTION_02_ID }),
    ]);

    await repo.leaveSection(STUDENT);
    expect(await repo.getStudentSection(STUDENT)).toBeUndefined();
    await expect(repo.joinSection(STUDENT, "ZZZ-ZZ")).rejects.toBeInstanceOf(
      CoursesNotFoundError,
    );
  });

  it("lists released, published questions in topic then position order", async () => {
    const repo = createDemoCoursesRepository();
    const state = await repo.loadProfessorState(GHOST);
    const releases = await repo.getSectionReleases(FALL_2026_SECTION_01_ID);
    expect(releases.length).toBeGreaterThan(0);
    const bank = new Map(state.bank.map((question) => [question.id, question]));
    for (const release of releases) {
      expect(bank.get(release.questionId)?.state).toBe("published");
      expect(release.questionVersionId).toBe(release.releasedVersion);
    }
    const order = releases.map((release) => [
      release.topicPosition,
      release.position,
    ]);
    expect(order).toEqual(
      [...order].sort(
        (left, right) => left[0] - right[0] || left[1] - right[1],
      ),
    );
    expect(await repo.getSectionReleases("missing-section")).toEqual([]);
  });
});
