import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfessorQuestionPage from "@/app/professor/questions/[id]/page";
import ProfessorReviewPage from "@/app/professor/review/page";
import { PUT as saveQuestionDraft } from "@/app/api/professor/question-intake/route";
import { GET as getProfessorQuestion } from "@/app/api/professor/questions/[id]/route";
import { POST as transitionQuestion } from "@/app/api/professor/questions/[id]/transitions/route";
import { GET as getProfessorQuestions } from "@/app/api/professor/questions/route";
import { GET as getProfessorReview } from "@/app/api/professor/review/route";
import { GET as getStudentQuestion } from "@/app/api/questions/[id]/route";
import { GET as getStudentQuestions } from "@/app/api/questions/route";
import { requireProfessorReview } from "@/lib/auth/authorization";
import {
  getContentAvailabilityDashboard,
  getProfessorQuestionReviewDashboard,
  getQuestionLifecycleDashboard,
} from "@/lib/data/data-store";
import { setPostgresPoolForTests } from "@/lib/data/postgres";
import { summarizeProfessorWorkspace } from "@/lib/professor/workspace-overview";
import { questionIntakeProvenance } from "@/lib/question-intake/provenance";
import {
  questionIntakeModelDraftForSave,
  verifyQuestionIntakeDraft,
} from "@/lib/question-intake/schema";
import type {
  QuestionIntakeDraft,
  QuestionIntakeModelDraft,
  QuestionIntakeTopic,
} from "@/lib/question-intake/types";
import type { QuestionLifecycleDto } from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

/**
 * The professor-reported bug: a screenshot was analyzed, the AI draft looked
 * right, Save Draft reported success, and then the question could not be found
 * anywhere. These tests pin the complete post-save workflow against a migrated
 * database: persistence, lifecycle state, discoverability, reopening, student
 * isolation, approve/publish, failure honesty, and duplicate-click safety.
 */

const TOPIC_ID = "conditional-probability";
const PROMPT =
  "A fair coin is tossed twice. What is the probability of exactly one head?";
const SAVE_KEY = "intake-save-key-0001";

const openDatabases: PGlite[] = [];

beforeEach(() => {
  mockPrincipal(TEST_PROFESSOR);
});

