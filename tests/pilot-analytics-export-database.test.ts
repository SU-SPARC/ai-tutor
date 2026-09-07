import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  requireAnalyticsAccess,
  requireStudent,
} from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabasePilotAnalyticsExportRepository } from "@/lib/data/pilot-analytics-export-repository";
import {
  mockPrincipal,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const databases: PGlite[] = [];
const RAW_ANONYMOUS_OWNER = "private-owner-cookie-SENSITIVE";
const RAW_ANSWER = "RAW-STUDENT-ANSWER-SENSITIVE";
const PRIVATE_SUMMARY = "PRIVATE-REFERENCE-SUMMARY-SENSITIVE";
const FEEDBACK_MESSAGE = "FEEDBACK-MESSAGE-SENSITIVE";
const RESOLUTION_NOTES = "RESOLUTION-NOTES-SENSITIVE";

afterEach(() => mockPrincipal(undefined));

afterAll(async () => {
  while (databases.length > 0) {
    await databases.pop()?.close();
  }
});

describe("pilot analytics research export", () => {
  let repository: ReturnType<
    typeof createDatabasePilotAnalyticsExportRepository
  >;

  beforeAll(async () => {
    const database = await migratedDatabase();
    repository = createDatabasePilotAnalyticsExportRepository(
      pgliteQuery(database),
    );
    await seed(database);
  }, 60_000);

  it("derives every requested metric with explicit tutor-path semantics", async () => {
    const document = await repository.build(
      await professorAuthorization(),
      "2026-08-31T12:00:00.000Z",
    );

    expect(document).toMatchObject({
      schemaVersion: 1,
      exportType: "pilot_analytics",
      generatedAt: "2026-08-31T12:00:00.000Z",
      mode: "database",
      privacy: {
        directIdentifiersIncluded: false,
        participantIdentifier: "pseudonymous_sha256",
        privateRetrievalContentIncluded: false,
        rawStudentTextIncluded: false,
      },
      cohort: {
        participatingStudents: 2,
        sessions: 3,
        questionsAttempted: 2,
        answerAttempts: 5,
        correctAnswerAttempts: 3,
        incorrectAnswerAttempts: 1,
        unscoredAnswerAttempts: 1,
        correctnessRate: 0.6,
        hintsUsed: 3,
        solutionStepsRevealed: 2,
      },
      tutorUsage: {
        totalInteractions: 6,
        deterministicInteractions: 2,
        retrievalInteractions: 1,
        llmProviderInteractions: 1,
        llmCacheInteractions: 1,
        llmAssistanceInteractions: 2,
        blockedInteractions: 1,
      },
      feedback: { totalReports: 2 },
    });
    expect(document.participants).toHaveLength(2);
    expect(document.topics).toHaveLength(2);
    expect(document.questions).toHaveLength(2);
    expect(document.misconceptions).toEqual([
      {
        misconceptionCode: "denominator-selection",
        sessionOccurrences: 2,
      },
    ]);
    expect(document.feedback.byCategory).toEqual([
      { count: 1, key: "answer_appears_incorrect" },
      { count: 1, key: "technical_problem" },
    ]);
    expect(document.feedback.byStatus).toEqual([
      { count: 1, key: "open" },
      { count: 1, key: "resolved" },
    ]);
    expect(document.metricDefinitions.researchOutcomes).toMatchObject({
      included: false,
    });
    expect(document.metricDefinitions.researchOutcomes.statement).toMatch(
      /does not measure or establish learning improvement/i,
    );
  });

  it("uses only global AI accounting so multi-scope writes are not multiplied", async () => {
    const document = await repository.build(await professorAuthorization());

    expect(document.aiUsage).toEqual({
      cacheHits: 1,
      estimatedRequestTokens: 500,
      estimatedTokenPortion: 20,
      generationRequests: 2,
      inputTokens: 120,
      limitBlocks: 1,
      outputTokens: 30,
      providerCalls: 3,
      successfulFallbacks: 1,
      totalTokens: 150,
    });
  });

  it("returns pseudonyms and excludes identity, student text, feedback text, and private retrieval content", async () => {
    const document = await repository.build(await professorAuthorization());
    const serialized = JSON.stringify(document);

    for (const participant of document.participants) {
      expect(participant.participantId).toMatch(/^[0-9a-f]{64}$/);
    }
    for (const sensitive of [
      RAW_ANONYMOUS_OWNER,
      TEST_STUDENT.userId,
      TEST_STUDENT.email,
      TEST_STUDENT.displayName,
      "session-private-a",
      RAW_ANSWER,
      FEEDBACK_MESSAGE,
      RESOLUTION_NOTES,
      PRIVATE_SUMMARY,
      "DATABASE_URL",
      "OPENROUTER_API_KEY",
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(serialized).not.toMatch(
      /submittedAnswer|normalizedAnswer|answerHash|feedbackMessage|resolutionNotes|scopeKey|requestHash|providerResponse/i,
    );
  });

  it("keeps participant rows pseudonymous while preserving useful aggregates", async () => {
    const document = await repository.build(await professorAuthorization());
    const multiQuestionParticipant = document.participants.find(
      (participant) => participant.questionsAttempted === 2,
    );

    expect(multiQuestionParticipant).toMatchObject({
      sessions: 2,
      answerAttempts: 4,
      correctAnswerAttempts: 2,
      incorrectAnswerAttempts: 1,
      unscoredAnswerAttempts: 1,
      questionsAttempted: 2,
    });
  });

  it("refuses the export repository to student authorization", async () => {
    mockPrincipal(TEST_STUDENT);
    const studentAuthorization = await requireStudent();

    await expect(
      repository.build(studentAuthorization as never),
    ).rejects.toThrow(/permission/i);
  });

  it("returns a valid empty database document when no pilot activity exists", async () => {
    const database = await migratedDatabase();
    const emptyRepository = createDatabasePilotAnalyticsExportRepository(
      pgliteQuery(database),
    );
    const document = await emptyRepository.build(
      await professorAuthorization(),
      "2026-08-31T12:00:00.000Z",
    );

    expect(document).toMatchObject({
      schemaVersion: 1,
      mode: "database",
      cohort: {
        participatingStudents: 0,
        sessions: 0,
        correctnessRate: null,
      },
      feedback: { totalReports: 0 },
    });
    expect(document.participants).toEqual([]);
    expect(document.dataCoverage).toEqual({
      earliestDate: null,
      latestDate: null,
    });
  });
});

async function professorAuthorization() {
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}

async function migratedDatabase() {
  const database = new PGlite();
  databases.push(database);
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  return database;
}

function pgliteQuery(database: PGlite): DatabaseQueryExecutor {
  return async (sql, params = []) => {
    const result = await database.query(sql, params);
    return result.rows as Record<string, unknown>[];
  };
}

async function seed(database: PGlite) {
  await database.query(
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values
       ($1, 'test', 'export-professor', 'professor-export@example.edu', 'Export Professor', 'active'),
       ($2, 'test', 'export-student', $3, $4, 'active')`,
    [
      TEST_PROFESSOR.userId,
      TEST_STUDENT.userId,
      TEST_STUDENT.email,
      TEST_STUDENT.displayName,
    ],
  );
  await database.query(
    "insert into user_roles (user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await database.query(
    `insert into topics (id, title, description, sort_order, is_active) values
       ('topic-a', 'Topic A', '', 1, true),
       ('topic-b', 'Topic B', '', 2, true)`,
  );

  for (const [questionId, topicId] of [
    ["question-a", "topic-a"],
    ["question-b", "topic-b"],
  ]) {
    await database.query(
      `insert into questions (
         id, topic_id, title, prompt, difficulty, accepted_answers_json,
         answer_explanation, source_type, trust_level, review_status,
         visibility, originality_note, reviewed_by, reviewed_by_user_id,
         reviewed_at
       ) values ($1, $2, $3, 'QUESTION-PROMPT-SENSITIVE', 'foundational',
         '["ACCEPTED-ANSWER-SENSITIVE"]'::jsonb, 'EXPLANATION-SENSITIVE',
         'original_demo', 'public_original', 'approved', 'public',
         'Original test question.', 'Professor', $4, now())`,
      [questionId, topicId, `Question ${questionId}`, TEST_PROFESSOR.userId],
    );
    await database.query(
      `insert into hints (question_id, hint_order, body)
       values ($1, 1, 'Start with the numerator and denominator.')`,
      [questionId],
    );
    await database.query(
      `insert into solution_steps (question_id, step_order, body)
       values ($1, 1, 'Divide the favorable outcomes by the total.')`,
      [questionId],
    );
  }

  const versionResult = await database.query<{
    id: number;
    question_id: string;
  }>(`select q.working_version_id as id, q.id as question_id from questions q`);
  const versions = new Map(
    versionResult.rows.map((row) => [row.question_id, row.id]),
  );

  await seedSession(database, {
    anonymousUserId: RAW_ANONYMOUS_OWNER,
    hints: 2,
    misconceptionCodes: ["denominator-selection"],
    questionId: "question-a",
    questionVersionId: versions.get("question-a")!,
    sessionId: "session-private-a",
    steps: 0,
  });
  await seedSession(database, {
    anonymousUserId: RAW_ANONYMOUS_OWNER,
    hints: 1,
    misconceptionCodes: ["denominator-selection"],
    questionId: "question-b",
    questionVersionId: versions.get("question-b")!,
    sessionId: "session-private-b",
    steps: 1,
  });
  await seedSession(database, {
    hints: 0,
    misconceptionCodes: [],
    questionId: "question-a",
    questionVersionId: versions.get("question-a")!,
    sessionId: "session-user",
    steps: 1,
    userId: TEST_STUDENT.userId,
  });
  await database.exec(`
    alter table tutor_sessions
      disable trigger tutor_sessions_guard_practice_context;
  `);
  await database.query(
    `insert into tutor_sessions (
       id, anonymous_user_id, question_id, question_version_id,
       practice_context, origin_session_id, revealed_hints, revealed_steps,
       current_state
     ) values (
       'session-extra-practice', $1, 'question-a', $2,
       'reserve_practice', 'session-private-a', 8, 8, 'working'
     )`,
    [RAW_ANONYMOUS_OWNER, versions.get("question-a")],
  );
  await database.exec(`
    alter table tutor_sessions
      enable trigger tutor_sessions_guard_practice_context;
  `);

  const attempts = [
    [
      "session-private-a",
      "question-a",
      "topic-a",
      "check",
      "rule",
      "incorrect",
    ],
    [
      "session-private-a",
      "question-a",
      "topic-a",
      "hint",
      "retrieval",
      "guidance",
    ],
    ["session-private-a", "question-a", "topic-a", "check", "llm", "correct"],
    ["session-private-b", "question-b", "topic-b", "check", "cache", "correct"],
    [
      "session-private-b",
      "question-b",
      "topic-b",
      "check",
      "blocked",
      "blocked",
    ],
    ["session-user", "question-a", "topic-a", "check", "rule", "correct"],
  ] as const;
  for (const [
    sessionId,
    questionId,
    topicId,
    mode,
    source,
    verdict,
  ] of attempts) {
    await database.query(
      `insert into attempts (
         session_id, question_id, topic_id, question_version_id, mode, source,
         verdict, answer_preview, submitted_answer, normalized_answer
       ) values ($1, $2, $3, $4, $5, $6, $7, 'SECRET', $8, $8)`,
      [
        sessionId,
        questionId,
        topicId,
        versions.get(questionId),
        mode,
        source,
        verdict,
        RAW_ANSWER,
      ],
    );
  }
  await database.query(
    `insert into attempts (
       session_id, question_id, topic_id, question_version_id, mode, source,
       verdict, answer_preview, submitted_answer, normalized_answer
     ) values (
       'session-extra-practice', 'question-a', 'topic-a', $1, 'check',
       'llm', 'correct', 'EXTRA', 'EXTRA', 'extra'
     )`,
    [versions.get("question-a")],
  );

  for (const [scope, scopeKey] of [
    ["global", "all"],
    ["student", "HMAC-STUDENT-SCOPE-SENSITIVE"],
  ]) {
    await database.query(
      `insert into ai_usage (
         scope, scope_key, date_key, interactions, estimated_tokens,
         llm_fallbacks, llm_input_tokens, llm_output_tokens, llm_total_tokens,
         estimated_llm_tokens, cache_hits, limit_blocks, llm_requests,
         llm_provider_calls
       ) values ($1, $2, '2026-08-30', 4, 500, 1, 120, 30, 150, 20, 1, 1, 2, 3)`,
      [scope, scopeKey],
    );
  }

  await database.query(
    `insert into feedback_reports (
       reporter_user_id, reporter_subject_hash, tutor_session_id, question_id,
       question_version_id, category, status, message
     ) values ($1, 'REPORTER-HASH-SENSITIVE', 'session-user', 'question-a', $2,
       'answer_appears_incorrect', 'open', $3)`,
    [TEST_STUDENT.userId, versions.get("question-a"), FEEDBACK_MESSAGE],
  );
  await database.query(
    `insert into feedback_reports (
       reporter_subject_hash, tutor_session_id, question_id,
       question_version_id, category, status, message, resolution_notes,
       resolved_at
     ) values ('ANON-REPORTER-HASH-SENSITIVE', 'session-private-b',
       'question-b', $1, 'technical_problem', 'resolved', $2, $3, now())`,
    [versions.get("question-b"), FEEDBACK_MESSAGE, RESOLUTION_NOTES],
  );
  await database.query(
    `insert into retrieval_chunks (
       id, topic_id, chunk_type, title, body, llm_safe_summary,
       source_type, trust_level, review_status, visibility, priority_tier
     ) values ('private-reference', 'topic-a', 'concept', 'Reviewed pattern', '',
       $1, 'private_reference_pattern', 'private_reference', 'approved',
       'private', 'private_reference')`,
    [PRIVATE_SUMMARY],
  );
}

async function seedSession(
  database: PGlite,
  input: {
    anonymousUserId?: string;
    hints: number;
    misconceptionCodes: string[];
    questionId: string;
    questionVersionId: number;
    sessionId: string;
    steps: number;
    userId?: string;
  },
) {
  await database.query(
    `insert into tutor_sessions (
       id, user_id, anonymous_user_id, question_id, question_version_id,
       revealed_hints, revealed_steps, last_misconception_ids_json,
       current_state, status
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'working',
       'content_unpublished'
     )`,
    [
      input.sessionId,
      input.userId ?? null,
      input.anonymousUserId ?? null,
      input.questionId,
      input.questionVersionId,
      input.hints,
      input.steps,
      JSON.stringify(input.misconceptionCodes),
    ],
  );
}
