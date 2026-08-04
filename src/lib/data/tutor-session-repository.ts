import "server-only";

import { randomUUID } from "node:crypto";

import {
  isSameOwner,
  ownerFromAuthorization,
  type StudentAuthorization,
} from "@/lib/auth/authorization";
import {
  readDatabaseRows,
  runDatabaseTransaction,
  type DatabaseQueryExecutor,
} from "@/lib/data/database-executor";
import { queryPostgres } from "@/lib/data/postgres";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import { getServerEnv } from "@/lib/env/server";
import { getOperatingModePolicy } from "@/lib/runtime/operating-mode";
import type { StudentOwner } from "@/lib/auth/principal";
import type {
  TutorSessionAttempt,
  TutorSessionRecord,
  TutorSource,
  TutorVerdict,
} from "@/lib/types";

type TutorSessionRow = {
  anonymous_user_id: string | null;
  created_at: Date | string;
  id: string;
  last_seen_at: Date | string;
  question_id: string;
  revealed_hints: number;
  revealed_steps: number;
  user_id: string | null;
};

type TutorAttemptRow = {
  answer_preview: string | null;
  created_at: Date | string;
  id: number | string;
  session_id?: string;
  source: TutorSource | null;
  verdict: TutorVerdict | null;
};

export type CreateTutorSessionInput = {
  owner: StudentOwner;
  questionId: string;
};

export type RecordTutorSessionAttemptInput = {
  answerPreview?: string;
  owner: StudentOwner;
  sessionId: string;
};

export type RecordTutorSessionAttemptOutcomeInput = {
  answerPreview?: string;
  estimatedTokens: number;
  owner: StudentOwner;
  sessionId: string;
  source: TutorSource;
  verdict: TutorVerdict;
};

export type TutorSessionRepository = {
  createSession(input: CreateTutorSessionInput): Promise<TutorSessionRecord>;
  getSession(
    sessionId: string,
    owner: StudentOwner,
  ): Promise<TutorSessionRecord | undefined>;
  listSessionsForStudent(owner: StudentOwner): Promise<TutorSessionRecord[]>;
  recordAttempt(
    input: RecordTutorSessionAttemptInput,
  ): Promise<TutorSessionRecord | undefined>;
  recordAttemptOutcome(
    input: RecordTutorSessionAttemptOutcomeInput,
  ): Promise<TutorSessionRecord | undefined>;
  revealHint(
    sessionId: string,
    owner: StudentOwner,
  ): Promise<TutorSessionRecord | undefined>;
  revealStep(
    sessionId: string,
    owner: StudentOwner,
  ): Promise<TutorSessionRecord | undefined>;
};

const memoryTutorSessionRepository = createMemoryTutorSessionRepository();
let tutorSessionRepositoryOverride: TutorSessionRepository | undefined;

export async function createTutorSession(
  authorization: StudentAuthorization,
  questionId: string,
) {
  const input: CreateTutorSessionInput = {
    owner: ownerFromAuthorization(authorization),
    questionId,
  };
  return writeWithConfiguredRepository((repository) =>
    repository.createSession(input),
  );
}

export async function getTutorSession(
  authorization: StudentAuthorization,
  sessionId: string,
) {
  const owner = ownerFromAuthorization(authorization);
  return readWithConfiguredRepository((repository) =>
    repository.getSession(sessionId, owner),
  );
}

export async function recordTutorSessionAttempt(
  authorization: StudentAuthorization,
  input: Omit<RecordTutorSessionAttemptInput, "owner">,
) {
  const authorizedInput = {
    ...input,
    owner: ownerFromAuthorization(authorization),
  };
  return writeWithConfiguredRepository((repository) =>
    repository.recordAttempt(authorizedInput),
  );
}

export async function recordTutorSessionAttemptOutcome(
  authorization: StudentAuthorization,
  input: Omit<RecordTutorSessionAttemptOutcomeInput, "owner">,
) {
  const authorizedInput = {
    ...input,
    owner: ownerFromAuthorization(authorization),
  };
  return writeWithConfiguredRepository((repository) =>
    repository.recordAttemptOutcome(authorizedInput),
  );
}

