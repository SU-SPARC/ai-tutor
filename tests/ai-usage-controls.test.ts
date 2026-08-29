import { PGlite } from "@electric-sql/pglite"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  accountingForGeneratedResponse,
  applyTutorAiAccounting,
  AiGenerationInProgressError,
  prepareTutorAiGeneration,
  releaseTutorAiReservation,
  resetAiUsageControlsForTests,
  type TutorAiExecutionContext,
} from "@/lib/ai/usage-controls"
import type { LlmTutorInput } from "@/lib/ai/llm-tutor"
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor"

const openDatabases: PGlite[] = []

describe("production AI usage controls", () => {
  afterEach(async () => {
    vi.useRealTimers()
    resetAiUsageControlsForTests()
    vi.unstubAllEnvs()
    await Promise.all(
      openDatabases.splice(0).map((database) => database.close()),
    )
  })

  it("caches guarded output for the same student without a provider token charge", async () => {
    enableTestAi()
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_SESSION", "1")
    const context = executionContext("student-a")
    const prepared = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )

    expect(prepared.outcome).toBe("reserved")
    const accounting = accountingForGeneratedResponse(
      accountingFrom(prepared),
      {
        contextUsed: true,
        estimatedTokens: {
          ...estimatedTokens(),
          providerCompletionTokens: 20,
          providerPromptTokens: 80,
          providerTotalTokens: 100,
        },
        fallbackUsed: true,
        providerAttempts: 1,
        tutorMessage: "Start with the conditioned sample space.",
      },
      "approved_course_content",
    )
    await applyTutorAiAccounting(accounting)

    const cached = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )

    expect(cached.outcome).toBe("cache_hit")
    if (cached.outcome === "cache_hit") {
      expect(cached.cacheResult).toMatchObject({
        fallbackUsed: true,
        providerAttempts: 0,
        tutorMessage: "Start with the conditioned sample space.",
      })
      expect(cached.cacheResult.estimatedTokens?.estimatedTotalTokens).toBe(0)
    }
  })

  it("never shares a cache entry across students", async () => {
    enableTestAi()
    const first = await prepareTutorAiGeneration(
      executionContext("student-a"),
      promptInput(),
      estimatedTokens(),
    )
    const accounting = accountingForGeneratedResponse(
      accountingFrom(first),
      {
        contextUsed: false,
        fallbackUsed: true,
        providerAttempts: 1,
        tutorMessage: "Use the next approved step.",
      },
      "general_ai_help",
    )
    await applyTutorAiAccounting(accounting)

    const second = await prepareTutorAiGeneration(
      executionContext("student-b"),
      promptInput(),
      estimatedTokens(),
    )

    expect(second.outcome).toBe("reserved")
    expect(accountingFrom(second).studentKeyHash).not.toBe(
      accountingFrom(first).studentKeyHash,
    )
  })

  it("permits only one in-flight generation per session", async () => {
    enableTestAi()
    const firstContext = executionContext("student-a")
    await prepareTutorAiGeneration(
      firstContext,
      promptInput(),
      estimatedTokens(),
    )

    await expect(
      prepareTutorAiGeneration(
        { ...firstContext, eventId: "event:second" },
        promptInput(),
        estimatedTokens(),
      ),
    ).rejects.toBeInstanceOf(AiGenerationInProgressError)
  })

  it("expires cached guidance and invalidates it when session state changes", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-25T12:00:00Z"))
    enableTestAi()
    const context = executionContext("student-a")
    const prepared = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )
    await applyTutorAiAccounting(
      accountingForGeneratedResponse(
        accountingFrom(prepared),
        {
          contextUsed: false,
          fallbackUsed: true,
          providerAttempts: 1,
          tutorMessage: "Use the event definition before selecting a formula.",
        },
        "general_ai_help",
      ),
    )

    const changedState = await prepareTutorAiGeneration(
      { ...context, eventId: "event:changed", expectedRevision: 4 },
      promptInput(),
      estimatedTokens(),
    )
    expect(changedState.outcome).toBe("reserved")
    await releaseTutorAiReservation(accountingFrom(changedState))

    vi.advanceTimersByTime(15 * 60 * 1_000 + 1)
    const expired = await prepareTutorAiGeneration(
      { ...context, eventId: "event:expired" },
      promptInput(),
      estimatedTokens(),
    )
    expect(expired.outcome).toBe("reserved")
  })

  it("releases a failed generation without caching it", async () => {
    enableTestAi()
    const context = executionContext("student-a")
    const prepared = await prepareTutorAiGeneration(
      context,
      promptInput(),
      estimatedTokens(),
    )
    const failedAccounting = accountingForGeneratedResponse(
      accountingFrom(prepared),
      {
        contextUsed: false,
        error: "provider_unavailable",
        fallbackUsed: false,
        providerAttempts: 2,
        tutorMessage: "AI help is temporarily unavailable.",
      },
      "general_ai_help",
    )
    expect(failedAccounting).toMatchObject({
      providerCalls: 2,
      providerInputTokens: 160,
      providerOutputTokens: 200,
      providerTotalTokens: 360,
      usageIsEstimate: true,
    })
    await applyTutorAiAccounting(failedAccounting)

    const retry = await prepareTutorAiGeneration(
      { ...context, eventId: "event:retry" },
      promptInput(),
      estimatedTokens(),
    )

    expect(retry.outcome).toBe("reserved")
    expect(accountingFrom(retry).providerCalls).toBe(0)
  })

  it("enforces the per-session LLM request allowance", async () => {
    enableTestAi()
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_SESSION", "2")
    vi.stubEnv("AI_LLM_BURST_MAX_REQUESTS", "10")

    await consumeMemoryRequest({ eventId: "event:session-1", revision: 1 })
    await consumeMemoryRequest({ eventId: "event:session-2", revision: 2 })
    const blocked = await prepareTutorAiGeneration(
      {
        ...executionContext("student-a"),
        eventId: "event:session-3",
        expectedRevision: 3,
      },
      promptInput(),
      estimatedTokens(),
    )

    expect(blocked).toMatchObject({
      outcome: "blocked",
      reason: "session_limit",
    })
    if (blocked.outcome === "blocked") {
      expect(blocked.message).toContain("allowance")
      expect(blocked.message).not.toMatch(/token|provider|billing/i)
    }
  })

  it("enforces a per-student question allowance across sessions", async () => {
    enableTestAi()
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_SESSION", "10")
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_STUDENT_QUESTION", "2")
    vi.stubEnv("AI_LLM_BURST_MAX_REQUESTS", "10")

    await consumeMemoryRequest({
      eventId: "event:question-1",
      revision: 1,
      sessionId: "session-1",
    })
    await consumeMemoryRequest({
      eventId: "event:question-2",
      revision: 2,
      sessionId: "session-2",
    })
    const blocked = await prepareTutorAiGeneration(
      {
        ...executionContext("student-a"),
        eventId: "event:question-3",
        expectedRevision: 3,
        sessionId: "session-3",
      },
      promptInput(),
      estimatedTokens(),
    )

    expect(blocked).toMatchObject({
      outcome: "blocked",
      reason: "question_limit",
    })
  })

  it("enforces the configured daily pilot allowance", async () => {
    enableTestAi()
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_SESSION", "10")
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_STUDENT_QUESTION", "10")
    vi.stubEnv("AI_LLM_DAILY_REQUEST_LIMIT", "2")
    vi.stubEnv("AI_LLM_BURST_MAX_REQUESTS", "10")

    await consumeMemoryRequest({
      eventId: "event:daily-1",
      revision: 1,
      sessionId: "session-1",
    })
    await consumeMemoryRequest({
      eventId: "event:daily-2",
      revision: 2,
      sessionId: "session-2",
    })
    const blocked = await prepareTutorAiGeneration(
      {
        ...executionContext("student-a"),
        eventId: "event:daily-3",
        expectedRevision: 3,
        sessionId: "session-3",
      },
      promptInput(),
      estimatedTokens(),
    )

    expect(blocked).toMatchObject({
      outcome: "blocked",
      reason: "daily_limit",
    })
  })

  it("applies an owner-scoped LLM burst limit", async () => {
    enableTestAi()
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_SESSION", "10")
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_STUDENT_QUESTION", "10")
    vi.stubEnv("AI_LLM_BURST_MAX_REQUESTS", "2")
    vi.stubEnv("AI_LLM_BURST_WINDOW_SECONDS", "60")

    await consumeMemoryRequest({
      eventId: "event:burst-1",
      revision: 1,
      sessionId: "session-1",
    })
    await consumeMemoryRequest({
      eventId: "event:burst-2",
      revision: 2,
      sessionId: "session-2",
    })
    const blocked = await prepareTutorAiGeneration(
      {
        ...executionContext("student-a"),
        eventId: "event:burst-3",
        expectedRevision: 3,
        sessionId: "session-3",
      },
      promptInput(),
      estimatedTokens(),
    )

    expect(blocked).toMatchObject({
      outcome: "blocked",
      reason: "burst_limit",
      retryAfterSeconds: 60,
    })
  })

  it("uses AI_ENABLED as a provider kill switch before reserving usage", async () => {
    vi.stubEnv("AI_ENABLED", "false")
    vi.stubEnv("OPENROUTER_API_KEY", "")

    const blocked = await prepareTutorAiGeneration(
      executionContext("student-a"),
      promptInput(),
      estimatedTokens(),
    )

    expect(blocked).toMatchObject({
      outcome: "blocked",
      reason: "ai_disabled",
    })
  })

  it("atomically reserves only one configured daily request across sessions", async () => {
    enableTestAi()
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_SESSION", "10")
    vi.stubEnv("AI_LLM_MAX_REQUESTS_PER_STUDENT_QUESTION", "10")
    vi.stubEnv("AI_LLM_DAILY_REQUEST_LIMIT", "1")
    vi.stubEnv("AI_LLM_BURST_MAX_REQUESTS", "10")
    const database = new PGlite()
    openDatabases.push(database)
    await createDatabaseUsageSchema(database)
    const query = pgliteExecutor(database)
    await insertTutorSession(database, "session-a", "student-a", 1)
    await insertTutorSession(database, "session-b", "student-a", 1)

    const results = await Promise.all(
      ["session-a", "session-b"].map((sessionId, index) =>
        prepareTutorAiGeneration(
          {
            ...executionContext("student-a"),
            eventId: `event:concurrent-${index}`,
            expectedRevision: 1,
            sessionId,
          },
          {
            ...promptInput(),
            studentMessage: `Concurrent request ${index}`,
          },
          estimatedTokens(),
          { query, repositorySource: "database" },
        ),
      ),
    )
    const rows = await database.query<{
      counts_toward_limit: boolean
      limit_reason: string | null
      status: string
    }>(
      `select status, counts_toward_limit, limit_reason
       from ai_llm_reservations
       order by status`,
    )

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "blocked",
      "reserved",
    ])
    expect(rows.rows).toEqual([
      {
        counts_toward_limit: false,
        limit_reason: "daily_limit",
        status: "blocked",
      },
      {
        counts_toward_limit: true,
        limit_reason: null,
        status: "pending",
      },
    ])
  })

  it("settles provider usage once when a generated transition is abandoned", async () => {
    enableTestAi()
    const database = new PGlite()
    openDatabases.push(database)
    await createDatabaseUsageSchema(database)
    const query = pgliteExecutor(database)
    await insertTutorSession(database, "session-abandoned", "student-a", 1)
    const prepared = await prepareTutorAiGeneration(
      {
        ...executionContext("student-a"),
        eventId: "event:abandoned",
        expectedRevision: 1,
        sessionId: "session-abandoned",
      },
      promptInput(),
      estimatedTokens(),
      { query, repositorySource: "database" },
    )
    const accounting = accountingForGeneratedResponse(
      accountingFrom(prepared),
      {
        contextUsed: false,
        estimatedTokens: {
          ...estimatedTokens(),
          providerCompletionTokens: 20,
          providerPromptTokens: 80,
          providerTotalTokens: 100,
        },
        fallbackUsed: true,
        providerAttempts: 2,
        tutorMessage: "Start with the event definition.",
      },
      "general_ai_help",
    )

    await releaseTutorAiReservation(accounting, query)
    await releaseTutorAiReservation(accounting, query)
    const reservation = await database.query<{
      accounted_at: string | null
      actual_total_tokens: number
      provider_calls: number
      status: string
    }>(
      `select status, provider_calls, actual_total_tokens, accounted_at
       from ai_llm_reservations`,
    )
    const usage = await database.query<{
      llm_provider_calls: number
      llm_requests: number
      llm_total_tokens: number
    }>(
      `select llm_requests, llm_provider_calls, llm_total_tokens
       from ai_usage
       where scope = 'student'`,
    )
    const cache = await database.query<{ count: number }>(
      `select count(*)::integer as count from ai_response_cache`,
    )

    expect(reservation.rows[0]).toMatchObject({
      actual_total_tokens: 100,
      provider_calls: 2,
      status: "released",
    })
    expect(reservation.rows[0]?.accounted_at).toBeTruthy()
    expect(usage.rows[0]).toEqual({
      llm_provider_calls: 2,
      llm_requests: 1,
      llm_total_tokens: 100,
    })
    expect(cache.rows[0]?.count).toBe(0)

    await expect(
      prepareTutorAiGeneration(
        {
          ...executionContext("student-a"),
          eventId: "event:abandoned",
          expectedRevision: 1,
          sessionId: "session-abandoned",
        },
        promptInput(),
        estimatedTokens(),
        { query, repositorySource: "database" },
      ),
    ).rejects.toThrow("already attempted")
  })
})

