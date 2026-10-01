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
  vi,
} from "vitest";

import { GET as listQuestionsRoute } from "@/app/api/questions/route";
import { POST as postSession } from "@/app/api/tutor/session/route";
import { GET as getSessionRoute } from "@/app/api/tutor/session/[sessionId]/route";
import { requireProfessorReview } from "@/lib/auth/authorization";
import type { StudentOwner } from "@/lib/auth/principal";
import type { CoursesAction } from "@/lib/courses/reducer";
import {
  createDatabaseCoursesRepository,
  type CoursesRepository,
} from "@/lib/data/courses-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import {
  getStudentQuestionVersion,
  setContentRepositoryForTests,
  setCoursesRepositoryForTests,
  setStudentQuestionVersionQueryForTests,
} from "@/lib/data/data-store";
import {
  createDatabaseQuestionLifecycleRepository,
  type QuestionVersionContentInput,
} from "@/lib/data/question-lifecycle-repository";
import {
  createDatabaseTutorSessionRepository,
  resetTutorSessionsForTests,
  setTutorSessionRepositoryForTests,
  type TutorSessionRepository,
} from "@/lib/data/tutor-session-repository";
import {
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";
import {
  loadMigrations,
  runPendingMigrations,
} from "../scripts/lib/database-migrations.mjs";

const TOPIC = "pinned-topic";
const QUESTION = "pinned-q1";
const COURSE = "pinned-course";
const SECTION = "pinned-course-sec-01";
const MEMBER: StudentOwner = { kind: "anonymous", anonymousId: "anon:member" };
const OUTSIDER: StudentOwner = {
  kind: "anonymous",
  anonymousId: "anon:outsider",
};

let db: PGlite;
let query: DatabaseQueryExecutor;
let courses: CoursesRepository;
let tutor: TutorSessionRepository;
let v1 = 0;
let v2 = 0;
let joinCode = "";

beforeAll(async () => {
  db = new PGlite();
  await runPendingMigrations({
    actor: "section-pinned-version-test",
    allowDestructive: true,
    changeTicket: "TEST-PINNED",
    client: {
      exec: (sql: string) => db.exec(sql),
      query: (sql: string, params?: unknown[]) =>
        db.query<Record<string, unknown>>(sql, params),
    },
    deploymentSha: "d".repeat(40),
    destructiveApprovedBy: "independent-pinned-approver",
    migrations: await loadMigrations(
      path.resolve(process.cwd(), "db/migrations"),
    ),
    target: "test",
  });
  await db.exec(readFileSync("db/roles/app_runtime.sql", "utf8"));
  await db.query(
    "insert into users (id, display_name, identity_provider, external_subject, status, email) values ($1, 'Professor', 'test', 'pinned-professor', 'active', 'pinned-professor@example.invalid')",
    [TEST_PROFESSOR.userId],
  );
  await db.query(
    "insert into user_roles(user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await db.exec(
    `insert into topics(id,title,description,sort_order,week_number,is_active) values ('${TOPIC}','Counting','',1,1,true)`,
  );
  query = async (sql, params = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  query.transaction = (work) =>
    db.transaction(async (tx) =>
      work(
        async (sql, params = []) =>
          (await tx.query<Record<string, unknown>>(sql, params)).rows,
      ),
    );
  courses = createDatabaseCoursesRepository(query);
  tutor = createDatabaseTutorSessionRepository("unused", query);

  mockPrincipal(TEST_PROFESSOR);
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  const created = await lifecycle.createQuestion(auth, {
    content: content("Version one", "0.5"),
    creationMethod: "manual",
    submit: true,
  });
  v1 = (await approveAndPublish(created.workingVersion.versionId))
    .publishedVersion!.versionId;

  await professor({
    type: "course/create",
    course: {
      id: COURSE,
      code: "STAT-200",
      title: "Pinned Statistics",
      term: "Fall 2026",
      status: "active",
    },
    includeAllTopics: true,
  });
  let state = await professor({
    type: "section/create",
    section: {
      id: SECTION,
      courseId: COURSE,
      label: "Section 1",
      meetingTime: "",
    },
  });
  joinCode = state.sections.find((section) => section.id === SECTION)!.joinCode;
  await professor({
    type: "section/setTopicState",
    sectionId: SECTION,
    topicId: TOPIC,
    state: "open",
  });
  state = await professor({
    type: "section/applyReleaseChanges",
    sectionId: SECTION,
    changes: [{ kind: "add", questionId: QUESTION }],
    now: new Date().toISOString(),
  });
  await professor({
    type: "section/updateDelivery",
    sectionId: SECTION,
    questionId: QUESTION,
    patch: { hintsEnabled: false },
  });

  // The professor publishes a revised version; the release stays on v1.
  const current = (await lifecycle.getQuestion(auth, QUESTION))!;
  const next = await lifecycle.createVersion(auth, {
    questionId: QUESTION,
    baseVersionId: current.workingVersion.versionId,
    expectedWorkingVersionId: current.workingVersion.versionId,
    content: content("Version two", "0.25"),
    creationMethod: "manual",
    submit: true,
  });
  v2 = (await approveAndPublish(next!.workingVersion.versionId))
    .publishedVersion!.versionId;
  resetAuthMocks();

  await courses.joinSection(MEMBER, joinCode);
}, 60_000);

beforeEach(() => {
  resetTutorSessionsForTests();
  setCoursesRepositoryForTests(courses);
  setContentRepositoryForTests(
    createDatabaseContentRepository("unused", query),
  );
  setStudentQuestionVersionQueryForTests(query);
  setTutorSessionRepositoryForTests(tutor);
  mockPrincipal(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  setCoursesRepositoryForTests(undefined);
  setContentRepositoryForTests(undefined);
  setStudentQuestionVersionQueryForTests(undefined);
  resetTutorSessionsForTests();
  resetAuthMocks();
  vi.restoreAllMocks();
});

afterAll(async () => db?.close());

function content(variant: string, answer: string): QuestionVersionContentInput {
  return {
    id: QUESTION,
    topicId: TOPIC,
    title: `Pinned coin ${variant}`,
    prompt: `A coin is tossed (${variant}). Find the probability of the event described.`,
    difficulty: "foundational",
    answer: {
      acceptedAnswers: [answer],
      explanation: "Count the favourable outcomes over all outcomes.",
    },
    hints: [`Hint for ${variant}.`],
    solutionSteps: ["Divide favourable outcomes by all outcomes."],
    misconceptions: [],
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
      originalityNote: "Original public-safe question.",
    },
  };
}

async function approveAndPublish(versionId: number) {
  const auth = await requireProfessorReview();
  const lifecycle = createDatabaseQuestionLifecycleRepository(query);
  await lifecycle.transition(auth, {
    action: "approve",
    expectedState: "needs_review",
    questionId: QUESTION,
    versionId,
  });
  return lifecycle.transition(auth, {
    action: "publish",
    expectedState: "approved",
    questionId: QUESTION,
    versionId,
  });
}

async function professor(action: CoursesAction) {
  return courses.applyProfessorAction(TEST_PROFESSOR.userId, action, "req");
}

async function moveToVersion(version: number) {
  mockPrincipal(TEST_PROFESSOR);
  await professor({
    type: "section/moveToVersion",
    sectionId: SECTION,
    questionId: QUESTION,
    version,
  });
  mockPrincipal(undefined);
}

function insertSession(owner: StudentOwner, versionId: number, id: string) {
  return db.query(
    `insert into tutor_sessions (
       id, anonymous_user_id, question_id, question_version_id, expires_at
     ) values ($1, $2, $3, $4, now() + interval '30 days')`,
    [
      id,
      owner.kind === "anonymous" ? owner.anonymousId : null,
      QUESTION,
      versionId,
    ],
  );
}

function sessionRequest(body: object) {
  return new Request("http://localhost/api/tutor/session", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

describe("section-pinned question versions (migration 029)", () => {
  it("accepts a member's session on the pinned version and refuses everyone else", async () => {
    expect(v2).not.toBe(v1);
    const pin = await db.query<{ released_version_id: number }>(
      "select released_version_id from section_question_availability where section_id = $1",
      [SECTION],
    );
    expect(Number(pin.rows[0].released_version_id)).toBe(v1);

    // An active member may start on the pinned v1 after v2 was published.
    await insertSession(MEMBER, v1, "member-on-pin");
    // Not a member: still needs the published version.
    await expect(
      insertSession(OUTSIDER, v1, "outsider-on-pin"),
    ).rejects.toThrow(/published question version/i);
    // A member on the published v2 that is not their pin is refused too.
    await expect(insertSession(MEMBER, v2, "member-on-v2")).rejects.toThrow(
      /published question version/i,
    );
    // Students without a section keep the published path exactly.
    await insertSession(OUTSIDER, v2, "outsider-on-published");
  });

  it("refuses the pinned version once the member has left the section", async () => {
    const former: StudentOwner = {
      kind: "anonymous",
      anonymousId: "anon:former-member",
    };
    await courses.joinSection(former, joinCode);
    await insertSession(former, v1, "former-before-leaving");
    await courses.leaveSection(former);
    await expect(
      insertSession(former, v1, "former-after-leaving"),
    ).rejects.toThrow(/published question version/i);
  });

  it("reads the pinned version's content only for a member", async () => {
    const pinned = await getStudentQuestionVersion(MEMBER, QUESTION, v1);
    expect(pinned).toMatchObject({
      id: QUESTION,
      title: "Pinned coin Version one",
      hints: ["Hint for Version one."],
      answer: { acceptedAnswers: ["0.5"] },
      source: { visibility: "public" },
      review: { status: "approved" },
    });
    expect(await getStudentQuestionVersion(OUTSIDER, QUESTION, v1)).toBe(
      undefined,
    );
    // v2 is published but it is not the member's pin.
    expect(await getStudentQuestionVersion(MEMBER, QUESTION, v2)).toBe(
      undefined,
    );
  });

  it("serves, starts and recovers a member's practice on the pinned version", async () => {
    mockStudentOwner(MEMBER);

    const list = await listQuestionsRoute(
      new Request("http://localhost/api/questions"),
    );
    const listed = (await list.json()) as {
      questions: { id: string; title: string; prompt: string }[];
    };
    expect(listed.questions).toEqual([
      expect.objectContaining({
        id: QUESTION,
        prompt: expect.stringContaining("Version one"),
      }),
    ]);

    // A client naming any version other than the pin is refused.
    const wrongVersion = await postSession(
      sessionRequest({
        idempotencyKey: "pinned:wrong-version",
        questionId: QUESTION,
        questionVersionId: v2,
      }),
    );
    expect(wrongVersion.status).toBe(404);
    expect(await wrongVersion.json()).toMatchObject({
      code: "QUESTION_UNAVAILABLE",
    });

    const created = await postSession(
      sessionRequest({
        idempotencyKey: "pinned:create",
        questionId: QUESTION,
        questionVersionId: v1,
      }),
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as {
      session: { id: string; questionVersionId: number };
    };
    expect(session.questionVersionId).toBe(v1);

    // The tutor grades against the session's stored version.
    const stored = await tutor.getSession(session.id, MEMBER);
    expect(stored?.questionVersion?.answer.acceptedAnswers).toEqual(["0.5"]);

    // Recovery keeps the pin; hints are off for this release, so no hint
    // text comes back even once the engine has revealed one.
    await db.query(
      "update tutor_sessions set revealed_hints = 1 where id = $1",
      [session.id],
    );
    const recovered = await getSessionRoute(
      new Request(`http://localhost/api/tutor/session/${session.id}`),
      { params: Promise.resolve({ sessionId: session.id }) },
    );
    expect(recovered.status).toBe(200);
    const recoveredPayload = (await recovered.json()) as {
      session: {
        disclosedHints: string[];
        questionVersionId: number;
        revealedHints: number;
      };
    };
    expect(recoveredPayload.session).toMatchObject({
      disclosedHints: [],
      questionVersionId: v1,
      revealedHints: 1,
    });
    expect(JSON.stringify(recoveredPayload)).not.toContain("Hint for");
  });

  it("moves the section's sessions to the newer version with the release", async () => {
    // Runs last: moveToVersion only moves forward.
    await moveToVersion(2);
    await expect(insertSession(MEMBER, v1, "member-old-pin")).rejects.toThrow(
      /published question version/i,
    );
    await insertSession(MEMBER, v2, "member-new-pin");

    mockStudentOwner(MEMBER);
    const created = await postSession(
      sessionRequest({
        idempotencyKey: "pinned:after-move",
        questionId: QUESTION,
      }),
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as {
      session: { questionVersionId: number };
    };
    expect(session.questionVersionId).toBe(v2);
    expect(await getStudentQuestionVersion(MEMBER, QUESTION, v2)).toMatchObject(
      { title: "Pinned coin Version two" },
    );
  });
});