export async function listTutorSessionsForStudent(
  authorization: StudentAuthorization,
): Promise<{
  mode: "database" | "demo";
  sessions: TutorSessionRecord[];
}> {
  const owner = ownerFromAuthorization(authorization);
  const env = getServerEnv();
  const policy = getOperatingModePolicy();

  if (tutorSessionRepositoryOverride) {
    try {
      return {
        mode: policy.repositorySource,
        sessions:
          await tutorSessionRepositoryOverride.listSessionsForStudent(owner),
      };
    } catch (cause) {
      if (!policy.allowDemoFallback) {
        throw new DataServiceUnavailableError("tutor-session", { cause });
      }

      return {
        mode: "demo",
        sessions:
          await memoryTutorSessionRepository.listSessionsForStudent(owner),
      };
    }
  }

  if (policy.repositorySource === "demo") {
    return {
      mode: "demo",
      sessions:
        await memoryTutorSessionRepository.listSessionsForStudent(owner),
    };
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("tutor-session");
  }

  try {
    const repository = createDatabaseTutorSessionRepository(
      env.DATABASE_URL,
      queryPostgres,
    );
    return {
      mode: "database",
      sessions: await repository.listSessionsForStudent(owner),
    };
  } catch (cause) {
    if (!policy.allowDemoFallback) {
      throw new DataServiceUnavailableError("tutor-session", { cause });
    }

    return {
      mode: "demo",
      sessions:
        await memoryTutorSessionRepository.listSessionsForStudent(owner),
    };
  }
}

export async function revealTutorSessionHint(
  authorization: StudentAuthorization,
  sessionId: string,
) {
  const owner = ownerFromAuthorization(authorization);
  return writeWithConfiguredRepository((repository) =>
    repository.revealHint(sessionId, owner),
  );
}

export async function revealTutorSessionStep(
  authorization: StudentAuthorization,
  sessionId: string,
) {
  const owner = ownerFromAuthorization(authorization);
  return writeWithConfiguredRepository((repository) =>
    repository.revealStep(sessionId, owner),
  );
}

export function createMemoryTutorSessionRepository(): TutorSessionRepository {
  const sessions = new Map<
    string,
    { owner: StudentOwner; session: TutorSessionRecord }
  >();

  return {
    async createSession(input) {
      const session: TutorSessionRecord = {
        attempts: [],
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        lastSeenAt: new Date().toISOString(),
        questionId: input.questionId,
        revealedHints: 0,
        revealedSteps: 0,
      };

      sessions.set(session.id, {
        owner: input.owner,
        session: cloneSession(session),
      });
      return cloneSession(session);
    },

    async getSession(sessionId, owner) {
      const stored = sessions.get(sessionId);
      return stored && isSameOwner(stored.owner, owner)
        ? cloneSession(stored.session)
        : undefined;
    },

    async listSessionsForStudent(owner) {
      return [...sessions.values()]
        .filter((stored) => isSameOwner(stored.owner, owner))
        .sort((left, right) =>
          right.session.lastSeenAt.localeCompare(left.session.lastSeenAt),
        )
        .map((stored) => cloneSession(stored.session));
    },

    async recordAttempt(input) {
      const stored = sessions.get(input.sessionId);

      if (!stored || !isSameOwner(stored.owner, input.owner)) {
        return undefined;
      }
      const session = stored.session;

      session.attempts.push({
        answerPreview: previewString(input.answerPreview),
        createdAt: new Date().toISOString(),
        id: randomUUID(),
      });
      session.lastSeenAt = new Date().toISOString();
      stored.session = cloneSession(session);
      sessions.set(session.id, stored);
      return cloneSession(session);
    },

    async recordAttemptOutcome(input) {
      const stored = sessions.get(input.sessionId);

      if (!stored || !isSameOwner(stored.owner, input.owner)) {
        return undefined;
      }
      const session = stored.session;

      const pendingAttempt = [...session.attempts]
        .reverse()
        .find((attempt) => !attempt.verdict);
      if (pendingAttempt) {
        pendingAttempt.source = input.source;
        pendingAttempt.verdict = input.verdict;
      } else {
        session.attempts.push({
          answerPreview: previewString(input.answerPreview),
          createdAt: new Date().toISOString(),
          id: randomUUID(),
          source: input.source,
          verdict: input.verdict,
        });
      }
      session.lastSeenAt = new Date().toISOString();
      stored.session = cloneSession(session);
      sessions.set(session.id, stored);
      return cloneSession(session);
    },

    async revealHint(sessionId, owner) {
      const stored = sessions.get(sessionId);

      if (!stored || !isSameOwner(stored.owner, owner)) {
        return undefined;
      }
      const session = stored.session;

      session.revealedHints += 1;
      session.lastSeenAt = new Date().toISOString();
      stored.session = cloneSession(session);
      sessions.set(session.id, stored);
      return cloneSession(session);
    },

    async revealStep(sessionId, owner) {
      const stored = sessions.get(sessionId);

      if (!stored || !isSameOwner(stored.owner, owner)) {
        return undefined;
      }
      const session = stored.session;

      session.revealedSteps += 1;
      session.lastSeenAt = new Date().toISOString();
      stored.session = cloneSession(session);
      sessions.set(session.id, stored);
      return cloneSession(session);
    },
  };
}

