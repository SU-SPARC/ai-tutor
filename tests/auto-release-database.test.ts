import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { requireProfessorReview } from "@/lib/auth/authorization";
import type { CoursesAction } from "@/lib/courses/reducer";
import { autoReleasePublishedQuestions } from "@/lib/data/auto-release";
import {
  createDatabaseCoursesRepository,
  type CoursesRepository,
} from "@/lib/data/courses-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import {
  createDatabaseQuestionLifecycleRepository,
  type QuestionVersionContentInput,
} from "@/lib/data/question-lifecycle-repository";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";
import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";

const PROFESSOR = TEST_PROFESSOR.userId;
const TOPIC_A = "auto-release-topic-a";
const TOPIC_B = "auto-release-topic-b";
const COURSE = "auto-release-course";
const SECTION = "auto-release-course-sec-01";
const DEFAULT_DELIVERY = {
  attemptsAllowed: 3,
  hintsEnabled: true,
  solutionReveal: "after_2_wrong",
};

let db: PGlite;
let query: DatabaseQueryExecutor;
let repo: CoursesRepository;

beforeAll(async () => {
  db = new PGlite();
  await runPendingMigrations({
    actor: "auto-release-test",
    allowDestructive: true,
    changeTicket: "TEST-AUTO-RELEASE",
    client: {
      exec: (sql: string) => db.exec(sql),
      query: (sql: string, params?: unknown[]) =>
        db.query<Record<string, unknown>>(sql, params),
    },
    deploymentSha: "d".repeat(40),
    destructiveApprovedBy: "independent-auto-release-approver",
    migrations: await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    ),
    target: "test",
  });
  await db.exec(readFileSync("db/roles/app_runtime.sql", "utf8"));
  await db.query(
    "insert into users (id, display_name, identity_provider, external_subject, status, email) values ($1, 'Professor', 'test', 'auto-release-professor', 'active', 'auto-release-professor@example.invalid')",
    [PROFESSOR],
  );
  await db.query(
    "insert into user_roles(user_id, role_id) values ($1, 'professor')",
    [PROFESSOR],
  );
  await db.exec(`
    insert into topics(id,title,description,sort_order,week_number,is_active) values
      ('${TOPIC_A}','Random variables','',1,1,true),
      ('${TOPIC_B}','Binomial models','',2,2,true);
  `);
  query = async (sql, params = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  query.transaction = (work) =>
    db.transaction(async (tx) =>
      work(
        async (sql, params = []) =>
          (await tx.query<Record<string, unknown>>(sql, params)).rows,
      ),
    );
  repo = createDatabaseCoursesRepository(query);
}, 60_000);
beforeEach(() => mockPrincipal(TEST_PROFESSOR));
afterEach(resetAuthMocks);
afterAll(async () => db?.close());

function content(
  id: string,
  topicId: string,
  variant = "",
): QuestionVersionContentInput {
  return {
    id,
    topicId,
    title: `${id}${variant}`,
    prompt: `A fair coin is tossed for scenario ${id}${variant}. Find the probability of heads.`,
    difficulty: "foundational",
    answer: {
      acceptedAnswers: ["0.5"],
      explanation: "One of two equally likely outcomes is heads.",
    },
    hints: ["Count the equally likely outcomes."],
    solutionSteps: ["Divide one favorable outcome by two outcomes."],
    misconceptions: [],
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
      originalityNote: "Original public-safe question.",
    },
  };
}

async function approveAndPublish(questionId: string, versionId: number) {
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  await lifecycle.transition(auth, {
    action: "approve",
    expectedState: "needs_review",
    questionId,
    versionId,
  });
  return lifecycle.transition(auth, {
    action: "publish",
    expectedState: "approved",
    questionId,
    versionId,
  });
}

async function publish(id: string, topicId: string) {
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  const created = await lifecycle.createQuestion(auth, {
    content: content(id, topicId),
    creationMethod: "manual",
    submit: true,
  });
  return approveAndPublish(id, created.workingVersion.versionId);
}

async function publishNewVersion(id: string, topicId: string) {
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  const current = (await lifecycle.getQuestion(auth, id))!;
  const next = await lifecycle.createVersion(auth, {
    questionId: id,
    baseVersionId: current.workingVersion.versionId,
    expectedWorkingVersionId: current.workingVersion.versionId,
    content: content(id, topicId, " (revised)"),
    creationMethod: "manual",
    submit: true,
  });
  return approveAndPublish(id, next!.workingVersion.versionId);
}

function apply(action: CoursesAction) {
  return repo.applyProfessorAction(PROFESSOR, action, "req-test");
}

async function ledger(afterId = 0) {
  const result = await db.query<{
    action: string;
    actor_user_id: string;
    request_id: string | null;
    section_id: string | null;
  }>(
    "select action, actor_user_id, request_id, section_id from course_events where id > $1 order by id",
    [afterId],
  );
  return result.rows;
}

