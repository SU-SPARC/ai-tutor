import "server-only";

import {
  assertAuthorization,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import {
  ANALYTICS_STUDENT_SESSION_FILTER_SQL,
  PROFESSOR_OWNED_SESSION_SQL,
  STUDENT_ACCOUNTS_CTE,
  STUDENT_KEY_SQL,
} from "@/lib/data/analytics-population";
import {
  readDatabaseRows,
  type DatabaseQueryExecutor,
  type DatabaseQueryValue,
} from "@/lib/data/database-executor";
import {
  derivePracticeCreditEvidence,
  VALID_ANSWER_ATTEMPT_SQL,
  type PracticeCreditInteraction,
  type PracticeCreditLinkedSimilarProblem,
} from "@/lib/tutor/practice-credit";
import { MEANINGFUL_TUTOR_SESSION_SQL } from "@/lib/tutor/session-engagement";
import { labelMisconceptions } from "@/lib/professor/student-pseudonym";
import type {
  InstructorAttentionSignal,
  InstructorCohortAnalytics,
  InstructorQuestionCreditEvidence,
  InstructorStudentActivityPoint,
  InstructorStudentAttempt,
  InstructorStudentDetail,
  InstructorStudentList,
  InstructorStudentListFilters,
  InstructorStudentSort,
  InstructorStudentSummary,
  InstructorStudentTopicPerformance,
} from "@/lib/types";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const RECENT_ATTEMPT_LIMIT = 30;
const ACTIVITY_WINDOW_DAYS = 30;
const MISCONCEPTION_LIMIT = 10;

const REPEATED_DIFFICULTY_MINIMUM_ATTEMPTS = 4;
const REPEATED_DIFFICULTY_MAXIMUM_ACCURACY = 0.4;
const REPEATED_MISCONCEPTION_MINIMUM_SESSIONS = 3;
const SOLUTION_RELIANCE_MINIMUM_REVEALS = 3;

/**
 * `readDatabaseRows` returns untyped rows; each caller here knows the shape it
 * selected, so name that shape once instead of casting at every call site.
 */
async function readRows<Row>(
  query: DatabaseQueryExecutor,
  sql: string,
  params: DatabaseQueryValue[] = [],
) {
  return (await readDatabaseRows(query, sql, params)) as Row[];
}

/**
 * The analytics population includes meaningful sessions from anonymous owners
 * and authenticated owners without a current effective professor role. The two
 * ownership namespaces are prefixed before hashing so they can never collide.
 *
 * The digest is computed in SQL and the raw owner never leaves this module, so
 * no instructor query can return a cookie value or a user id by accident.
 */
const STUDENT_SESSIONS_CTE = `
  all_student_sessions as (
    select
      s.id as session_id,
      ${STUDENT_KEY_SQL} as student_key,
      s.revealed_hints,
      s.revealed_steps,
      s.solved,
      s.question_id,
      s.question_version_id,
      s.last_misconception_ids_json,
      s.created_at,
      s.last_seen_at
      ,s.practice_context
    from tutor_sessions s
    where ${ANALYTICS_STUDENT_SESSION_FILTER_SQL}
  ),
  student_sessions as (
    select * from all_student_sessions
    where practice_context = 'published'
  )
`;

const EXTRA_PRACTICE_TOTALS_CTE = `
  extra_practice_totals as (
    select student_key, count(*)::int as extra_practice_sessions
    from all_student_sessions
    where practice_context = 'reserve_practice'
    group by student_key
  )
`;

const SESSION_TOTALS_CTE = `
  session_totals as (
    select
      student_key,
      count(*)::int as sessions,
      coalesce(sum(revealed_hints), 0)::int as hints_used,
      coalesce(sum(revealed_steps), 0)::int as solutions_revealed,
      count(*) filter (where solved)::int as solved_sessions,
      min(created_at) as first_active_at,
      max(last_seen_at) as last_active_at
    from student_sessions
    group by student_key
  )
`;

/**
 * `mode = 'check'` is an answer submission. Hints and revealed solutions are
 * counted from the session counters instead, matching how the existing practice
 * analytics already reports them.
 */
const ATTEMPT_TOTALS_CTE = `
  attempt_totals as (
    select
      ss.student_key,
      count(*) filter (where a.mode = 'check')::int as attempts,
      count(*) filter (where a.mode = 'check' and a.verdict = 'correct')::int
        as correct_attempts,
      count(*) filter (where a.mode = 'check' and a.verdict = 'incorrect')::int
        as incorrect_attempts,
      count(*) filter (where a.source = 'llm')::int as llm_attempts,
      count(*) filter (
        where jsonb_array_length(a.misconception_feedback_json) > 0
      )::int as misconception_attempts,
      count(distinct a.topic_id)::int as topics_practiced
    from attempts a
    join student_sessions ss on ss.session_id = a.session_id
    group by ss.student_key
  )
`;

const ATTENTION_STUDENTS_CTE = `
  attention_topics as (
    select
      ss.student_key,
      a.topic_id
    from attempts a
    join student_sessions ss on ss.session_id = a.session_id
    where a.mode = 'check'
      and a.verdict in ('correct', 'incorrect')
      and a.topic_id is not null
    group by ss.student_key, a.topic_id
    having count(*) >= ${REPEATED_DIFFICULTY_MINIMUM_ATTEMPTS}
      and count(*) filter (where a.verdict = 'correct')::numeric / count(*)
        <= ${REPEATED_DIFFICULTY_MAXIMUM_ACCURACY}
  ),
  attention_students as (
    select distinct student_key, true as needs_attention
    from attention_topics
  )
`;

/**
 * Who appears on the Students page: every signed-in student account, whether
 * or not they have practised, plus every owner of meaningful published
 * practice, which is how anonymous pilot students are known. `union` collapses
 * a signed-in student who has practised into one row, because both branches
 * derive the same digest from the same user id. Session and attempt totals
 * are left-joined onto this population, so a student who has only signed in
 * reports zeros and no activity timestamps rather than being absent.
 */
const STUDENT_POPULATION_CTE = `
  student_population as (
    select student_key from student_accounts
    union
    select student_key from session_totals
  )
`;

const SUMMARY_COLUMNS = `
  p.student_key,
  coalesce(st.sessions, 0) as sessions,
  coalesce(st.hints_used, 0) as hints_used,
  coalesce(st.solutions_revealed, 0) as solutions_revealed,
  coalesce(st.solved_sessions, 0) as solved_sessions,
  st.first_active_at,
  st.last_active_at,
  coalesce(t.attempts, 0) as attempts,
  coalesce(t.correct_attempts, 0) as correct_attempts,
  coalesce(t.incorrect_attempts, 0) as incorrect_attempts,
  coalesce(extra.extra_practice_sessions, 0) as extra_practice_sessions,
  coalesce(t.llm_attempts, 0) as llm_attempts,
  coalesce(t.misconception_attempts, 0) as misconception_attempts,
  coalesce(t.topics_practiced, 0) as topics_practiced,
  coalesce(attention.needs_attention, false) as needs_attention
`;

/**
 * Every order ends on the pseudonym, so students that nothing else separates
 * still come back in one fixed sequence. A student with no recorded activity
 * has no last-active time and zero counts: `nulls last` and the zero
 * coalesces place them after every active student under every sort, in
 * pseudonym order, instead of wherever a null happens to land.
 */
const SORT_CLAUSES: Record<InstructorStudentSort, string> = {
  attempts: "coalesce(t.attempts, 0) desc, p.student_key",
  last_active: "st.last_active_at desc nulls last, p.student_key",
  lowest_accuracy: `
    case
      when coalesce(t.correct_attempts, 0) + coalesce(t.incorrect_attempts, 0) >= ${REPEATED_DIFFICULTY_MINIMUM_ATTEMPTS}
        then coalesce(t.correct_attempts, 0)::numeric / nullif(t.correct_attempts + t.incorrect_attempts, 0)
    end asc nulls last,
    coalesce(t.attempts, 0) desc,
    p.student_key
  `,
  sessions: "coalesce(st.sessions, 0) desc, p.student_key",
};

type StudentSummaryRow = {
  attempts: number | string | null;
  correct_attempts: number | string | null;
  extra_practice_sessions: number | string | null;
  first_active_at: Date | string | null;
  hints_used: number | string | null;
  incorrect_attempts: number | string | null;
  last_active_at: Date | string | null;
  llm_attempts: number | string | null;
  misconception_attempts: number | string | null;
  needs_attention: boolean | null;
  sessions: number | string | null;
  solutions_revealed: number | string | null;
  solved_sessions: number | string | null;
  student_key: string;
  topics_practiced: number | string | null;
  total_students?: number | string | null;
};

type TopicRow = {
  attempts: number | string | null;
  correct_attempts: number | string | null;
  extra_practice_sessions: number | string | null;
  hints_used: number | string | null;
  incorrect_attempts: number | string | null;
  last_active_at: Date | string | null;
  misconception_attempts: number | string | null;
  solutions_revealed: number | string | null;
  topic_id: string;
  topic_title: string;
};

type AttemptRow = {
  created_at: Date | string;
  id: number | string;
  misconception_count: number | string | null;
  mode: string;
  question_id: string;
  question_title: string;
  source: string;
  topic_id: string;
  topic_title: string;
  verdict: string | null;
};

type MisconceptionRow = {
  misconception_id: string;
  sessions: number | string | null;
};

type ActivityRow = {
  attempts: number | string | null;
  correct_attempts: number | string | null;
  day: Date | string;
};

type CohortRow = {
  incorrect_attempts?: number | string | null;
  active_students: number | string | null;
  attempts: number | string | null;
  blocked_attempts: number | string | null;
  correct_attempts: number | string | null;
  excluded_staff_sessions: number | string | null;
  extra_practice_sessions: number | string | null;
  hints_used: number | string | null;
  llm_attempts: number | string | null;
  retrieval_attempts: number | string | null;
  rule_attempts: number | string | null;
  sessions: number | string | null;
  solutions_revealed: number | string | null;
  students_needing_attention: number | string | null;
};

function count(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function timestamp(value: Date | string | null | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toSummary(row: StudentSummaryRow): InstructorStudentSummary {
  return {
    attempts: count(row.attempts),
    correctAttempts: count(row.correct_attempts),
    extraPracticeSessions: count(row.extra_practice_sessions),
    firstActiveAt: timestamp(row.first_active_at),
    hintsUsed: count(row.hints_used),
    incorrectAttempts: count(row.incorrect_attempts),
    lastActiveAt: timestamp(row.last_active_at),
    llmAttempts: count(row.llm_attempts),
    misconceptionAttempts: count(row.misconception_attempts),
    needsAttention: Boolean(row.needs_attention),
    sessions: count(row.sessions),
    solutionsRevealed: count(row.solutions_revealed),
    solvedSessions: count(row.solved_sessions),
    studentKey: String(row.student_key),
    topicsPracticed: count(row.topics_practiced),
  };
}

/** A search term is only ever a prefix of a student's own hex label. */
function normalizeSearch(search: string | undefined) {
  const trimmed = search?.trim().toLowerCase();
  return trimmed && /^[0-9a-f]{1,64}$/.test(trimmed) ? trimmed : undefined;
}

async function readStudentList(
  query: DatabaseQueryExecutor,
  filters: InstructorStudentListFilters,
): Promise<InstructorStudentList> {
  const limit = Math.min(
    Math.max(filters.limit ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = normalizeSearch(filters.search);
  const order = SORT_CLAUSES[filters.sort ?? "last_active"];
  const rows = await readRows<StudentSummaryRow>(
    query,
    `
      with
      ${STUDENT_SESSIONS_CTE},
      ${SESSION_TOTALS_CTE},
      ${ATTEMPT_TOTALS_CTE},
      ${ATTENTION_STUDENTS_CTE},
      ${EXTRA_PRACTICE_TOTALS_CTE},
      ${STUDENT_ACCOUNTS_CTE},
      ${STUDENT_POPULATION_CTE}
      select
        ${SUMMARY_COLUMNS},
        count(*) over ()::int as total_students
      from student_population p
      left join session_totals st on st.student_key = p.student_key
      left join attempt_totals t on t.student_key = p.student_key
      left join attention_students attention
        on attention.student_key = p.student_key
      left join extra_practice_totals extra on extra.student_key = p.student_key
      where $3::text is null or p.student_key like $3 || '%'
      order by ${order}
      limit $1
      offset $2
    `,
    [limit, offset, search ?? null],
  );

  return {
    limit,
    mode: "database",
    offset,
    students: rows.map(toSummary),
    total: count(rows[0]?.total_students),
  };
}

async function readStudentSummary(
  query: DatabaseQueryExecutor,
  studentKey: string,
) {
  const rows = await readRows<StudentSummaryRow>(
    query,
    `
      with
      ${STUDENT_SESSIONS_CTE},
      ${SESSION_TOTALS_CTE},
      ${ATTEMPT_TOTALS_CTE},
      ${ATTENTION_STUDENTS_CTE},
      ${EXTRA_PRACTICE_TOTALS_CTE},
      ${STUDENT_ACCOUNTS_CTE},
      ${STUDENT_POPULATION_CTE}
      select ${SUMMARY_COLUMNS}
      from student_population p
      left join session_totals st on st.student_key = p.student_key
      left join attempt_totals t on t.student_key = p.student_key
      left join attention_students attention
        on attention.student_key = p.student_key
      left join extra_practice_totals extra on extra.student_key = p.student_key
      where p.student_key = $1
    `,
    [studentKey],
  );

  return rows[0] ? toSummary(rows[0]) : undefined;
}

async function readTopicPerformance(
  query: DatabaseQueryExecutor,
  studentKey: string,
): Promise<InstructorStudentTopicPerformance[]> {
  const rows = await readRows<TopicRow>(
    query,
    `
      with
      ${STUDENT_SESSIONS_CTE},
      attempt_topics as (
        select
          a.topic_id,
          count(*) filter (where a.mode = 'check')::int as attempts,
          count(*) filter (where a.mode = 'check' and a.verdict = 'correct')::int
            as correct_attempts,
          count(*) filter (where a.mode = 'check' and a.verdict = 'incorrect')::int
            as incorrect_attempts,
          count(*) filter (
            where jsonb_array_length(a.misconception_feedback_json) > 0
          )::int as misconception_attempts,
          max(a.created_at) as last_active_at
        from attempts a
        join student_sessions ss on ss.session_id = a.session_id
        where ss.student_key = $1
        group by a.topic_id
      ),
      session_topics as (
        select
          q.topic_id,
          coalesce(sum(ss.revealed_hints), 0)::int as hints_used,
          coalesce(sum(ss.revealed_steps), 0)::int as solutions_revealed
        from student_sessions ss
        join questions q on q.id = ss.question_id
        where ss.student_key = $1
        group by q.topic_id
      )
      select
        t.id as topic_id,
        t.title as topic_title,
        coalesce(at.attempts, 0) as attempts,
        coalesce(at.correct_attempts, 0) as correct_attempts,
        coalesce(at.incorrect_attempts, 0) as incorrect_attempts,
        coalesce(at.misconception_attempts, 0) as misconception_attempts,
        coalesce(sst.hints_used, 0) as hints_used,
        coalesce(sst.solutions_revealed, 0) as solutions_revealed,
        at.last_active_at
      from topics t
      left join attempt_topics at on at.topic_id = t.id
      left join session_topics sst on sst.topic_id = t.id
      where at.topic_id is not null or sst.topic_id is not null
      order by t.sort_order, t.title, t.id
    `,
    [studentKey],
  );

  return rows.map((row) => ({
    attempts: count(row.attempts),
    correctAttempts: count(row.correct_attempts),
    hintsUsed: count(row.hints_used),
    incorrectAttempts: count(row.incorrect_attempts),
    lastActiveAt: timestamp(row.last_active_at),
    misconceptionAttempts: count(row.misconception_attempts),
    solutionsRevealed: count(row.solutions_revealed),
    topicId: String(row.topic_id),
    topicTitle: String(row.topic_title),
  }));
}

/**
 * Deliberately omits the submitted answer, the stored misconception feedback,
 * and every retrieval or provider payload. An instructor needs to know that a
 * misconception was matched, not to read the student's words back.
 */
async function readRecentAttempts(
  query: DatabaseQueryExecutor,
  studentKey: string,
): Promise<InstructorStudentAttempt[]> {
  const rows = await readRows<AttemptRow>(
    query,
    `
      with ${STUDENT_SESSIONS_CTE}
      select
        a.id,
        a.created_at,
        a.mode,
        a.source,
        a.verdict,
        a.question_id,
        q.title as question_title,
        a.topic_id,
        t.title as topic_title,
        jsonb_array_length(a.misconception_feedback_json) as misconception_count
      from attempts a
      join student_sessions ss on ss.session_id = a.session_id
      join questions q on q.id = a.question_id
      join topics t on t.id = a.topic_id
      where ss.student_key = $1
      order by a.created_at desc, a.id desc
      limit ${RECENT_ATTEMPT_LIMIT}
    `,
    [studentKey],
  );

  return rows.map((row) => ({
    createdAt: timestamp(row.created_at) ?? new Date(0).toISOString(),
    id: String(row.id),
    misconceptionDetected: count(row.misconception_count) > 0,
    mode: String(row.mode),
    questionId: String(row.question_id),
    questionTitle: String(row.question_title),
    source: String(row.source),
    topicId: String(row.topic_id),
    topicTitle: String(row.topic_title),
    verdict: row.verdict ?? undefined,
  }));
}

/**
 * Misconception *codes* are stored per session, not per attempt: an attempt row
 * records the feedback that was shown, while the session records the ids that
 * produced it. Counting sessions is therefore the honest unit here.
 */
async function readMisconceptions(
  query: DatabaseQueryExecutor,
  studentKey: string,
) {
  const rows = await readRows<MisconceptionRow>(
    query,
    `
      with ${STUDENT_SESSIONS_CTE}
      select
        misconception_id,
        count(*)::int as sessions
      from student_sessions ss
      cross join lateral jsonb_array_elements_text(
        ss.last_misconception_ids_json
      ) as misconception_id
      where ss.student_key = $1
      group by misconception_id
      order by sessions desc, misconception_id
      limit ${MISCONCEPTION_LIMIT}
    `,
    [studentKey],
  );

  return labelMisconceptions(
    rows.map((row) => ({
      misconceptionId: String(row.misconception_id),
      sessions: count(row.sessions),
    })),
  );
}

async function readActivity(
  query: DatabaseQueryExecutor,
  studentKey: string,
): Promise<InstructorStudentActivityPoint[]> {
  const rows = await readRows<ActivityRow>(
    query,
    `
      with ${STUDENT_SESSIONS_CTE}
      select
        date_trunc('day', a.created_at) as day,
        count(*) filter (where a.mode = 'check')::int as attempts,
        count(*) filter (where a.mode = 'check' and a.verdict = 'correct')::int
          as correct_attempts
      from attempts a
      join student_sessions ss on ss.session_id = a.session_id
      where ss.student_key = $1
        and a.created_at >= now() - interval '${ACTIVITY_WINDOW_DAYS} days'
      group by 1
      order by 1
    `,
    [studentKey],
  );

  return rows
    .map((row) => ({
      attempts: count(row.attempts),
      correctAttempts: count(row.correct_attempts),
      date: (timestamp(row.day) ?? "").slice(0, 10),
    }))
    .filter((point) => point.date !== "" && point.attempts > 0);
}

type CreditSessionRow = {
  created_at: Date | string;
  last_seen_at: Date | string;
  question_id: string;
  question_title: string;
  session_id: string;
  solved: boolean | null;
  topic_id: string;
  topic_title: string;
};

type CreditInteractionRow = {
  created_at: Date | string;
  id: number | string;
  mode: string;
  question_id: string;
  verdict: string | null;
};

type CreditSimilarRow = {
  attempted: boolean | null;
  question_id: string;
  solved: boolean | null;
};

/**
 * Practice-credit evidence per assigned question, derived in TypeScript from
 * three batched reads so the page never queries per question. Interactions are
 * gathered across every published session for the question, which is what
 * makes Start over unable to reset the count; similar problems are only those
 * whose origin is one of this student's published sessions for the question,
 * so unrelated Reserve practice never satisfies a route. The route itself is
 * decided by `derivePracticeCreditEvidence`, shared with the unit tests.
 */
async function readCreditEvidence(
  query: DatabaseQueryExecutor,
  studentKey: string,
): Promise<InstructorQuestionCreditEvidence[]> {
  const [sessionRows, interactionRows, similarRows] = await Promise.all([
    readRows<CreditSessionRow>(
      query,
      `
        with ${STUDENT_SESSIONS_CTE}
        select
          ss.session_id,
          ss.question_id,
          q.title as question_title,
          q.topic_id,
          t.title as topic_title,
          ss.created_at,
          ss.last_seen_at,
          ss.solved
        from student_sessions ss
        join questions q on q.id = ss.question_id
        join topics t on t.id = q.topic_id
        where ss.student_key = $1
        order by t.sort_order, t.title, q.title, q.id, ss.created_at, ss.session_id
      `,
      [studentKey],
    ),
    readRows<CreditInteractionRow>(
      query,
      `
        with ${STUDENT_SESSIONS_CTE}
        select a.id, a.created_at, a.mode, a.verdict, ss.question_id
        from attempts a
        join student_sessions ss on ss.session_id = a.session_id
        where ss.student_key = $1
        order by a.created_at, a.id
      `,
      [studentKey],
    ),
    readRows<CreditSimilarRow>(
      query,
      `
        with ${STUDENT_SESSIONS_CTE}
        select
          origin.question_id,
          (
            r.solved
            or r.status = 'completed'
            or exists (
              select 1 from attempts a
              where a.session_id = r.id
                and a.mode = 'check' and a.verdict = 'correct'
            )
          ) as solved,
          exists (
            select 1 from attempts a
            where a.session_id = r.id and ${VALID_ANSWER_ATTEMPT_SQL}
          ) as attempted
        from tutor_sessions r
        join student_sessions origin on origin.session_id = r.origin_session_id
        where r.practice_context = 'reserve_practice'
          and origin.student_key = $1
          and exists (
            select 1
            from question_similarity_links link
            where link.relationship_type = 'similar_practice'
              and link.origin_question_id = origin.question_id
              and link.origin_version_id = origin.question_version_id
              and link.similar_question_id = r.question_id
              and link.similar_version_id = r.question_version_id
          )
      `,
      [studentKey],
    ),
  ]);

  type QuestionGroup = {
    interactions: PracticeCreditInteraction[];
    lastActiveAt?: string;
    questionId: string;
    questionTitle: string;
    sessionCount: number;
    similarProblems: PracticeCreditLinkedSimilarProblem[];
    solved: boolean;
    topicId: string;
    topicTitle: string;
  };
  const groups = new Map<string, QuestionGroup>();

  for (const row of sessionRows) {
    const questionId = String(row.question_id);
    const group = groups.get(questionId) ?? {
      interactions: [],
      questionId,
      questionTitle: String(row.question_title),
      sessionCount: 0,
      similarProblems: [],
      solved: false,
      topicId: String(row.topic_id),
      topicTitle: String(row.topic_title),
    };
    group.sessionCount += 1;
    group.solved = group.solved || Boolean(row.solved);
    const lastSeenAt = timestamp(row.last_seen_at);
    if (
      lastSeenAt &&
      (!group.lastActiveAt || lastSeenAt > group.lastActiveAt)
    ) {
      group.lastActiveAt = lastSeenAt;
    }
    groups.set(questionId, group);
  }

  for (const row of interactionRows) {
    groups.get(String(row.question_id))?.interactions.push({
      createdAt: timestamp(row.created_at) ?? new Date(0).toISOString(),
      id: String(row.id),
      mode: String(row.mode),
      verdict: row.verdict ?? undefined,
    });
  }

  for (const row of similarRows) {
    groups.get(String(row.question_id))?.similarProblems.push({
      attempted: Boolean(row.attempted),
      solved: Boolean(row.solved),
    });
  }

  return [...groups.values()].map((group) => ({
    ...derivePracticeCreditEvidence({
      interactions: group.interactions,
      publishedSessionCount: group.sessionCount,
      similarProblems: group.similarProblems,
      solved: group.solved,
    }),
    lastActiveAt: group.lastActiveAt,
    questionId: group.questionId,
    questionTitle: group.questionTitle,
    topicId: group.topicId,
    topicTitle: group.topicTitle,
  }));
}

/**
 * Deterministic signals only, each carrying the counts behind it. Nothing here
 * ranks students or labels them; it points at a topic and shows the arithmetic.
 */
export function deriveAttentionSignals({
  misconceptions,
  topics,
}: {
  misconceptions: Array<{ label: string; sessions: number }>;
  topics: InstructorStudentTopicPerformance[];
}): InstructorAttentionSignal[] {
  const signals: InstructorAttentionSignal[] = [];

  for (const topic of topics) {
    if (
      topic.correctAttempts + topic.incorrectAttempts >=
        REPEATED_DIFFICULTY_MINIMUM_ATTEMPTS &&
      topic.correctAttempts /
        (topic.correctAttempts + topic.incorrectAttempts) <=
        REPEATED_DIFFICULTY_MAXIMUM_ACCURACY
    ) {
      signals.push({
        attempts: topic.correctAttempts + topic.incorrectAttempts,
        code: "repeated_topic_difficulty",
        correctAttempts: topic.correctAttempts,
        detail: `${topic.correctAttempts} of ${topic.correctAttempts + topic.incorrectAttempts} scored attempts correct`,
        topicId: topic.topicId,
        topicTitle: topic.topicTitle,
      });
      continue;
    }

    if (
      topic.solutionsRevealed >= SOLUTION_RELIANCE_MINIMUM_REVEALS &&
      topic.solutionsRevealed > topic.correctAttempts
    ) {
      signals.push({
        attempts: topic.attempts,
        code: "solution_reliance",
        correctAttempts: topic.correctAttempts,
        detail: `${topic.solutionsRevealed} solutions revealed against ${topic.correctAttempts} correct attempts`,
        topicId: topic.topicId,
        topicTitle: topic.topicTitle,
      });
    }
  }

  for (const misconception of misconceptions) {
    if (misconception.sessions >= REPEATED_MISCONCEPTION_MINIMUM_SESSIONS) {
      signals.push({
        attempts: misconception.sessions,
        code: "repeated_misconception",
        correctAttempts: 0,
        detail: `${misconception.label} recorded in ${misconception.sessions} sessions`,
      });
    }
  }

  return signals;
}

async function readCohortAnalytics(
  query: DatabaseQueryExecutor,
): Promise<InstructorCohortAnalytics> {
  const [totalsRows, misconceptionRows] = await Promise.all([
    readRows<CohortRow>(
      query,
      `
        with
        ${STUDENT_SESSIONS_CTE},
        ${SESSION_TOTALS_CTE},
        ${ATTEMPT_TOTALS_CTE},
        ${ATTENTION_STUDENTS_CTE},
        source_totals as (
          select
            count(*) filter (where a.mode = 'check')::int as attempts,
            count(*) filter (where a.mode = 'check' and a.verdict = 'correct')::int
              as correct_attempts,
            count(*) filter (where a.mode = 'check' and a.verdict = 'incorrect')::int as incorrect_attempts,
            count(*) filter (where a.source = 'rule')::int as rule_attempts,
            count(*) filter (where a.source = 'retrieval')::int
              as retrieval_attempts,
            count(*) filter (where a.source = 'llm')::int as llm_attempts,
            count(*) filter (where a.source = 'blocked')::int as blocked_attempts
          from attempts a
          join student_sessions ss on ss.session_id = a.session_id
        )
        select
          (select count(*)::int from session_totals) as active_students,
          (select coalesce(sum(sessions), 0)::int from session_totals) as sessions,
          (select count(*)::int from all_student_sessions
           where practice_context = 'reserve_practice') as extra_practice_sessions,
          (select count(*)::int from tutor_sessions s
           where ${PROFESSOR_OWNED_SESSION_SQL}
             and ${MEANINGFUL_TUTOR_SESSION_SQL}) as excluded_staff_sessions,
          (select coalesce(sum(hints_used), 0)::int from session_totals)
            as hints_used,
          (select coalesce(sum(solutions_revealed), 0)::int from session_totals)
            as solutions_revealed,
          (
            select count(distinct student_key)::int
            from attention_students
          ) as students_needing_attention,
          source_totals.attempts,
          source_totals.correct_attempts,
          source_totals.incorrect_attempts,
          source_totals.rule_attempts,
          source_totals.retrieval_attempts,
          source_totals.llm_attempts,
          source_totals.blocked_attempts
        from source_totals
      `,
    ),
    readRows<MisconceptionRow>(
      query,
      `
        select
          misconception_id,
          count(*)::int as sessions
        from tutor_sessions s
        cross join lateral jsonb_array_elements_text(
          s.last_misconception_ids_json
        ) as misconception_id
        where s.practice_context = 'published'
          and ${ANALYTICS_STUDENT_SESSION_FILTER_SQL}
        group by misconception_id
        order by sessions desc, misconception_id
        limit ${MISCONCEPTION_LIMIT}
      `,
    ),
  ]);
  const totals = totalsRows[0];

  return {
    activeStudents: count(totals?.active_students),
    attempts: count(totals?.attempts),
    blockedAttempts: count(totals?.blocked_attempts),
    correctAttempts: count(totals?.correct_attempts),
    incorrectAttempts: count(totals?.incorrect_attempts),
    excludedStaffSessions: count(totals?.excluded_staff_sessions),
    extraPracticeSessions: count(totals?.extra_practice_sessions),
    hintsUsed: count(totals?.hints_used),
    llmAttempts: count(totals?.llm_attempts),
    misconceptions: labelMisconceptions(
      misconceptionRows.map((row) => ({
        misconceptionId: String(row.misconception_id),
        sessions: count(row.sessions),
      })),
    ),
    mode: "database",
    retrievalAttempts: count(totals?.retrieval_attempts),
    ruleAttempts: count(totals?.rule_attempts),
    sessions: count(totals?.sessions),
    solutionsRevealed: count(totals?.solutions_revealed),
    studentsNeedingAttention: count(totals?.students_needing_attention),
  };
}

export function createDatabaseInstructorStudentRepository(
  query: DatabaseQueryExecutor,
) {
  return {
    async getCohortAnalytics(
      authorization: AnalyticsAuthorization,
    ): Promise<InstructorCohortAnalytics> {
      assertAuthorization(authorization, "professor");
      return readCohortAnalytics(query);
    },

    async getStudentDetail(
      authorization: AnalyticsAuthorization,
      studentKey: string,
    ): Promise<InstructorStudentDetail | undefined> {
      assertAuthorization(authorization, "professor");
      const summary = await readStudentSummary(query, studentKey);

      if (!summary) {
        return undefined;
      }

      const [topics, attempts, misconceptions, activity, creditEvidence] =
        await Promise.all([
          readTopicPerformance(query, studentKey),
          readRecentAttempts(query, studentKey),
          readMisconceptions(query, studentKey),
          readActivity(query, studentKey),
          readCreditEvidence(query, studentKey),
        ]);

      return {
        activity,
        attempts,
        attention: deriveAttentionSignals({ misconceptions, topics }),
        creditEvidence,
        misconceptions,
        mode: "database",
        summary,
        topics,
      };
    },

    async listStudents(
      authorization: AnalyticsAuthorization,
      filters: InstructorStudentListFilters = {},
    ): Promise<InstructorStudentList> {
      assertAuthorization(authorization, "professor");
      return readStudentList(query, filters);
    },
  };
}

export const INSTRUCTOR_STUDENT_PAGE_SIZE = DEFAULT_PAGE_SIZE;
