import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  requireProfessorReview,
  requireAnalyticsAccess,
} from "@/lib/auth/authorization";
import {
  createDatabaseQuestionLifecycleRepository,
  type QuestionVersionContentInput,
} from "@/lib/data/question-lifecycle-repository";
import { createDatabaseTutorSessionRepository } from "@/lib/data/tutor-session-repository";
import { createDatabaseInstructorStudentRepository } from "@/lib/data/instructor-student-repository";
import { createDatabasePilotAnalyticsExportRepository } from "@/lib/data/pilot-analytics-export-repository";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { checkAnswer } from "@/lib/tutor/answer-checker";
import { numericAnswerMatches } from "@/lib/tutor/answer/rational";
import { validateAnswerSpec, type AnswerSpec } from "@/lib/tutor/answer/spec";
import { decideTutorResponse } from "@/lib/tutor/tutor-engine";
import { getTutorSessionState } from "@/lib/tutor/tutor-state";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

let db: PGlite;
let query: DatabaseQueryExecutor;
let oldSnapshot: unknown;
const numeric: AnswerSpec = {
  kind: "numeric",
  value: "0.5",
  domain: "probability",
  percentMode: "either",
  tolerance: { mode: "exact" },
};
const specs: Array<[AnswerSpec, string[]]> = [
  [numeric, ["\\frac{1}{2}", "½", "5e-1", "50 percent"]],
  [{ kind: "categorical", canonical: "seven", aliases: ["7"] }, ["seven", "7"]],
  [
    {
      kind: "number_list",
      values: ["0.1", "0.6", "0.3"],
      ordered: true,
      tolerance: { mode: "exact" },
    },
    ["1/10,6/10,3/10"],
  ],
];
beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations")
    .filter((f) => f.endsWith(".sql") && !f.startsWith("024"))
    .sort())
    await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await db.query(
    "insert into users (id, display_name, identity_provider, external_subject, status, email) values ($1, 'Professor', 'test', 'typed-professor', 'active', 'typed-professor@example.invalid')",
    [TEST_PROFESSOR.userId],
  );
  await db.query(
    "insert into user_roles(user_id, role_id) values ($1, 'professor')",
    [TEST_PROFESSOR.userId],
  );
  await db.exec(`
    insert into topics(id,title,description,sort_order,is_active) values ('conditional-probability','Conditional Probability','',1,true);
    select set_config('app.current_user_id','system:schema-migration',false);
    select set_config('app.current_creation_method','imported',false);
    select set_config('app.suppress_question_version','true',false);
    insert into questions(id,topic_id,title,prompt,difficulty,accepted_answers_json,numeric_value,tolerance,answer_explanation,source_type,trust_level,review_status,visibility,originality_note,reviewed_by,reviewed_by_user_id,reviewed_at)
      values ('typed-legacy','conditional-probability','Legacy question','One of two outcomes is favorable. Find its probability.','foundational','["0.5","1/2"]',0.5,0.001,'Divide one by two.','original_demo','public_original','approved','public','Original question.','Professor','${TEST_PROFESSOR.userId}',now());
    insert into hints(question_id,hint_order,body) values ('typed-legacy',1,'Count the favorable outcomes before dividing.');
    insert into solution_steps(question_id,step_order,body) values ('typed-legacy',1,'Compute one divided by two.');
    select set_config('app.suppress_question_version','false',false);
    select app_record_question_version('typed-legacy');
  `);
  oldSnapshot = (
    await db.query(
      "select snapshot_json, content_hash, content_sha256 from question_versions where question_id='typed-legacy'",
    )
  ).rows;
  await db.exec(
    readFileSync("db/migrations/024_typed_answer_spec.sql", "utf8"),
  );
  query = async (sql, params = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  query.transaction = (work) =>
    db.transaction(async (tx) =>
      work(
        async (sql, params = []) =>
          (await tx.query<Record<string, unknown>>(sql, params)).rows,
      ),
    );
}, 30_000);
beforeEach(() => mockPrincipal(TEST_PROFESSOR));
afterEach(resetAuthMocks);
afterAll(async () => db?.close());

