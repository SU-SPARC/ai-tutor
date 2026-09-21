import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

import {
  requireAnalyticsAccess,
  requireStudent,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseInstructorStudentRepository } from "@/lib/data/instructor-student-repository";
import {
  createDatabaseStudentIdentityRepository,
  recordStudentIdentityViews,
} from "@/lib/data/student-identity-repository";
import {
  resolveInstructorStudentRoster,
  setStudentIdentityDependenciesForTests,
  type ProviderIdentity,
} from "@/lib/professor/student-identity";

/**
 * Five students whose surnames sort in the opposite order to their user ids
 * and pseudonyms, so an alphabetical result cannot be an accident of either.
 */
const ANDERS = {
  email: "zoe.anders@suffolk.edu",
  familyName: "Anders",
  givenName: "Zoe",
  name: "Zoe Anders",
  subject: "user_2topicAnders",
  userId: "user:topic-roster-e-anders",
};
const BROWN = {
  email: "adam.brown@suffolk.edu",
  familyName: "Brown",
  givenName: "Adam",
  name: "Adam Brown",
  subject: "user_2topicBrown",
  userId: "user:topic-roster-d-brown",
};
const CLARK_LIAM = {
  email: "liam.clark@suffolk.edu",
  familyName: "Clark",
  givenName: "Liam",
  name: "Liam Clark",
  subject: "user_2topicClarkLiam",
  userId: "user:topic-roster-c-clark-liam",
};
const CLARK_MIA = {
  email: "mia.clark@suffolk.edu",
  familyName: "Clark",
  givenName: "Mia",
  name: "Mia Clark",
  subject: "user_2topicClarkMia",
  userId: "user:topic-roster-b-clark-mia",
};
const ANONYMOUS_OWNER = "topic-roster-anonymous-owner";

const STUDENTS = [ANDERS, BROWN, CLARK_LIAM, CLARK_MIA];
const ANDERS_KEY = keyFor(`user:${ANDERS.userId}`);
const BROWN_KEY = keyFor(`user:${BROWN.userId}`);
const CLARK_LIAM_KEY = keyFor(`user:${CLARK_LIAM.userId}`);
const CLARK_MIA_KEY = keyFor(`user:${CLARK_MIA.userId}`);
const ANONYMOUS_KEY = keyFor(`anon:${ANONYMOUS_OWNER}`);
const PROFESSOR_KEY = keyFor(`user:${TEST_PROFESSOR.userId}`);
const UNKNOWN_KEY = "f".repeat(64);

/** Strings that must never appear in a pseudonymous payload or an audit row. */
const IDENTIFIERS = STUDENTS.flatMap((student) => [
  student.email,
  student.name,
  student.familyName,
  student.subject,
  student.userId,
]).concat(ANONYMOUS_OWNER);

/** Strings that must not appear even after a reveal has shown the names. */
const PRIVATE_IDENTIFIERS = STUDENTS.flatMap((student) => [
  student.email,
  student.subject,
  student.userId,
]).concat(ANONYMOUS_OWNER);

const databases: PGlite[] = [];

afterEach(() => {
  resetAuthMocks();
  setStudentIdentityDependenciesForTests(undefined);
  vi.unstubAllEnvs();
});

afterAll(async () => {
  while (databases.length > 0) {
    await databases.pop()?.close();
  }
});

