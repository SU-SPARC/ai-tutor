import "server-only";

import {
  correctnessRate,
  emptyPilotAnalyticsExport,
  pilotAnalyticsLimitations,
  pilotAnalyticsMetricDefinitions,
  type PilotAnalyticsActivity,
  type PilotAnalyticsCount,
  type PilotAnalyticsExport,
  type PilotAnalyticsTutorPath,
} from "@/lib/analytics/pilot-export";
import {
  assertAuthorization,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import {
  readDatabaseRows,
  type DatabaseQueryExecutor,
  type DatabaseQueryValue,
} from "@/lib/data/database-executor";
import { STUDENT_KEY_SQL } from "@/lib/data/instructor-student-repository";

type ActivityRow = {
  answer_attempts: number | string | null;
  blocked_interactions: number | string | null;
  cache_interactions: number | string | null;
  correct_attempts: number | string | null;
  incorrect_attempts: number | string | null;
  llm_interactions: number | string | null;
  participating_students?: number | string | null;
  questions_attempted: number | string | null;
  question_id?: string;
  question_versions_attempted?: number | string | null;
  retrieval_interactions: number | string | null;
  rule_interactions: number | string | null;
  sessions: number | string | null;
  student_key?: string;
  topic_id?: string;
  topic_title?: string;
  total_interactions: number | string | null;
  total_revealed_hints: number | string | null;
  total_revealed_steps: number | string | null;
};

type AiUsageRow = {
  cache_hits: number | string | null;
  estimated_llm_tokens: number | string | null;
  estimated_tokens: number | string | null;
  limit_blocks: number | string | null;
  llm_fallbacks: number | string | null;
  llm_input_tokens: number | string | null;
  llm_output_tokens: number | string | null;
  llm_provider_calls: number | string | null;
  llm_requests: number | string | null;
  llm_total_tokens: number | string | null;
};

type CoverageRow = {
  earliest_at: Date | string | null;
  latest_at: Date | string | null;
};

type MisconceptionRow = {
  misconception_code: string;
  session_occurrences: number | string | null;
};

type CountRow = {
  count: number | string | null;
  key: string;
};

const SESSION_FACTS_CTE = `
  student_sessions as (
    select
      s.id as session_id,
      ${STUDENT_KEY_SQL} as student_key,
      s.question_id,
      s.question_version_id,
      q.topic_id,
      s.revealed_hints,
      s.revealed_steps
    from tutor_sessions s
    join questions q on q.id = s.question_id
  ),
  attempt_facts as (
    select
      a.session_id,
      count(*)::int as total_interactions,
      count(*) filter (where a.mode = 'check')::int as answer_attempts,
      count(*) filter (
        where a.mode = 'check' and a.verdict = 'correct'
      )::int as correct_attempts,
      count(*) filter (
        where a.mode = 'check' and a.verdict = 'incorrect'
      )::int as incorrect_attempts,
      count(*) filter (where a.source = 'rule')::int as rule_interactions,
      count(*) filter (where a.source = 'retrieval')::int
        as retrieval_interactions,
      count(*) filter (where a.source = 'llm')::int as llm_interactions,
      count(*) filter (where a.source = 'cache')::int as cache_interactions,
      count(*) filter (where a.source = 'blocked')::int
        as blocked_interactions
    from attempts a
    group by a.session_id
  ),
  session_facts as (
    select
      ss.*,
      coalesce(af.total_interactions, 0) as total_interactions,
      coalesce(af.answer_attempts, 0) as answer_attempts,
      coalesce(af.correct_attempts, 0) as correct_attempts,
      coalesce(af.incorrect_attempts, 0) as incorrect_attempts,
      coalesce(af.rule_interactions, 0) as rule_interactions,
      coalesce(af.retrieval_interactions, 0) as retrieval_interactions,
      coalesce(af.llm_interactions, 0) as llm_interactions,
      coalesce(af.cache_interactions, 0) as cache_interactions,
      coalesce(af.blocked_interactions, 0) as blocked_interactions
    from student_sessions ss
    left join attempt_facts af on af.session_id = ss.session_id
  )
`;

const ACTIVITY_COLUMNS = `
  count(*)::int as sessions,
  count(distinct question_id) filter (where answer_attempts > 0)::int
    as questions_attempted,
  coalesce(sum(revealed_hints), 0)::int as total_revealed_hints,
  coalesce(sum(revealed_steps), 0)::int as total_revealed_steps,
  coalesce(sum(answer_attempts), 0)::int as answer_attempts,
  coalesce(sum(correct_attempts), 0)::int as correct_attempts,
  coalesce(sum(incorrect_attempts), 0)::int as incorrect_attempts,
  coalesce(sum(total_interactions), 0)::int as total_interactions,
  coalesce(sum(rule_interactions), 0)::int as rule_interactions,
  coalesce(sum(retrieval_interactions), 0)::int as retrieval_interactions,
  coalesce(sum(llm_interactions), 0)::int as llm_interactions,
  coalesce(sum(cache_interactions), 0)::int as cache_interactions,
  coalesce(sum(blocked_interactions), 0)::int as blocked_interactions
`;

async function readRows<Row>(
  query: DatabaseQueryExecutor,
  sql: string,
  params: DatabaseQueryValue[] = [],
) {
  return (await readDatabaseRows(query, sql, params)) as Row[];
}

export function createDatabasePilotAnalyticsExportRepository(
  query: DatabaseQueryExecutor,
) {
  return {
    async build(
      authorization: AnalyticsAuthorization,
      generatedAt = new Date().toISOString(),
    ): Promise<PilotAnalyticsExport> {
      assertAuthorization(authorization, "professor");

      const [
        cohortRows,
        participantRows,
        topicRows,
        questionRows,
        misconceptionRows,
        aiUsageRows,
        feedbackCategoryRows,
        feedbackStatusRows,
        coverageRows,
      ] = await Promise.all([
        readRows<ActivityRow>(
          query,
          `with ${SESSION_FACTS_CTE}
           select
             count(distinct student_key)::int as participating_students,
             ${ACTIVITY_COLUMNS}
           from session_facts`,
        ),
        readRows<ActivityRow>(
          query,
          `with ${SESSION_FACTS_CTE}
           select student_key, ${ACTIVITY_COLUMNS}
           from session_facts
           group by student_key
           order by student_key`,
        ),
        readRows<ActivityRow>(
          query,
          `with ${SESSION_FACTS_CTE}
           select
             sf.topic_id,
             t.title as topic_title,
             count(distinct sf.student_key)::int as participating_students,
             ${ACTIVITY_COLUMNS}
           from session_facts sf
           join topics t on t.id = sf.topic_id
           group by sf.topic_id, t.title
           order by sf.topic_id`,
        ),
        readRows<ActivityRow>(
          query,
          `with ${SESSION_FACTS_CTE}
           select
             question_id,
             topic_id,
             count(distinct student_key)::int as participating_students,
             count(distinct question_version_id) filter (
               where answer_attempts > 0
             )::int as question_versions_attempted,
             ${ACTIVITY_COLUMNS}
           from session_facts
           group by question_id, topic_id
           order by topic_id, question_id`,
        ),
        readRows<MisconceptionRow>(
          query,
          `select
             misconception_code,
             count(*)::int as session_occurrences
           from (
             select distinct
               s.id as session_id,
               code as misconception_code
             from tutor_sessions s
             cross join lateral jsonb_array_elements_text(
               s.last_misconception_ids_json
             ) as code
           ) retained
           group by misconception_code
           order by session_occurrences desc, misconception_code`,
        ),
        readRows<AiUsageRow>(
          query,
          `select
             coalesce(sum(estimated_tokens), 0)::bigint as estimated_tokens,
             coalesce(sum(llm_fallbacks), 0)::bigint as llm_fallbacks,
             coalesce(sum(llm_input_tokens), 0)::bigint as llm_input_tokens,
             coalesce(sum(llm_output_tokens), 0)::bigint as llm_output_tokens,
             coalesce(sum(llm_total_tokens), 0)::bigint as llm_total_tokens,
             coalesce(sum(estimated_llm_tokens), 0)::bigint
               as estimated_llm_tokens,
             coalesce(sum(cache_hits), 0)::bigint as cache_hits,
             coalesce(sum(limit_blocks), 0)::bigint as limit_blocks,
             coalesce(sum(llm_requests), 0)::bigint as llm_requests,
             coalesce(sum(llm_provider_calls), 0)::bigint
               as llm_provider_calls
           from ai_usage
           where scope = 'global'`,
        ),
        readRows<CountRow>(
          query,
          `select category as key, count(*)::int as count
           from feedback_reports
           group by category
           order by category`,
        ),
        readRows<CountRow>(
          query,
          `select status as key, count(*)::int as count
           from feedback_reports
           group by status
           order by status`,
        ),
        readRows<CoverageRow>(
          query,
          `select min(recorded_at) as earliest_at, max(recorded_at) as latest_at
           from (
             select created_at as recorded_at from tutor_sessions
             union all
             select created_at from attempts
             union all
             select created_at from feedback_reports
             union all
             select date_key::timestamptz from ai_usage where scope = 'global'
           ) retained_events`,
        ),
      ]);

      const cohortRow = cohortRows[0];
      const cohort = {
        ...activity(cohortRow),
        participatingStudents: count(cohortRow?.participating_students),
      };
      const tutorUsage = tutorPath(cohortRow);
      const aiUsage = aiUsageRows[0];
      const byCategory = countRows(feedbackCategoryRows);
      const byStatus = countRows(feedbackStatusRows);
      const coverage = coverageRows[0];

      return {
        ...emptyPilotAnalyticsExport(generatedAt),
        mode: "database",
        dataCoverage: {
          earliestDate: dateOnly(coverage?.earliest_at),
          latestDate: dateOnly(coverage?.latest_at),
        },
        cohort,
        tutorUsage,
        aiUsage: {
          cacheHits: count(aiUsage?.cache_hits),
          estimatedRequestTokens: count(aiUsage?.estimated_tokens),
          estimatedTokenPortion: count(aiUsage?.estimated_llm_tokens),
          generationRequests: count(aiUsage?.llm_requests),
          inputTokens: count(aiUsage?.llm_input_tokens),
          limitBlocks: count(aiUsage?.limit_blocks),
          outputTokens: count(aiUsage?.llm_output_tokens),
          providerCalls: count(aiUsage?.llm_provider_calls),
          successfulFallbacks: count(aiUsage?.llm_fallbacks),
          totalTokens: count(aiUsage?.llm_total_tokens),
        },
        participants: participantRows.map((row) => ({
          ...activity(row),
          participantId: String(row.student_key),
        })),
        topics: topicRows.map((row) => ({
          ...activity(row),
          participatingStudents: count(row.participating_students),
          topicId: String(row.topic_id),
          topicTitle: String(row.topic_title),
        })),
        questions: questionRows.map((row) => ({
          ...activity(row),
          participatingStudents: count(row.participating_students),
          questionId: String(row.question_id),
          questionVersionsAttempted: count(row.question_versions_attempted),
          topicId: String(row.topic_id),
        })),
        misconceptions: misconceptionRows.map((row) => ({
          misconceptionCode: row.misconception_code,
          sessionOccurrences: count(row.session_occurrences),
        })),
        feedback: {
          byCategory,
          byStatus,
          totalReports: byCategory.reduce(
            (total, category) => total + category.count,
            0,
          ),
        },
        metricDefinitions: pilotAnalyticsMetricDefinitions(),
        limitations: pilotAnalyticsLimitations(),
      };
    },
  };
}

function activity(row: ActivityRow | undefined): PilotAnalyticsActivity {
  const answerAttempts = count(row?.answer_attempts);
  const correctAnswerAttempts = count(row?.correct_attempts);
  const incorrectAnswerAttempts = count(row?.incorrect_attempts);
  return {
    ...tutorPath(row),
    answerAttempts,
    correctAnswerAttempts,
    correctnessRate: correctnessRate(correctAnswerAttempts, answerAttempts),
    hintsUsed: count(row?.total_revealed_hints),
    incorrectAnswerAttempts,
    questionsAttempted: count(row?.questions_attempted),
    sessions: count(row?.sessions),
    solutionStepsRevealed: count(row?.total_revealed_steps),
    unscoredAnswerAttempts: Math.max(
      0,
      answerAttempts - correctAnswerAttempts - incorrectAnswerAttempts,
    ),
  };
}

function tutorPath(row: ActivityRow | undefined): PilotAnalyticsTutorPath {
  const llmProviderInteractions = count(row?.llm_interactions);
  const llmCacheInteractions = count(row?.cache_interactions);
  return {
    blockedInteractions: count(row?.blocked_interactions),
    deterministicInteractions: count(row?.rule_interactions),
    llmAssistanceInteractions: llmProviderInteractions + llmCacheInteractions,
    llmCacheInteractions,
    llmProviderInteractions,
    retrievalInteractions: count(row?.retrieval_interactions),
    totalInteractions: count(row?.total_interactions),
  };
}

function countRows(rows: CountRow[]): PilotAnalyticsCount[] {
  return rows.map((row) => ({ count: count(row.count), key: row.key }));
}

function count(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function dateOnly(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
