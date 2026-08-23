import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { GET as getFeedbackQueue } from "@/app/api/professor/feedback/route";
import { PATCH as reviewFeedback } from "@/app/api/professor/feedback/[reportId]/route";
import { POST as submitFeedback } from "@/app/api/tutor/session/[sessionId]/feedback/route";
import { POST as createSession } from "@/app/api/tutor/session/route";
import { ProfessorQuestionFeedbackPanel } from "@/components/professor/professor-question-feedback-panel";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import {
  createDatabaseQuestionFeedbackRepository,
  resetQuestionFeedbackForTests,
  setQuestionFeedbackRepositoryForTests,
} from "@/lib/data/question-feedback-repository";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import {
  createDatabaseTutorSessionRepository,
  resetTutorSessionsForTests,
  setTutorSessionRepositoryForTests,
} from "@/lib/data/tutor-session-repository";
import type {
  ProfessorQuestionFeedbackDashboard,
  TutorSessionRecord,
} from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

const QUESTION_ID = "demo-basic-probability-colored-tickets";
const openDatabases: PGlite[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  setContentRepositoryForTests(undefined);
  resetTutorSessionsForTests();
  resetQuestionFeedbackForTests();
  resetAuthMocks();
  await Promise.all(
    openDatabases.splice(0).map((database) => database.close()),
  );
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("professor question feedback workflow", () => {
  it("keeps the review queue and status updates behind professor access", async () => {
    mockPrincipal(TEST_STUDENT);
    const studentRead = await getFeedbackQueue();
    const studentWrite = await reviewFeedback(
      reviewRequest("1", "triaged", "Check the explanation."),
      reportContext("1"),
    );

    mockPrincipal(undefined);
    const anonymousRead = await getFeedbackQueue();

    expect(studentRead.status).toBe(403);
    expect(studentWrite.status).toBe(403);
    expect(anonymousRead.status).toBe(401);
  });

  it("triages and resolves a version-linked report without changing published content", async () => {
    const database = await seededDatabase();
    const query = pgliteQuery(database);
    setContentRepositoryForTests(
      createDatabaseContentRepository("postgres://unused.example/db", query),
    );
    setTutorSessionRepositoryForTests(
      createDatabaseTutorSessionRepository(
        "postgres://unused.example/db",
        query,
      ),
    );
    setQuestionFeedbackRepositoryForTests(
      createDatabaseQuestionFeedbackRepository(query),
    );

    mockPrincipal(TEST_STUDENT);
    const sessionResponse = await createSession(
      jsonRequest("http://test/api/tutor/session", {
        idempotencyKey: "session:feedback-workflow",
        questionId: QUESTION_ID,
      }),
    );
    const sessionPayload = (await sessionResponse.json()) as {
      session: TutorSessionRecord;
    };
    const session = sessionPayload.session;
    expect(sessionResponse.status).toBe(201);

    const before = await contentFingerprint(database);
    const submitResponse = await submitFeedback(
      new Request(`http://test/api/tutor/session/${session.id}/feedback`, {
        body: JSON.stringify({
          category: "solution_step_issue",
          details:
            "Step two skips the denominator. Email student@example.edu or call 617-555-0199.",
          idempotencyKey: "feedback:professor-workflow",
        }),
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.21",
        },
        method: "POST",
      }),
      { params: Promise.resolve({ sessionId: session.id }) },
    );
    expect(submitResponse.status).toBe(201);

    mockPrincipal(TEST_PROFESSOR);
    const queueResponse = await getFeedbackQueue();
    const queuePayload = (await queueResponse.json()) as {
      dashboard: ProfessorQuestionFeedbackDashboard;
    };
    const report = queuePayload.dashboard.reports[0];

    expect(queueResponse.status).toBe(200);
    expect(queueResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(queuePayload.dashboard.counts.open).toBe(1);
    expect(report).toMatchObject({
      category: "solution_step_issue",
      questionId: QUESTION_ID,
      questionVersionId: session.questionVersionId,
      status: "open",
      tutorSessionId: session.id,
    });
    expect(report.message).toContain("[email removed]");
    expect(report.message).toContain("[number removed]");
    expect(JSON.stringify(queuePayload)).not.toMatch(
      /reporter_subject|reporterSubject|student@example|617-555/i,
    );

    const missingResolution = await reviewFeedback(
      reviewRequest(report.id, "resolved"),
      reportContext(report.id),
    );
    expect(missingResolution.status).toBe(400);

    const triaged = await reviewFeedback(
      reviewRequest(
        report.id,
        "triaged",
        "Compare the exact published version with the expected arithmetic.",
      ),
      reportContext(report.id),
    );
    const triagedPayload = (await triaged.json()) as {
      report: { assignedToDisplayName: string; status: string };
    };
    expect(triaged.status).toBe(200);
    expect(triagedPayload.report).toMatchObject({
      assignedToDisplayName: TEST_PROFESSOR.displayName,
      status: "triaged",
    });

    const resolved = await reviewFeedback(
      reviewRequest(
        report.id,
        "resolved",
        "Reviewed the pinned version; a separate lifecycle revision is required.",
      ),
      reportContext(report.id),
    );
    const resolvedPayload = (await resolved.json()) as {
      report: { resolutionNotes: string; resolvedAt: string; status: string };
    };
    expect(resolved.status).toBe(200);
    expect(resolvedPayload.report).toMatchObject({
      resolutionNotes:
        "Reviewed the pinned version; a separate lifecycle revision is required.",
      status: "resolved",
    });
    expect(resolvedPayload.report.resolvedAt).toBeTruthy();

    const stored = await database.query<{
      category: string;
      metadata_json: unknown;
      question_id: string;
      question_version_id: number;
      reporter_subject_hash: string;
      reporter_user_id: string | null;
      resolution_notes: string;
      status: string;
      tutor_session_id: string;
    }>(
      `select
         reporter_user_id,
         reporter_subject_hash,
         tutor_session_id,
         question_id,
         question_version_id,
         category,
         status,
         resolution_notes,
         metadata_json
       from feedback_reports
       where id = $1`,
      [report.id],
    );
    expect(stored.rows[0]).toMatchObject({
      category: "solution_step_issue",
      metadata_json: {},
      question_id: QUESTION_ID,
      question_version_id: session.questionVersionId,
      reporter_user_id: null,
      resolution_notes:
        "Reviewed the pinned version; a separate lifecycle revision is required.",
      status: "resolved",
      tutor_session_id: session.id,
    });
    expect(stored.rows[0].reporter_subject_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await contentFingerprint(database)).toEqual(before);

    const finalQueue = await getFeedbackQueue();
    const finalPayload = (await finalQueue.json()) as {
      dashboard: ProfessorQuestionFeedbackDashboard;
    };
    expect(finalPayload.dashboard.counts).toMatchObject({
      open: 0,
      resolved: 1,
    });

    const markup = renderToStaticMarkup(
      createElement(ProfessorQuestionFeedbackPanel, {
        initialDashboard: finalPayload.dashboard,
      }),
    );
    expect(markup).toContain("Solution-step issue");
    expect(markup).toContain("Resolution notes");
    expect(markup).toContain("never alters published content");
    expect(markup).toContain("Tutor session linked");
  });
});

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function reviewRequest(
  reportId: string,
  status: string,
  resolutionNotes?: string,
) {
  return new Request(`http://test/api/professor/feedback/${reportId}`, {
    body: JSON.stringify({ resolutionNotes, status }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}

function reportContext(reportId: string) {
  return { params: Promise.resolve({ reportId }) };
}

async function seededDatabase() {
  const database = new PGlite();
  openDatabases.push(database);
  const migrationDirectory = path.join(process.cwd(), "db/migrations");
  for (const migration of readdirSync(migrationDirectory)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await database.exec(
      readFileSync(path.join(migrationDirectory, migration), "utf8"),
    );
  }

  const directory = mkdtempSync(path.join(tmpdir(), "pf-xj-feedback-"));
  temporaryDirectories.push(directory);
  const seedPath = path.join(directory, "seed.sql");
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
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values
       ($1, 'test', $1, $2, $3, 'active'),
       ($4, 'test', $4, $5, $6, 'active')`,
    [
      TEST_STUDENT.userId,
      TEST_STUDENT.email,
      TEST_STUDENT.displayName,
      TEST_PROFESSOR.userId,
      TEST_PROFESSOR.email,
      TEST_PROFESSOR.displayName,
    ],
  );
  await database.query(
    `insert into user_roles (user_id, role_id, granted_by_user_id)
     values
       ($1, 'student', 'system:schema-migration'),
       ($2, 'professor', 'system:schema-migration')`,
    [TEST_STUDENT.userId, TEST_PROFESSOR.userId],
  );
  return database;
}

async function contentFingerprint(database: PGlite) {
  const result = await database.query<{
    lifecycle_events: number;
    published_version_id: number;
    question_updated_at: string;
    review_status: string;
  }>(
    `select
       q.published_version_id,
       q.review_status,
       q.updated_at::text as question_updated_at,
       (
         select count(*)::int
         from question_lifecycle_events event
         where event.question_id = q.id
       ) as lifecycle_events
     from questions q
     where q.id = $1`,
    [QUESTION_ID],
  );
  return result.rows[0];
}

function pgliteQuery(database: PGlite | Transaction): DatabaseQueryExecutor {
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