function enableTestAi() {
  vi.stubEnv("AI_ENABLED", "true")
  vi.stubEnv("OPENROUTER_API_KEY", "test-key")
}

function executionContext(studentId: string): TutorAiExecutionContext {
  return {
    eventId: "event:first",
    expectedRevision: 3,
    mode: "check",
    owner: { anonymousId: studentId, kind: "anonymous" },
    questionId: "question-1",
    questionVersionId: 7,
    sessionId: "session-1",
    topicId: "conditional-probability",
  }
}

function promptInput(): LlmTutorInput {
  return {
    allowedDisclosure: "hint_only",
    currentQuestion: {
      prompt: "What is the conditional probability?",
      title: "Conditional probability",
    },
    mode: "check",
    provenanceNote: "Use approved context only.",
    retrievedContext: [],
    studentMessage: "I am stuck.",
    task: "low_confidence_answer_help",
    topicId: "conditional-probability",
  }
}

function estimatedTokens() {
  return {
    estimatedInputTokens: 80,
    estimatedTotalTokens: 180,
    maxOutputTokens: 100,
  }
}

async function consumeMemoryRequest(options: {
  eventId: string
  revision: number
  sessionId?: string
}) {
  const prepared = await prepareTutorAiGeneration(
    {
      ...executionContext("student-a"),
      eventId: options.eventId,
      expectedRevision: options.revision,
      sessionId: options.sessionId ?? "session-1",
    },
    promptInput(),
    estimatedTokens(),
  )
  const accounting = accountingForGeneratedResponse(
    accountingFrom(prepared),
    {
      contextUsed: false,
      estimatedTokens: {
        ...estimatedTokens(),
        providerCompletionTokens: 10,
        providerPromptTokens: 40,
        providerTotalTokens: 50,
      },
      fallbackUsed: true,
      providerAttempts: 1,
      tutorMessage: "Use the event definition first.",
    },
    "general_ai_help",
  )
  await applyTutorAiAccounting(accounting)
}

