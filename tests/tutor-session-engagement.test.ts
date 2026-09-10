import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isMeaningfulTutorSession,
  MEANINGFUL_TUTOR_SESSION_SQL,
} from "@/lib/tutor/session-engagement";
import type { TutorSessionRecord } from "@/lib/types";

const opened: TutorSessionRecord = {
  id: "session",
  questionId: "question",
  attempts: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-09-01T00:00:00.000Z",
  revealedHints: 0,
  revealedSteps: 0,
  status: "active",
};
const cases: Array<[string, Partial<TutorSessionRecord>, boolean]> = [
  ["open/reload/passive last-seen", {}, false],
  ["expired technical session", { status: "expired" }, false],
  ["withdrawn technical session", { status: "content_unpublished" }, false],
  [
    "operational revision and AI flags alone",
    { revision: 2, llmUsed: true, retrievalUsed: true },
    false,
  ],
  ["legacy answer counter", { attemptCount: 1 }, true],
  ["legacy wrong answer counter", { wrongAttemptCount: 1 }, true],
  ["legacy hint reveal", { revealedHints: 1 }, true],
  ["legacy step reveal", { revealedSteps: 1 }, true],
  [
    "retained solved completion",
    { solved: true, status: "content_unpublished" },
    true,
  ],
  ["retained completed status", { status: "completed" }, true],
  ...(["check", "hint", "solution", "full_solution", undefined] as const).map(
    (mode): [string, Partial<TutorSessionRecord>, boolean] => [
      `persisted ${mode ?? "legacy unscored"} request`,
      { attempts: [{ id: "attempt", createdAt: opened.createdAt, mode }] },
      true,
    ],
  ),
  [
    "persisted blocked help request",
    {
      attempts: [
        {
          id: "attempt",
          createdAt: opened.createdAt,
          mode: "full_solution",
          source: "blocked",
          verdict: "blocked",
        },
      ],
    },
    true,
  ],
  [
    "eligible AI/cache assistance",
    {
      attempts: [
        {
          id: "attempt",
          createdAt: opened.createdAt,
          mode: "check",
          source: "cache",
        },
      ],
    },
    true,
  ],
];

describe("shared tutor engagement SQL/record parity", () => {
  let database: PGlite;
  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      create table tutor_sessions (
        id text, attempt_count int, wrong_attempt_count int,
        revealed_hints int, revealed_steps int, solved boolean, status text
      );
      create table attempts (session_id text, mode text);
    `);
  });
  afterAll(async () => database.close());

  it.each(cases)(
    "classifies %s consistently",
    async (_name, changes, expected) => {
      const session = { ...opened, ...changes };
      await database.exec("delete from attempts; delete from tutor_sessions;");
      await database.query(
        "insert into tutor_sessions values ($1,$2,$3,$4,$5,$6,$7)",
        [
          session.id,
          session.attemptCount ?? 0,
          session.wrongAttemptCount ?? 0,
          session.revealedHints,
          session.revealedSteps,
          session.solved ?? false,
          session.status,
        ],
      );
      for (const attempt of session.attempts) {
        await database.query("insert into attempts values ($1,$2)", [
          session.id,
          attempt.mode ?? null,
        ]);
      }
      const result = await database.query<{ meaningful: boolean }>(
        `select ${MEANINGFUL_TUTOR_SESSION_SQL} as meaningful from tutor_sessions s`,
      );
      expect(isMeaningfulTutorSession(session)).toBe(expected);
      expect(result.rows[0].meaningful).toBe(expected);
    },
  );
});
