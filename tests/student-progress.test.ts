import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "@/app/api/student/progress/route"
import { ANONYMOUS_STUDENT_HEADER } from "@/lib/auth/anonymous-student"
import { getStudentProgress } from "@/lib/data/student-progress"
import {
  createTutorSession,
  recordTutorSessionAttempt,
  recordTutorSessionAttemptOutcome,
  resetTutorSessionsForTests,
  revealTutorSessionHint,
  revealTutorSessionStep,
} from "@/lib/data/tutor-session-repository"

const studentId = "anonymous-student-progress-123"

describe("student progress dashboard", () => {
  beforeEach(() => {
    resetTutorSessionsForTests()
    vi.stubEnv("APP_DEMO_MODE", "true")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("aggregates attempts, outcomes, help, topics, and recent sessions", async () => {
    const firstSession = await createTutorSession({
      anonymousStudentId: studentId,
      questionId: "dice-sum-eight",
    })
    await recordTutorSessionAttempt({
      answerPreview: "2/5 private working",
      sessionId: firstSession.id,
    })
    await recordTutorSessionAttemptOutcome({
      answerPreview: "2/5 private working",
      estimatedTokens: 0,
      sessionId: firstSession.id,
      source: "rule",
      verdict: "correct",
    })
    await revealTutorSessionHint(firstSession.id)

    const secondSession = await createTutorSession({
      anonymousStudentId: studentId,
      questionId: "five-question-quiz",
    })
    await recordTutorSessionAttempt({
      answerPreview: "0.2 private working",
      sessionId: secondSession.id,
    })
    await recordTutorSessionAttemptOutcome({
      answerPreview: "0.2 private working",
      estimatedTokens: 0,
      sessionId: secondSession.id,
      source: "rule",
      verdict: "incorrect",
    })
    await revealTutorSessionStep(secondSession.id)

    const otherStudentSession = await createTutorSession({
      anonymousStudentId: "anonymous-student-other-123",
      questionId: "exam-z-score",
    })
    await recordTutorSessionAttempt({ sessionId: otherStudentSession.id })

    const progress = await getStudentProgress(studentId)

    expect(progress).toMatchObject({
      mode: "demo",
      summary: {
        attemptedQuestions: 2,
        correctAttempts: 1,
        hintsUsed: 1,
        stepsRevealed: 1,
        topicsPracticed: 2,
      },
    })
    expect(progress.topics.map((topic) => topic.id)).toEqual([
      "conditional-probability",
      "binomial-models",
    ])
    expect(progress.recentSessions).toHaveLength(2)
    expect(progress.recentSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attemptCount: 1,
          correctAttempts: 1,
          questionId: "dice-sum-eight",
        }),
        expect.objectContaining({
          attemptCount: 1,
          correctAttempts: 0,
          questionId: "five-question-quiz",
        }),
      ]),
    )
  })

  it("requires an anonymous browser session and returns aggregate-only data", async () => {
    const session = await createTutorSession({
      anonymousStudentId: studentId,
      questionId: "dice-sum-eight",
    })
    await recordTutorSessionAttempt({
      answerPreview: "private student answer",
      sessionId: session.id,
    })

    const missingIdentity = await GET(
      new Request("http://localhost/api/student/progress"),
    )
    const response = await GET(
      new Request("http://localhost/api/student/progress", {
        headers: { [ANONYMOUS_STUDENT_HEADER]: studentId },
      }),
    )
    const responseText = await response.text()

    expect(missingIdentity.status).toBe(400)
    expect(response.status).toBe(200)
    expect(responseText).not.toContain("private student answer")
    expect(responseText).not.toContain(studentId)
    expect(responseText).not.toContain(session.id)
    expect(JSON.parse(responseText)).toMatchObject({
      progress: {
        summary: {
          attemptedQuestions: 1,
        },
      },
    })
  })
})
