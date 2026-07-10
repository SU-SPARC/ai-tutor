import { describe, expect, afterEach, beforeEach, it, vi } from "vitest"

import { POST as postAttempt } from "@/app/api/tutor/session/[sessionId]/attempt/route"
import { POST as postHint } from "@/app/api/tutor/session/[sessionId]/hint/route"
import { GET as getSession } from "@/app/api/tutor/session/[sessionId]/route"
import { POST as postStep } from "@/app/api/tutor/session/[sessionId]/step/route"
import { POST as postSession } from "@/app/api/tutor/session/route"
import {
  createDatabaseTutorSessionRepository,
  resetTutorSessionsForTests,
} from "@/lib/data/tutor-session-repository"
import type { TutorSessionRecord } from "@/lib/types"

type SessionPayload = {
  error?: string
  session?: TutorSessionRecord
}

describe("tutor session API", () => {
  beforeEach(() => {
    resetTutorSessionsForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("creates, reads, and updates an in-memory tutor session", async () => {
    const createdResponse = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        anonymousStudentId: "anon-123",
        questionId: "dice-sum-eight",
      }),
    )
    const created = (await createdResponse.json()) as SessionPayload
    const sessionId = created.session?.id ?? ""

    expect(createdResponse.status).toBe(201)
    expect(created.session).toMatchObject({
      anonymousStudentId: "anon-123",
      attempts: [],
      llmFallbacksRemaining: 3,
      questionId: "dice-sum-eight",
      revealedHints: 0,
      revealedSteps: 0,
    })

    const hinted = await postHint(
      new Request(`http://localhost/api/tutor/session/${sessionId}/hint`, {
        method: "POST",
      }),
      sessionContext(sessionId),
    )
    const stepped = await postStep(
      new Request(`http://localhost/api/tutor/session/${sessionId}/step`, {
        method: "POST",
      }),
      sessionContext(sessionId),
    )
    const attempted = await postAttempt(
      jsonRequest(`http://localhost/api/tutor/session/${sessionId}/attempt`, {
        answer: "2/36 because I counted all dice outcomes",
      }),
      sessionContext(sessionId),
    )
    const fetched = await getSession(
      new Request(`http://localhost/api/tutor/session/${sessionId}`),
      sessionContext(sessionId),
    )

    const hintedPayload = (await hinted.json()) as SessionPayload
    const steppedPayload = (await stepped.json()) as SessionPayload
    const attemptedPayload = (await attempted.json()) as SessionPayload
    const fetchedPayload = (await fetched.json()) as SessionPayload

    expect(hintedPayload.session?.revealedHints).toBe(1)
    expect(steppedPayload.session?.revealedSteps).toBe(1)
    expect(attemptedPayload.session?.attempts).toHaveLength(1)
    expect(attemptedPayload.session?.attempts[0].answerPreview).toBe(
      "2/36 because I counted all dice outcomes",
    )
    expect(fetchedPayload.session).toMatchObject({
      anonymousStudentId: "anon-123",
      id: sessionId,
      questionId: "dice-sum-eight",
      revealedHints: 1,
      revealedSteps: 1,
    })
    expect(fetchedPayload.session?.attempts).toHaveLength(1)
  })

  it("validates required session route inputs", async () => {
    const createResponse = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        anonymousStudentId: "anon-123",
      }),
    )
    const missingResponse = await getSession(
      new Request("http://localhost/api/tutor/session/missing-session"),
      sessionContext("missing-session"),
    )
    const missingIdentityResponse = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        questionId: "dice-sum-eight",
      }),
    )

    expect(createResponse.status).toBe(400)
    expect(((await createResponse.json()) as SessionPayload).error).toContain(
      "questionId",
    )
    expect(missingIdentityResponse.status).toBe(400)
    expect(
      ((await missingIdentityResponse.json()) as SessionPayload).error,
    ).toContain("anonymousStudentId")
    expect(missingResponse.status).toBe(404)
  })

  it("falls back to in-memory sessions when configured database access is unavailable", async () => {
    vi.stubEnv("APP_DEMO_MODE", "false")
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.test/db")

    const response = await postSession(
      jsonRequest("http://localhost/api/tutor/session", {
        anonymousStudentId: "anon-fallback",
        questionId: "dice-sum-eight",
      }),
    )
    const payload = (await response.json()) as SessionPayload

    expect(response.status).toBe(201)
    expect(payload.session?.questionId).toBe("dice-sum-eight")
    expect(payload.session?.anonymousStudentId).toBe("anon-fallback")
    expect(payload.session?.revealedHints).toBe(0)
  })

  it("supports database-backed tutor session operations through the repository", async () => {
    const rows = createFakeTutorSessionRows()
    const repository = createDatabaseTutorSessionRepository(
      "postgres://user:pass@example.test/db",
      rows.query,
    )

    const created = await repository.createSession({
      anonymousStudentId: "anon-db",
      questionId: "dice-sum-eight",
    })
    const hinted = await repository.revealHint(created.id)
    const stepped = await repository.revealStep(created.id)
    const attempted = await repository.recordAttempt({
      answerPreview: "2/36",
      sessionId: created.id,
    })
    const settled = await repository.recordAttemptOutcome({
      answerPreview: "2/36",
      estimatedTokens: 0,
      sessionId: created.id,
      source: "rule",
      verdict: "correct",
    })
    const studentSessions = await repository.listSessionsForStudent("anon-db")

    expect(created).toMatchObject({
      anonymousStudentId: "anon-db",
      attempts: [],
      llmFallbacksRemaining: 3,
      questionId: "dice-sum-eight",
      revealedHints: 0,
      revealedSteps: 0,
    })
    expect(hinted?.revealedHints).toBe(1)
    expect(stepped?.revealedSteps).toBe(1)
    expect(attempted?.attempts).toEqual([
      expect.objectContaining({
        answerPreview: "2/36",
      }),
    ])
    expect(settled?.attempts).toEqual([
      expect.objectContaining({
        source: "rule",
        verdict: "correct",
      }),
    ])
    expect(studentSessions).toHaveLength(1)
    expect(studentSessions[0].id).toBe(created.id)
  })
})

