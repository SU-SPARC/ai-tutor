import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  POST as analyzeQuestion,
  PUT as saveQuestionDraft,
} from "@/app/api/professor/question-intake/route";
import {
  QuestionIntakeAiError,
  setQuestionIntakeGeneratorForTests,
  type GenerateQuestionIntakeInput,
} from "@/lib/question-intake/ai";
import {
  questionIntakeModelDraftForSave,
  verifyQuestionIntakeDraft,
} from "@/lib/question-intake/schema";
import type {
  QuestionIntakeModelDraft,
  QuestionIntakeTopic,
} from "@/lib/question-intake/types";
import { setPostgresPoolForTests } from "@/lib/data/postgres";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const openDatabases: PGlite[] = [];

beforeEach(() => {
  mockPrincipal(TEST_PROFESSOR);
  vi.stubEnv("APP_DEMO_MODE", "true");
  vi.stubEnv("DATABASE_URL", "");
  setQuestionIntakeGeneratorForTests(undefined);
});

afterEach(async () => {
  setQuestionIntakeGeneratorForTests(undefined);
  setPostgresPoolForTests(undefined);
  resetAuthMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
});

describe("professor question intake analysis API", () => {
  it("turns pasted text into a complete unsaved structured draft", async () => {
    let received: GenerateQuestionIntakeInput | undefined;
    setQuestionIntakeGeneratorForTests(async (input) => {
      received = input;
      return generated(input, input.questionText!);
    });
    const submitted =
      "A fair coin is tossed twice. What is P(exactly one head)?";
    const response = await analyzeQuestion(textRequest(submitted));
    const payload = (await response.json()) as Record<string, unknown> & {
      draft: ReturnType<typeof completeDraft>;
    };

    expect(response.status).toBe(200);
    expect(received).toMatchObject({
      inputMode: "text",
      questionText: submitted,
    });
    expect(payload).toMatchObject({
      inputMode: "text",
      model: "test/intake-model",
      saved: false,
    });
    expect(payload.draft).toMatchObject({
      prompt: submitted,
      questionType: "free_response",
      answerType: "numeric",
      review: { required: true, status: "needs_professor_review" },
    });
    expect(payload.draft.hints).toHaveLength(3);
    expect(payload.draft.solutionSteps.length).toBeGreaterThan(1);
  });

  it("passes a validated screenshot transiently to the mocked multimodal provider", async () => {
    let imageDataUrl = "";
    setQuestionIntakeGeneratorForTests(async (input) => {
      imageDataUrl = input.imageDataUrl ?? "";
      return generated(
        input,
        "A fair coin is tossed twice. What is P(exactly one head)?",
      );
    });
    const response = await analyzeQuestion(imageRequest(pngFile()));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(imageDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(serialized).not.toContain(imageDataUrl.slice(-12));
    expect(serialized).not.toMatch(/imageDataUrl|base64/);
  });

  it("rejects invalid images and offers manual editing when structured AI output fails", async () => {
    const invalidImage = await analyzeQuestion(
      imageRequest(
        new File(["not an image"], "question.png", { type: "image/png" }),
      ),
    );
    setQuestionIntakeGeneratorForTests(async () => {
      throw new QuestionIntakeAiError(
        "invalid_provider_output",
        "AI output did not match the schema.",
        ["topicId must be valid"],
      );
    });
    const invalidAi = await analyzeQuestion(textRequest("A valid question?"));
    const invalidAiPayload = (await invalidAi.json()) as Record<
      string,
      unknown
    >;

    expect(invalidImage.status).toBe(400);
    expect(invalidAi.status).toBe(422);
    expect(invalidAiPayload).toMatchObject({
      code: "invalid_provider_output",
      manualDraftAllowed: true,
    });
  });

  it("reports the exact missing vision-model capability without calling a provider", async () => {
    vi.stubEnv("AI_ENABLED", "true");
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("AI_MODEL", "nvidia/nemotron-3.5-lightning:free");
    vi.stubEnv("AI_QUESTION_INTAKE_VISION_MODEL", "");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    vi.stubEnv(
      "AI_USAGE_HMAC_SECRET",
      "test-question-intake-hmac-secret-123456789",
    );
    vi.stubEnv("AI_REQUEST_TIMEOUT_MS", "1000");
    vi.stubEnv("MAX_LLM_OUTPUT_TOKENS", "400");

    const response = await analyzeQuestion(imageRequest(pngFile()));
    const payload = (await response.json()) as {
      code: string;
      error: string;
      manualDraftAllowed: boolean;
    };

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      code: "vision_model_not_configured",
      manualDraftAllowed: true,
    });
    expect(payload.error).toMatch(
      /nvidia\/nemotron-3\.5-lightning:free.*AI_QUESTION_INTAKE_VISION_MODEL/i,
    );
  });

  it("allows professors and denies students and unauthenticated callers", async () => {
    setQuestionIntakeGeneratorForTests(async (input) =>
      generated(input, input.questionText!),
    );
    mockPrincipal(undefined);
    const anonymous = await analyzeQuestion(textRequest("Question?"));
    mockPrincipal(TEST_STUDENT);
    const student = await analyzeQuestion(textRequest("Question?"));
    const studentSave = await saveQuestionDraft(
      saveRequest(completeDraft("Question?", demoTopics()), false),
    );

    expect(anonymous.status).toBe(401);
    expect(student.status).toBe(403);
    expect(studentSave.status).toBe(403);
  });
});

