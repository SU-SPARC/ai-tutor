import "server-only"

import { randomUUID } from "node:crypto"

import { queryPostgres } from "@/lib/data/postgres"
import { getServerEnv } from "@/lib/env/server"
import { getBudgetFallbacksRemaining } from "@/lib/tutor/usage-control"
import type {
  TutorSessionAttempt,
  TutorSessionRecord,
  TutorSource,
  TutorVerdict,
} from "@/lib/types"

type QueryValue = Date | null | number | string
type QueryExecutor = (
  sql: string,
  params?: QueryValue[],
) => Promise<Record<string, unknown>[]>

type TutorSessionRow = {
  anonymous_user_id: string | null
  created_at: Date | string
  id: string
  last_seen_at: Date | string
  llm_calls?: number
  question_id: string
  revealed_hints: number
  revealed_steps: number
}

type TutorAttemptRow = {
  answer_preview: string | null
  created_at: Date | string
  id: number | string
  source: TutorSource | null
  verdict: TutorVerdict | null
}

export type CreateTutorSessionInput = {
  anonymousStudentId: string
  questionId: string
}

export type RecordTutorSessionAttemptInput = {
  answerPreview?: string
  sessionId: string
}

export type RecordTutorSessionAttemptOutcomeInput = {
  answerPreview?: string
  estimatedTokens: number
  sessionId: string
  source: TutorSource
  verdict: TutorVerdict
}

export type TutorSessionRepository = {
  createSession(input: CreateTutorSessionInput): Promise<TutorSessionRecord>
  getSession(sessionId: string): Promise<TutorSessionRecord | undefined>
  listSessionsForStudent(
    anonymousStudentId: string,
  ): Promise<TutorSessionRecord[]>
  recordAttempt(
    input: RecordTutorSessionAttemptInput,
  ): Promise<TutorSessionRecord | undefined>
  recordAttemptOutcome(
    input: RecordTutorSessionAttemptOutcomeInput,
  ): Promise<TutorSessionRecord | undefined>
  revealHint(sessionId: string): Promise<TutorSessionRecord | undefined>
  revealStep(sessionId: string): Promise<TutorSessionRecord | undefined>
}

const memoryTutorSessionRepository = createMemoryTutorSessionRepository()

export async function createTutorSession(input: CreateTutorSessionInput) {
  const session = await writeWithDemoFallback((repository) =>
    repository.createSession(input),
  )
  return withCurrentLlmUsage(session)
}

export async function getTutorSession(sessionId: string) {
  const session = await readWithDemoFallback((repository) =>
    repository.getSession(sessionId),
  )
  return withCurrentLlmUsage(session)
}

export async function recordTutorSessionAttempt(
  input: RecordTutorSessionAttemptInput,
) {
  const session = await writeWithDemoFallback((repository) =>
    repository.recordAttempt(input),
  )
  return withCurrentLlmUsage(session)
}

export async function recordTutorSessionAttemptOutcome(
  input: RecordTutorSessionAttemptOutcomeInput,
) {
  const session = await writeWithDemoFallback((repository) =>
    repository.recordAttemptOutcome(input),
  )
  return withCurrentLlmUsage(session)
}

export async function listTutorSessionsForStudent(
  anonymousStudentId: string,
): Promise<{
  mode: "database" | "demo"
  sessions: TutorSessionRecord[]
}> {
  const env = getServerEnv()

  if (env.APP_DEMO_MODE || !env.DATABASE_URL) {
    return {
      mode: "demo",
      sessions:
        await memoryTutorSessionRepository.listSessionsForStudent(
          anonymousStudentId,
        ),
    }
  }

  try {
    const repository = createDatabaseTutorSessionRepository(
      env.DATABASE_URL,
      queryPostgres,
    )
    return {
      mode: "database",
      sessions: await repository.listSessionsForStudent(anonymousStudentId),
    }
  } catch {
    return {
      mode: "demo",
      sessions:
        await memoryTutorSessionRepository.listSessionsForStudent(
          anonymousStudentId,
        ),
    }
  }
}

export async function revealTutorSessionHint(sessionId: string) {
  const session = await writeWithDemoFallback((repository) =>
    repository.revealHint(sessionId),
  )
  return withCurrentLlmUsage(session)
}

