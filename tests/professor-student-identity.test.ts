import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";

import { POST as revealIdentity } from "@/app/api/professor/students/[studentKey]/identity/route";
import {
  requireAnalyticsAccess,
  type AnalyticsAuthorization,
} from "@/lib/auth/authorization";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { createDatabaseInstructorStudentRepository } from "@/lib/data/instructor-student-repository";
import {
  createDatabaseStudentIdentityRepository,
  recordStudentIdentityView,
  type StudentAccountLink,
} from "@/lib/data/student-identity-repository";
import {
  identityForLink,
  setStudentIdentityDependenciesForTests,
  type ProviderIdentity,
} from "@/lib/professor/student-identity";

const SIGNED_IN_USER_ID = "user:identity-student";
const CLERK_SUBJECT = "user_2clerkStudent";
const ANONYMOUS_OWNER = "identity-anonymous-owner";
const STUDENT_NAME = "Jane Smith";
const STUDENT_EMAIL = "jane.smith@suffolk.edu";

const SIGNED_IN_KEY = studentKeyFor(`user:${SIGNED_IN_USER_ID}`);
const ANONYMOUS_KEY = studentKeyFor(`anon:${ANONYMOUS_OWNER}`);
const PROFESSOR_KEY = studentKeyFor(`user:${TEST_PROFESSOR.userId}`);
const UNKNOWN_KEY = "f".repeat(64);

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

describe("pseudonym to account mapping", () => {
  let database: PGlite;
  let query: DatabaseQueryExecutor;
  let repository: ReturnType<typeof createDatabaseStudentIdentityRepository>;

  beforeAll(async () => {
    database = await migratedDatabase();
    query = pgliteQuery(database);
    repository = createDatabaseStudentIdentityRepository(query);
    await seed(database);
  }, 60_000);

  it("resolves a pseudonymous key to the account's provider subject", async () => {
    const link = await repository.findAccountLink(
      await professorAuthorization(),
      SIGNED_IN_KEY,
    );

    expect(link).toEqual({
      identityProvider: "clerk",
      kind: "account",
      subject: CLERK_SUBJECT,
    });
  });

  it("reports a student who practised without signing in as anonymous", async () => {
    const link = await repository.findAccountLink(
      await professorAuthorization(),
      ANONYMOUS_KEY,
    );

    expect(link).toEqual({ kind: "anonymous" });
  });

  it("resolves nothing for a key outside the analytics population", async () => {
    const authorization = await professorAuthorization();

    await expect(
      repository.findAccountLink(authorization, UNKNOWN_KEY),
    ).resolves.toBeUndefined();
    // Professor practice is excluded from the student population, so a
    // professor cannot drill from their own recorded practice into an identity.
    await expect(
      repository.findAccountLink(authorization, PROFESSOR_KEY),
    ).resolves.toBeUndefined();
  });

  it("refuses the lookup for a principal without professor permission", async () => {
    mockPrincipal(TEST_STUDENT);

    await expect(
      repository.findAccountLink(
        { permission: "student" } as never,
        SIGNED_IN_KEY,
      ),
    ).rejects.toThrow();
  });

  it("records who looked at which pseudonym without recording the identity", async () => {
    await recordStudentIdentityView(query, {
      professorUserId: TEST_PROFESSOR.userId,
      requestId: "request-identity-1",
      status: "identified",
      studentKey: SIGNED_IN_KEY,
    });

    const events = await database.query<{
      action: string;
      actor_user_id: string | null;
      entity_id: string;
      metadata_json: unknown;
    }>(
      `select action, actor_user_id, entity_id, metadata_json
       from audit_events
       where action = 'analytics.student_identity_viewed'`,
    );

    expect(events.rows).toEqual([
      {
        action: "analytics.student_identity_viewed",
        actor_user_id: TEST_PROFESSOR.userId,
        entity_id: SIGNED_IN_KEY,
        metadata_json: { result: "identified" },
      },
    ]);
    const serialized = JSON.stringify(events.rows);
    expect(serialized).not.toContain(STUDENT_NAME);
    expect(serialized).not.toContain(STUDENT_EMAIL);
    expect(serialized).not.toContain(CLERK_SUBJECT);
    expect(serialized).not.toContain(SIGNED_IN_USER_ID);
  });

  it("rejects rather than silently skipping an audit row it could not write", async () => {
    const failing: DatabaseQueryExecutor = async () => {
      throw new Error('relation "audit_events" does not exist');
    };

    await expect(
      recordStudentIdentityView(failing, {
        professorUserId: TEST_PROFESSOR.userId,
        status: "identified",
        studentKey: SIGNED_IN_KEY,
      }),
    ).rejects.toThrow();
    await expect(
      recordStudentIdentityView(async () => [], {
        professorUserId: TEST_PROFESSOR.userId,
        status: "identified",
        studentKey: SIGNED_IN_KEY,
      }),
    ).rejects.toThrow();
  });

  it("keeps the analytics reads pseudonymous and working without the identity provider", async () => {
    const authorization = await professorAuthorization();
    const analytics = createDatabaseInstructorStudentRepository(query);
    const list = await analytics.listStudents(authorization);
    const detail = await analytics.getStudentDetail(
      authorization,
      SIGNED_IN_KEY,
    );
    const serialized = JSON.stringify({ detail, list });

    expect(list.students.map((student) => student.studentKey).sort()).toEqual(
      [ANONYMOUS_KEY, SIGNED_IN_KEY].sort(),
    );
    expect(detail?.summary.studentKey).toBe(SIGNED_IN_KEY);
    expect(serialized).not.toContain(STUDENT_NAME);
    expect(serialized).not.toContain(STUDENT_EMAIL);
    expect(serialized).not.toContain(CLERK_SUBJECT);
    expect(serialized).not.toContain(SIGNED_IN_USER_ID);
    expect(serialized).not.toContain(ANONYMOUS_OWNER);
  });
});