async function lastLedgerId() {
  const result = await db.query<{ id: number }>(
    "select coalesce(max(id), 0)::int as id from course_events",
  );
  return result.rows[0].id;
}

async function releases() {
  return (await repo.getSectionReleases(SECTION)).map((row) => ({
    questionId: row.questionId,
    position: row.position,
    releasedVersion: row.releasedVersion,
    topicId: row.topicId,
    topicState: row.topicState,
    delivery: row.delivery,
  }));
}

describe("automatic release to the professor's only section", () => {
  it("releases each publish to the one section, opens its week, and writes the ledger as the professor", async () => {
    // Nothing to release into before the professor has a section.
    await publish("auto-q1", TOPIC_A);
    expect(
      await autoReleasePublishedQuestions(repo, PROFESSOR, ["auto-q1"], "r0"),
    ).toBeUndefined();
    expect(await ledger()).toEqual([]);

    await apply({
      type: "course/create",
      course: {
        id: COURSE,
        code: "MATH-255",
        title: "Probability & Statistics",
        term: "Fall 2026",
        status: "active",
      },
      includeAllTopics: true,
    });
    await apply({
      type: "section/create",
      section: {
        id: SECTION,
        courseId: COURSE,
        label: "Section 1",
        meetingTime: "",
      },
    });
    const setupLedgerId = await lastLedgerId();

    // A publish after that goes straight to the section at the published
    // version, with default delivery, and the closed week opens.
    await publish("auto-q2", TOPIC_A);
    expect(
      await autoReleasePublishedQuestions(repo, PROFESSOR, ["auto-q2"], "r1"),
    ).toEqual({
      courseId: COURSE,
      sectionId: SECTION,
      openTopics: [TOPIC_A],
      questionIds: ["auto-q2"],
    });
    expect(await releases()).toEqual([
      {
        questionId: "auto-q2",
        position: 0,
        releasedVersion: 1,
        topicId: TOPIC_A,
        topicState: "open",
        delivery: DEFAULT_DELIVERY,
      },
    ]);
    expect(await ledger(setupLedgerId)).toEqual([
      {
        action: "section/setTopicState",
        actor_user_id: PROFESSOR,
        request_id: "auto-release:r1",
        section_id: SECTION,
      },
      {
        action: "section/applyReleaseChanges",
        actor_user_id: PROFESSOR,
        request_id: "auto-release:r1",
        section_id: SECTION,
      },
    ]);

    // The question published before the section existed is not swept in:
    // releasing it is still the professor's (or an operator's) call.
    expect((await releases()).map((row) => row.questionId)).not.toContain(
      "auto-q1",
    );

    // A later publish in the same week appends after it; an open week gets
    // no second topic event.
    await publish("auto-q3", TOPIC_A);
    const afterFirst = await lastLedgerId();
    expect(
      (await autoReleasePublishedQuestions(repo, PROFESSOR, ["auto-q3"], "r2"))
        ?.openTopics,
    ).toEqual([]);
    expect(
      (await releases()).map((row) => [row.questionId, row.position]),
    ).toEqual([
      ["auto-q2", 0],
      ["auto-q3", 1],
    ]);
    expect((await ledger(afterFirst)).map((row) => row.action)).toEqual([
      "section/applyReleaseChanges",
    ]);

    // Already in the section: nothing to do and nothing in the ledger, even
    // after a newer version is published (the pin is the professor's to move).
    await publishNewVersion("auto-q2", TOPIC_A);
    const beforeNoop = await lastLedgerId();
    expect(
      await autoReleasePublishedQuestions(
        repo,
        PROFESSOR,
        ["auto-q2", "auto-q3"],
        "r3",
      ),
    ).toBeUndefined();
    expect(await ledger(beforeNoop)).toEqual([]);
    expect(
      (await releases()).find((row) => row.questionId === "auto-q2")
        ?.releasedVersion,
    ).toBe(1);

    // A second active section makes the choice the professor's again.
    await apply({
      type: "section/create",
      section: {
        id: `${COURSE}-sec-02`,
        courseId: COURSE,
        label: "Section 2",
        meetingTime: "",
      },
    });
    await publish("auto-q4", TOPIC_B);
    const beforeSecond = await lastLedgerId();
    expect(
      await autoReleasePublishedQuestions(repo, PROFESSOR, ["auto-q4"], "r4"),
    ).toBeUndefined();
    expect(await ledger(beforeSecond)).toEqual([]);
    const placed = await db.query<{ count: number }>(
      "select count(*)::int as count from section_question_availability where question_id = 'auto-q4'",
    );
    expect(placed.rows[0].count).toBe(0);
  }, 60_000);
});
