import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";

import { claimAnonymousIdentity } from "@/lib/auth/anonymous-claims";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import {
  createDatabaseReservePracticeRepository,
  setReservePracticeRepositoryForTests,
} from "@/lib/data/reserve-practice-repository";
import {
  createDatabaseTutorSessionRepository,
  resetTutorSessionsForTests,
  setTutorSessionRepositoryForTests,
} from "@/lib/data/tutor-session-repository";
import { startSimilarReservePractice } from "@/lib/tutor/similar-reserve-practice";
import { AUTHENTICATED_TUTOR_SESSION_RETENTION_DAYS } from "@/lib/tutor/session-persistence";
import {
  authorizationForStudentOwner,
  TEST_ANONYMOUS_OWNER,
} from "./auth-test-helpers";

const databases: PGlite[] = [];

afterEach(async () => {
  setContentRepositoryForTests(undefined);
  setReservePracticeRepositoryForTests(undefined);
  resetTutorSessionsForTests();
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Reserve-practice anonymous claims on the migrated schema", () => {
  it("rejects an active published-context session pinned to an unpublished version", async () => {
    const database = await migratedDatabase();
    const reserveVersionId = await seedQuestionsAndActors(database);

    await expect(
      database.query(
        `insert into tutor_sessions (
           id, user_id, question_id, question_version_id, expires_at
         ) values (
           'published-context-unpublished-version', 'user:claim-enabled',
           'claim-reserve-question', $1, now() + interval '180 days'
         )`,
        [reserveVersionId],
      ),
    ).rejects.toThrow(/published question version/i);
  });

  it("does not revalidate Reserve ownership during a multi-row claim update", async () => {
    const database = await migratedDatabase();
    const reserveVersionId = await seedQuestionsAndActors(database);
    await seedAnonymousPair(database, {
      anonymousId: "anon:trigger-order",
      childId: "reserve-child-trigger-order",
      originId: "reserve-origin-trigger-order",
      reserveVersionId,
    });
    await database.exec(`
      update tutor_sessions
      set last_seen_at = now(), updated_at = now()
      where id = 'reserve-origin-trigger-order';
    `);
    await setReserveState(database, {
      isReserved: true,
      practiceAllowed: false,
    });

    await expect(
      database.exec(`
        update tutor_sessions
        set user_id = 'user:claim-enabled',
            anonymous_user_id = null,
            expires_at = now() + interval '180 days',
            updated_at = now()
        where anonymous_user_id = 'anon:trigger-order'
          and user_id is null;
      `),
    ).resolves.toBeDefined();
  });

  it("moves enabled, disabled, and released Reserve sessions without revalidating ownership or eligibility", async () => {
    const database = await migratedDatabase();
    const reserveVersionId = await seedQuestionsAndActors(database);

    await seedAnonymousPair(database, {
      anonymousId: "anon:reserve-enabled",
      childId: "reserve-child-enabled",
      originId: "reserve-origin-enabled",
      reserveVersionId,
    });
    await database.exec(`
      update tutor_sessions
      set last_seen_at = now(), updated_at = now()
      where id = 'reserve-origin-enabled';
    `);
    await expect(
      claimAnonymousIdentity(
        {
          anonymousId: "anon:reserve-enabled",
          source: "signed_cookie",
          userId: "user:claim-enabled",
        },
        pgliteQuery(database),
      ),
    ).resolves.toMatchObject({ migratedSessionCount: 2 });

    await seedAnonymousPair(database, {
      anonymousId: "anon:reserve-disabled",
      childId: "reserve-child-disabled",
      originId: "reserve-origin-disabled",
      reserveVersionId,
    });
    await setReserveState(database, {
      isReserved: true,
      practiceAllowed: false,
    });
    await database.exec(`
      update tutor_sessions
      set status = 'content_unpublished', updated_at = now()
      where id = 'reserve-child-disabled';
    `);
    await expect(
      claimAnonymousIdentity(
        {
          anonymousId: "anon:reserve-disabled",
          source: "signed_cookie",
          userId: "user:claim-disabled",
        },
        pgliteQuery(database),
      ),
    ).resolves.toMatchObject({ migratedSessionCount: 2 });

    await setReserveState(database, {
      isReserved: true,
      practiceAllowed: true,
    });
    await seedAnonymousPair(database, {
      anonymousId: "anon:reserve-released",
      childId: "reserve-child-released",
      originId: "reserve-origin-released",
      reserveVersionId,
    });
    await setReserveState(database, {
      isReserved: false,
      practiceAllowed: false,
    });
    await database.exec(`
      update tutor_sessions
      set status = 'content_unpublished', updated_at = now()
      where id = 'reserve-child-released';
    `);
    await expect(
      claimAnonymousIdentity(
        {
          anonymousId: "anon:reserve-released",
          source: "signed_cookie",
          userId: "user:claim-released",
        },
        pgliteQuery(database),
      ),
    ).resolves.toMatchObject({ migratedSessionCount: 2 });

    const claimed = await database.query<{
      anonymous_user_id: string | null;
      expires_at: Date;
      user_id: string;
    }>(`
      select anonymous_user_id, expires_at, user_id
      from tutor_sessions
      where id like 'reserve-%'
      order by id
    `);
    expect(claimed.rows).toHaveLength(6);
    expect(claimed.rows.every((row) => row.anonymous_user_id === null)).toBe(
      true,
    );
    const minimumExpiry =
      Date.now() +
      (AUTHENTICATED_TUTOR_SESSION_RETENTION_DAYS - 1) * 24 * 60 * 60 * 1_000;
    expect(
      claimed.rows.every(
        (row) => new Date(row.expires_at).getTime() > minimumExpiry,
      ),
    ).toBe(true);
  });

  it("excludes an eligible Reserve question when its topic becomes inactive", async () => {
    const database = await migratedDatabase();
    await seedQuestionsAndActors(database);

    await expect(reservePracticeViewCount(database)).resolves.toBe(1);
    await database.exec(`
      update topics set is_active = false where id = 'claim-topic';
    `);
    await expect(reservePracticeViewCount(database)).resolves.toBe(0);
  });

  it("enforces current, future, expired, and disabled question availability windows", async () => {
    const database = await migratedDatabase();
    await seedQuestionsAndActors(database);
    await database.exec(`
      select set_config(
        'app.current_user_id', 'user:claim-professor', false
      );
      insert into question_student_availability (
        question_id, release_state, available_from, available_until,
        updated_by_user_id
      ) values (
        'claim-reserve-question', 'published',
        now() - interval '1 hour', now() + interval '1 hour',
        'user:claim-professor'
      );
    `);
    await expect(reservePracticeViewCount(database)).resolves.toBe(1);

    await database.exec(`
      update question_student_availability
      set available_from = now() + interval '1 day',
          available_until = now() + interval '2 days'
      where question_id = 'claim-reserve-question';
    `);
    await expect(reservePracticeViewCount(database)).resolves.toBe(0);

    await database.exec(`
      update question_student_availability
      set available_from = now() - interval '2 days',
          available_until = now() - interval '1 day'
      where question_id = 'claim-reserve-question';
    `);
    await expect(reservePracticeViewCount(database)).resolves.toBe(0);

    await database.exec(`
      update question_student_availability
      set release_state = 'unpublished',
          available_from = null,
          available_until = null
      where question_id = 'claim-reserve-question';
    `);
    await expect(reservePracticeViewCount(database)).resolves.toBe(0);
  });

  it("maps a real guard rejection to none when eligibility changes after lookup", async () => {
    const database = await migratedDatabase();
    await seedQuestionsAndActors(database);
    const query = pgliteQuery(database);
    const databaseReserveRepository =
      createDatabaseReservePracticeRepository(query);
    let eligibleCandidatesSeen = 0;

    await database.exec(`
      insert into tutor_sessions (
        id, anonymous_user_id, question_id, question_version_id,
        solved, status, current_state, completed_at
      )
      select
        'reserve-race-origin', 'anon:test-browser-a', q.id,
        q.published_version_id, true, 'completed', 'solved', now()
      from questions q
      where q.id = 'claim-origin-question';
    `);
    setContentRepositoryForTests(
      createDatabaseContentRepository("postgres://unused.example/db", query),
    );
    setTutorSessionRepositoryForTests(
      createDatabaseTutorSessionRepository(
        "postgres://unused.example/db",
        query,
      ),
    );
    setReservePracticeRepositoryForTests({
      getEligibleQuestion: databaseReserveRepository.getEligibleQuestion,
      async listEligibleQuestions() {
        const candidates =
          await databaseReserveRepository.listEligibleQuestions();
        eligibleCandidatesSeen = candidates.length;
        await setReserveState(database, {
          isReserved: true,
          practiceAllowed: false,
        });
        return candidates;
      },
    });

    await expect(
      startSimilarReservePractice(
        authorizationForStudentOwner(TEST_ANONYMOUS_OWNER),
        "reserve-race-origin",
      ),
    ).resolves.toEqual({ outcome: "none" });
    expect(eligibleCandidatesSeen).toBe(1);
    const created = await database.query<{ count: number }>(`
      select count(*)::int as count
      from tutor_sessions
      where practice_context = 'reserve_practice'
    `);
    expect(created.rows[0].count).toBe(0);
  });
});