function content(
  id: string,
  spec: AnswerSpec,
  acceptedAnswers: string[],
): QuestionVersionContentInput {
  return {
    id,
    topicId: "conditional-probability",
    title: id,
    prompt: `For the original scenario ${id}, calculate the requested answer.`,
    difficulty: "foundational",
    answer: {
      spec,
      acceptedAnswers,
      explanation: "Use the defined values to find the requested answer.",
    },
    hints: ["Identify the relevant outcomes before computing."],
    solutionSteps: ["Apply the stated calculation to the relevant values."],
    misconceptions: [],
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
      originalityNote: "Original public-safe question.",
    },
  };
}
async function published(
  id: string,
  spec: AnswerSpec = numeric,
  acceptedAnswers = ["0.5"],
) {
  const auth = await requireProfessorReview();
  const repo = createDatabaseQuestionLifecycleRepository(query);
  let q = await repo.createQuestion(auth, {
    content: content(id, spec, acceptedAnswers),
    creationMethod: "manual",
    submit: true,
  });
  q = await repo.transition(auth, {
    action: "approve",
    expectedState: "needs_review",
    questionId: id,
    versionId: q.workingVersion.versionId,
  });
  return repo.transition(auth, {
    action: "publish",
    expectedState: "approved",
    questionId: id,
    versionId: q.workingVersion.versionId,
  });
}

