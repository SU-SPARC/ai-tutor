import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET as getAvailability,
  PATCH as patchAvailability,
} from "@/app/api/professor/availability/route";
import { GET as getQuestion } from "@/app/api/questions/[id]/route";
import { GET as listQuestions } from "@/app/api/questions/route";
import { POST as createTutorSession } from "@/app/api/tutor/session/route";
import { requireProfessorReview } from "@/lib/auth/authorization";
import { activeCanonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import { createDatabaseContentAvailabilityRepository } from "@/lib/data/content-availability-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import {
  getTopics,
  setContentAvailabilityRepositoryForTests,
  setContentRepositoryForTests,
} from "@/lib/data/data-store";
import type { StudentContentAvailabilityDashboard } from "@/lib/types";
import {
  mockPrincipal,
  mockStudentOwner,
  resetAuthMocks,
  TEST_ANONYMOUS_OWNER,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const QUESTION_ID = "demo-basic-probability-colored-tickets";
const TOPIC_ID = "introduction-probability-venn-diagrams";
const openDatabases: PGlite[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  setContentAvailabilityRepositoryForTests(undefined);
  setContentRepositoryForTests(undefined);
  resetAuthMocks();
  vi.unstubAllEnvs();
  await Promise.all(openDatabases.splice(0).map((database) => database.close()));
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("controlled student content availability", () => {
  it("rejects student and anonymous attempts to change professor availability", async () => {
    mockPrincipal(TEST_STUDENT);
    const studentResponse = await patchAvailability(
      availabilityRequest("question", QUESTION_ID, "unpublished"),
    );

    mockPrincipal(undefined);
    const anonymousResponse = await patchAvailability(
      availabilityRequest("question", QUESTION_ID, "unpublished"),
    );

    expect(studentResponse.status).toBe(403);
    expect(anonymousResponse.status).toBe(401);
  });

  it("enforces global, scheduled, unpublished, archived, and topic visibility boundaries", async () => {
    const database = await seededDatabase();
    const query = pgliteQuery(database);
    const availabilityRepository =
      createDatabaseContentAvailabilityRepository(query);
    const contentRepository = createDatabaseContentRepository(
      "postgres://unused.example/db",
      query,
    );
    setContentAvailabilityRepositoryForTests(availabilityRepository);
    setContentRepositoryForTests(contentRepository);
    mockPrincipal(TEST_PROFESSOR);
    const authorization = await requireProfessorReview();

    const initialDashboard =
      await availabilityRepository.getDashboard(authorization);
    const initialQuestion = await directQuestion();
    const professorRead = await getAvailability();

    expect(initialQuestion.status).toBe(200);
    expect(professorRead.status).toBe(200);
    expect(professorRead.headers.get("Cache-Control")).toBe("private, no-store");
    expect(initialDashboard.assignmentScope).toBe("global_only");
    expect(initialDashboard.topics.map((topic) => topic.id)).toEqual(
      activeCanonicalSyllabusTopics.map((topic) => topic.id),
    );
    expect(initialDashboard.questions).toContainEqual(
      expect.objectContaining({
        effectiveAvailability: "available",
        id: QUESTION_ID,
        publicationState: "published",
        releaseState: "published",
      }),
    );
    expect(await visibleRetrievalCount(database)).toBe(1);

    const unpublished = await professorPatch(
      "question",
      QUESTION_ID,
      "unpublished",
      { reason: "pilot_hold" },
    );
    expect(unpublished.status).toBe(200);
    expect(await directQuestion()).toHaveProperty("status", 404);
    expect(await listedQuestionIds()).not.toContain(QUESTION_ID);
    expect(await visibleRetrievalCount(database)).toBe(0);

    mockPrincipal(undefined);
    mockStudentOwner(TEST_ANONYMOUS_OWNER);
    const hiddenSession = await createTutorSession(
      new Request("http://test/api/tutor/session", {
        body: JSON.stringify({ questionId: QUESTION_ID }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(hiddenSession.status).toBe(404);

    const editorialState = await database.query<{
      published_version_id: number;
      record_state: string;
      review_status: string;
    }>(
      `select published_version_id, record_state, review_status
       from questions where id = $1`,
      [QUESTION_ID],
    );
    expect(editorialState.rows[0]).toMatchObject({
      record_state: "active",
      review_status: "approved",
    });
    expect(editorialState.rows[0].published_version_id).toBeTruthy();

    const now = Date.now();
    const scheduled = await professorPatch(
      "question",
      QUESTION_ID,
      "published",
      {
        availableFrom: new Date(now + 60 * 60 * 1_000).toISOString(),
        availableUntil: new Date(now + 2 * 60 * 60 * 1_000).toISOString(),
      },
    );
    const scheduledDashboard = await responseDashboard(scheduled);
    expect(scheduled.status).toBe(200);
    expect(
      scheduledDashboard.questions.find((question) => question.id === QUESTION_ID),
    ).toMatchObject({ effectiveAvailability: "scheduled" });
    expect(await directQuestion()).toHaveProperty("status", 404);

    const expiredSchedule = await professorPatch(
      "question",
      QUESTION_ID,
      "published",
      {
        availableFrom: new Date(now - 2 * 60 * 60 * 1_000).toISOString(),
        availableUntil: new Date(now - 60 * 60 * 1_000).toISOString(),
      },
    );
    const expiredDashboard = await responseDashboard(expiredSchedule);
    expect(
      expiredDashboard.questions.find((question) => question.id === QUESTION_ID),
    ).toMatchObject({ effectiveAvailability: "expired" });
    expect(await directQuestion()).toHaveProperty("status", 404);

    const activeSchedule = await professorPatch(
      "question",
      QUESTION_ID,
      "published",
      {
        availableFrom: new Date(now - 60 * 60 * 1_000).toISOString(),
        availableUntil: new Date(now + 60 * 60 * 1_000).toISOString(),
      },
    );
    expect(activeSchedule.status).toBe(200);
    expect(await directQuestion()).toHaveProperty("status", 200);
    expect(await visibleRetrievalCount(database)).toBe(1);

    const hiddenTopic = await professorPatch(
      "topic",
      TOPIC_ID,
      "unpublished",
      { reason: "topic_pause" },
    );
    expect(hiddenTopic.status).toBe(200);
    expect(await directQuestion()).toHaveProperty("status", 404);
    expect(await visibleRetrievalCount(database)).toBe(0);
    expect((await getTopics()).map((topic) => topic.id)).toEqual(
      activeCanonicalSyllabusTopics
        .filter((topic) => topic.id !== TOPIC_ID)
        .map((topic) => topic.id),
    );
    const topicStorage = await database.query<{ is_active: boolean }>(
      "select is_active from topics where id = $1",
      [TOPIC_ID],
    );
    expect(topicStorage.rows[0].is_active).toBe(true);

    const restoredTopic = await professorPatch(
      "topic",
      TOPIC_ID,
      "published",
    );
    expect(restoredTopic.status).toBe(200);
    expect(await directQuestion()).toHaveProperty("status", 200);
    expect(await visibleRetrievalCount(database)).toBe(1);

    const archived = await professorPatch(
      "question",
      QUESTION_ID,
      "archived",
      { reason: "pilot_retired" },
    );
    const finalDashboard = await responseDashboard(archived);
    expect(archived.status).toBe(200);
    expect(await directQuestion()).toHaveProperty("status", 404);
    expect(await visibleRetrievalCount(database)).toBe(0);
    expect(
      finalDashboard.questions.find((question) => question.id === QUESTION_ID),
    ).toMatchObject({ effectiveAvailability: "archived" });
    expect(finalDashboard.auditEvents).toHaveLength(7);
    expect(finalDashboard.auditEvents[0]).toMatchObject({
      actorDisplayName: TEST_PROFESSOR.displayName,
      actorUserId: TEST_PROFESSOR.userId,
      reason: "pilot_retired",
      targetId: QUESTION_ID,
      toReleaseState: "archived",
    });

    const finalEditorialState = await database.query<{
      published_version_id: number;
      record_state: string;
      review_status: string;
    }>(
      `select published_version_id, record_state, review_status
       from questions where id = $1`,
      [QUESTION_ID],
    );
    expect(finalEditorialState.rows[0]).toMatchObject({
      record_state: "active",
      review_status: "approved",
    });
    expect(finalEditorialState.rows[0].published_version_id).toBeTruthy();
    await expect(
      database.query(
        `update question_student_availability
         set release_state = 'unpublished'
         where question_id = $1`,
        [QUESTION_ID],
      ),
    ).rejects.toThrow("active professor identity");
    await expect(
      database.query(
        `delete from student_content_availability_events
         where target_id = $1`,
        [QUESTION_ID],
      ),
    ).rejects.toThrow("append-only");

    const lifecycleVersion = finalEditorialState.rows[0].published_version_id;
    await database.query(
      `select * from app_transition_question_version(
         $1, $2, 'unpublish', $3, $4, 'published',
         'availability_boundary_test', null, $5, $5, '{}'::jsonb
       )`,
      [
        QUESTION_ID,
        lifecycleVersion,
        TEST_PROFESSOR.userId,
        TEST_PROFESSOR.displayName,
        "availability:lifecycle-unpublish",
      ],
    );
    const cannotBypassLifecycle = await professorPatch(
      "question",
      QUESTION_ID,
      "published",
    );
    const cannotBypassBody = await cannotBypassLifecycle.text();
    expect(cannotBypassLifecycle.status).toBe(400);
    expect(cannotBypassBody).toContain("question lifecycle");
    expect(await directQuestion()).toHaveProperty("status", 404);
  });
});

async function professorPatch(
  targetType: "topic" | "question",
  targetId: string,
  releaseState: "published" | "unpublished" | "archived",
  options: {
    availableFrom?: string;
    availableUntil?: string;
    reason?: string;
  } = {},
) {
  mockPrincipal(TEST_PROFESSOR);
  return patchAvailability(
    availabilityRequest(targetType, targetId, releaseState, options),
  );
}

function availabilityRequest(
  targetType: "topic" | "question",
  targetId: string,
  releaseState: "published" | "unpublished" | "archived",
  options: {
    availableFrom?: string;
    availableUntil?: string;
    reason?: string;
  } = {},
) {
  return new Request("http://test/api/professor/availability", {
    body: JSON.stringify({
      ...options,
      releaseState,
      targetId,
      targetType,
    }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `test:${targetType}:${targetId}:${releaseState}:${options.availableFrom ?? "none"}`,
    },
    method: "PATCH",
  });
}

function directQuestion() {
  return getQuestion(new Request("http://test/api/questions/x"), {
    params: Promise.resolve({ id: QUESTION_ID }),
  });
}

async function listedQuestionIds() {
  const response = await listQuestions(
    new Request("http://test/api/questions"),
  );
  const payload = (await response.json()) as {
    questions: Array<{ id: string }>;
  };
  return payload.questions.map((question) => question.id);
}

async function responseDashboard(response: Response) {
  const payload = (await response.json()) as {
    dashboard: StudentContentAvailabilityDashboard;
  };
  return payload.dashboard;
}

async function seededDatabase() {
  const database = new PGlite();
  openDatabases.push(database);
  const migrationDirectory = path.join(process.cwd(), "db/migrations");
  const migrationFiles = readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const migrationFile of migrationFiles) {
    await database.exec(
      readFileSync(path.join(migrationDirectory, migrationFile), "utf8"),
    );
  }

  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "pf-xj-availability-"),
  );
  temporaryDirectories.push(temporaryDirectory);
  const seedPath = path.join(temporaryDirectory, "seed.sql");
  execFileSync(
    process.execPath,
    [
      path.join(process.cwd(), "scripts/prepare-public-db-seed.mjs"),
      "--output",
      seedPath,
    ],
    { stdio: "pipe" },
  );
  await database.exec(readFileSync(seedPath, "utf8"));
  await database.query(
    `insert into retrieval_chunks (
       id, topic_id, question_id, chunk_type, title, body,
       source_type, trust_level, review_status, visibility, priority_tier
     ) values (
       'availability-test-chunk', $1, $2, 'question',
       'Availability test chunk', 'Public-safe test retrieval text.',
       'original_demo', 'public_original', 'approved', 'public', 'safe_demo'
     )`,
    [TOPIC_ID, QUESTION_ID],
  );
  await database.query(
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values ($1, 'test', $1, $2, $3, 'active')`,
    [TEST_PROFESSOR.userId, TEST_PROFESSOR.email, TEST_PROFESSOR.displayName],
  );
  await database.query(
    `insert into user_roles (user_id, role_id, granted_by_user_id)
     values ($1, 'professor', 'system:schema-migration')`,
    [TEST_PROFESSOR.userId],
  );
  return database;
}

async function visibleRetrievalCount(database: PGlite) {
  const result = await database.query<{ count: number }>(
    `select count(*)::int as count
     from app_student_retrieval_chunks
     where id = 'availability-test-chunk'`,
  );
  return result.rows[0].count;
}

function pgliteQuery(
  database: PGlite | Transaction,
): DatabaseQueryExecutor {
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query(sql, params);
    return result.rows as Record<string, unknown>[];
  };
  if (database instanceof PGlite) {
    query.transaction = (work) =>
      database.transaction((transaction) => work(pgliteQuery(transaction)));
  }
  return query;
}