function jsonRequest(url: string, body: unknown) {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  })
}

function sessionContext(sessionId: string) {
  return {
    params: Promise.resolve({ sessionId }),
  }
}

function createFakeTutorSessionRows() {
  let session:
    | {
        anonymous_user_id: string | null
        created_at: string
        id: string
        last_seen_at: string
        question_id: string
        revealed_hints: number
        revealed_steps: number
      }
    | undefined
  const attempts: Array<{
    answer_preview: string | null
    created_at: string
    id: number
    source: "blocked" | "cache" | "llm" | "retrieval" | "rule"
    verdict: "blocked" | "correct" | "guidance" | "incorrect" | null
  }> = []

  return {
    async query(
      sql: string,
      params: Array<Date | null | number | string> = [],
    ) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim()

      if (normalizedSql.startsWith("insert into tutor_sessions")) {
        session = {
          anonymous_user_id: String(params[1] ?? ""),
          created_at: "2026-07-06T00:00:00.000Z",
          id: String(params[0]),
          last_seen_at: "2026-07-06T00:00:00.000Z",
          question_id: String(params[2]),
          revealed_hints: 0,
          revealed_steps: 0,
        }
        return [session]
      }

      if (normalizedSql.startsWith("select * from tutor_sessions")) {
        if (normalizedSql.includes("anonymous_user_id = $1")) {
          return session && session.anonymous_user_id === params[0]
            ? [session]
            : []
        }

        return session && session.id === params[0] ? [session] : []
      }

      if (normalizedSql.startsWith("update tutor_sessions")) {
        if (!session || session.id !== params[0]) {
          return []
        }

        if (normalizedSql.includes("revealed_hints")) {
          session.revealed_hints += 1
        }

        if (normalizedSql.includes("revealed_steps")) {
          session.revealed_steps += 1
        }

        session.last_seen_at = "2026-07-06T00:00:02.000Z"

        return []
      }

      if (normalizedSql.startsWith("update attempts")) {
        const pendingAttempt = [...attempts]
          .reverse()
          .find((attempt) => attempt.verdict === null)

        if (!pendingAttempt) {
          return []
        }

        pendingAttempt.verdict = String(
          params[1],
        ) as typeof pendingAttempt.verdict
        pendingAttempt.source = String(
          params[2],
        ) as typeof pendingAttempt.source
        return [{ id: pendingAttempt.id }]
      }

      if (normalizedSql.startsWith("insert into attempts")) {
        const includesOutcome = normalizedSql.includes("verdict,")
        attempts.push({
          answer_preview: params[2] === null ? null : String(params[2]),
          created_at: "2026-07-06T00:00:01.000Z",
          id: attempts.length + 1,
          source: includesOutcome
            ? (String(params[3]) as (typeof attempts)[number]["source"])
            : "rule",
          verdict: includesOutcome
            ? (String(params[4]) as (typeof attempts)[number]["verdict"])
            : null,
        })
        return []
      }

      if (
        normalizedSql.startsWith(
          "select id, answer_preview, source, verdict, created_at from attempts",
        )
      ) {
        return attempts
      }

      throw new Error(`Unexpected SQL: ${normalizedSql}`)
    },
  }
}
