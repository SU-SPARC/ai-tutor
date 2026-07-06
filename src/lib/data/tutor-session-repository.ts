import "server-only"

import { randomUUID } from "node:crypto"

import { getServerEnv } from "@/lib/env/server"
import type { TutorSessionAttempt, TutorSessionRecord } from "@/lib/types"

type QueryValue = Date | null | number | string
type QueryExecutor = (
  sql: string,
  params?: QueryValue[],
) => Promise<Record<string, unknown>[]>

type TutorSessionRow = {
  anonymous_user_id: string | null
  created_at: Date | string
  id: string
  question_id: string
  revealed_hints: number
  revealed_steps: number
}

type TutorAttemptRow = {
  answer_preview: string | null
  created_at: Date | string
  id: number | string
}

export type CreateTutorSessionInput = {
  anonymousStudentId?: string
  questionId: string
}

export type RecordTutorSessionAttemptInput = {
  answerPreview?: string
  sessionId: string
}

export type TutorSessionRepository = {
  createSession(input: CreateTutorSessionInput): Promise<TutorSessionRecord>
  getSession(sessionId: string): Promise<TutorSessionRecord | undefined>
  recordAttempt(
    input: RecordTutorSessionAttemptInput,
  ): Promise<TutorSessionRecord | undefined>
  revealHint(sessionId: string): Promise<TutorSessionRecord | undefined>
  revealStep(sessionId: string): Promise<TutorSessionRecord | undefined>
}

const memoryTutorSessionRepository = createMemoryTutorSessionRepository()

export async function createTutorSession(input: CreateTutorSessionInput) {
  return writeWithDemoFallback((repository) => repository.createSession(input))
}

export async function getTutorSession(sessionId: string) {
  return readWithDemoFallback((repository) => repository.getSession(sessionId))
}

export async function recordTutorSessionAttempt(
  input: RecordTutorSessionAttemptInput,
) {
  return writeWithDemoFallback((repository) => repository.recordAttempt(input))
}

export async function revealTutorSessionHint(sessionId: string) {
  return writeWithDemoFallback((repository) => repository.revealHint(sessionId))
}

export async function revealTutorSessionStep(sessionId: string) {
  return writeWithDemoFallback((repository) => repository.revealStep(sessionId))
}

export function createMemoryTutorSessionRepository(): TutorSessionRepository {
  const sessions = new Map<string, TutorSessionRecord>()

  return {
    async createSession(input) {
      const session: TutorSessionRecord = {
        anonymousStudentId: input.anonymousStudentId,
        attempts: [],
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        questionId: input.questionId,
        revealedHints: 0,
        revealedSteps: 0,
      }

      sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    },

    async getSession(sessionId) {
      const session = sessions.get(sessionId)
      return session ? cloneSession(session) : undefined
    },

    async recordAttempt(input) {
      const session = sessions.get(input.sessionId)

      if (!session) {
        return undefined
      }

      session.attempts.push({
        answerPreview: previewString(input.answerPreview),
        createdAt: new Date().toISOString(),
        id: randomUUID(),
      })
      sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    },

    async revealHint(sessionId) {
      const session = sessions.get(sessionId)

      if (!session) {
        return undefined
      }

      session.revealedHints += 1
      sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    },

    async revealStep(sessionId) {
      const session = sessions.get(sessionId)

      if (!session) {
        return undefined
      }

      session.revealedSteps += 1
      sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    },
  }
}