export function createDatabaseTutorSessionRepository(
  databaseUrl: string,
  query: DatabaseQueryExecutor = createUnavailableQueryExecutor(databaseUrl),
): TutorSessionRepository {
  return {
    async createSession(input) {
      const rows = await query(
        `
          insert into tutor_sessions (
            id,
            anonymous_user_id,
            user_id,
            question_id,
            expires_at,
            revealed_hints,
            revealed_steps
          )
          values ($1, $2, $3, $4, $5, 0, 0)
          returning *
        `,
        [
          randomUUID(),
          input.owner.kind === "anonymous" ? input.owner.anonymousId : null,
          input.owner.kind === "user" ? input.owner.userId : null,
          input.questionId,
          input.owner.kind === "anonymous"
            ? new Date(
                Date.now() +
                  getServerEnv().ANONYMOUS_COOKIE_DAYS * 24 * 60 * 60 * 1_000,
              )
            : null,
        ],
      );

      return mapTutorSession(rows[0] as TutorSessionRow, []);
    },

    async getSession(sessionId, owner) {
      return readDatabaseSession(query, sessionId, owner);
    },

    async listSessionsForStudent(owner) {
      const rows = (await readDatabaseRows(
        query,
        `
          select *
          from tutor_sessions
          where (
            ($1 = 'user' and user_id = $2 and anonymous_user_id is null)
            or
            ($1 = 'anonymous' and anonymous_user_id = $2 and user_id is null)
          )
          order by last_seen_at desc, created_at desc
        `,
        [owner.kind, ownerIdentifier(owner)],
      )) as TutorSessionRow[];

      if (rows.length === 0) {
        return [];
      }

      const attemptRows = (await readDatabaseRows(
        query,
        `
          select session_id, id, answer_preview, source, verdict, created_at
          from attempts
          where session_id = any($1)
          order by session_id, created_at, id
        `,
        [rows.map((row) => row.id)],
      )) as TutorAttemptRow[];
      const attemptsBySession = new Map<string, TutorAttemptRow[]>();

      for (const attempt of attemptRows) {
        const sessionAttempts =
          attemptsBySession.get(attempt.session_id!) ?? [];
        sessionAttempts.push(attempt);
        attemptsBySession.set(attempt.session_id!, sessionAttempts);
      }

      return rows.map((row) =>
        mapTutorSession(row, attemptsBySession.get(row.id) ?? []),
      );
    },

    async recordAttempt(input) {
      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const session = await lockDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
          );

          if (!session) {
            return undefined;
          }

          await transactionQuery(
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
          );
          await touchDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
          );

          return readDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
          );
        },
        { retryOnConflict: true },
      );
    },

    async recordAttemptOutcome(input) {
      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const session = await lockDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
          );

          if (!session) {
            return undefined;
          }

          const updated = await transactionQuery(
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
            [
              input.sessionId,
              input.verdict,
              input.source,
              input.estimatedTokens,
            ],
          );

          if (updated.length === 0) {
            await transactionQuery(
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
            );
          }

          await touchDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
          );
          return readDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
          );
        },
        { retryOnConflict: true },
      );
    },

    async revealHint(sessionId, owner) {
      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const rows = await transactionQuery(
            `
              update tutor_sessions
              set revealed_hints = revealed_hints + 1,
                  last_seen_at = now()
              where id = $1
                and (
                  ($2 = 'user' and user_id = $3 and anonymous_user_id is null)
                  or
                  ($2 = 'anonymous' and anonymous_user_id = $3 and user_id is null)
                )
              returning *
            `,
            [sessionId, owner.kind, ownerIdentifier(owner)],
          );
          const row = rows[0] as TutorSessionRow | undefined;

          return row
            ? readDatabaseSessionAttempts(transactionQuery, row)
            : undefined;
        },
        { retryOnConflict: true },
      );
    },

    async revealStep(sessionId, owner) {
      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const rows = await transactionQuery(
            `
              update tutor_sessions
              set revealed_steps = revealed_steps + 1,
                  last_seen_at = now()
              where id = $1
                and (
                  ($2 = 'user' and user_id = $3 and anonymous_user_id is null)
                  or
                  ($2 = 'anonymous' and anonymous_user_id = $3 and user_id is null)
                )
              returning *
            `,
            [sessionId, owner.kind, ownerIdentifier(owner)],
          );
          const row = rows[0] as TutorSessionRow | undefined;

          return row
            ? readDatabaseSessionAttempts(transactionQuery, row)
            : undefined;
        },
        { retryOnConflict: true },
      );
    },
  };
}

