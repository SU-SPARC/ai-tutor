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
import { requireProfessorReview } from "@/lib/auth/authorization";
import {
  createDatabaseQuestionLifecycleRepository,
  type QuestionVersionContentInput,
} from "@/lib/data/question-lifecycle-repository";
import { createDatabaseContentRepository } from "@/lib/data/database-repository";
import type { DatabaseQueryExecutor } from "@/lib/data/database-executor";
import { evaluateQuestionPublicationQualityGates } from "@/lib/tutor/question-publication-quality-gates";
import { QuestionLifecycleValidationError } from "@/lib/tutor/question-lifecycle";
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";
import type { QuestionFigure } from "@/lib/types";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

let db: PGlite;
let query: DatabaseQueryExecutor;
let legacyBefore: unknown;

const figure: QuestionFigure = {
  kind: "bar",
  alt: "Bar chart of the probability of each value of X from 0 to 2.",
  title: "Distribution of X",
  xLabel: "x",
  yLabel: "P(X = x)",
  bars: [
    { label: "0", value: 0.2 },
    { label: "1", value: 0.5 },
    { label: "2", value: 0.3, highlight: true },
  ],
};
const VIEWS = [
  "app_question_version_content",
  "app_public_questions",
  "app_review_queue_questions",
  "app_reserve_practice_questions",
];