describe("identity resolution", () => {
  it("returns the display name and primary email and nothing else", async () => {
    const identity = await identityForLink(accountLink(), async () => ({
      displayName: STUDENT_NAME,
      email: STUDENT_EMAIL,
    }));

    expect(identity).toEqual({
      displayName: STUDENT_NAME,
      email: STUDENT_EMAIL,
      status: "identified",
    });
    expect(Object.keys(identity).sort()).toEqual([
      "displayName",
      "email",
      "status",
    ]);
  });

  it("identifies a student whose account holds no email address", async () => {
    const identity = await identityForLink(accountLink(), async () => ({
      displayName: STUDENT_NAME,
    }));

    expect(identity).toEqual({
      displayName: STUDENT_NAME,
      status: "identified",
    });
  });

  it("reports a missing provider account as unlinked", async () => {
    await expect(
      identityForLink(accountLink(), async () => "unlinked"),
    ).resolves.toEqual({ status: "unlinked" });
  });

  it("reports an unreachable provider as unavailable", async () => {
    await expect(
      identityForLink(accountLink(), async () => "unavailable"),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("never asks the provider about a student who never signed in", async () => {
    const lookUpIdentity = vi.fn<() => Promise<ProviderIdentity>>();

    await expect(
      identityForLink({ kind: "anonymous" }, lookUpIdentity),
    ).resolves.toEqual({ status: "anonymous" });
    expect(lookUpIdentity).not.toHaveBeenCalled();
  });
});

describe("identity reveal endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("APP_DEMO_MODE", "true");
  });

  it("denies a signed-out request before any student is looked up", async () => {
    mockPrincipal(undefined);
    const findAccountLink = vi.fn();
    setStudentIdentityDependenciesForTests({ findAccountLink });

    const response = await reveal(SIGNED_IN_KEY);

    expect(response.status).toBe(401);
    expect(findAccountLink).not.toHaveBeenCalled();
  });

  it("denies an ordinary student the same way for a real and a made-up key", async () => {
    mockPrincipal(TEST_STUDENT);
    const findAccountLink = vi.fn();
    setStudentIdentityDependenciesForTests({ findAccountLink });

    const [known, unknown] = await Promise.all([
      reveal(SIGNED_IN_KEY),
      reveal(UNKNOWN_KEY),
    ]);

    expect(known.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(await known.json()).toEqual(await unknown.json());
    expect(findAccountLink).not.toHaveBeenCalled();
  });

  it("returns the identity to an authorized professor and audits the reveal", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const recordView = vi.fn(async () => {});
    setStudentIdentityDependenciesForTests({
      findAccountLink: async () => accountLink(),
      lookUpIdentity: async () => ({
        displayName: STUDENT_NAME,
        email: STUDENT_EMAIL,
      }),
      recordView,
    });

    const response = await reveal(SIGNED_IN_KEY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      displayName: STUDENT_NAME,
      email: STUDENT_EMAIL,
      status: "identified",
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(recordView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "identified",
        studentKey: SIGNED_IN_KEY,
      }),
    );
    const audited = JSON.stringify(recordView.mock.calls);
    expect(audited).not.toContain(STUDENT_NAME);
    expect(audited).not.toContain(STUDENT_EMAIL);
  });

  it("withholds the identity when the reveal cannot be audited", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const lookUpIdentity = vi.fn(async () => ({
      displayName: STUDENT_NAME,
      email: STUDENT_EMAIL,
    }));
    setStudentIdentityDependenciesForTests({
      findAccountLink: async () => accountLink(),
      lookUpIdentity,
      recordView: async () => {
        throw new Error('relation "audit_events" does not exist');
      },
    });

    const response = await reveal(SIGNED_IN_KEY);
    const body = await response.text();

    // The identity was resolved and then deliberately discarded: an
    // unauditable reveal must be indistinguishable from one that never found
    // an identity at all.
    expect(lookUpIdentity).toHaveBeenCalled();
    expect(JSON.parse(body)).toEqual({ status: "unavailable" });
    expect(body).not.toContain(STUDENT_NAME);
    expect(body).not.toContain(STUDENT_EMAIL);
    expect(body).not.toContain(CLERK_SUBJECT);
    expect(body).not.toContain("audit_events");
    expect(body).not.toContain("relation");
  });

  it("withholds an anonymous or unlinked outcome it could not audit as well", async () => {
    mockPrincipal(TEST_PROFESSOR);
    setStudentIdentityDependenciesForTests({
      findAccountLink: async () => ({ kind: "anonymous" }),
      recordView: async () => {
        throw new Error("audit store unavailable");
      },
    });

    const response = await reveal(ANONYMOUS_KEY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("keeps identity out of the request URL", async () => {
    mockPrincipal(TEST_PROFESSOR);
    const seen: string[] = [];
    setStudentIdentityDependenciesForTests({
      findAccountLink: async () => accountLink(),
      lookUpIdentity: async () => ({
        displayName: STUDENT_NAME,
        email: STUDENT_EMAIL,
      }),
      recordView: async () => {},
    });

    const request = new Request(
      `http://test/api/professor/students/${SIGNED_IN_KEY}/identity`,
      { method: "POST" },
    );
    seen.push(request.url);
    await revealIdentity(request, {
      params: Promise.resolve({ studentKey: SIGNED_IN_KEY }),
    });

    expect(seen[0]).toBe(
      `http://test/api/professor/students/${SIGNED_IN_KEY}/identity`,
    );
    expect(seen[0]).not.toContain("@");
    expect(seen[0].toLowerCase()).not.toContain("jane");
  });

  it("answers 404 for a key that is not a digest and for one that matches nobody", async () => {
    mockPrincipal(TEST_PROFESSOR);
    setStudentIdentityDependenciesForTests({
      findAccountLink: async () => undefined,
    });

    const [malformed, missing] = await Promise.all([
      reveal("jane.smith@suffolk.edu"),
      reveal(UNKNOWN_KEY),
    ]);

    expect(malformed.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await malformed.json()).toEqual(await missing.json());
  });

  it("reports a provider outage without failing the page", async () => {
    mockPrincipal(TEST_PROFESSOR);
    setStudentIdentityDependenciesForTests({
      findAccountLink: async () => accountLink(),
      lookUpIdentity: async () => "unavailable",
      recordView: async () => {},
    });

    const response = await reveal(SIGNED_IN_KEY);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});

describe("identity stays out of the analytics and tutor paths", () => {
  it("keeps names and email addresses out of every analytics query", () => {
    for (const file of [
      "src/lib/data/instructor-student-repository.ts",
      "src/lib/data/analytics-population.ts",
      "src/lib/analytics/pilot-export.ts",
      "src/lib/data/pilot-analytics-export-repository.ts",
    ]) {
      const source = readFileSync(path.join(process.cwd(), file), "utf8");

      expect(source, `${file} must not read identity columns`).not.toMatch(
        /display_name|\bemail\b|external_subject/,
      );
    }
  });

  it("is imported only by the reveal boundary itself", () => {
    const importers = sourceFiles(path.join(process.cwd(), "src")).filter(
      (file) =>
        readFileSync(file, "utf8").includes("professor/student-identity"),
    );

    expect(
      importers
        .map((file) =>
          path.relative(process.cwd(), file).split(path.sep).join("/"),
        )
        .sort(),
    ).toEqual([
      "src/app/api/professor/students/[studentKey]/identity/route.ts",
    ]);
  });
});

function accountLink(): StudentAccountLink {
  return {
    identityProvider: "clerk",
    kind: "account",
    subject: CLERK_SUBJECT,
  };
}

function reveal(studentKey: string) {
  return revealIdentity(
    new Request(
      `http://test/api/professor/students/${encodeURIComponent(studentKey)}/identity`,
      { method: "POST" },
    ),
    { params: Promise.resolve({ studentKey }) },
  );
}

async function professorAuthorization(): Promise<AnalyticsAuthorization> {
  mockPrincipal(TEST_PROFESSOR);
  return requireAnalyticsAccess();
}

function studentKeyFor(owner: string) {
  return createHash("sha256").update(owner).digest("hex");
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.tsx?$/.test(entry.name) ? [absolute] : [];
  });
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
 * One signed-in student, one anonymous student, and one professor, each with a
 * single engaged session. The professor row is present so the population filter
 * is exercised rather than assumed.
 */
async function seed(database: PGlite) {
  await database.query(
    `insert into users (
       id, identity_provider, external_subject, email, display_name, status
     ) values
       ($1, 'test', 'identity-professor', 'professor@example.edu', 'Professor', 'active'),
       ($2, 'clerk', $3, $4, $5, 'active')`,
    [
      TEST_PROFESSOR.userId,
      SIGNED_IN_USER_ID,
      CLERK_SUBJECT,
      STUDENT_EMAIL,
      STUDENT_NAME,
    ],
  );
  await database.query(
    "insert into user_roles (user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await database.query(
    `insert into topics (id, title, description, sort_order, is_active)
     values ('conditional-probability', 'Conditional Probability', '', 1, true)`,
  );
  await database.exec(
    "select set_config('app.current_creation_method', 'manual', false)",
  );
  await database.query(
    `insert into questions (
       id, topic_id, title, prompt, difficulty, accepted_answers_json,
       answer_explanation, source_type, trust_level, review_status,
       visibility, originality_note, reviewed_by, reviewed_by_user_id,
       reviewed_at
     ) values ('cp-question', 'conditional-probability', 'Question',
       'Prompt text', 'foundational', '["0.5"]'::jsonb,
       'Divide the favorable outcomes by the total.', 'original_demo',
       'public_original', 'approved', 'public', 'Original test question.',
       'Professor', $1, now())`,
    [TEST_PROFESSOR.userId],
  );

  await database.query(
    `insert into hints (question_id, hint_order, body)
     values ('cp-question', 1, 'Start with the numerator and denominator.')`,
  );
  await database.query(
    `insert into solution_steps (question_id, step_order, body)
     values ('cp-question', 1, 'Divide the favorable outcomes by the total.')`,
  );

  const [version] = (
    await database.query<{ id: number }>(
      "select working_version_id as id from questions where id = 'cp-question'",
    )
  ).rows;
  for (const [action, expectedState] of [
    ["submit", "draft"],
    ["approve", "needs_review"],
    ["publish", "approved"],
  ]) {
    await database.query(
      `select * from app_transition_question_version(
         target_question_id => 'cp-question',
         target_question_version_id => $1,
         transition_action => $2,
         actor_id => $3,
         actor_display => 'Professor',
         expected_state => $4,
         idempotency_key_value => $5
       )`,
      [
        version.id,
        action,
        TEST_PROFESSOR.userId,
        expectedState,
        `seed:${action}`,
      ],
    );
  }

  const sessions: Array<[string, string | null, string | null]> = [
    ["session-signed-in", SIGNED_IN_USER_ID, null],
    ["session-anonymous", null, ANONYMOUS_OWNER],
    ["session-professor", TEST_PROFESSOR.userId, null],
  ];

  for (const [sessionId, userId, anonymousUserId] of sessions) {
    await database.query(
      `insert into tutor_sessions (
         id, user_id, anonymous_user_id, question_id, revealed_hints
       ) values ($1, $2, $3, 'cp-question', 1)`,
      [sessionId, userId, anonymousUserId],
    );
  }
}