export function resetTutorSessionsForTests() {
  const freshRepository = createMemoryTutorSessionRepository();
  Object.assign(memoryTutorSessionRepository, freshRepository);
  tutorSessionRepositoryOverride = undefined;
}

export function setTutorSessionRepositoryForTests(
  repository: TutorSessionRepository | undefined,
) {
  tutorSessionRepositoryOverride = repository;
}

async function readWithConfiguredRepository<T>(
  read: (repository: TutorSessionRepository) => Promise<T>,
) {
  const env = getServerEnv();
  const policy = getOperatingModePolicy();

  if (tutorSessionRepositoryOverride) {
    try {
      return await read(tutorSessionRepositoryOverride);
    } catch (cause) {
      if (!policy.allowDemoFallback) {
        throw new DataServiceUnavailableError("tutor-session", { cause });
      }

      return read(memoryTutorSessionRepository);
    }
  }

  if (policy.repositorySource === "demo") {
    return read(memoryTutorSessionRepository);
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("tutor-session");
  }

  try {
    return await read(
      createDatabaseTutorSessionRepository(env.DATABASE_URL, queryPostgres),
    );
  } catch (cause) {
    if (!policy.allowDemoFallback) {
      throw new DataServiceUnavailableError("tutor-session", { cause });
    }

    return read(memoryTutorSessionRepository);
  }
}

async function writeWithConfiguredRepository<T>(
  write: (repository: TutorSessionRepository) => Promise<T>,
) {
  const env = getServerEnv();
  const policy = getOperatingModePolicy();

  if (tutorSessionRepositoryOverride) {
    try {
      return await write(tutorSessionRepositoryOverride);
    } catch (cause) {
      throw new DataServiceUnavailableError("tutor-session", { cause });
    }
  }

  if (policy.repositorySource === "demo") {
    return write(memoryTutorSessionRepository);
  }

  if (!env.DATABASE_URL) {
    throw new DataServiceUnavailableError("tutor-session");
  }

  try {
    return await write(
      createDatabaseTutorSessionRepository(env.DATABASE_URL, queryPostgres),
    );
  } catch (cause) {
    // A failed database write must never be replayed against process memory.
    // The server cannot prove whether a connection failure happened before or
    // after commit, so callers receive a stable unavailable response instead.
    throw new DataServiceUnavailableError("tutor-session", { cause });
  }
}

