import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CoursesIndexScreen } from "@/components/courses/courses-index-screen";
import { CoursesStoreProvider } from "@/components/courses/courses-store";
import {
  coursesSyncReducer,
  createInitialCoursesSync,
  saveErrorMessage,
  type CoursesSyncState,
} from "@/components/courses/courses-sync";
import {
  FALL_2026_COURSE_ID,
  SUMMER_2026_COURSE_ID,
  createSeedState,
} from "@/lib/courses/demo-seed";
import type { CoursesState } from "@/lib/courses/types";

/** What the server returns: no active course, that is a browser choice. */
function serverState(): CoursesState {
  return { ...createSeedState(), activeCourseId: null };
}

function loaded(demo = false): CoursesSyncState {
  return coursesSyncReducer(createInitialCoursesSync(), {
    type: "loaded",
    state: serverState(),
    demo,
  });
}

describe("courses sync reducer", () => {
  it("starts empty and not hydrated, so screens show skeletons, not seed data", () => {
    const sync = createInitialCoursesSync();
    expect(sync.hydrated).toBe(false);
    expect(sync.view.courses).toEqual([]);
    expect(sync.demo).toBe(false);
  });

  it("hydrates from the server and falls back to the first active course", () => {
    const sync = loaded(true);
    expect(sync.hydrated).toBe(true);
    expect(sync.demo).toBe(true);
    expect(sync.view.courses).toEqual(serverState().courses);
    expect(sync.view.activeCourseId).toBe(
      serverState().courses.find((course) => course.status === "active")?.id,
    );
  });

  it("keeps a remembered course across the load and ignores an unknown one", () => {
    let sync = coursesSyncReducer(createInitialCoursesSync(), {
      type: "restoreActive",
      courseId: SUMMER_2026_COURSE_ID,
    });
    sync = coursesSyncReducer(sync, {
      type: "loaded",
      state: serverState(),
      demo: false,
    });
    expect(sync.view.activeCourseId).toBe(SUMMER_2026_COURSE_ID);

    const unknown = coursesSyncReducer(
      coursesSyncReducer(createInitialCoursesSync(), {
        type: "restoreActive",
        courseId: "another-professors-course",
      }),
      { type: "loaded", state: serverState(), demo: false },
    );
    expect(unknown.view.activeCourseId).toBe(FALL_2026_COURSE_ID);
  });

  it("keeps course/setActive local and never queues it for the server", () => {
    const sync = coursesSyncReducer(loaded(), {
      type: "dispatch",
      action: { type: "course/setActive", courseId: SUMMER_2026_COURSE_ID },
    });
    expect(sync.pending).toEqual([]);
    expect(sync.view.activeCourseId).toBe(SUMMER_2026_COURSE_ID);
  });

  it("ignores hydrate actions: the server is the only source", () => {
    const before = loaded();
    const after = coursesSyncReducer(before, {
      type: "dispatch",
      action: { type: "hydrate", state: createSeedState() },
    });
    expect(after).toBe(before);
  });

  it("applies an action optimistically, queues it, and lets the server's answer replace it", () => {
    let sync = coursesSyncReducer(loaded(), {
      type: "dispatch",
      action: {
        type: "section/update",
        sectionId: serverState().sections[0].id,
        patch: { label: "Optimistic" },
      },
    });
    expect(sync.pending).toHaveLength(1);
    expect(sync.view.sections[0].label).toBe("Optimistic");

    const fromServer = serverState();
    fromServer.sections = fromServer.sections.map((section, index) =>
      index === 0 ? { ...section, label: "Saved" } : section,
    );
    sync = coursesSyncReducer(sync, { type: "confirmed", state: fromServer });
    expect(sync.pending).toEqual([]);
    expect(sync.view.sections[0].label).toBe("Saved");
  });

  it("re-applies later queued actions on top of each confirmed state", () => {
    const sectionId = serverState().sections[0].id;
    let sync = loaded();
    sync = coursesSyncReducer(sync, {
      type: "dispatch",
      action: { type: "section/update", sectionId, patch: { label: "First" } },
    });
    sync = coursesSyncReducer(sync, {
      type: "dispatch",
      action: {
        type: "section/update",
        sectionId,
        patch: { meetingTime: "TTh 9:00" },
      },
    });
    const firstSaved = serverState();
    firstSaved.sections = firstSaved.sections.map((section) =>
      section.id === sectionId ? { ...section, label: "First" } : section,
    );
    sync = coursesSyncReducer(sync, { type: "confirmed", state: firstSaved });

    expect(sync.pending).toHaveLength(1);
    const section = sync.view.sections.find((row) => row.id === sectionId);
    expect(section).toMatchObject({ label: "First", meetingTime: "TTh 9:00" });
  });

  it("drops the whole queue when a save is rejected", () => {
    let sync = loaded();
    const original = sync.view.sections[0].label;
    sync = coursesSyncReducer(sync, {
      type: "dispatch",
      action: {
        type: "section/update",
        sectionId: sync.view.sections[0].id,
        patch: { label: "Will fail" },
      },
    });
    sync = coursesSyncReducer(sync, {
      type: "dispatch",
      action: {
        type: "section/update",
        sectionId: sync.view.sections[0].id,
        patch: { meetingTime: "Built on the failed one" },
      },
    });
    sync = coursesSyncReducer(sync, { type: "rejected" });
    expect(sync.pending).toEqual([]);
    expect(sync.view.sections[0].label).toBe(original);
  });

  it("moves off a course the professor archives, as the reducer decides", () => {
    let sync = coursesSyncReducer(loaded(), {
      type: "dispatch",
      action: { type: "course/setActive", courseId: FALL_2026_COURSE_ID },
    });
    sync = coursesSyncReducer(sync, {
      type: "dispatch",
      action: { type: "course/archive", courseId: FALL_2026_COURSE_ID },
    });
    expect(sync.view.activeCourseId).not.toBe(FALL_2026_COURSE_ID);
    expect(sync.pending).toEqual([
      { type: "course/archive", courseId: FALL_2026_COURSE_ID },
    ]);
  });

  it("marks a failed load without losing what is already shown", () => {
    const sync = coursesSyncReducer(loaded(), { type: "loadFailed" });
    expect(sync.loadFailed).toBe(true);
    expect(sync.hydrated).toBe(true);
    expect(sync.view.courses.length).toBeGreaterThan(0);
  });
});

describe("save error messages", () => {
  it("shows the server's reason for a 4xx and a generic retry otherwise", () => {
    expect(saveErrorMessage(404, "Course not found.")).toBe(
      "Course not found.",
    );
    expect(saveErrorMessage(409, "  ")).toBe("Could not save, try again");
    expect(saveErrorMessage(503, "Data service unavailable")).toBe(
      "Could not save, try again",
    );
    expect(saveErrorMessage(undefined)).toBe("Could not save, try again");
  });
});

describe("courses index before the first load", () => {
  it("renders a loading skeleton, no seed courses, and no demo reset", () => {
    const markup = renderToStaticMarkup(
      createElement(
        CoursesStoreProvider,
        null,
        createElement(CoursesIndexScreen),
      ),
    );
    expect(markup).toContain("Loading your courses.");
    expect(markup).not.toContain("MATH-255");
    expect(markup).not.toContain("Reset demo");
  });
});