describe("024 snapshot authority and publication", () => {
  it("applies after 023 without changing any historical snapshot or adding a questions spec column", async () => {
    expect(
      (
        await db.query(
          "select snapshot_json, content_hash, content_sha256 from question_versions where question_id='typed-legacy'",
        )
      ).rows,
    ).toEqual(oldSnapshot);
    expect(
      (
        await db.query(
          "select column_name from information_schema.columns where table_name='questions' and column_name='answer_spec_json'",
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "select * from app_question_publication_gate_failures('typed-legacy',(select published_version_id from questions where id='typed-legacy'),'published') where code <> 'invalid_review_state'",
        )
      ).rows,
    ).toEqual([]);
    const tutor = createDatabaseTutorSessionRepository("unused", query);
    const session = await tutor.createSession({
      owner: { kind: "anonymous", anonymousId: "legacy-pin" },
      questionId: "typed-legacy",
    });
    const loaded = await tutor.getSession(session.id, {
      kind: "anonymous",
      anonymousId: "legacy-pin",
    });
    expect(loaded?.questionVersion?.answer.spec).toBeUndefined();
    expect(
      checkAnswer({ ...loaded!.questionVersion!.answer, studentAnswer: "1/2" })
        .isCorrect,
    ).toBe(true);
  });
  it.each(specs)(
    "publishes typed %j through real lifecycle gates",
    async (spec, accepted) => {
      const q = await published(`typed-${spec.kind}`, spec, accepted);
      expect(q.publishedVersion?.answer.spec).toEqual(spec);
      const stored = (
        await db.query<{ snapshot_json: { answer: { spec: AnswerSpec } } }>(
          "select snapshot_json from question_versions where id=$1",
          [q.publishedVersion!.versionId],
        )
      ).rows[0].snapshot_json;
      expect(stored.answer.spec).toEqual(spec);
      expect(
        (
          await db.query<{ answer_spec_json: AnswerSpec }>(
            "select answer_spec_json from app_public_questions where id=$1",
            [q.questionId],
          )
        ).rows[0].answer_spec_json,
      ).toEqual(spec);
      expect(
        (
          await createDatabaseContentRepository(
            "unused",
            query,
          ).getQuestionById(q.questionId)
        )?.answer.spec,
      ).toEqual(spec);
    },
  );
  it("preserves a published session's exact spec after a new draft changes the answer", async () => {
    const original = await published("typed-pinned");
    const owner = { kind: "anonymous" as const, anonymousId: "typed-owner" };
    const tutor = createDatabaseTutorSessionRepository("unused", query);
    const session = await tutor.createSession({
      owner,
      questionId: original.questionId,
    });
    const repo = createDatabaseQuestionLifecycleRepository(query);
    const revision = await repo.createRevision(await requireProfessorReview(), {
      questionId: original.questionId,
      baseVersionId: original.workingVersion.versionId,
      expectedWorkingVersionId: original.workingVersion.versionId,
      revision: content(original.questionId, { ...numeric, value: "0.25" }, [
        "0.25",
      ]),
    });
    expect(revision!.workingVersion.versionId).not.toBe(
      original.workingVersion.versionId,
    );
    const loaded = (await tutor.getSession(session.id, owner))!;
    expect(loaded.questionVersionId).toBe(original.workingVersion.versionId);
    expect(loaded.questionVersion!.answer.spec).toEqual(numeric);
    expect(
      checkAnswer({ ...loaded.questionVersion!.answer, studentAnswer: "0.5" })
        .isCorrect,
    ).toBe(true);
    expect(
      checkAnswer({ ...revision!.workingVersion.answer, studentAnswer: "0.5" })
        .isCorrect,
    ).toBe(false);
    await expect(
      db.query("update question_versions set snapshot_json='{}' where id=$1", [
        original.workingVersion.versionId,
      ]),
    ).rejects.toThrow(/append-only/i);
  });
  it("grades Reserve practice from its pinned typed version and keeps it separate from published analytics", async () => {
    const q = await published("typed-reserve", { ...numeric, value: "0.25" }, [
      "0.25",
    ]);
    const auth = await requireProfessorReview();
    const repo = createDatabaseQuestionLifecycleRepository(query);
    await repo.transition(auth, {
      action: "unpublish",
      expectedState: "published",
      questionId: q.questionId,
      versionId: q.workingVersion.versionId,
      reasonCode: "content_correction",
    });
    await repo.setReserveDisposition(auth, {
      action: "reserve",
      questionId: q.questionId,
      expectedWorkingVersionId: q.workingVersion.versionId,
      reasonCode: "extra_practice",
    });
    await repo.setReserveDisposition(auth, {
      action: "allow_practice",
      questionId: q.questionId,
      expectedWorkingVersionId: q.workingVersion.versionId,
    });
    const owner = {
      kind: "anonymous" as const,
      anonymousId: "typed-reserve-owner",
    };
    const tutor = createDatabaseTutorSessionRepository("unused", query);
    const origin = await tutor.createSession({
      owner,
      questionId: "typed-legacy",
    });
    await db.query(
      "update tutor_sessions set solved=true,status='completed',current_state='solved',completed_at=now() where id=$1",
      [origin.id],
    );
    const practice = await tutor.createSession({
      owner,
      questionId: q.questionId,
      questionVersionId: q.workingVersion.versionId,
      practiceContext: "reserve_practice",
      originSessionId: origin.id,
    });
    const pinned = (await tutor.getSession(practice.id, owner))!;
    expect(pinned.questionVersionId).toBe(q.workingVersion.versionId);
    expect(pinned.questionVersion!.answer.spec).toEqual({
      ...numeric,
      value: "0.25",
    });
    const decision = await decideTutorResponse({
      question: pinned.questionVersion!,
      answer: "25%",
      mode: "check",
      allowLlmFallback: false,
      sessionId: practice.id,
      state: getTutorSessionState(practice.id, q.questionId),
    });
    expect(decision.response.verdict).toBe("correct");
    await tutor.persistTransition({
      owner,
      sessionId: practice.id,
      expectedRevision: 0,
      idempotencyKey: "reserve-typed",
      mode: "check",
      submittedAnswer: "25%",
      response: decision.response,
      state: decision.state,
    });
    const exported = await createDatabasePilotAnalyticsExportRepository(
      query,
    ).build(await requireAnalyticsAccess());
    expect(
      exported.questions.some((item) => item.questionId === q.questionId),
    ).toBe(false);
  });

  it("blocks a malformed typed snapshot at the real database publication gate", async () => {
    const auth = await requireProfessorReview();
    const repo = createDatabaseQuestionLifecycleRepository(query);
    const q = await repo.createQuestion(auth, {
      content: content("typed-invalid-db", numeric, ["0.5"]),
      creationMethod: "manual",
      submit: false,
    });
    // A new immutable version models a privileged import that bypassed application validation.
    await db.query(
      `insert into question_versions(question_id,version_number,parent_version_id,snapshot_json,content_hash,created_by_user_id,creation_method,schema_version)
      select question_id,2,id,jsonb_set(snapshot_json,'{answer,spec,percentMode}','null'),md5(jsonb_set(snapshot_json,'{answer,spec,percentMode}','null')::text),created_by_user_id,'manual',2 from question_versions where id=$1`,
      [q.workingVersion.versionId],
    );
    const gates = await db.query(
      "select * from app_question_publication_gate_failures($1,(select working_version_id from questions where id=$1),'needs_review')",
      [q.questionId],
    );
    expect(gates.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "percent_mode_missing" }),
      ]),
    );
    await expect(
      db.query(
        "update question_version_lifecycle set state='needs_review' where question_version_id=(select working_version_id from questions where id=$1)",
        [q.questionId],
      ),
    ).rejects.toThrow();
  });

  it("persists a form diagnostic and marks a note-policy answer solved", async () => {
    const spec = {
      ...numeric,
      requiredForm: "simplified_fraction" as const,
      formPolicy: "note" as const,
    };
    const q = await published("typed-diagnostic", spec, ["1/2"]);
    const owner = {
      kind: "anonymous" as const,
      anonymousId: "typed-diagnostic-owner",
    };
    const tutor = createDatabaseTutorSessionRepository("unused", query);
    const session = await tutor.createSession({
      owner,
      questionId: q.questionId,
    });
    const loaded = (await tutor.getSession(session.id, owner))!;
    const state = getTutorSessionState(session.id, q.questionId);
    const decision = await decideTutorResponse({
      question: loaded.questionVersion!,
      answer: "2/4",
      mode: "check",
      allowLlmFallback: false,
      sessionId: session.id,
      state,
    });
    expect(decision.response).toMatchObject({
      verdict: "correct",
      checkDetail: "unsimplified",
    });
    expect(decision.response.message).toContain("simplify");
    const saved = await tutor.persistTransition({
      owner,
      sessionId: session.id,
      expectedRevision: 0,
      idempotencyKey: "typed-note",
      mode: "check",
      submittedAnswer: "2/4",
      response: decision.response,
      state: decision.state,
    });
    expect(saved.outcome).toBe("applied");
    const recovered = (await tutor.getSession(session.id, owner))!;
    expect(recovered.solved).toBe(true);
    expect(recovered.attempts[0].checkDetail).toBe("unsimplified");
    await expect(
      db.query(
        "update attempts set check_detail='arbitrary' where session_id=$1",
        [session.id],
      ),
    ).rejects.toThrow(/check_detail/);
  });
  it("uses scored checks for attention, cohort accuracy inputs, and export while retaining activity counts", async () => {
    const q = await published("typed-analytics");
    const owner = {
      kind: "anonymous" as const,
      anonymousId: "typed-analytics-owner",
    };
    const tutor = createDatabaseTutorSessionRepository("unused", query);
    const session = await tutor.createSession({
      owner,
      questionId: q.questionId,
    });
    for (const verdict of [
      "correct",
      "incorrect",
      ...Array<string>(8).fill("guidance"),
      "blocked",
    ])
      await db.query(
        "insert into attempts(session_id,question_id,mode,source,verdict) values ($1,$2,'check','rule',$3)",
        [session.id, q.questionId, verdict],
      );
    const repo = createDatabaseInstructorStudentRepository(query);
    const auth = await requireAnalyticsAccess();
    const students = await repo.listStudents(auth, {});
    const student = students.students.find((s) => s.attempts === 11)!;
    expect(student).toMatchObject({
      correctAttempts: 1,
      incorrectAttempts: 1,
      needsAttention: false,
    });
    const detail = await repo.getStudentDetail(auth, student.studentKey);
    expect(
      detail?.attention.some((s) => s.code === "repeated_topic_difficulty"),
    ).toBe(false);
    const exporter = createDatabasePilotAnalyticsExportRepository(query);
    const exported = await exporter.build(auth);
    const participant = exported.participants.find(
      (p) => p.answerAttempts === 11,
    )!;
    expect(participant).toMatchObject({
      answerAttempts: 11,
      correctAnswerAttempts: 1,
      incorrectAnswerAttempts: 1,
      unscoredAnswerAttempts: 9,
      correctnessRate: 0.5,
    });
    expect(exported.schemaVersion).toBe(2);
  });
});