async function reservePracticeViewCount(database: PGlite) {
  const result = await database.query<{ count: number }>(`
    select count(*)::int as count
    from app_reserve_practice_questions
    where id = 'claim-reserve-question'
  `);
  return result.rows[0].count;
}

async function migratedDatabase() {
  const database = new PGlite();
  databases.push(database);
  const directory = path.join(process.cwd(), "db/migrations");
  for (const filename of readdirSync(directory)
    .filter((value) => value.endsWith(".sql"))
    .sort()) {
    await database.exec(readFileSync(path.join(directory, filename), "utf8"));
  }
  return database;
}

async function seedQuestionsAndActors(database: PGlite) {
  await database.exec(`
    insert into users (
      id, identity_provider, external_subject, email, display_name, status
    ) values
      ('user:claim-professor', 'test', 'claim-professor',
       'claim-professor@example.invalid', 'Claim Professor', 'active'),
      ('user:claim-enabled', 'test', 'claim-enabled',
       'claim-enabled@example.invalid', 'Enabled Student', 'active'),
      ('user:claim-disabled', 'test', 'claim-disabled',
       'claim-disabled@example.invalid', 'Disabled Student', 'active'),
      ('user:claim-released', 'test', 'claim-released',
       'claim-released@example.invalid', 'Released Student', 'active');

    insert into user_roles (user_id, role_id) values
      ('user:claim-professor', 'professor'),
      ('user:claim-enabled', 'student'),
      ('user:claim-disabled', 'student'),
      ('user:claim-released', 'student');

    insert into topics (
      id, title, description, sort_order, week_number, module_ref, is_active
    ) values (
      'claim-topic', 'Claim topic', '', 987, 1, 'claim-module', true
    );

    select set_config('app.current_user_id', 'system:schema-migration', false);
    select set_config('app.current_creation_method', 'imported', false);
    select set_config('app.suppress_question_version', 'true', false);

    insert into questions (
      id, topic_id, title, prompt, difficulty,
      accepted_answers_json, answer_explanation,
      source_type, trust_level, review_status, visibility,
      originality_note, reviewed_by, reviewed_by_user_id, reviewed_at
    ) values
      (
        'claim-origin-question', 'claim-topic', 'Claim origin',
        'What is one divided by two?', 'foundational', '["0.5"]'::jsonb,
        'Divide one by two.', 'professor_provided', 'public_original',
        'approved', 'public', 'Original public-safe claim origin.',
        'Claim Professor', 'user:claim-professor', now()
      ),
      (
        'claim-reserve-question', 'claim-topic', 'Claim Reserve',
        'What is one divided by four?', 'foundational', '["0.25"]'::jsonb,
        'Divide one by four.', 'professor_provided', 'public_original',
        'approved', 'public', 'Original public-safe claim Reserve question.',
        'Claim Professor', 'user:claim-professor', now()
      );

    insert into hints (question_id, hint_order, body) values
      ('claim-origin-question', 1, 'Divide the numerator by the denominator.'),
      ('claim-reserve-question', 1, 'Divide the numerator by the denominator.');
    insert into solution_steps (question_id, step_order, body) values
      ('claim-origin-question', 1, 'Compute 1 / 2 = 0.5.'),
      ('claim-reserve-question', 1, 'Compute 1 / 4 = 0.25.');

    select set_config('app.suppress_question_version', 'false', false);
    select app_record_question_version('claim-origin-question');
    select app_record_question_version('claim-reserve-question');
  `);
  const version = await database.query<{ published_version_id: number }>(`
    select published_version_id
    from questions
    where id = 'claim-reserve-question'
  `);
  const reserveVersionId = Number(version.rows[0].published_version_id);
  await database.query(
    `select * from app_transition_question_version(
      $1, $2, 'unpublish', $3, $4, 'published', 'content_correction',
      null, 'claim-unpublish', 'claim-request', '{}'::jsonb
    )`,
    [
      "claim-reserve-question",
      reserveVersionId,
      "user:claim-professor",
      "Claim Professor",
    ],
  );
  await setReserveState(database, {
    isReserved: true,
    practiceAllowed: true,
  });
  return reserveVersionId;
}