beforeAll(async () => {
  db = new PGlite();
  for (const f of readdirSync("db/migrations")
    .filter((f) => f.endsWith(".sql") && !f.startsWith("028"))
    .sort())
    await db.exec(readFileSync(`db/migrations/${f}`, "utf8"));
  await db.query(
    "insert into users (id, display_name, identity_provider, external_subject, status, email) values ($1, 'Professor', 'test', 'figure-professor', 'active', 'figure-professor@example.invalid')",
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
      values ('figure-legacy','conditional-probability','Legacy question','One of two outcomes is favorable. Find its probability.','foundational','["0.5","1/2"]',0.5,0.001,'Divide one by two.','original_demo','public_original','approved','public','Original question.','Professor','${TEST_PROFESSOR.userId}',now());
    insert into hints(question_id,hint_order,body) values ('figure-legacy',1,'Count the favorable outcomes before dividing.');
    insert into solution_steps(question_id,step_order,body) values ('figure-legacy',1,'Compute one divided by two.');
    select set_config('app.suppress_question_version','false',false);
    select app_record_question_version('figure-legacy');
  `);
  legacyBefore = (
    await db.query(
      "select id, snapshot_json, content_hash, content_sha256 from question_versions where question_id='figure-legacy' order by id",
    )
  ).rows;
  await db.exec(readFileSync("db/migrations/028_question_figures.sql", "utf8"));
  query = async (sql, params = []) =>
    (await db.query<Record<string, unknown>>(sql, params)).rows;
  query.transaction = (work) =>
    db.transaction(async (tx) =>
      work(
        async (sql, params = []) =>
          (await tx.query<Record<string, unknown>>(sql, params)).rows,
      ),
    );
}, 60_000);
beforeEach(() => mockPrincipal(TEST_PROFESSOR));
afterEach(resetAuthMocks);
afterAll(async () => db?.close());

function content(
  id: string,
  withFigure: unknown = figure,
): QuestionVersionContentInput {
  return {
    id,
    topicId: "conditional-probability",
    title: id,
    prompt: `The bar chart for scenario ${id} shows the distribution of X. Find P(X >= 1).`,
    difficulty: "foundational",
    ...(withFigure === null ? {} : { figure: withFigure as QuestionFigure }),
    answer: {
      acceptedAnswers: ["0.8"],
      explanation: "Add the bar heights for x = 1 and x = 2.",
    },
    hints: ["Read the height of each bar at or above one."],
    solutionSteps: ["Add 0.5 and 0.3 to get 0.8."],
    misconceptions: [],
    source: {
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
      originalityNote: "Original public-safe question.",
    },
  };
}

async function published(id: string, withFigure: unknown = figure) {
  const auth = await requireProfessorReview();
  const repo = createDatabaseQuestionLifecycleRepository(query);
  let q = await repo.createQuestion(auth, {
    content: content(id, withFigure),
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

describe("028 question figures", () => {
  it("adds figure_json to every question view without rewriting historical snapshots", async () => {
    expect(
      (
        await db.query(
          "select id, snapshot_json, content_hash, content_sha256 from question_versions where question_id='figure-legacy' order by id",
        )
      ).rows,
    ).toEqual(legacyBefore);
    for (const view of VIEWS) {
      const columns = (
        await db.query<{ column_name: string }>(
          "select column_name from information_schema.columns where table_name=$1 and column_name in ('figure_json','answer_spec_json')",
          [view],
        )
      ).rows.map((row) => row.column_name);
      expect(columns.sort()).toEqual(["answer_spec_json", "figure_json"]);
      const invoker = (
        await db.query<{ security_invoker: boolean }>(
          "select coalesce(reloptions @> array['security_invoker=true'], false) as security_invoker from pg_class where relname=$1",
          [view],
        )
      ).rows[0];
      expect(invoker.security_invoker).toBe(true);
    }
    expect(
      (
        await db.query(
          "select column_name from information_schema.columns where table_name='questions' and column_name='figure_json'",
        )
      ).rows,
    ).toEqual([]);
    const legacy = (
      await db.query<{ figure_json: unknown }>(
        "select figure_json from app_public_questions where id='figure-legacy'",
      )
    ).rows[0];
    expect(legacy.figure_json).toBeNull();
    const read = await createDatabaseContentRepository(
      "unused",
      query,
    ).getQuestionById("figure-legacy");
    expect(read).toBeDefined();
    expect(read && "figure" in read).toBe(false);
  });

  it("stores the figure only in the immutable snapshot and serves it on the public read", async () => {
    const q = await published("figure-bar");
    expect(q.publishedVersion?.figure).toEqual(figure);
    const stored = (
      await db.query<{ snapshot_json: { figure?: unknown } }>(
        "select snapshot_json from question_versions where id=$1",
        [q.publishedVersion!.versionId],
      )
    ).rows[0].snapshot_json;
    expect(stored.figure).toEqual(figure);
    expect(
      (
        await db.query<{ figure_json: unknown }>(
          "select figure_json from app_public_questions where id=$1",
          [q.questionId],
        )
      ).rows[0].figure_json,
    ).toEqual(figure);
    const repo = createDatabaseContentRepository("unused", query);
    expect((await repo.getQuestionById(q.questionId))?.figure).toEqual(figure);
    expect(
      (await repo.listQuestions()).find((item) => item.id === q.questionId)
        ?.figure,
    ).toEqual(figure);
  });

  it("keeps the figure key absent for content without a figure", async () => {
    const q = await published("figure-none", null);
    expect(q.publishedVersion && "figure" in q.publishedVersion).toBe(false);
    const stored = (
      await db.query<{ snapshot_json: Record<string, unknown> }>(
        "select snapshot_json from question_versions where id=$1",
        [q.publishedVersion!.versionId],
      )
    ).rows[0].snapshot_json;
    expect("figure" in stored).toBe(false);
  });

  it("rejects an invalid figure before it can be stored or approved", async () => {
    const auth = await requireProfessorReview();
    const repo = createDatabaseQuestionLifecycleRepository(query);
    await expect(
      repo.createQuestion(auth, {
        content: content("figure-invalid", {
          kind: "normal",
          alt: "A normal curve.",
          mean: 0,
          sd: 0,
        }),
        creationMethod: "manual",
        submit: true,
      }),
    ).rejects.toBeInstanceOf(QuestionLifecycleValidationError);
    expect(
      (await db.query("select id from questions where id='figure-invalid'"))
        .rows,
    ).toEqual([]);
  });

  it("refuses to approve a version whose stored snapshot figure is invalid", async () => {
    const auth = await requireProfessorReview();
    const repo = createDatabaseQuestionLifecycleRepository(query);
    const created = await repo.createQuestion(auth, {
      content: content("figure-stored-invalid", null),
      creationMethod: "manual",
    });
    // Simulate a figure that bypassed the application validators.
    await db.exec(`
      select set_config('app.current_user_id', '${TEST_PROFESSOR.userId}', false);
      select set_config('app.current_creation_method', 'manual', false);
      insert into question_versions (question_id, version_number, snapshot_json, content_hash, created_by_user_id, creation_method, schema_version, parent_version_id)
      select question_id, version_number + 1,
        snapshot_json || '{"figure":{"kind":"bar","alt":"Bars.","bars":[]}}'::jsonb,
        md5((snapshot_json || '{"figure":{"kind":"bar","alt":"Bars.","bars":[]}}'::jsonb)::text),
        created_by_user_id, 'manual', 2, id
      from question_versions where id = ${created.workingVersion.versionId};
    `);
    let q = (await repo.getQuestion(auth, "figure-stored-invalid"))!;
    expect(q.workingVersion.versionId).not.toBe(
      created.workingVersion.versionId,
    );
    expect(q.workingVersion.figure).toBeUndefined();
    q = await repo.transition(auth, {
      action: "submit",
      expectedState: "draft",
      questionId: q.questionId,
      versionId: q.workingVersion.versionId,
    });
    await expect(
      repo.transition(auth, {
        action: "approve",
        expectedState: "needs_review",
        questionId: q.questionId,
        versionId: q.workingVersion.versionId,
      }),
    ).rejects.toThrow(/Invalid question figure/);
  });

  it("drops the figure when a professor revision sends figure null, leaving the old version intact", async () => {
    const original = await published("figure-revise");
    const repo = createDatabaseQuestionLifecycleRepository(query);
    const { figure: _removed, ...withoutFigure } = content(original.questionId);
    void _removed;
    const revised = await repo.createRevision(await requireProfessorReview(), {
      questionId: original.questionId,
      baseVersionId: original.workingVersion.versionId,
      expectedWorkingVersionId: original.workingVersion.versionId,
      revision: { ...withoutFigure, figure: undefined },
    });
    expect(revised!.workingVersion.versionId).not.toBe(
      original.workingVersion.versionId,
    );
    expect(revised!.workingVersion.figure).toBeUndefined();
    const snapshots = (
      await db.query<{ id: number; snapshot_json: Record<string, unknown> }>(
        "select id, snapshot_json from question_versions where question_id=$1 order by version_number",
        [original.questionId],
      )
    ).rows;
    expect(snapshots.at(0)?.snapshot_json.figure).toEqual(figure);
    expect("figure" in snapshots.at(-1)!.snapshot_json).toBe(false);
    // The published version still serves the figure until the revision is published.
    expect(
      (
        await createDatabaseContentRepository("unused", query).getQuestionById(
          original.questionId,
        )
      )?.figure,
    ).toEqual(figure);
    expect(
      changedQuestionVersionFields(
        original.workingVersion,
        revised!.workingVersion,
      ),
    ).toContain("Figure removed");
  });

  it("blocks publication when the raw snapshot figure is invalid", async () => {
    const q = await published("figure-gate");
    const blockers = evaluateQuestionPublicationQualityGates({
      activeSyllabusTopic: true,
      deterministicValidationPasses: true,
      duplicateQuestionId: false,
      hintsRequired: true,
      professorApprovalExists: true,
      questionId: q.questionId,
      snapshotFigure: { kind: "bar", alt: "Bars.", bars: [] },
      version: { ...q.publishedVersion!, state: "approved" },
    });
    expect(blockers.map((blocker) => blocker.message).join(" ")).toMatch(
      /question figure is invalid/i,
    );
    expect(
      evaluateQuestionPublicationQualityGates({
        activeSyllabusTopic: true,
        deterministicValidationPasses: true,
        duplicateQuestionId: false,
        hintsRequired: true,
        professorApprovalExists: true,
        questionId: q.questionId,
        snapshotFigure: figure,
        version: { ...q.publishedVersion!, state: "approved" },
      }).filter((blocker) => /figure/i.test(blocker.message)),
    ).toEqual([]);
  });
});