async function createDatabaseUsageSchema(database: PGlite) {
  await database.exec(`
    create table tutor_sessions (
      id text primary key,
      anonymous_user_id text,
      user_id text,
      revision bigint not null,
      status text not null,
      expires_at timestamptz not null
    );

    create table ai_usage (
      scope text not null,
      scope_key text not null,
      date_key date not null,
      interactions integer not null default 0,
      estimated_tokens integer not null default 0,
      llm_fallbacks integer not null default 0,
      llm_input_tokens integer not null default 0,
      llm_output_tokens integer not null default 0,
      llm_total_tokens integer not null default 0,
      estimated_llm_tokens integer not null default 0,
      cache_hits integer not null default 0,
      limit_blocks integer not null default 0,
      llm_requests integer not null default 0,
      llm_provider_calls integer not null default 0,
      updated_at timestamptz not null default now(),
      primary key (scope, scope_key, date_key)
    );

    create table ai_response_cache (
      request_hash text primary key,
      question_id text,
      question_version_id bigint,
      topic_id text,
      mode text not null,
      source text not null,
      response_json jsonb not null,
      expires_at timestamptz not null,
      student_key_hash text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table ai_llm_reservations (
      id text primary key,
      session_id text not null,
      student_key_hash text not null,
      question_key_hash text not null,
      reserved_total_tokens integer not null,
      actual_input_tokens integer,
      actual_output_tokens integer,
      actual_total_tokens integer,
      status text not null,
      expires_at timestamptz not null,
      idempotency_key text not null,
      request_hash text not null,
      usage_is_estimate boolean not null default false,
      provider_calls integer not null default 0,
      usage_date date not null default (timezone('UTC', now())::date),
      counts_toward_limit boolean not null default true,
      limit_reason text,
      accounted_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create unique index ai_llm_reservations_session_event_idx
      on ai_llm_reservations (session_id, idempotency_key);
    create unique index ai_llm_reservations_one_pending_session_idx
      on ai_llm_reservations (session_id)
      where status = 'pending';
  `)
}

async function insertTutorSession(
  database: PGlite,
  sessionId: string,
  anonymousId: string,
  revision: number,
) {
  await database.query(
    `insert into tutor_sessions (
       id, anonymous_user_id, revision, status, expires_at
     ) values ($1, $2, $3, 'active', now() + interval '1 hour')`,
    [sessionId, anonymousId, revision],
  )
}

function pgliteExecutor(database: PGlite): DatabaseQueryExecutor {
  let transactionTail = Promise.resolve()
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query<Record<string, unknown>>(sql, params)
    return result.rows
  }
  query.read = query
  query.transaction = async (work) => {
    const previous = transactionTail
    let release!: () => void
    transactionTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await work(query)
    } finally {
      release()
    }
  }
  return query
}

function accountingFrom(
  prepared: Awaited<ReturnType<typeof prepareTutorAiGeneration>>,
) {
  if (prepared.outcome === "blocked") {
    throw new Error(`Expected an AI accounting result, got ${prepared.reason}.`)
  }
  return prepared.accounting
}
