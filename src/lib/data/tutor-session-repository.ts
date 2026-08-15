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
  Difficulty,
  PracticeQuestion,
  ReviewStatus,
  SourceType,
  TrustLevel,
  TutorMode,
  TutorResponse,
  TutorSessionAttempt,
  TutorSessionEngineState,
  TutorSessionRecord,
  TutorSource,
  TutorState,
  TutorVerdict,
  Visibility,
} from "@/lib/types";
import {
  AUTHENTICATED_TUTOR_SESSION_RETENTION_DAYS,
  misconceptionFeedbackForPersistence,
  normalizedTutorAnswerForPersistence,
  redactTutorSessionText,
} from "@/lib/tutor/session-persistence";

type TutorSessionRow = {
  anonymous_user_id: string | null;
  attempt_count?: number;
  completed_at?: Date | string | null;
  creation_idempotency_key?: string;
  created_at: Date | string;
  current_state?: TutorState;
  expires_at?: Date | string | null;
  id: string;
  last_seen_at: Date | string;
  last_answer_fingerprint?: string | null;
  last_misconception_ids_json?: unknown;
  llm_used?: boolean;
  question_id: string;
  question_snapshot_json?: unknown;
  question_title?: string | null;
  question_version_id: number | string;
  revealed_hints: number;
  revealed_steps: number;
  retrieval_used?: boolean;
  revision?: number | string;
  solved?: boolean;
  status: "active" | "completed" | "expired" | "content_unpublished";
  topic_id?: string | null;
  user_id: string | null;
  wrong_attempt_count?: number;
};

type TutorAttemptRow = {
  answer_preview: string | null;
  context_used?: boolean;
  created_at: Date | string;
  estimated_tokens?: number;
  fallback_used?: boolean;
  id: number | string;
  idempotency_key?: string;
  misconception_feedback_json?: unknown;
  mode?: TutorMode;
  normalized_answer?: string | null;
  response_label?: TutorResponse["responseLabel"] | null;
  session_id?: string;
  source: TutorSource | null;
  submitted_answer?: string | null;
  tutor_state?: TutorState | null;
  verdict: TutorVerdict | null;
};

export type CreateTutorSessionInput = {
  idempotencyKey?: string;
  owner: StudentOwner;
  questionId: string;
};

export type RecordTutorSessionAttemptInput = {
  answerPreview?: string;
  idempotencyKey?: string;
  owner: StudentOwner;
  sessionId: string;
};

export type RecordTutorSessionAttemptOutcomeInput = {
  answerPreview?: string;
  estimatedTokens: number;
  idempotencyKey?: string;
  owner: StudentOwner;
  sessionId: string;
  source: TutorSource;
  verdict: TutorVerdict;
};

export type PersistTutorSessionTransitionInput = {
  expectedRevision: number;
  idempotencyKey: string;
  mode: TutorMode;
  normalizedAnswer?: string;
  owner: StudentOwner;
  response: Pick<
    TutorResponse,
    "misconceptions" | "responseLabel" | "source" | "usage" | "verdict"
  >;
  sessionId: string;
  state: TutorSessionEngineState;
  submittedAnswer?: string;
};

