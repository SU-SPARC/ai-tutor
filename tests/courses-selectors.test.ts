import { describe, expect, it } from "vitest";

import {
  FALL_2026_COURSE_ID,
  FALL_2026_SECTION_01_ID,
  FALL_2026_SECTION_02_ID,
  SEED_NOW,
  SUMMER_2026_COURSE_ID,
  SUMMER_2026_SECTION_ID,
  createSeedState,
} from "@/lib/courses/demo-seed";
import { coursesReducer } from "@/lib/courses/reducer";
import {
  bankQuestionsForTopic,
  copyReleasedSetChanges,
  coursePipeline,
  courseSummary,
  courseTopicsOrdered,
  listCourses,
  previewReleaseChanges,
  questionReleaseMap,
  questionReleasedSections,
  releaseBlockReason,
  sectionBuilder,
  sectionProgress,
  sectionSummary,
} from "@/lib/courses/selectors";
import type { CoursesState } from "@/lib/courses/types";

const state: CoursesState = createSeedState();

function released(sectionId: string) {
  return state.questionAvailability.filter(
    (row) => row.sectionId === sectionId && row.state === "released",
  );
}

describe("course-level selectors", () => {
  it("lists active courses before archived ones", () => {
    const ordered = listCourses(state);
    const firstArchived = ordered.findIndex(
      (course) => course.status === "archived",
    );
    expect(firstArchived).toBeGreaterThan(0);
    expect(
      ordered
        .slice(firstArchived)
        .every((course) => course.status === "archived"),
    ).toBe(true);
  });

  it("orders the syllabus overlay, honouring display labels and exclusions", () => {
    const fall = courseTopicsOrdered(state, FALL_2026_COURSE_ID);
    expect(fall).toHaveLength(11);
    expect(fall.map((entry) => entry.overlay.position)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(fall[2].label).toBe("Wk3 — Bayes");

    const summer = courseTopicsOrdered(state, SUMMER_2026_COURSE_ID);
    const excluded = summer.filter((entry) => !entry.overlay.included);
    expect(excluded).toHaveLength(2);
    // Excluded topics sort last so the ⚠ row stays visible without hiding work.
    expect(summer.slice(-2)).toEqual(excluded);
  });

  it("counts what the S1 card and the S2 pipeline say", () => {
    const summary = courseSummary(state, FALL_2026_COURSE_ID);
    expect(summary.sectionCount).toBe(2);
    expect(summary.studentCount).toBe(61);
    expect(summary.topicCount).toBe(11);
    expect(summary.needsReview).toBeGreaterThanOrEqual(5);
    expect(summary.approvedNotPublished).toBeGreaterThanOrEqual(3);
    expect(summary.approvedNotReleased).toBe(
      summary.approvedNotPublished + summary.publishedNotReleased,
    );

    const distinct = new Set(
      [
        ...released(FALL_2026_SECTION_01_ID),
        ...released(FALL_2026_SECTION_02_ID),
      ].map((row) => row.questionId),
    );
    expect(summary.releasedCount).toBe(distinct.size);

    const pipeline = coursePipeline(state, FALL_2026_COURSE_ID);
    expect(pipeline.published).toBe(
      state.bank.filter((question) => question.state === "published").length,
    );
    expect(pipeline.releasedBySection.map((entry) => entry.sectionId)).toEqual([
      FALL_2026_SECTION_01_ID,
      FALL_2026_SECTION_02_ID,
    ]);
    expect(pipeline.releasedBySection[0].count).toBe(
      released(FALL_2026_SECTION_01_ID).length,
    );
    expect(pipeline.releasedBySection[0].count).toBeGreaterThan(
      pipeline.releasedBySection[1].count,
    );
  });

  it("excludes dropped topics from the summer course's counts", () => {
    const summary = courseSummary(state, SUMMER_2026_COURSE_ID);
    expect(summary.topicCount).toBe(9);
  });
});

describe("sectionSummary and sectionBuilder", () => {
  it("summarizes one section", () => {
    const summary = sectionSummary(state, FALL_2026_SECTION_01_ID);
    expect(summary.joined).toBe(34);
    expect(summary.topicsOpen).toBe(6);
    expect(summary.topicsTotal).toBe(11);
    expect(summary.released).toBe(released(FALL_2026_SECTION_01_ID).length);
    expect(summary.lastActivityAt).not.toBeNull();
  });

  it("builds one entry per included topic, in overlay order", () => {
    const builder = sectionBuilder(state, FALL_2026_SECTION_01_ID);
    expect(builder).toHaveLength(11);
    expect(builder.map((entry) => entry.topic.id)).toEqual(
      courseTopicsOrdered(state, FALL_2026_COURSE_ID).map(
        (entry) => entry.topic.id,
      ),
    );
    expect(builder[2].label).toBe("Wk3 — Bayes");
    expect(builder[6].availability.state).toBe("scheduled");
    expect(builder[6].availability.opensAt).not.toBeNull();
    expect(builder[7].availability.state).toBe("closed");
  });

  it("counts released against bank per topic and never exceeds it", () => {
    const builder = sectionBuilder(state, FALL_2026_SECTION_01_ID);
    const totalReleased = builder.reduce(
      (sum, entry) => sum + entry.releasedCount,
      0,
    );
    expect(totalReleased).toBe(released(FALL_2026_SECTION_01_ID).length);
    for (const entry of builder) {
      expect(entry.bankCount).toBe(
        bankQuestionsForTopic(state, entry.topic.id).length,
      );
      expect(entry.releasedCount).toBeLessThanOrEqual(entry.bankCount);
      // Closed topics keep their released list; only visibility changes.
      expect(entry.released.map((row) => row.position)).toEqual(
        [...entry.released].map((row) => row.position).sort((a, b) => a - b),
      );
      for (const row of entry.released) {
        expect(row.state).toBe("released");
        expect(row.lifecycleState).toBe("published");
      }
    }
  });

  it("sorts a topic's bank by what can go out first", () => {
    const bank = bankQuestionsForTopic(state, state.topics[1].id);
    const rank = [
      "published",
      "approved",
      "needs_review",
      "draft",
      "unpublished",
    ];
    const ranks = bank.map((question) => rank.indexOf(question.state));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("returns nothing for an unknown section", () => {
    expect(sectionBuilder(state, "sec-nope")).toEqual([]);
  });
});

describe("release gates", () => {
  it("names why each non-published state is blocked", () => {
    const byState = (lifecycle: string) =>
      state.bank.find((question) => question.state === lifecycle)!;
    expect(releaseBlockReason(byState("published"))).toBeNull();
    expect(releaseBlockReason(byState("approved"))).toBe(
      "Approved — publish first",
    );
    expect(releaseBlockReason(byState("needs_review"))).toBe("Needs review");
    expect(releaseBlockReason(byState("draft"))).toBe("Draft");
    expect(releaseBlockReason(byState("unpublished"))).toBe(
      "Unpublished — republish first",
    );
  });

  it("splits staged changes into ready, blocked, and warnings", () => {
    const approved = state.bank.find(
      (question) => question.state === "approved",
    )!;
    const addable = state.bank.find(
      (question) =>
        question.state === "published" &&
        !state.questionAvailability.some(
          (row) =>
            row.sectionId === FALL_2026_SECTION_01_ID &&
            row.questionId === question.id,
        ),
    )!;
    const pinnedKey = Object.keys(state.pinnedSessions).find((key) =>
      key.startsWith(`${FALL_2026_SECTION_01_ID}:`),
    )!;
    const pinnedQuestionId = pinnedKey.slice(
      FALL_2026_SECTION_01_ID.length + 1,
    );
    const notReleased = state.bank.find(
      (question) =>
        question.state === "published" &&
        !state.questionAvailability.some(
          (row) =>
            row.sectionId === FALL_2026_SECTION_01_ID &&
            row.questionId === question.id,
        ) &&
        question.id !== addable.id,
    )!;

    const preview = previewReleaseChanges(state, FALL_2026_SECTION_01_ID, [
      { kind: "add", questionId: addable.id },
      { kind: "add", questionId: approved.id },
      { kind: "remove", questionId: pinnedQuestionId },
      { kind: "remove", questionId: notReleased.id },
      { kind: "add", questionId: "ghost-question" },
    ]);

    expect(preview.ready).toEqual([
      { kind: "add", question: addable, version: addable.publishedVersion },
      {
        kind: "remove",
        question: state.bank.find((q) => q.id === pinnedQuestionId),
        version: null,
      },
    ]);
    expect(preview.blocked).toEqual([
      { kind: "add", question: approved, reason: "Approved — publish first" },
      {
        kind: "remove",
        question: notReleased,
        reason: "Not released to this section",
      },
    ]);
    expect(preview.warnings).toEqual([
      {
        question: state.bank.find((q) => q.id === pinnedQuestionId),
        pinnedSessions: state.pinnedSessions[pinnedKey],
      },
    ]);
  });

  it("stages the changes that make one section match another", () => {
    const changes = copyReleasedSetChanges(
      state,
      FALL_2026_SECTION_01_ID,
      FALL_2026_SECTION_02_ID,
    );
    const source = new Set(
      released(FALL_2026_SECTION_01_ID).map((row) => row.questionId),
    );
    const target = new Set(
      released(FALL_2026_SECTION_02_ID).map((row) => row.questionId),
    );
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      if (change.kind === "add") {
        expect(source.has(change.questionId)).toBe(true);
        expect(target.has(change.questionId)).toBe(false);
      } else {
        expect(target.has(change.questionId)).toBe(true);
        expect(source.has(change.questionId)).toBe(false);
      }
    }

    // Applying them makes Sec 02's released set a superset of the staged adds.
    const applied = coursesReducer(state, {
      type: "section/applyReleaseChanges",
      sectionId: FALL_2026_SECTION_02_ID,
      changes,
      now: "2026-09-20T12:00:00.000Z",
    });
    const after = new Set(
      applied.questionAvailability
        .filter(
          (row) =>
            row.sectionId === FALL_2026_SECTION_02_ID &&
            row.state === "released",
        )
        .map((row) => row.questionId),
    );
    for (const change of changes) {
      if (change.kind === "remove") {
        expect(after.has(change.questionId)).toBe(false);
      }
    }
    expect(
      copyReleasedSetChanges(
        state,
        FALL_2026_SECTION_01_ID,
        FALL_2026_SECTION_01_ID,
      ),
    ).toEqual([]);
  });
});

describe("questionReleaseMap", () => {
  const flat = (questionId: string) =>
    questionReleaseMap(state, questionId).flatMap((group) =>
      group.sections.map((row) => ({ ...row, courseId: group.course.id })),
    );

  it("groups by course with archived terms last", () => {
    const groups = questionReleaseMap(state, state.bank[0].id);
    expect(groups.map((group) => group.course.id)).toEqual(
      listCourses(state).map((course) => course.id),
    );
    expect(groups[groups.length - 1].course.status).toBe("archived");
  });

  it("reads live when the section is pinned to the published version", () => {
    const row = released(FALL_2026_SECTION_01_ID).find((candidate) => {
      const question = state.bank.find((q) => q.id === candidate.questionId);
      return question?.publishedVersion === candidate.releasedVersion;
    })!;
    const entry = flat(row.questionId).find(
      (candidate) => candidate.sectionId === FALL_2026_SECTION_01_ID,
    );
    expect(entry?.status).toBe("live");
  });

  it("reads older when the section stayed on a previous version", () => {
    const row = released(FALL_2026_SECTION_02_ID).find((candidate) => {
      const question = state.bank.find((q) => q.id === candidate.questionId);
      return (
        question?.publishedVersion != null &&
        candidate.releasedVersion != null &&
        candidate.releasedVersion < question.publishedVersion
      );
    });
    expect(row, "seed must contain an older-version pin").toBeDefined();
    const entry = flat(row!.questionId).find(
      (candidate) => candidate.sectionId === FALL_2026_SECTION_02_ID,
    );
    expect(entry?.status).toBe("older");
    expect(entry?.releasedVersion).toBeLessThan(entry!.publishedVersion!);
  });

  it("reads held for a pin whose version was unpublished, and not_released elsewhere", () => {
    const held = state.questionAvailability.find(
      (row) =>
        row.sectionId === FALL_2026_SECTION_01_ID && row.state === "held",
    )!;
    const rows = flat(held.questionId);
    expect(
      rows.find((row) => row.sectionId === FALL_2026_SECTION_01_ID)?.status,
    ).toBe("held");
    expect(
      rows.find((row) => row.sectionId === FALL_2026_SECTION_02_ID)?.status,
    ).toBe("not_released");
    expect(
      state.bank.find((question) => question.id === held.questionId)?.state,
    ).toBe("unpublished");
  });

  it("lists the sections a question is currently released to", () => {
    const row = released(FALL_2026_SECTION_01_ID)[0];
    const sections = questionReleasedSections(state, row.questionId);
    expect(sections.length).toBeGreaterThan(0);
    expect(
      sections.every((entry) => entry.availability.state === "released"),
    ).toBe(true);
  });
});

describe("sectionProgress", () => {
  it("reports class correctness, weekly activity, and mastery per open topic", () => {
    const progress = sectionProgress(state, FALL_2026_SECTION_01_ID, SEED_NOW);
    const members = state.members.filter(
      (member) => member.sectionId === FALL_2026_SECTION_01_ID,
    );
    const attempts = members.reduce((sum, member) => sum + member.attempts, 0);
    const correct = members.reduce(
      (sum, member) => sum + member.correctAttempts,
      0,
    );

    expect(progress.classCorrectness).toBe(
      Math.round((correct / attempts) * 100),
    );
    expect(progress.activeTotal).toBe(34);
    expect(progress.activeThisWeek).toBeGreaterThan(0);
    expect(progress.activeThisWeek).toBeLessThanOrEqual(34);
    expect(progress.needsAttention).toBe(4);
    // Six open topics plus the scheduled one: closed topics have no mastery yet.
    expect(progress.topicMastery).toHaveLength(7);
    for (const entry of progress.topicMastery) {
      expect(entry.pct).toBeGreaterThanOrEqual(30);
      expect(entry.pct).toBeLessThanOrEqual(95);
    }
  });

  it("is empty but safe for a section with no members", () => {
    const progress = sectionProgress(state, "sec-sp26-01", SEED_NOW);
    expect(progress).toMatchObject({
      classCorrectness: 0,
      activeThisWeek: 0,
      activeTotal: 0,
      needsAttention: 0,
    });
  });

  it("covers the summer section, where every included topic is open", () => {
    const summary = sectionSummary(state, SUMMER_2026_SECTION_ID);
    expect(summary.joined).toBe(18);
    expect(summary.topicsOpen).toBe(9);
    expect(summary.topicsTotal).toBe(9);
  });
});