async function seedAnonymousPair(
  database: PGlite,
  input: {
    anonymousId: string;
    childId: string;
    originId: string;
    reserveVersionId: number;
  },
) {
  await database.query(
    `insert into tutor_sessions (
       id, anonymous_user_id, question_id, solved, status, current_state,
       completed_at, expires_at
     ) values ($1, $2, 'claim-origin-question', true, 'completed', 'solved',
       now(), now() + interval '30 days')`,
    [input.originId, input.anonymousId],
  );
  await database.query(
    `insert into tutor_sessions (
       id, anonymous_user_id, question_id, question_version_id,
       practice_context, origin_session_id, expires_at
     ) values ($1, $2, 'claim-reserve-question', $3,
       'reserve_practice', $4, now() + interval '30 days')`,
    [input.childId, input.anonymousId, input.reserveVersionId, input.originId],
  );
}

async function setReserveState(
  database: PGlite,
  input: { isReserved: boolean; practiceAllowed: boolean },
) {
  await database.exec(
    "select set_config('app.reserve_write', 'allowed', false)",
  );
  await database.query(
    `update questions
     set is_reserved = $2,
         reserve_practice_allowed = $3,
         reserve_reason_code = case when $2 then 'extra_practice' else null end,
         reserved_by_user_id = case when $2 then 'user:claim-professor' else null end,
         reserved_at = case when $2 then now() else null end,
         updated_at = now()
     where id = $1`,
    ["claim-reserve-question", input.isReserved, input.practiceAllowed],
  );
}

function pgliteQuery(database: PGlite | Transaction): DatabaseQueryExecutor {
  const query: DatabaseQueryExecutor = async (sql, params = []) => {
    const result = await database.query<Record<string, unknown>>(sql, params);
    return result.rows;
  };
  if (database instanceof PGlite) {
    query.transaction = (work) =>
      database.transaction((transaction) => work(pgliteQuery(transaction)));
  }
  return query;
}