export function createDatabaseTutorSessionRepository(
  databaseUrl: string,
  query: QueryExecutor = createUnavailableQueryExecutor(databaseUrl),
): TutorSessionRepository {
  return {
    async createSession(input) {
      const rows = await query(
        `
          insert into tutor_sessions (
            id,
            anonymous_user_id,
            question_id,
            revealed_hints,
            revealed_steps
          )
          values ($1, $2, $3, 0, 0)
          returning *
        `,
        [randomUUID(), input.anonymousStudentId ?? null, input.questionId],
      )

      return mapTutorSession(rows[0] as TutorSessionRow, [])
    },

    async getSession(sessionId) {
      return readDatabaseSession(query, sessionId)
    },

    async recordAttempt(input) {
      const session = await this.getSession(input.sessionId)

      if (!session) {
        return undefined
      }

      await query(
        `
          insert into attempts (
            session_id,
            question_id,
            mode,
            answer_preview,
            source,
            estimated_tokens
          )
          values ($1, $2, 'check', $3, 'rule', 0)
        `,
        [
          input.sessionId,
          session.questionId,
          previewString(input.answerPreview) ?? null,
        ],
      )

      return this.getSession(input.sessionId)
    },

    async revealHint(sessionId) {
      await query(
        `
          update tutor_sessions
          set revealed_hints = revealed_hints + 1,
              last_seen_at = now()
          where id = $1
        `,
        [sessionId],
      )
      return this.getSession(sessionId)
    },

    async revealStep(sessionId) {
      await query(
        `
          update tutor_sessions
          set revealed_steps = revealed_steps + 1,
              last_seen_at = now()
          where id = $1
        `,
        [sessionId],
      )
      return this.getSession(sessionId)
    },
  }
}

export function resetTutorSessionsForTests() {
  const freshRepository = createMemoryTutorSessionRepository()
  Object.assign(memoryTutorSessionRepository, freshRepository)
}

async function readWithDemoFallback<T>(
  read: (repository: TutorSessionRepository) => Promise<T>,
) {
  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    return read(memoryTutorSessionRepository)
  }

  try {
    return await read(createDatabaseTutorSessionRepository(env.DATABASE_URL))
  } catch {
    return read(memoryTutorSessionRepository)
  }
}

async function writeWithDemoFallback<T>(
  write: (repository: TutorSessionRepository) => Promise<T>,
) {
  return readWithDemoFallback(write)
}

async function readDatabaseSession(
  query: QueryExecutor,
  sessionId: string,
): Promise<TutorSessionRecord | undefined> {
  const sessionRows = await query(
    `
      select *
      from tutor_sessions
      where id = $1
      limit 1
    `,
    [sessionId],
  )
  const sessionRow = sessionRows[0] as TutorSessionRow | undefined

  if (!sessionRow) {
    return undefined
  }

  const attemptRows = await query(
    `
      select id, answer_preview, created_at
      from attempts
      where session_id = $1
      order by created_at, id
    `,
    [sessionId],
  )

  return mapTutorSession(sessionRow, attemptRows as TutorAttemptRow[])
}

function mapTutorSession(
  sessionRow: TutorSessionRow,
  attemptRows: TutorAttemptRow[],
): TutorSessionRecord {
  return {
    anonymousStudentId: sessionRow.anonymous_user_id ?? undefined,
    attempts: attemptRows.map(mapTutorAttempt),
    createdAt: toIsoString(sessionRow.created_at),
    id: String(sessionRow.id),
    questionId: String(sessionRow.question_id),
    revealedHints: Number(sessionRow.revealed_hints ?? 0),
    revealedSteps: Number(sessionRow.revealed_steps ?? 0),
  }
}

function mapTutorAttempt(row: TutorAttemptRow): TutorSessionAttempt {
  return {
    answerPreview: row.answer_preview ?? undefined,
    createdAt: toIsoString(row.created_at),
    id: String(row.id),
  }
}

function cloneSession(session: TutorSessionRecord): TutorSessionRecord {
  return {
    ...session,
    attempts: session.attempts.map((attempt) => ({ ...attempt })),
  }
}

function previewString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, 80) : undefined
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function createUnavailableQueryExecutor(databaseUrl: string): QueryExecutor {
  return async () => {
    const host = new URL(databaseUrl).host
    throw new Error(
      `Database tutor session repository selected for ${host}, but no Postgres driver is configured. Add a server-only query executor or keep APP_DEMO_MODE=true for demo fallback.`,
    )
  }
}
