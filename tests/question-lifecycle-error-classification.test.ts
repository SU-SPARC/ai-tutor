import { afterEach, describe, expect, it, vi } from "vitest";

import type { Pool } from "pg";

import { requireProfessorReview } from "@/lib/auth/authorization";
import {
  DatabaseOperationError,
  queryPostgres,
  setPostgresPoolForTests,
} from "@/lib/data/postgres";
import {
  QuestionLifecycleConflictError,
  QuestionLifecycleNotFoundError,
  QuestionLifecycleValidationError,
  QuestionPublicationBlockedError,
} from "@/lib/tutor/question-lifecycle";
import { mockPrincipal, resetAuthMocks } from "./auth-test-helpers";

const transition = vi.fn();

vi.mock("@/lib/data/question-lifecycle-repository", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/data/question-lifecycle-repository")
    >();
  return {
    ...actual,
    createDatabaseQuestionLifecycleRepository: () => ({ transition }),
  };
});

const { transitionQuestionLifecycle } = await import("@/lib/data/data-store");

afterEach(() => {
  transition.mockReset();
  resetAuthMocks();
  setPostgresPoolForTests(undefined);
  vi.unstubAllEnvs();
});

describe("question lifecycle error classification", () => {
  it("propagates publication quality-gate blockers instead of reporting storage failure", async () => {
    const blocked = new QuestionPublicationBlockedError([
      {
        code: "missing_required_hint",
        message: "At least one useful hint is required before publication.",
      },
    ]);
    transition.mockRejectedValue(blocked);

    await expect(publishAttempt()).rejects.toBe(blocked);
  });

  it("keeps the other lifecycle domain errors distinguishable from infrastructure failures", async () => {
    for (const domainError of [
      new QuestionLifecycleConflictError("Stale version."),
      new QuestionLifecycleNotFoundError(),
      new QuestionLifecycleValidationError("Reason code required."),
    ]) {
      transition.mockRejectedValue(domainError);
      await expect(publishAttempt()).rejects.toBe(domainError);
    }
  });

  it("still reports genuine storage failures as unavailable", async () => {
    transition.mockRejectedValue(new Error("connection terminated"));

    await expect(publishAttempt()).rejects.toMatchObject({
      name: "DataServiceUnavailableError",
    });
  });
});

async function publishAttempt() {
  vi.stubEnv("APP_DEMO_MODE", "false");
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv(
    "DATABASE_URL",
    "postgresql://user:password@database.example.edu/tutor",
  );
  mockPrincipal({
    displayName: "Lifecycle Professor",
    email: "professor@lifecycle.invalid",
    kind: "user",
    role: "professor",
    roles: ["student", "professor"],
    userId: "user:lifecycle-professor",
  });
  const authorization = await requireProfessorReview();
  return transitionQuestionLifecycle(authorization, {
    action: "publish",
    expectedState: "approved",
    questionId: "lifecycle-classification-question",
    versionId: 1,
  });
}

describe("database transaction error preservation", () => {
  it("keeps a domain error raised inside a transaction intact after rollback", async () => {
    const statements = stubTransactionPool();
    const blocked = new QuestionPublicationBlockedError([
      {
        code: "invalid_review_state",
        message:
          "Only an approved or previously unpublished version can be published.",
      },
    ]);

    await expect(
      queryPostgres.transaction!(async (query) => {
        await query("select 1");
        throw blocked;
      }),
    ).rejects.toBe(blocked);
    expect(statements).toEqual(["begin", "select 1", "rollback"]);
  });

  it("still classifies driver failures raised inside a transaction", async () => {
    stubTransactionPool();

    await expect(
      queryPostgres.transaction!(async () => {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }),
    ).rejects.toBeInstanceOf(DatabaseOperationError);
  });
});

function stubTransactionPool() {
  vi.stubEnv("DATABASE_URL", "postgres://runtime:test@db.example.test/tutor");
  const statements: string[] = [];
  const client = {
    async query(sql: string) {
      statements.push(sql.replace(/\s+/g, " ").trim().toLowerCase());
      return { rows: [] };
    },
    release: vi.fn(),
  };
  setPostgresPoolForTests({
    connect: vi.fn(async () => client),
  } as unknown as Pool);
  return statements;
}