async function readDatabaseSession(
  query: DatabaseQueryExecutor,
  sessionId: string,
  owner: StudentOwner,
): Promise<TutorSessionRecord | undefined> {
  const sessionRows = await readDatabaseRows(
    query,
    `
      select *
      from tutor_sessions
      where id = $1
        and (
          ($2 = 'user' and user_id = $3 and anonymous_user_id is null)
          or
          ($2 = 'anonymous' and anonymous_user_id = $3 and user_id is null)
        )
      limit 1
    `,
    [sessionId, owner.kind, ownerIdentifier(owner)],
  );
  const sessionRow = sessionRows[0] as TutorSessionRow | undefined;

  if (!sessionRow) {
    return undefined;
  }

  return readDatabaseSessionAttempts(query, sessionRow);
}

async function readDatabaseSessionAttempts(
  query: DatabaseQueryExecutor,
  sessionRow: TutorSessionRow,
) {
  const attemptRows = await readDatabaseRows(
    query,
    `
      select id, answer_preview, source, verdict, created_at
      from attempts
      where session_id = $1
      order by created_at, id
    `,
    [sessionRow.id],
  );

  return mapTutorSession(sessionRow, attemptRows as TutorAttemptRow[]);
}

function mapTutorSession(
  sessionRow: TutorSessionRow,
  attemptRows: TutorAttemptRow[],
): TutorSessionRecord {
  return {
    attempts: attemptRows.map(mapTutorAttempt),
    createdAt: toIsoString(sessionRow.created_at),
    id: String(sessionRow.id),
    lastSeenAt: toIsoString(sessionRow.last_seen_at),
    questionId: String(sessionRow.question_id),
    revealedHints: Number(sessionRow.revealed_hints ?? 0),
    revealedSteps: Number(sessionRow.revealed_steps ?? 0),
  };
}

function mapTutorAttempt(row: TutorAttemptRow): TutorSessionAttempt {
  return {
    answerPreview: row.answer_preview ?? undefined,
    createdAt: toIsoString(row.created_at),
    id: String(row.id),
    source: row.source ?? undefined,
    verdict: row.verdict ?? undefined,
  };
}

function cloneSession(session: TutorSessionRecord): TutorSessionRecord {
  return {
    ...session,
    attempts: session.attempts.map((attempt) => ({ ...attempt })),
  };
}

function previewString(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 80) : undefined;
}

async function lockDatabaseSession(
  query: DatabaseQueryExecutor,
  sessionId: string,
  owner: StudentOwner,
) {
  const rows = await readDatabaseRows(
    query,
    `
      select *
      from tutor_sessions
      where id = $1
        and (
          ($2 = 'user' and user_id = $3 and anonymous_user_id is null)
          or
          ($2 = 'anonymous' and anonymous_user_id = $3 and user_id is null)
        )
      for update
    `,
    [sessionId, owner.kind, ownerIdentifier(owner)],
  );
  const row = rows[0] as TutorSessionRow | undefined;

  return row ? mapTutorSession(row, []) : undefined;
}

async function touchDatabaseSession(
  query: DatabaseQueryExecutor,
  sessionId: string,
  owner: StudentOwner,
) {
  await query(
    `
      update tutor_sessions
      set last_seen_at = now()
      where id = $1
        and (
          ($2 = 'user' and user_id = $3 and anonymous_user_id is null)
          or
          ($2 = 'anonymous' and anonymous_user_id = $3 and user_id is null)
        )
    `,
    [sessionId, owner.kind, ownerIdentifier(owner)],
  );
}

function ownerIdentifier(owner: StudentOwner) {
  return owner.kind === "user" ? owner.userId : owner.anonymousId;
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function createUnavailableQueryExecutor(
  databaseUrl: string,
): DatabaseQueryExecutor {
  void databaseUrl;
  return async () => {
    throw new Error(
      "Tutor session repository has no configured query executor.",
    );
  };
}