export async function revealTutorSessionStep(sessionId: string) {
  const session = await writeWithDemoFallback((repository) =>
    repository.revealStep(sessionId),
  )
  return withCurrentLlmUsage(session)
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
        lastSeenAt: new Date().toISOString(),
        llmFallbacksRemaining: getServerEnv().MAX_LLM_CALLS_PER_SESSION,
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

    async listSessionsForStudent(anonymousStudentId) {
      return [...sessions.values()]
        .filter((session) => session.anonymousStudentId === anonymousStudentId)
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
        .map(cloneSession)
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
      session.lastSeenAt = new Date().toISOString()
      sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    },

    async recordAttemptOutcome(input) {
      const session = sessions.get(input.sessionId)

      if (!session) {
        return undefined
      }

      const pendingAttempt = [...session.attempts]
        .reverse()
        .find((attempt) => !attempt.verdict)
      if (pendingAttempt) {
        pendingAttempt.source = input.source
        pendingAttempt.verdict = input.verdict
      } else {
        session.attempts.push({
          answerPreview: previewString(input.answerPreview),
          createdAt: new Date().toISOString(),
          id: randomUUID(),
          source: input.source,
          verdict: input.verdict,
        })
      }
      session.lastSeenAt = new Date().toISOString()
      sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    },

    async revealHint(sessionId) {
      const session = sessions.get(sessionId)

      if (!session) {
        return undefined
      }

      session.revealedHints += 1
      session.lastSeenAt = new Date().toISOString()
      sessions.set(session.id, cloneSession(session))
      return cloneSession(session)
    },

    async revealStep(sessionId) {
      const session = sessions.get(sessionId)

      if (!session) {
        return undefined
      }

      session.revealedSteps += 1
      session.lastSeenAt = new Date().toISOString()
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
        [randomUUID(), input.anonymousStudentId, input.questionId],
      )

      return mapTutorSession(rows[0] as TutorSessionRow, [])
    },

    async getSession(sessionId) {
      return readDatabaseSession(query, sessionId)
    },

    async listSessionsForStudent(anonymousStudentId) {
      const rows = await query(
        `
          select *
          from tutor_sessions
          where anonymous_user_id = $1
          order by last_seen_at desc, created_at desc
        `,
        [anonymousStudentId],
      )

      return Promise.all(
        (rows as TutorSessionRow[]).map((row) =>
          readDatabaseSessionAttempts(query, row),
        ),
      )
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
      await touchDatabaseSession(query, input.sessionId)

      return this.getSession(input.sessionId)
    },

    async recordAttemptOutcome(input) {
      const session = await this.getSession(input.sessionId)

      if (!session) {
        return undefined
      }

      const updated = await query(
        `
          update attempts
          set verdict = $2,
              source = $3,
              estimated_tokens = $4
          where id = (
            select id
            from attempts
            where session_id = $1
              and mode = 'check'
              and verdict is null
            order by created_at desc, id desc
            limit 1
          )
          returning id
        `,
        [input.sessionId, input.verdict, input.source, input.estimatedTokens],
      )

      if (updated.length === 0) {
        await query(
          `
            insert into attempts (
              session_id,
              question_id,
              mode,
              answer_preview,
              source,
              verdict,
              estimated_tokens
            )
            values ($1, $2, 'check', $3, $4, $5, $6)
          `,
          [
            input.sessionId,
            session.questionId,
            previewString(input.answerPreview) ?? null,
            input.source,
            input.verdict,
            input.estimatedTokens,
          ],
        )
      }

      await touchDatabaseSession(query, input.sessionId)
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
    return await read(
      createDatabaseTutorSessionRepository(env.DATABASE_URL, queryPostgres),
    )
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

  return readDatabaseSessionAttempts(query, sessionRow)
}

async function readDatabaseSessionAttempts(
  query: QueryExecutor,
  sessionRow: TutorSessionRow,
) {
  const attemptRows = await query(
    `
      select id, answer_preview, source, verdict, created_at
      from attempts
      where session_id = $1
      order by created_at, id
    `,
    [sessionRow.id],
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
    lastSeenAt: toIsoString(sessionRow.last_seen_at),
    llmFallbacksRemaining: Math.max(
      0,
      getServerEnv().MAX_LLM_CALLS_PER_SESSION -
        Number(sessionRow.llm_calls ?? 0),
    ),
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
    source: row.source ?? undefined,
    verdict: row.verdict ?? undefined,
  }
}

function cloneSession(session: TutorSessionRecord): TutorSessionRecord {
  return {
    ...session,
    attempts: session.attempts.map((attempt) => ({ ...attempt })),
  }
}

async function withCurrentLlmUsage(
  session: TutorSessionRecord,
): Promise<TutorSessionRecord>
async function withCurrentLlmUsage(
  session: TutorSessionRecord | undefined,
): Promise<TutorSessionRecord | undefined>
async function withCurrentLlmUsage(
  session: TutorSessionRecord | undefined,
): Promise<TutorSessionRecord | undefined> {
  if (!session) {
    return undefined
  }

  return {
    ...session,
    llmFallbacksRemaining: await getBudgetFallbacksRemaining(session.id),
  }
}

function previewString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.slice(0, 80) : undefined
}

async function touchDatabaseSession(query: QueryExecutor, sessionId: string) {
  await query(
    `
      update tutor_sessions
      set last_seen_at = now()
      where id = $1
    `,
    [sessionId],
  )
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