describe("024 SQL/app grammar and structural parity", () => {
  it.each([
    "\\frac{1}{2}",
    "\\dfrac{2}{4}",
    "\\tfrac{1}{2}",
    "½",
    "5e-1",
    "50 percent",
    ".500",
    "1 / 2",
    "0.5",
    "1 2",
    "1/0",
    "1e31",
    "1,,000",
    "$$",
    "\t\\(1/2\\)\n",
    "\u00a0\\[ ½ \\]\u00a0",
    "\t1\t2\t",
  ])("matches the application grammar for %s", async (answer) => {
    const sql = (
      await db.query<{ matches: boolean }>(
        "select app_publication_numeric_answer_matches($1,0.5,0) as matches",
        [answer],
      )
    ).rows[0].matches;
    expect(sql).toBe(numericAnswerMatches(answer, 0.5, 0));
  });
  it.each([
    ...specs.map(([spec]) => spec),
    { ...numeric, value: "\\(25%\\)", percentMode: "percent" },
    { ...numeric, requiredForm: null },
    { ...numeric, formPolicy: null },
    { ...numeric, unit: { label: " ", required: false } },
    { kind: "categorical", canonical: "...", aliases: [] },
    { ...numeric, percentMode: undefined },
    { ...numeric, value: "2" },
    { ...numeric, tolerance: { mode: "absolute", value: -1 } },
    { ...numeric, domain: "count", tolerance: { mode: "absolute", value: 0 } },
    { kind: "categorical", canonical: "", aliases: [] },
    {
      kind: "number_list",
      values: ["1/0"],
      ordered: true,
      tolerance: { mode: "exact" },
    },
  ])("agrees on typed structure %j", async (spec) => {
    const sql = (
      await db.query("select * from app_answer_spec_failures($1::jsonb)", [
        JSON.stringify(spec),
      ])
    ).rows;
    expect(sql.length === 0).toBe(validateAnswerSpec(spec).length === 0);
  });
  it("keeps the list-separator rule application-only, stricter than the SQL floor", async () => {
    // SQL parses "1,000" as thousands grouping; the application rejects it in a
    // list because students can never reproduce it there. No migration needed.
    const spec = {
      kind: "number_list",
      values: ["1,000", "2"],
      ordered: true,
      tolerance: { mode: "exact" },
    };
    const sql = (
      await db.query("select * from app_answer_spec_failures($1::jsonb)", [
        JSON.stringify(spec),
      ])
    ).rows;
    expect(sql).toEqual([]);
    expect(validateAnswerSpec(spec).map((issue) => issue.code)).toEqual([
      "invalid_answer_spec",
    ]);
  });
});