describe("professor question intake save lifecycle", () => {
  it("saves professor-provided AI content as a non-public draft and warns before duplicates", async () => {
    const database = await migratedDatabase();
    await seedProfessorAndTopic(database);
    setPostgresPoolForTests(pglitePool(database));
    vi.stubEnv("APP_DEMO_MODE", "false");
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");

    const topics = databaseTopics();
    const draft = completeDraft(
      "A fair coin is tossed twice. What is the probability of exactly one head?",
      topics,
    );
    const saved = await saveQuestionDraft(saveRequest(draft, false));
    const savedPayload = (await saved.json()) as {
      question: { questionId: string; workingVersion: { state: string } };
    };

    expect(saved.status).toBe(201);
    expect(savedPayload.question.workingVersion.state).toBe("draft");
    const stored = await database.query<{
      creation_method: string;
      lifecycle_state: string;
      pattern_id: string | null;
      published_version_id: number | null;
      public_count: number;
      source_type: string;
      trust_level: string;
    }>(
      `select
         q.pattern_id,
         q.published_version_id,
         q.source_type,
         q.trust_level,
         qv.creation_method,
         qvl.state as lifecycle_state,
         (select count(*)::int from app_public_questions public_question
          where public_question.id = q.id) as public_count
       from questions q
       join question_versions qv on qv.id = q.working_version_id
       join question_version_lifecycle qvl on qvl.question_version_id = qv.id
       where q.id = $1`,
      [savedPayload.question.questionId],
    );
    expect(stored.rows[0]).toEqual({
      creation_method: "generated",
      lifecycle_state: "draft",
      pattern_id: null,
      published_version_id: null,
      public_count: 0,
      source_type: "professor_provided",
      trust_level: "public_original",
    });

    const duplicateWarning = await saveQuestionDraft(saveRequest(draft, false));
    const warningPayload = (await duplicateWarning.json()) as {
      duplicates: Array<{ questionId: string }>;
      requiresDuplicateAcknowledgement: boolean;
    };
    expect(duplicateWarning.status).toBe(409);
    expect(warningPayload.requiresDuplicateAcknowledgement).toBe(true);
    expect(warningPayload.duplicates[0]?.questionId).toBe(
      savedPayload.question.questionId,
    );

    const acknowledgedVariant = await saveQuestionDraft(
      saveRequest(draft, true),
    );
    expect(acknowledgedVariant.status).toBe(201);
    const counts = await database.query<{ count: number }>(
      "select count(*)::int as count from questions",
    );
    expect(counts.rows[0].count).toBe(2);
  });

  it("rejects answer/solution disagreement before any save", async () => {
    const draft = completeDraft("A fair coin is tossed twice.", demoTopics());
    draft.answer.acceptedAnswers = ["3/4"];
    draft.answer.numericValue = 0.75;
    const response = await saveQuestionDraft(saveRequest(draft, false));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(payload.error).toMatch(/consistency/i);
  });
});

function textRequest(questionText: string) {
  const formData = new FormData();
  formData.set("mode", "text");
  formData.set("questionText", questionText);
  return new Request("http://test/api/professor/question-intake", {
    body: formData,
    method: "POST",
  });
}

function imageRequest(file: File) {
  const formData = new FormData();
  formData.set("mode", "image");
  formData.set("file", file);
  return new Request("http://test/api/professor/question-intake", {
    body: formData,
    method: "POST",
  });
}

function saveRequest(
  draft: ReturnType<typeof completeDraft>,
  acknowledged: boolean,
) {
  return new Request("http://test/api/professor/question-intake", {
    body: JSON.stringify({
      draft: questionIntakeModelDraftForSave(draft),
      duplicateAcknowledged: acknowledged,
      sourceKind: "professor_authored",
    }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
}

function generated(input: GenerateQuestionIntakeInput, prompt: string) {
  return Promise.resolve({
    draft: completeDraft(prompt, input.topics),
    model: "test/intake-model",
  });
}

function completeDraft(prompt: string, topics: QuestionIntakeTopic[]) {
  return verifyQuestionIntakeDraft(modelDraft(prompt, topics[0]!.id), topics);
}

function modelDraft(prompt: string, topicId: string): QuestionIntakeModelDraft {
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
    prompt,
    questionType: "free_response",
    schemaVersion: 1,
    solutionSteps: [
      "The equally likely outcomes are HH, HT, TH, and TT.",
      "Exactly one head occurs in HT and TH, so there are 2 favorable outcomes.",
      "The probability is 2/4 = 1/2 = 0.5.",
    ],
    title: "Exactly one head in two tosses",
    topicId,
    unreadableSegments: [],
    warnings: [],
  };
}

function pngFile() {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    "question.png",
    { type: "image/png" },
  );
}

function demoTopics(): QuestionIntakeTopic[] {
  return [
    {
      description: "Basic probability",
      id: "introduction-probability-venn-diagrams",
      title: "Introduction to Probability and Venn Diagrams",
    },
  ];
}

function databaseTopics(): QuestionIntakeTopic[] {
  return [
    {
      description: "Conditional probability test topic",
      id: "conditional-probability",
      title: "Conditional Probability",
    },
  ];
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
      'user:test-professor', 'test', 'professor-subject',
      'professor@example.invalid', 'Test Professor', 'active'
    );

    insert into user_roles (user_id, role_id)
    values ('user:test-professor', 'professor');

    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values (
      'conditional-probability', 'Conditional Probability',
      'Conditional probability test topic', 3, 3, 'Week 3', true
    );
  `);
}

function pglitePool(database: PGlite) {
  const query = async (sql: string, params: unknown[] = []) =>
    database.query(sql, params);
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