afterEach(async () => {
  setPostgresPoolForTests(undefined);
  resetAuthMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

type SavedPayload = {
  duplicates: unknown[];
  error?: string;
  question?: QuestionLifecycleDto;
  replayed?: boolean;
};

describe("professor AI question intake draft workflow", () => {
  it("persists Save Draft into the review state with every generated field, attribution, and provenance", async () => {
    const database = await databaseMode();
    const draft = completeDraft();

    const saved = await saveQuestionDraft(saveRequest(draft));
    const payload = (await saved.json()) as SavedPayload;

    expect(saved.status).toBe(201);
    expect(payload.replayed).toBe(false);
    const question = payload.question!;
    expect(question.questionId).toMatch(
      /^ai-intake-exactly-one-head-in-two-tosses-[0-9a-f]{8}$/u,
    );
    expect(question.recordState).toBe("active");
    expect(question.publishedVersion).toBeUndefined();
    expect(question.allowedActions).toContain("approve");
    expect(question.allowedActions).not.toContain("publish");
    expect(question.workingVersion).toMatchObject({
      answer: {
        acceptedAnswers: ["1/2", "0.5", "50%"],
        explanation: draft.answer.explanation,
        numericValue: 0.5,
        tolerance: 0.0001,
      },
      createdBy: {
        displayName: TEST_PROFESSOR.displayName,
        userId: TEST_PROFESSOR.userId,
      },
      creationMethod: "generated",
      difficulty: "foundational",
      hints: draft.hints,
      misconceptions: [
        {
          feedback: "Exactly one head excludes HH and TT.",
          id: "at-least-one-vs-exactly-one",
          matchTerms: ["3/4", "HH"],
        },
      ],
      prompt: PROMPT,
      solutionSteps: draft.solutionSteps,
      source: {
        originalityNote: expect.stringContaining("professor authored"),
        sourceType: "professor_provided",
        trustLevel: "public_original",
        visibility: "public",
      },
      state: "needs_review",
      title: "Exactly one head in two tosses",
      topicId: TOPIC_ID,
    });

    const submission = question.events.find(
      (event) => event.action === "submit",
    );
    expect(submission).toMatchObject({
      actor: { userId: TEST_PROFESSOR.userId },
      actorRole: "professor",
      fromState: "draft",
      metadata: {
        answerType: "numeric",
        inputMode: "image",
        model: "test/intake-model",
        questionType: "free_response",
        source: "question_intake",
      },
      toState: "needs_review",
    });
    expect(submission?.note).toMatch(/AI question intake/u);
    expect(questionIntakeProvenance(question)).toMatchObject({
      inputMode: "image",
      model: "test/intake-model",
      submittedBy: TEST_PROFESSOR.displayName,
    });

    const stored = await database.query<Record<string, unknown>>(
      `select
         q.record_state,
         q.working_version_id,
         q.published_version_id,
         qv.created_by_user_id,
         qv.creation_method,
         qvl.state as lifecycle_state,
         (select count(*)::int from question_versions v where v.question_id = q.id) as version_count,
         (select count(*)::int from app_public_questions p where p.id = q.id) as public_count
       from questions q
       join question_versions qv on qv.id = q.working_version_id
       join question_version_lifecycle qvl on qvl.question_version_id = qv.id
       where q.id = $1`,
      [question.questionId],
    );
    expect(stored.rows[0]).toEqual({
      created_by_user_id: TEST_PROFESSOR.userId,
      creation_method: "generated",
      lifecycle_state: "needs_review",
      public_count: 0,
      published_version_id: null,
      record_state: "active",
      version_count: 1,
      working_version_id: question.workingVersion.versionId,
    });
  });

  it("makes the saved draft discoverable in the Review Queue, the lifecycle list, and the overview", async () => {
    await databaseMode();
    const question = await saveDraft();

    const review = await getProfessorReview(
      new Request(`http://test/api/professor/review?topicId=${TOPIC_ID}`),
    );
    const reviewPayload = (await review.json()) as {
      candidates: Array<{ questionId: string; state: string; title: string }>;
      topicProgress: { needsReview: number };
    };
    expect(review.status).toBe(200);
    expect(reviewPayload.candidates).toEqual([
      expect.objectContaining({
        questionId: question.questionId,
        state: "needs_review",
        title: "Exactly one head in two tosses",
      }),
    ]);
    expect(reviewPayload.topicProgress.needsReview).toBe(1);

    const list = await getProfessorQuestions(
      new Request(
        "http://test/api/professor/questions?view=lifecycle&state=needs_review",
      ),
    );
    const listPayload = (await list.json()) as {
      questions: Array<{ questionId: string }>;
    };
    expect(listPayload.questions.map((item) => item.questionId)).toEqual([
      question.questionId,
    ]);

    const authorization = await requireProfessorReview();
    const overview = summarizeProfessorWorkspace({
      availability: await getContentAvailabilityDashboard(authorization),
      lifecycle: await getQuestionLifecycleDashboard(authorization),
      review: await getProfessorQuestionReviewDashboard(authorization),
    });
    expect(overview.pipeline).toMatchObject({ drafts: 0, needsReview: 1 });
    expect(overview.totalNeedsReview).toBe(1);
    expect(overview.reviewTopics).toEqual([
      expect.objectContaining({ needsReview: 1, topicId: TOPIC_ID }),
    ]);

    // The "Open in Review Queue" link preselects the topic and shows the
    // saved question first, ready to approve.
    const reviewPage = renderToStaticMarkup(
      await ProfessorReviewPage({
        searchParams: Promise.resolve({
          question: question.questionId,
          topic: TOPIC_ID,
        }),
      }),
    );
    expect(reviewPage).toContain("Exactly one head in two tosses");
    expect(reviewPage).toContain(PROMPT);
    expect(reviewPage).toContain("Approve");
    expect(reviewPage).not.toContain("Choose a topic</option>\n");
  });

  it("reopens the saved draft with every field after a restart and keeps students out", async () => {
    const database = await databaseMode();
    const draft = completeDraft();
    const question = await saveDraft(draft);

    // A fresh pool over the same database stands in for a server restart.
    setPostgresPoolForTests(pglitePool(database));

    const detail = await getProfessorQuestion(
      new Request(`http://test/api/professor/questions/${question.questionId}`),
      { params: Promise.resolve({ id: question.questionId }) },
    );
    const detailPayload = (await detail.json()) as {
      question: QuestionLifecycleDto;
    };
    expect(detail.status).toBe(200);
    expect(detailPayload.question.workingVersion).toMatchObject({
      answer: draft.answer,
      difficulty: draft.difficulty,
      hints: draft.hints,
      misconceptions: draft.misconceptions,
      prompt: draft.prompt,
      solutionSteps: draft.solutionSteps,
      state: "needs_review",
      title: draft.title,
      topicId: draft.topicId,
    });

    const page = renderToStaticMarkup(
      await ProfessorQuestionPage({
        params: Promise.resolve({ id: question.questionId }),
      }),
    );
    expect(page).toContain("Exactly one head in two tosses");
    expect(page).toContain("Waiting for your review");
    expect(page).toContain("AI intake · screenshot");
    expect(page).toContain("test/intake-model");
    expect(page).toContain(PROMPT);
    for (const text of [
      ...draft.hints,
      ...draft.solutionSteps,
      draft.answer.explanation,
      "Exactly one head excludes HH and TT.",
      "1/2, 0.5, 50%",
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain("Approve");
    expect(page).toContain(
      `href="/professor/review?topic=${TOPIC_ID}&amp;question=${question.questionId}"`,
    );
    expect(page).not.toContain("Lifecycle filters");

    mockPrincipal(TEST_STUDENT);
    const studentList = await getStudentQuestions(
      new Request("http://test/api/questions"),
    );
    const studentListPayload = (await studentList.json()) as {
      questions: Array<{ id: string }>;
    };
    expect(studentList.status).toBe(200);
    expect(studentListPayload.questions.map((item) => item.id)).not.toContain(
      question.questionId,
    );
    const studentDetail = await getStudentQuestion(
      new Request(`http://test/api/questions/${question.questionId}`),
      { params: Promise.resolve({ id: question.questionId }) },
    );
    expect(studentDetail.status).toBe(404);
    const studentProfessorApi = await getProfessorQuestion(
      new Request(`http://test/api/professor/questions/${question.questionId}`),
      { params: Promise.resolve({ id: question.questionId }) },
    );
    expect(studentProfessorApi.status).toBe(403);
    await expectRedirect(
      ProfessorQuestionPage({
        params: Promise.resolve({ id: question.questionId }),
      }),
      "/forbidden",
    );

    mockPrincipal(undefined);
    const anonymous = await getProfessorQuestion(
      new Request(`http://test/api/professor/questions/${question.questionId}`),
      { params: Promise.resolve({ id: question.questionId }) },
    );
    expect(anonymous.status).toBe(401);
  });

  it("approves and publishes the saved draft through the normal lifecycle before students can see it", async () => {
    const database = await databaseMode();
    const question = await saveDraft();

    const approved = await transition(question, "approve", "needs_review");
    expect(approved.status).toBe(200);
    const approvedPayload = (await approved.json()) as {
      question: QuestionLifecycleDto;
    };
    expect(approvedPayload.question.workingVersion.state).toBe("approved");
    expect(approvedPayload.question.publishedVersion).toBeUndefined();

    mockPrincipal(TEST_STUDENT);
    const stillHidden = await getStudentQuestion(
      new Request(`http://test/api/questions/${question.questionId}`),
      { params: Promise.resolve({ id: question.questionId }) },
    );
    expect(stillHidden.status).toBe(404);

    mockPrincipal(TEST_PROFESSOR);
    const published = await transition(question, "publish", "approved");
    expect(published.status).toBe(200);
    const publishedPayload = (await published.json()) as {
      question: QuestionLifecycleDto;
    };
    expect(publishedPayload.question.publishedVersion?.versionId).toBe(
      question.workingVersion.versionId,
    );

    const publicRows = await database.query<{ count: number }>(
      "select count(*)::int as count from app_public_questions where id = $1",
      [question.questionId],
    );
    expect(publicRows.rows[0].count).toBe(1);

    mockPrincipal(TEST_STUDENT);
    const visible = await getStudentQuestion(
      new Request(`http://test/api/questions/${question.questionId}`),
      { params: Promise.resolve({ id: question.questionId }) },
    );
    const visiblePayload = (await visible.json()) as {
      question: { prompt: string };
    };
    expect(visible.status).toBe(200);
    expect(visiblePayload.question.prompt).toBe(PROMPT);
  });

  it("does not report success when persistence fails and lets the same save be retried", async () => {
    const database = await databaseMode();
    const draft = completeDraft();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    setPostgresPoolForTests(
      pglitePool(database, { failOn: /insert into questions\b/iu }),
    );

    const failed = await saveQuestionDraft(saveRequest(draft));
    const failedPayload = (await failed.json()) as SavedPayload;

    expect(failed.status).toBe(503);
    expect(failedPayload.question).toBeUndefined();
    expect(failedPayload.error).toContain("still available on this page");
    expect(errorLog).toHaveBeenCalledWith(
      "Question intake draft save failed.",
      expect.objectContaining({ userId: TEST_PROFESSOR.userId }),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(PROMPT);
    const none = await database.query<{ count: number }>(
      "select count(*)::int as count from questions",
    );
    expect(none.rows[0].count).toBe(0);

    setPostgresPoolForTests(pglitePool(database));
    const retried = await saveQuestionDraft(saveRequest(draft));
    expect(retried.status).toBe(201);
  });

  it("collapses repeated Save Draft clicks for one draft into one question", async () => {
    const database = await databaseMode();
    const draft = completeDraft();

    const first = await saveQuestionDraft(saveRequest(draft));
    const second = await saveQuestionDraft(saveRequest(draft));
    const firstPayload = (await first.json()) as SavedPayload;
    const secondPayload = (await second.json()) as SavedPayload;

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(secondPayload.replayed).toBe(true);
    expect(secondPayload.question?.questionId).toBe(
      firstPayload.question?.questionId,
    );
    const count = await database.query<{ count: number }>(
      "select count(*)::int as count from questions",
    );
    expect(count.rows[0].count).toBe(1);

    // A different draft with the same wording is still a possible duplicate,
    // never a silent second copy.
    const otherDraft = await saveQuestionDraft(
      saveRequest(draft, { saveKey: "intake-save-key-0002" }),
    );
    expect(otherDraft.status).toBe(409);

    const malformed = await saveQuestionDraft(
      saveRequest(draft, { saveKey: "bad key!" }),
    );
    expect(malformed.status).toBe(400);
  });
});

async function saveDraft(draft = completeDraft()) {
  const response = await saveQuestionDraft(saveRequest(draft));
  const payload = (await response.json()) as SavedPayload;
  expect(response.status).toBe(201);
  return payload.question!;
}

async function transition(
  question: QuestionLifecycleDto,
  action: "approve" | "publish",
  expectedState: "approved" | "needs_review",
) {
  return transitionQuestion(
    new Request(
      `http://test/api/professor/questions/${question.questionId}/transitions`,
      {
        body: JSON.stringify({
          action,
          expectedState,
          versionId: question.workingVersion.versionId,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `${action}-${question.questionId}`,
        },
        method: "POST",
      },
    ),
    { params: Promise.resolve({ id: question.questionId }) },
  );
}

function saveRequest(
  draft: QuestionIntakeDraft,
  options: { saveKey?: string } = {},
) {
  return new Request("http://test/api/professor/question-intake", {
    body: JSON.stringify({
      analysis: { inputMode: "image", model: "test/intake-model" },
      draft: questionIntakeModelDraftForSave(draft),
      duplicateAcknowledged: false,
      sourceKind: "professor_authored",
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": options.saveKey ?? SAVE_KEY,
    },
    method: "PUT",
  });
}

async function expectRedirect(
  operation: Promise<unknown>,
  destination: string,
) {
  try {
    await operation;
    throw new Error(`Expected a redirect to ${destination}.`);
  } catch (error) {
    const digest = (error as { digest?: string }).digest;
    expect(digest).toContain(`;${destination};`);
  }
}

function topics(): QuestionIntakeTopic[] {
  return [
    {
      description: "Conditional probability test topic",
      id: TOPIC_ID,
      title: "Conditional Probability",
    },
  ];
}

function completeDraft() {
  return verifyQuestionIntakeDraft(modelDraft(), topics());
}

function modelDraft(): QuestionIntakeModelDraft {
  return {
    answer: {
      acceptedAnswers: ["1/2", "0.5", "50%"],
      explanation:
        "Exactly one head occurs as HT or TH, so 2 of 4 equally likely outcomes are favorable and 2/4 = 1/2.",
      numericValue: 0.5,
      tolerance: 0.0001,
    },
    answerType: "numeric",
    confidence: { answer: 0.98, extraction: 0.97, overall: 0.95, topic: 0.92 },
    difficulty: "foundational",
    hints: [
      "List the equally likely outcomes of two coin tosses.",
      "Identify which listed outcomes contain exactly one head.",
      "Divide the favorable count by the total count.",
    ],
    misconceptions: [
      {
        feedback: "Exactly one head excludes HH and TT.",
        id: "at-least-one-vs-exactly-one",
        matchTerms: ["3/4", "HH"],
      },
    ],
    prompt: PROMPT,
    questionType: "free_response",
    schemaVersion: 1,
    solutionSteps: [
      "The equally likely outcomes are HH, HT, TH, and TT.",
      "Exactly one head occurs in HT and TH, so there are 2 favorable outcomes.",
      "The probability is 2/4 = 1/2 = 0.5.",
    ],
    title: "Exactly one head in two tosses",
    topicId: TOPIC_ID,
    unreadableSegments: [],
    warnings: [],
  };
}

async function databaseMode() {
  const database = await migratedDatabase();
  await seedProfessorAndTopic(database);
  setPostgresPoolForTests(pglitePool(database));
  vi.stubEnv("APP_DEMO_MODE", "false");
  vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");
  return database;
}

async function migratedDatabase() {
  const database = new PGlite();
  openDatabases.push(database);
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  return database;
}

async function seedProfessorAndTopic(database: PGlite) {
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values (
      '${TEST_PROFESSOR.userId}', 'test', 'professor-subject',
      'professor@example.invalid', '${TEST_PROFESSOR.displayName}', 'active'
    );

    insert into user_roles (user_id, role_id)
    values ('${TEST_PROFESSOR.userId}', 'professor');

    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values (
      '${TOPIC_ID}', 'Conditional Probability',
      'Conditional probability test topic', 3, 3, 'Week 3', true
    );
  `);
}

function pglitePool(database: PGlite, options: { failOn?: RegExp } = {}) {
  const query = async (sql: string, params: unknown[] = []) => {
    if (options.failOn?.test(sql)) {
      throw Object.assign(new Error("simulated storage outage"), {
        code: "57P01",
      });
    }
    return database.query(sql, params);
  };
  const client = {
    query,
    release: () => undefined,
  };
  return {
    connect: async () => client,
    on: () => undefined,
    query,
  } as unknown as Pool;
}