export type PersistTutorSessionTransitionResult =
  | { outcome: "applied" | "idempotent"; session: TutorSessionRecord }
  | { outcome: "conflict"; session: TutorSessionRecord }
  | { outcome: "not_found" };

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
  persistTransition(
    input: PersistTutorSessionTransitionInput,
  ): Promise<PersistTutorSessionTransitionResult>;
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
  idempotencyKey?: string,
) {
  const input: CreateTutorSessionInput = {
    idempotencyKey,
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

export async function persistTutorSessionTransition(
  authorization: StudentAuthorization,
  input: Omit<PersistTutorSessionTransitionInput, "owner">,
) {
  const authorizedInput = {
    ...input,
    misconceptionFeedback: misconceptionFeedbackForPersistence(
      input.response.misconceptions,
    ),
    normalizedAnswer: normalizedTutorAnswerForPersistence(
      input.normalizedAnswer ?? input.submittedAnswer,
    ),
    owner: ownerFromAuthorization(authorization),
    submittedAnswer: redactTutorSessionText(input.submittedAnswer),
  };
  const response = {
    ...authorizedInput.response,
    misconceptions: authorizedInput.misconceptionFeedback,
  };

  return writeWithConfiguredRepository((repository) =>
    repository.persistTransition({
      ...authorizedInput,
      response,
    }),
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
      if (input.idempotencyKey) {
        const existing = [...sessions.values()].find(
          (stored) =>
            isSameOwner(stored.owner, input.owner) &&
            stored.session.idempotencyKey === input.idempotencyKey,
        );
        if (existing) {
          if (existing.session.questionId !== input.questionId) {
            throw new Error("Tutor session idempotency conflict.");
          }
          return cloneSession(existing.session);
        }
      }

      const createdAt = new Date();
      const session: TutorSessionRecord = {
        attemptCount: 0,
        attempts: [],
        createdAt: createdAt.toISOString(),
        currentState: "working",
        engineState: initialEngineState("", input.questionId),
        expiresAt: new Date(
          createdAt.getTime() +
            retentionDaysForOwner(input.owner) * 24 * 60 * 60 * 1_000,
        ).toISOString(),
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
        lastSeenAt: createdAt.toISOString(),
        llmUsed: false,
        questionId: input.questionId,
        revealedHints: 0,
        revealedSteps: 0,
        retrievalUsed: false,
        revision: 0,
        solved: false,
        status: "active",
        wrongAttemptCount: 0,
      };
      session.engineState = initialEngineState(session.id, input.questionId);

      sessions.set(session.id, {
        owner: input.owner,
        session: cloneSession(session),
      });
      return cloneSession(session);
    },

    async getSession(sessionId, owner) {
      const stored = sessions.get(sessionId);
      return stored &&
        isSameOwner(stored.owner, owner) &&
        stored.session.status !== "expired" &&
        (!stored.session.expiresAt ||
          new Date(stored.session.expiresAt).getTime() > Date.now())
        ? cloneSession(stored.session)
        : undefined;
    },

    async listSessionsForStudent(owner) {
      return [...sessions.values()]
        .filter(
          (stored) =>
            isSameOwner(stored.owner, owner) &&
            stored.session.status !== "expired" &&
            (!stored.session.expiresAt ||
              new Date(stored.session.expiresAt).getTime() > Date.now()),
        )
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
      if (session.status !== "active") {
        return undefined;
      }
      const existing = input.idempotencyKey
        ? session.attempts.find(
            (attempt) => attempt.idempotencyKey === input.idempotencyKey,
          )
        : undefined;
      if (existing) {
        return cloneSession(session);
      }

      session.attempts.push({
        answerPreview: previewString(input.answerPreview),
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
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

      const settled = input.idempotencyKey
        ? session.attempts.find(
            (attempt) =>
              attempt.idempotencyKey === input.idempotencyKey &&
              Boolean(attempt.verdict),
          )
        : undefined;
      if (settled) {
        return cloneSession(session);
      }

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
          idempotencyKey: input.idempotencyKey,
          source: input.source,
          verdict: input.verdict,
        });
      }
      session.lastSeenAt = new Date().toISOString();
      stored.session = cloneSession(session);
      sessions.set(session.id, stored);
      return cloneSession(session);
    },

    async persistTransition(input) {
      const stored = sessions.get(input.sessionId);
      if (!stored || !isSameOwner(stored.owner, input.owner)) {
        return { outcome: "not_found" };
      }

      const session = stored.session;
      if (session.status !== "active") {
        return { outcome: "not_found" };
      }
      const existing = session.attempts.find(
        (attempt) => attempt.idempotencyKey === input.idempotencyKey,
      );
      if (existing?.verdict) {
        return { outcome: "idempotent", session: cloneSession(session) };
      }
      if ((session.revision ?? 0) !== input.expectedRevision) {
        return { outcome: "conflict", session: cloneSession(session) };
      }

      const now = new Date().toISOString();
      const attempt: TutorSessionAttempt = existing ?? {
        createdAt: now,
        id: randomUUID(),
        idempotencyKey: input.idempotencyKey,
      };
      Object.assign(attempt, {
        answerPreview: input.submittedAnswer?.slice(0, 80),
        contextUsed: input.response.usage.contextUsed,
        fallbackUsed: input.response.usage.fallbackUsed,
        estimatedTokens: input.response.usage.estimatedTokens,
        misconceptionFeedback: [...input.response.misconceptions],
        mode: input.mode,
        normalizedAnswer: input.normalizedAnswer,
        responseLabel: input.response.responseLabel,
        source: input.response.source,
        state: input.state.state,
        submittedAnswer: input.submittedAnswer,
        verdict: input.response.verdict,
      });
      if (!existing) {
        session.attempts.push(attempt);
      }

      applyEngineStateToSession(session, input.state, now);
      session.revision = (session.revision ?? 0) + 1;
      stored.session = cloneSession(session);
      sessions.set(session.id, stored);
      return { outcome: "applied", session: cloneSession(session) };
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
      return runDatabaseTransaction(query, async (transactionQuery) => {
        const idempotencyKey = input.idempotencyKey ?? randomUUID();
        const ownerId = ownerIdentifier(input.owner);
        const rows = await transactionQuery(
          `
            insert into tutor_sessions (
              id,
              anonymous_user_id,
              user_id,
              question_id,
              expires_at,
              revealed_hints,
              revealed_steps,
              creation_idempotency_key
            )
            values ($1, $2, $3, $4, $5, 0, 0, $6)
            on conflict do nothing
            returning *
          `,
          [
            randomUUID(),
            input.owner.kind === "anonymous" ? ownerId : null,
            input.owner.kind === "user" ? ownerId : null,
            input.questionId,
            new Date(
              Date.now() +
                retentionDaysForOwner(input.owner) * 24 * 60 * 60 * 1_000,
            ),
            idempotencyKey,
          ],
        );
        const row = (rows[0] ??
          (
            await readDatabaseRows(
              transactionQuery,
              `
                select *
                from tutor_sessions
                where question_id = $1
                  and creation_idempotency_key = $2
                  and (
                    ($3 = 'user' and user_id = $4 and anonymous_user_id is null)
                    or
                    ($3 = 'anonymous' and anonymous_user_id = $4 and user_id is null)
                  )
                limit 1
              `,
              [input.questionId, idempotencyKey, input.owner.kind, ownerId],
            )
          )[0]) as TutorSessionRow | undefined;

        if (!row) {
          throw new Error("Tutor session idempotency conflict.");
        }
        return mapTutorSession(row, []);
      });
    },

    async getSession(sessionId, owner) {
      return readDatabaseSession(query, sessionId, owner);
    },

    async listSessionsForStudent(owner) {
      const rows = (await readDatabaseRows(
        query,
        `
          select
            s.*,
            qv.snapshot_json as question_snapshot_json,
            qv.snapshot_json ->> 'title' as question_title,
            qv.snapshot_json ->> 'topicId' as topic_id
          from tutor_sessions s
          join question_versions qv on qv.id = s.question_version_id
          where (
            ($1 = 'user' and s.user_id = $2 and s.anonymous_user_id is null)
            or
            ($1 = 'anonymous' and s.anonymous_user_id = $2 and s.user_id is null)
          )
            and s.status <> 'expired'
            and s.expires_at > now()
          order by s.last_seen_at desc, s.created_at desc
        `,
        [owner.kind, ownerIdentifier(owner)],
      )) as TutorSessionRow[];

      if (rows.length === 0) {
        return [];
      }

      const attemptRows = (await readDatabaseRows(
        query,
        `
          select
            session_id,
            id,
            answer_preview,
            source,
            verdict,
            created_at,
            estimated_tokens,
            idempotency_key,
            submitted_answer,
            normalized_answer,
            tutor_state,
            misconception_feedback_json,
            context_used,
            fallback_used,
            response_label,
            mode
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

    async persistTransition(input) {
      return runDatabaseTransaction(
        query,
        async (transactionQuery) => {
          const session = await lockDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
          );
          if (!session) {
            return { outcome: "not_found" };
          }

          const existingRows = await readDatabaseRows(
            transactionQuery,
            `
              select id, verdict
              from attempts
              where session_id = $1
                and idempotency_key = $2
              limit 1
            `,
            [input.sessionId, input.idempotencyKey],
          );
          if (existingRows[0]?.verdict) {
            const current = await readDatabaseSession(
              transactionQuery,
              input.sessionId,
              input.owner,
            );
            return current
              ? { outcome: "idempotent", session: current }
              : { outcome: "not_found" };
          }

          if ((session.revision ?? 0) !== input.expectedRevision) {
            const current = await readDatabaseSession(
              transactionQuery,
              input.sessionId,
              input.owner,
            );
            return current
              ? { outcome: "conflict", session: current }
              : { outcome: "not_found" };
          }

          const nextRevision = input.expectedRevision + 1;
          const completed = input.state.solved;
          const updatedRows = await transactionQuery(
            `
              update tutor_sessions
              set current_state = $4,
                  attempt_count = $5,
                  wrong_attempt_count = $6,
                  revealed_hints = $7,
                  revealed_steps = $8,
                  solved = $9,
                  retrieval_used = $10,
                  llm_used = $11,
                  last_answer_fingerprint = $12,
                  last_misconception_ids_json = $13::jsonb,
                  status = case when $9 then 'completed' else status end,
                  completed_at = case
                    when $9 then coalesce(completed_at, now())
                    else completed_at
                  end,
                  last_seen_at = now(),
                  revision = $14
              where id = $1
                and revision = $2
                and status = 'active'
                and expires_at > now()
                and (
                  ($3 = 'user' and user_id = $15 and anonymous_user_id is null)
                  or
                  ($3 = 'anonymous' and anonymous_user_id = $15 and user_id is null)
                )
              returning *
            `,
            [
              input.sessionId,
              input.expectedRevision,
              input.owner.kind,
              input.state.state,
              input.state.attemptCount,
              input.state.wrongAttemptCount,
              input.state.hintsRevealed,
              input.state.stepsRevealed,
              completed,
              input.state.retrievalUsed,
              input.state.llmUsed,
              input.state.lastAnswerFingerprint ?? null,
              JSON.stringify(input.state.lastMisconceptionIds),
              nextRevision,
              ownerIdentifier(input.owner),
            ],
          );
          if (!updatedRows[0]) {
            const current = await readDatabaseSession(
              transactionQuery,
              input.sessionId,
              input.owner,
            );
            return current
              ? { outcome: "conflict", session: current }
              : { outcome: "not_found" };
          }

          await transactionQuery(
            `
              insert into attempts (
                session_id,
                question_id,
                mode,
                answer_preview,
                source,
                verdict,
                estimated_tokens,
                idempotency_key,
                submitted_answer,
                normalized_answer,
                tutor_state,
                misconception_feedback_json,
                context_used,
                fallback_used,
                response_label,
                progress_revision
              )
              values (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12::jsonb, $13, $14, $15, $16
              )
              on conflict (session_id, idempotency_key) do update
              set source = excluded.source,
                  verdict = excluded.verdict,
                  estimated_tokens = excluded.estimated_tokens,
                  submitted_answer = excluded.submitted_answer,
                  normalized_answer = excluded.normalized_answer,
                  tutor_state = excluded.tutor_state,
                  misconception_feedback_json = excluded.misconception_feedback_json,
                  context_used = excluded.context_used,
                  fallback_used = excluded.fallback_used,
                  response_label = excluded.response_label,
                  progress_revision = excluded.progress_revision
              where attempts.verdict is null
            `,
            [
              input.sessionId,
              session.questionId,
              input.mode,
              input.submittedAnswer?.slice(0, 80) ?? null,
              input.response.source,
              input.response.verdict,
              input.response.usage.estimatedTokens,
              input.idempotencyKey,
              input.submittedAnswer ?? null,
              input.normalizedAnswer ?? null,
              input.state.state,
              JSON.stringify(input.response.misconceptions),
              input.response.usage.contextUsed,
              input.response.usage.fallbackUsed,
              input.response.responseLabel ?? null,
              nextRevision,
            ],
          );

          const current = await readDatabaseSession(
            transactionQuery,
            input.sessionId,
            input.owner,
            { includeCompleted: true },
          );
          return current
            ? { outcome: "applied", session: current }
            : { outcome: "not_found" };
        },
        { retryOnConflict: true },
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
            estimated_tokens,
            idempotency_key
          )
          values ($1, $2, 'check', $3, 'rule', 0, $4)
          on conflict (session_id, idempotency_key) do nothing
        `,
            [
              input.sessionId,
              session.questionId,
              previewString(input.answerPreview) ?? null,
              input.idempotencyKey ?? randomUUID(),
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
              estimated_tokens,
              idempotency_key
            )
            values ($1, $2, 'check', $3, $4, $5, $6, $7)
          `,
              [
                input.sessionId,
                session.questionId,
                previewString(input.answerPreview) ?? null,
                input.source,
                input.verdict,
                input.estimatedTokens,
                input.idempotencyKey ?? randomUUID(),
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
  options: { includeCompleted?: boolean } = {},
): Promise<TutorSessionRecord | undefined> {
  const sessionRows = await readDatabaseRows(
    query,
    `
      select
        s.*,
        qv.snapshot_json as question_snapshot_json,
        qv.snapshot_json ->> 'title' as question_title,
        qv.snapshot_json ->> 'topicId' as topic_id
      from tutor_sessions s
      join question_versions qv on qv.id = s.question_version_id
      where s.id = $1
        and (
          s.status = 'active'
          or ($4 = true and s.status = 'completed')
        )
        and s.expires_at > now()
        and (
          ($2 = 'user' and s.user_id = $3 and s.anonymous_user_id is null)
          or
          ($2 = 'anonymous' and s.anonymous_user_id = $3 and s.user_id is null)
        )
      limit 1
    `,
    [
      sessionId,
      owner.kind,
      ownerIdentifier(owner),
      options.includeCompleted ?? true,
    ],
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
      select
        id,
        answer_preview,
        source,
        verdict,
        created_at,
        estimated_tokens,
        idempotency_key,
        submitted_answer,
        normalized_answer,
        tutor_state,
        misconception_feedback_json,
        context_used,
        fallback_used,
        response_label,
        mode
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
  const engineState = engineStateFromRow(sessionRow);

  return {
    attemptCount: Number(sessionRow.attempt_count ?? 0),
    attempts: attemptRows.map(mapTutorAttempt),
    completedAt: toOptionalIsoString(sessionRow.completed_at),
    createdAt: toIsoString(sessionRow.created_at),
    currentState: sessionRow.current_state ?? "working",
    engineState,
    expiresAt: toOptionalIsoString(sessionRow.expires_at),
    id: String(sessionRow.id),
    idempotencyKey: sessionRow.creation_idempotency_key,
    lastSeenAt: toIsoString(sessionRow.last_seen_at),
    llmUsed: Boolean(sessionRow.llm_used),
    questionId: String(sessionRow.question_id),
    questionTitle: sessionRow.question_title ?? undefined,
    questionVersionId: Number(sessionRow.question_version_id),
    questionVersion: practiceQuestionFromSnapshot(
      sessionRow.question_snapshot_json,
      String(sessionRow.question_id),
    ),
    revealedHints: Number(sessionRow.revealed_hints ?? 0),
    revealedSteps: Number(sessionRow.revealed_steps ?? 0),
    retrievalUsed: Boolean(sessionRow.retrieval_used),
    revision: Number(sessionRow.revision ?? 0),
    solved: Boolean(sessionRow.solved),
    status: sessionRow.status,
    topicId: sessionRow.topic_id ?? undefined,
    wrongAttemptCount: Number(sessionRow.wrong_attempt_count ?? 0),
  };
}

function mapTutorAttempt(row: TutorAttemptRow): TutorSessionAttempt {
  return {
    answerPreview: row.answer_preview ?? undefined,
    contextUsed: row.context_used,
    createdAt: toIsoString(row.created_at),
    estimatedTokens: Number(row.estimated_tokens ?? 0),
    fallbackUsed: row.fallback_used,
    id: String(row.id),
    idempotencyKey: row.idempotency_key,
    misconceptionFeedback: stringArray(row.misconception_feedback_json),
    mode: row.mode,
    normalizedAnswer: row.normalized_answer ?? undefined,
    responseLabel: row.response_label ?? undefined,
    source: row.source ?? undefined,
    state: row.tutor_state ?? undefined,
    submittedAnswer: row.submitted_answer ?? undefined,
    verdict: row.verdict ?? undefined,
  };
}

function cloneSession(session: TutorSessionRecord): TutorSessionRecord {
  return {
    ...session,
    attempts: session.attempts.map((attempt) => ({
      ...attempt,
      misconceptionFeedback: attempt.misconceptionFeedback
        ? [...attempt.misconceptionFeedback]
        : undefined,
    })),
    engineState: session.engineState
      ? {
          ...session.engineState,
          lastMisconceptionIds: [...session.engineState.lastMisconceptionIds],
        }
      : undefined,
    questionVersion: session.questionVersion
      ? structuredClone(session.questionVersion)
      : undefined,
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
        and status = 'active'
        and expires_at > now()
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
        and status = 'active'
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

function toOptionalIsoString(value: Date | string | null | undefined) {
  return value ? toIsoString(value) : undefined;
}

function retentionDaysForOwner(owner: StudentOwner) {
  return owner.kind === "user"
    ? AUTHENTICATED_TUTOR_SESSION_RETENTION_DAYS
    : 30;
}

function initialEngineState(
  sessionId: string,
  questionId: string,
): TutorSessionEngineState {
  return {
    attemptCount: 0,
    hintsRevealed: 0,
    lastMisconceptionIds: [],
    llmUsed: false,
    questionKey: questionId,
    retrievalUsed: false,
    sessionId,
    solved: false,
    state: "working",
    stepsRevealed: 0,
    wrongAttemptCount: 0,
  };
}

function engineStateFromRow(row: TutorSessionRow): TutorSessionEngineState {
  return {
    attemptCount: Number(row.attempt_count ?? 0),
    hintsRevealed: Number(row.revealed_hints ?? 0),
    lastAnswerFingerprint: row.last_answer_fingerprint ?? undefined,
    lastMisconceptionIds: stringArray(row.last_misconception_ids_json),
    llmUsed: Boolean(row.llm_used),
    questionKey: String(row.question_id),
    retrievalUsed: Boolean(row.retrieval_used),
    sessionId: String(row.id),
    solved: Boolean(row.solved),
    state: row.current_state ?? "working",
    stepsRevealed: Number(row.revealed_steps ?? 0),
    wrongAttemptCount: Number(row.wrong_attempt_count ?? 0),
  };
}

function applyEngineStateToSession(
  session: TutorSessionRecord,
  state: TutorSessionEngineState,
  occurredAt: string,
) {
  session.attemptCount = state.attemptCount;
  session.currentState = state.state;
  session.engineState = {
    ...state,
    lastMisconceptionIds: [...state.lastMisconceptionIds],
  };
  session.lastSeenAt = occurredAt;
  session.llmUsed = state.llmUsed;
  session.retrievalUsed = state.retrievalUsed;
  session.revealedHints = state.hintsRevealed;
  session.revealedSteps = state.stepsRevealed;
  session.solved = state.solved;
  session.wrongAttemptCount = state.wrongAttemptCount;
  if (state.solved) {
    session.completedAt ??= occurredAt;
    session.status = "completed";
  }
}

function practiceQuestionFromSnapshot(
  value: unknown,
  expectedQuestionId: string,
): PracticeQuestion | undefined {
  const snapshot = recordValue(value);
  if (!snapshot || snapshot.id !== expectedQuestionId) {
    return undefined;
  }

  const id = stringValue(snapshot.id);
  const topicId = stringValue(snapshot.topicId);
  const title = stringValue(snapshot.title);
  const prompt = stringValue(snapshot.prompt);
  const explanation = stringValue(snapshot.answerExplanation);
  const difficulty = enumValue(snapshot.difficulty, [
    "foundational",
    "intermediate",
    "challenge",
  ] satisfies Difficulty[]);
  const sourceType = enumValue(snapshot.sourceType, [
    "original_demo",
    "professor_provided",
    "generated_original",
    "pattern_derived_original",
    "private_reference_pattern",
  ] satisfies SourceType[]);
  const snapshotTrustLevel = enumValue(snapshot.trustLevel, [
    "public_original",
    "professor_approved",
    "course_approved",
    "generated_unverified",
    "private_reference",
  ] satisfies TrustLevel[]);
  const visibility = enumValue(snapshot.visibility, [
    "public",
    "private",
  ] satisfies Visibility[]);
  const reviewStatus = enumValue(snapshot.reviewStatus, [
    "approved",
    "needs_review",
    "rejected",
    "needs_edit",
    "needs_regeneration",
  ] satisfies ReviewStatus[]);
  const acceptedAnswers = stringArray(snapshot.acceptedAnswers);
  const trustLevel =
    sourceType === "generated_original" ||
    sourceType === "pattern_derived_original"
      ? "professor_approved"
      : snapshotTrustLevel;

  if (
    !id ||
    !topicId ||
    !title ||
    !prompt ||
    !explanation ||
    !difficulty ||
    !sourceType ||
    !trustLevel ||
    !visibility ||
    acceptedAnswers.length === 0
  ) {
    return undefined;
  }

  return {
    answer: {
      acceptedAnswers,
      explanation,
      numericValue: finiteNumber(snapshot.numericValue),
      tolerance: finiteNumber(snapshot.tolerance),
    },
    difficulty,
    hints: orderedBodies(snapshot.hints),
    id,
    misconceptions: Array.isArray(snapshot.misconceptions)
      ? snapshot.misconceptions.flatMap((item) => {
          const misconception = recordValue(item);
          const misconceptionId = stringValue(misconception?.id);
          const feedback = stringValue(misconception?.feedback);
          return misconceptionId && feedback
            ? [
                {
                  feedback,
                  id: misconceptionId,
                  matchTerms: stringArray(misconception?.matchTerms),
                },
              ]
            : [];
        })
      : [],
    prompt,
    review: { status: reviewStatus ?? "approved" },
    solutionSteps: orderedBodies(snapshot.solutionSteps),
    source: {
      originalityNote: stringValue(snapshot.originalityNote),
      patternIds: stringValue(snapshot.patternId)
        ? [stringValue(snapshot.patternId)!]
        : undefined,
      sourceType,
      trustLevel,
      visibility,
    },
    title,
    topicId,
  };
}

function orderedBodies(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) =>
      typeof item === "string" ? item : stringValue(recordValue(item)?.body),
    )
    .filter((item): item is string => Boolean(item));
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function enumValue<const T extends string>(
  value: unknown,
  values: readonly T[],
): T | undefined {
  return typeof value === "string" && values.includes(value as T)
    ? (value as T)
    : undefined;
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