describe("students grouped by practised topic", () => {
  let database: PGlite;
  let query: DatabaseQueryExecutor;
  let repository: ReturnType<typeof createDatabaseInstructorStudentRepository>;
  let identity: ReturnType<typeof createDatabaseStudentIdentityRepository>;

  beforeAll(async () => {
    database = await migratedDatabase();
    query = pgliteQuery(database);
    repository = createDatabaseInstructorStudentRepository(query);
    identity = createDatabaseStudentIdentityRepository(query);
    await seed(database);
  }, 60_000);

  it("derives each student's topics from published practice, in syllabus order", async () => {
    const roster = await repository.listTopicRoster(await professorAuthorization());

    expect(roster.mode).toBe("database");
    expect(roster.revealed).toBe(false);
    // Syllabus order, not title order: "Binomial" would otherwise come first.
    expect(roster.topics.map((group) => [group.topicId, group.topicTitle])).toEqual([
      ["conditional-probability", "Conditional Probability"],
      ["binomial-models", "Binomial Models"],
    ]);
    // Anders practised both topics and is listed under each; Brown practised
    // one; the anonymous student's attempt places them under the second.
    expect(roster.topics[0].students).toEqual(
      [ANDERS_KEY, BROWN_KEY].sort().map((studentKey) => ({ studentKey })),
    );
    expect(roster.topics[1].students).toEqual(
      [ANDERS_KEY, ANONYMOUS_KEY].sort().map((studentKey) => ({ studentKey })),
    );
  });

  it("lists students with no practised topic once, under unassigned", async () => {
    const roster = await repository.listTopicRoster(await professorAuthorization());

    // Liam Clark only signed in; Mia Clark opened a question without
    // interacting, which is not practice and associates no topic.
    expect(roster.unassigned).toEqual(
      [CLARK_LIAM_KEY, CLARK_MIA_KEY].sort().map((studentKey) => ({ studentKey })),
    );
  });

  it("never lists the professor and returns no identity column", async () => {
    const roster = await repository.listTopicRoster(await professorAuthorization());
    const serialized = JSON.stringify(roster);

    expect(serialized).not.toContain(PROFESSOR_KEY);
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
    expect(serialized).not.toContain("@");
  });

  it("does not duplicate a database record when a student appears under several topics", async () => {
    const roster = await repository.listTopicRoster(await professorAuthorization());
    const rows = await database.query<{ total: number }>(
      "select count(*)::int as total from users where id = $1",
      [ANDERS.userId],
    );

    expect(
      roster.topics.filter((group) =>
        group.students.some((student) => student.studentKey === ANDERS_KEY),
      ),
    ).toHaveLength(2);
    expect(rows.rows[0].total).toBe(1);
  });

  it("resolves every roster pseudonym's account link in one read", async () => {
    const links = await identity.findAccountLinks(await professorAuthorization(), [
      ANDERS_KEY,
      BROWN_KEY,
      CLARK_LIAM_KEY,
      CLARK_MIA_KEY,
      ANONYMOUS_KEY,
      PROFESSOR_KEY,
      UNKNOWN_KEY,
      ANDERS_KEY,
    ]);

    expect(links.get(ANDERS_KEY)).toEqual({
      identityProvider: "clerk",
      kind: "account",
      subject: ANDERS.subject,
    });
    expect(links.get(CLARK_LIAM_KEY)).toEqual({
      identityProvider: "clerk",
      kind: "account",
      subject: CLARK_LIAM.subject,
    });
    expect(links.get(ANONYMOUS_KEY)).toEqual({ kind: "anonymous" });
    expect(links.has(PROFESSOR_KEY)).toBe(false);
    expect(links.has(UNKNOWN_KEY)).toBe(false);
    expect(links.size).toBe(5);
    await expect(
      identity.findAccountLinks(await professorAuthorization(), []),
    ).resolves.toEqual(new Map());
  });

  it("records one audit row per named student, marked with the view that showed it", async () => {
    await recordStudentIdentityViews(query, {
      professorUserId: TEST_PROFESSOR.userId,
      requestId: "request-roster-audit",
      scope: "roster",
      views: [
        { status: "identified", studentKey: ANDERS_KEY },
        { status: "anonymous", studentKey: ANONYMOUS_KEY },
      ],
    });

    const events = await database.query<{
      actor_user_id: string | null;
      entity_id: string;
      metadata_json: unknown;
      request_id: string | null;
    }>(
      `select actor_user_id, entity_id, metadata_json, request_id
       from audit_events
       where action = 'analytics.student_identity_viewed'
         and request_id = 'request-roster-audit'
       order by entity_id`,
    );

    expect(events.rows).toEqual(
      [
        {
          actor_user_id: TEST_PROFESSOR.userId,
          entity_id: ANDERS_KEY,
          metadata_json: { result: "identified", scope: "roster" },
          request_id: "request-roster-audit",
        },
        {
          actor_user_id: TEST_PROFESSOR.userId,
          entity_id: ANONYMOUS_KEY,
          metadata_json: { result: "anonymous", scope: "roster" },
          request_id: "request-roster-audit",
        },
      ].sort((left, right) => left.entity_id.localeCompare(right.entity_id)),
    );
    const serialized = JSON.stringify(events.rows);
    for (const identifier of IDENTIFIERS) {
      expect(serialized).not.toContain(identifier);
    }
  });

  it("rejects an audit write that records fewer rows than it was given", async () => {
    const views = [{ status: "identified", studentKey: ANDERS_KEY }];

    await expect(
      recordStudentIdentityViews(
        async () => {
          throw new Error('relation "audit_events" does not exist');
        },
        { professorUserId: TEST_PROFESSOR.userId, scope: "activity", views },
      ),
    ).rejects.toThrow();
    await expect(
      recordStudentIdentityViews(async () => [], {
        professorUserId: TEST_PROFESSOR.userId,
        scope: "activity",
        views,
      }),
    ).rejects.toThrow();
    // Nothing to show is nothing to record, not a failure.
    await expect(
      recordStudentIdentityViews(async () => [], {
        professorUserId: TEST_PROFESSOR.userId,
        scope: "activity",
        views: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("names the roster end to end, alphabetical by last name within each topic, and audits it", async () => {
    vi.stubEnv("APP_DEMO_MODE", "true");
    const providerRecords = new Map<string, ProviderIdentity>(
      STUDENTS.map((student) => [
        student.subject,
        {
          displayName: student.name,
          email: student.email,
          familyName: student.familyName,
          givenName: student.givenName,
        },
      ]),
    );
    const lookUpIdentities = vi.fn(async (links: Array<{ subject: string }>) =>
      new Map(
        links.map(({ subject }) => [
          subject,
          providerRecords.get(subject) ?? ("unlinked" as const),
        ]),
      ),
    );
    setStudentIdentityDependenciesForTests({
      findAccountLinks: (authorization, keys) =>
        identity.findAccountLinks(authorization, keys),
      listTopicRoster: (authorization) => repository.listTopicRoster(authorization),
      lookUpIdentities,
      recordViews: (authorization, input) =>
        recordStudentIdentityViews(query, {
          ...input,
          professorUserId: authorization.principal.userId,
        }),
    });

    const roster = await resolveInstructorStudentRoster(
      await professorAuthorization(),
      { requestId: "request-roster-page" },
    );

    expect(roster.revealed).toBe(true);
    // Conditional Probability: Anders before Brown, by surname, although
    // Brown's pseudonym and user id both sort first.
    expect(roster.topics[0].students).toEqual([
      { identity: { displayName: ANDERS.name, status: "identified" }, studentKey: ANDERS_KEY },
      { identity: { displayName: BROWN.name, status: "identified" }, studentKey: BROWN_KEY },
    ]);
    // Binomial Models: the anonymous student follows the named one.
    expect(roster.topics[1].students).toEqual([
      { identity: { displayName: ANDERS.name, status: "identified" }, studentKey: ANDERS_KEY },
      { identity: { status: "anonymous" }, studentKey: ANONYMOUS_KEY },
    ]);
    // Unassigned: the two Clarks are separated by first name.
    expect(roster.unassigned).toEqual([
      { identity: { displayName: CLARK_LIAM.name, status: "identified" }, studentKey: CLARK_LIAM_KEY },
      { identity: { displayName: CLARK_MIA.name, status: "identified" }, studentKey: CLARK_MIA_KEY },
    ]);
    // The anonymous student was never sent to the provider.
    expect(lookUpIdentities).toHaveBeenCalledTimes(1);
    expect(lookUpIdentities.mock.calls[0][0]).toHaveLength(4);

    // Display names are the one thing a reveal shows; nothing else about the
    // account — address, subject, id, anonymous owner — may travel with them.
    const body = JSON.stringify(roster);
    for (const identifier of PRIVATE_IDENTIFIERS) {
      expect(body).not.toContain(identifier);
    }
    expect(body).not.toContain("@");
    expect(body).not.toContain("familyName");
    expect(body).not.toContain("givenName");

    const audited = await database.query<{ entity_id: string; metadata_json: unknown }>(
      `select entity_id, metadata_json
       from audit_events
       where action = 'analytics.student_identity_viewed'
         and request_id = 'request-roster-page'
       order by entity_id`,
    );
    expect(audited.rows.map((row) => row.entity_id)).toEqual(
      [ANDERS_KEY, BROWN_KEY, CLARK_LIAM_KEY, CLARK_MIA_KEY, ANONYMOUS_KEY].sort(),
    );
    expect(audited.rows.find((row) => row.entity_id === ANONYMOUS_KEY)?.metadata_json).toEqual({
      result: "anonymous",
      scope: "roster",
    });
    const auditText = JSON.stringify(audited.rows);
    for (const identifier of IDENTIFIERS) {
      expect(auditText).not.toContain(identifier);
    }
  });

  it("refuses the roster reads for a student principal", async () => {
    mockPrincipal(TEST_STUDENT);
    const student = (await requireStudent()) as never;

    await expect(repository.listTopicRoster(student)).rejects.toThrow();
    await expect(identity.findAccountLinks(student, [ANDERS_KEY])).rejects.toThrow();
  });
});

async function professorAuthorization(): Promise<AnalyticsAuthorization> {
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}

function keyFor(owner: string) {
  return createHash("sha256").update(owner).digest("hex");
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

function pgliteQuery(database: PGlite): DatabaseQueryExecutor {
  return async (sql, params = []) =>
    (await database.query(sql, params)).rows as Record<string, unknown>[];
}

/**
 * Two published questions in two topics, four signed-in students, one
 * anonymous student, and the professor. Anders practised both topics (a hint
 * in one, an answer in the other); Brown practised one; Mia Clark opened a
 * question and did nothing; Liam Clark only signed in. The professor's own
 * practice is present so the population filter is exercised.
 */
async function seed(database: PGlite) {
  await database.query(
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values ($1, 'test', 'topic-roster-professor', 'professor@example.edu', 'Professor', 'active')`,
    [TEST_PROFESSOR.userId],
  );
  for (const student of STUDENTS) {
    await database.query(
      `insert into users (
         id, identity_provider, external_subject, email, display_name, status
       ) values ($1, 'clerk', $2, $3, $4, 'active')`,
      [student.userId, student.subject, student.email, student.name],
    );
  }
  await database.query(
    "insert into user_roles (user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await database.query(
    `insert into topics (id, title, description, sort_order, is_active) values
       ('conditional-probability', 'Conditional Probability', '', 1, true),
       ('binomial-models', 'Binomial Models', '', 2, true)`,
  );
  await database.exec(
    "select set_config('app.current_creation_method', 'manual', false)",
  );
  await seedQuestion(database, "cp-question", "conditional-probability");
  await seedQuestion(database, "bm-question", "binomial-models");

  const sessions: Array<[string, string | null, string | null, string, number]> = [
    ["anders-cp", ANDERS.userId, null, "cp-question", 1],
    ["anders-bm", ANDERS.userId, null, "bm-question", 0],
    ["brown-cp", BROWN.userId, null, "cp-question", 1],
    ["mia-opened-cp", CLARK_MIA.userId, null, "cp-question", 0],
    ["anonymous-bm", null, ANONYMOUS_OWNER, "bm-question", 0],
    ["professor-cp", TEST_PROFESSOR.userId, null, "cp-question", 1],
  ];
  for (const [id, userId, anonymousUserId, questionId, hints] of sessions) {
    await database.query(
      `insert into tutor_sessions (
         id, user_id, anonymous_user_id, question_id, revealed_hints
       ) values ($1, $2, $3, $4, $5)`,
      [id, userId, anonymousUserId, questionId, hints],
    );
  }
  await database.query(
    `insert into attempts (session_id, question_id, topic_id, mode, source, verdict) values
       ('anders-bm', 'bm-question', 'binomial-models', 'check', 'rule', 'correct'),
       ('anonymous-bm', 'bm-question', 'binomial-models', 'check', 'rule', 'incorrect')`,
  );
}

async function seedQuestion(database: PGlite, id: string, topicId: string) {
  await database.query(
    `insert into questions (
       id, topic_id, title, prompt, difficulty, accepted_answers_json,
       answer_explanation, source_type, trust_level, review_status,
       visibility, originality_note, reviewed_by, reviewed_by_user_id,
       reviewed_at
     ) values ($1, $2, 'Question', 'Prompt text', 'foundational',
       '["0.5"]'::jsonb, 'Divide the favorable outcomes by the total.',
       'original_demo', 'public_original', 'approved', 'public',
       'Original test question.', 'Professor', $3, now())`,
    [id, topicId, TEST_PROFESSOR.userId],
  );
  await database.query(
    `insert into hints (question_id, hint_order, body)
     values ($1, 1, 'Start with the numerator and denominator.')`,
    [id],
  );
  await database.query(
    `insert into solution_steps (question_id, step_order, body)
     values ($1, 1, 'Divide the favorable outcomes by the total.')`,
    [id],
  );

  const [version] = (
    await database.query<{ id: number }>(
      "select working_version_id as id from questions where id = $1",
      [id],
    )
  ).rows;
  for (const [action, expectedState] of [
    ["submit", "draft"],
    ["approve", "needs_review"],
    ["publish", "approved"],
  ]) {
    await database.query(
      `select * from app_transition_question_version(
         target_question_id => $1,
         target_question_version_id => $2,
         transition_action => $3,
         actor_id => $4,
         actor_display => 'Professor',
         expected_state => $5,
         idempotency_key_value => $6
       )`,
      [id, version.id, action, TEST_PROFESSOR.userId, expectedState, `seed:${id}:${action}`],
    );
  }
}
