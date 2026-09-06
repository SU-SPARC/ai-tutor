# True step-by-step grading

Status: future-architecture proposal, reviewed 2026-09-06. Step grading is not
implemented. This document designs evaluation of intermediate student
reasoning on top of the existing final-answer checking, numeric tolerance,
misconception detection, progressive hints, and progressive solution
disclosure, without weakening the immutable, professor-governed content
lifecycle in
[content-lifecycle.md](content-lifecycle.md).

Governing rules:

- **A grade is deterministic or it is not a grade.** Code decides
  `accepted` or `rejected`. Anything code cannot parse is `undetermined`, never
  `rejected`. A guarded model may explain, and under an explicit professor
  policy may accept an open-reasoning step, but it never grades the final
  step and every model acceptance is recorded, bounded, and auditable.
- **The step plan is part of the immutable version.** It is authored,
  reviewed, approved, hashed, published, pinned to sessions, rolled back, and
  exported exactly like every other content field.
- **Classic mode keeps working.** A question without a plan behaves exactly
  as today; a question with a plan still accepts a final answer at any time.

## 0. Decisions at a glance

| Decision                 | Choice                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Representation           | Optional `solutionPlan` object inside `question_versions.snapshot_json`; content schema version 3 (version 2 shape plus the plan).                             |
| Disclosure compatibility | `solutionSteps[]` stays the disclosure text and must equal the main path's step explanations in order.                                                         |
| Checkers                 | Numeric, rational, probability/counting expression grammar (`prob_v1`), choice, number set, keyword rubric, plus relational diagnostics for targeted feedback. |
| Model role               | Rubric steps only. Policy per plan: `disabled` (default), `feedback_only`, or `may_accept` with a confidence threshold. Never the final step.                  |
| Persistence              | `tutor_session_steps` current-state table, additive nullable step columns on `attempts`, three columns on `tutor_sessions`. No new session type.               |
| Publication              | Six new gate codes, applied in the application evaluator and in the database gate function, plus schema version 3 acceptance.                                  |
| Progress and analytics   | `solved` semantics unchanged. New per-step funnel for professors, per-attempt misconception codes, one new attention signal, export block in the next schema.  |
| Authoring                | Structured plan builder inside the existing revision editor with a converter from plain steps, live gate validation, and a grader simulator.                   |

## 1. Architecture

### 1.1 Where the design attaches to the current system

| Existing seam                                                                                          | How step grading uses it                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `snapshotForContent` / `insertQuestionVersion` (`src/lib/data/question-lifecycle-repository.ts`)       | Write `solutionPlan` into the snapshot and `schema_version = 3`.                                                             |
| `app_prepare_question_version_lifecycle_fields` (migration 011)                                        | SHA-256 already hashes the whole snapshot minus workflow keys, so the plan is covered by `content_sha256` automatically.     |
| `evaluateQuestionPublicationQualityGates` and `app_question_publication_gate_failures` (migration 015) | Gain plan gates and accept schema versions 2 and 3.                                                                          |
| `app_question_version_content` view (migration 011)                                                    | Gains a `solution_plan_json` column so student reads carry the plan.                                                         |
| `practiceQuestionFromSnapshot` and `mapQuestionRow`                                                    | Map the plan into `PracticeQuestion.solutionPlan`.                                                                           |
| `createTutorResponseFromState` / `decideTutorResponse` (`src/lib/tutor/tutor-engine.ts`)               | New `step_check` mode dispatches to a pure `gradeStep` function; `solution` and `hint` become step-aware in guided sessions. |
| `persistTutorSessionTransition` and `attempts`                                                         | One attempt row per step event with step columns; `tutor_session_steps` updated in the same revision-checked transaction.    |
| `POST /api/tutor/respond`                                                                              | Accepts `stepId` for `step_check`; everything else (idempotency, revision, rate limits, AI reservation) is reused.           |
| Revision editor and `parseQuestionRevisionContent`                                                     | Accept `solutionPlan` as an editable content field.                                                                          |
| `changedQuestionVersionFields`                                                                         | Diff shows "Solution plan".                                                                                                  |
| Content transfer schema                                                                                | Version 2 carries the optional plan through the same validator.                                                              |

### 1.2 Grading flow

```
student submits step s_k text
   │
   ▼
normalize (redact ≤500 chars, strip LaTeX wrappers)            src/lib/tutor/answer-checker.ts
   │
   ▼
deterministic checker for expected[s_k].kind  ──▶ accepted ──▶ rationale disclosed, advance
   │                                              rejected ──▶ diagnostics ──▶ targeted feedback
   │                                              undetermined
   ▼
step misconceptions (value / terms / relation) and relational diagnostics
   │
   ▼
rubric step and policy ≠ disabled?  ──▶ guarded model judgment (reservation, cache, limits)
   │                                        meets + confidence ≥ threshold + policy may_accept ──▶ accepted (gradedBy: llm)
   │                                        otherwise ──▶ feedback only
   ▼
still undetermined ──▶ "could not read" guidance, step hint, or self-check against the exemplar
```

Every branch produces a `StepGradeResult` with a machine-readable
`feedbackCode`, so the transcript can be rebuilt from stored codes plus the
immutable plan after a reload.

### 1.3 Invariants (each gets a test)

- **S1** A step is `accepted` only by a deterministic checker, by a model
  verdict that satisfies the plan's explicit `may_accept` policy, or by
  professor-authored self-check; the source is always recorded.
- **S2** The final step of every path is deterministic and equivalent to the
  question's final answer; a session becomes `solved` only through that step
  or through the classic final-answer check.
- **S3** No step `ask`, step hint, or incorrect-feedback text contains a later
  step's expected value or the final answer.
- **S4** A version without a plan behaves exactly as today in every route,
  DTO, view, gate, and export.
- **S5** Sessions pinned to a version keep grading against that version's
  plan after any later revision, publication replacement, or rollback.
- **S6** Attempts and step rows store at most 500 redacted characters of
  student text, never a prompt or provider body, and never identities.
- **S7** Schema-version-2 versions remain approvable and publishable without
  re-cloning.

## 2. Solution plan schema (content schema version 3)

Stored as `snapshot_json.solutionPlan`. Absent means "classic only".

```ts
export type SolutionPlan = {
  schemaVersion: 1;
  steps: SolutionPlanStep[]; // 2–12, ids unique
  paths: SolutionPath[]; // ≥ 1; paths[0] is the main path
  policy: {
    orderPolicy: "strict" | "prerequisites_only";
    maxAttemptsPerStep: number; // 1–10, default 3; then "Show this step" unlocks
    llmJudgment: "disabled" | "feedback_only" | "may_accept"; // default disabled
    llmAcceptConfidence?: number; // 0.75–1, required when may_accept, default 0.85
  };
};

export type SolutionPlanStep = {
  id: string; // ^[a-z][a-z0-9-]{0,39}$
  title: string; // ≤ 160
  ask: string; // ≤ 500; what the student is asked to produce
  explanation: string; // ≤ 8,000; rationale; equals solutionSteps[k] on the main path
  prerequisites: string[]; // step ids; acyclic
  expected: ExpectedResult;
  feedback?: { correct?: string; incorrect?: string }; // ≤ 500 each
  hints?: string[]; // ≤ 3, each ≥ 8 and ≤ 8,000 chars
  misconceptions?: StepMisconception[]; // ≤ 6
  optional?: boolean; // may be auto-completed when a later step is accepted (prerequisites_only only)
};

export type ExpectedResult =
  | {
      kind: "numeric";
      value: number;
      tolerance?: number;
      acceptedForms?: string[];
      allowArithmetic?: boolean;
    }
  | {
      kind: "rational";
      numerator: number;
      denominator: number;
      requireSimplified?: boolean;
      acceptDecimal?: boolean;
      tolerance?: number;
    }
  | {
      kind: "expression";
      canonical: string;
      equivalents?: string[];
      symbols?: string[];
      grammar: "prob_v1";
    }
  | {
      kind: "choice";
      options: Array<{ id: string; label: string }>;
      correct: string[];
    }
  | {
      kind: "number_set";
      values: number[];
      ordered?: boolean;
      tolerance?: number;
    }
  | {
      kind: "rubric";
      required: RubricCriterion[];
      forbidden?: RubricCriterion[];
      exemplar: string;
      keywordFallback?: { allOf: string[][] };
    };

export type RubricCriterion = { id: string; description: string }; // 1–5 required, ≤ 5 forbidden

export type StepMisconception = {
  id: string;
  feedback: string; // ≤ 1,000
  match:
    | { value: number; tolerance?: number }
    | { terms: string[] }
    | {
        relation:
          | "previous_step"
          | "later_step"
          | "complement_of_expected"
          | "reciprocal_of_expected"
          | "percent_of_expected"
          | "double_of_expected"
          | "half_of_expected";
      };
};

export type SolutionPath = { id: string; title?: string; stepIds: string[] }; // last id is that path's final step
```

Field-by-field mapping to the requested evaluation fields:

| Requested field                | Where it lives                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Step ID                        | `steps[].id`                                                                                   |
| Sequence and order             | `paths[].stepIds` order plus `policy.orderPolicy`                                              |
| Expected mathematical result   | `expected` (kind-specific)                                                                     |
| Acceptable equivalent forms    | `acceptedForms`, `equivalents`, `acceptDecimal`, grammar equivalence                           |
| Explanation and rationale      | `explanation` (disclosed on acceptance or reveal)                                              |
| Prerequisite step              | `prerequisites`                                                                                |
| Misconception mappings         | `misconceptions[].match` by value, term, or relation                                           |
| Deterministic checker strategy | `expected.kind` selects the checker; `allowArithmetic`, `requireSimplified`, `symbols` tune it |
| Whether order can vary         | `orderPolicy: prerequisites_only` with `optional` steps                                        |
| Alternate valid solution paths | `paths[]`; the session resolves its active path from the first path-unique step it accepts     |

### 2.1 Why embed in the snapshot rather than a side table

A side table keyed by version id would keep the schema version at 2, but the
plan would fall outside `content_sha256`, outside the approval evidence,
outside content transfer, and outside the "one immutable aggregate" doctrine.
Embedding costs one schema-version bump handled in a fixed set of places
(section 10) and gives hashing, approval, rollback, session pinning, diffing,
and export for free.

### 2.2 Compatibility rules

- `solutionSteps[k]` must equal `steps[main.stepIds[k]].explanation` for every
  `k`, so disclosure, retrieval chunking (`solution_step` chunks), the
  `revealed_steps` counter, and the legacy `solution_steps` projection are
  untouched.
- Alternate-path steps that are not on the main path disclose their
  explanation through the step response and `tutor_session_steps`, not through
  `disclosedSolutionSteps`.
- The legacy compatibility `PATCH` routes carry the working version's plan
  forward unchanged; they cannot create or edit a plan.

## 3. Schema changes

Migrations: use the next available numbers at implementation time. With the
current queue, the content migration is `024` if practice variants lands first,
otherwise `023`; the session-storage migration follows it. Both are
forward-only and additive. Splitting them keeps phase 1 deployable without
editing an already-applied migration when phase 2 begins.

### 3.1 Content

- `question_versions.schema_version` may be 2 or 3. New versions are written
  as 3 by `insertQuestionVersion`, by `insertDifficultyRevision` (which must
  carry the base version's schema version instead of the literal 2), and by
  `review-candidate-import.mjs`. `app_prepare_question_version_lifecycle_fields`
  sets 3 when it sets a version at all.
- `app_question_version_content` gains
  `qv.snapshot_json -> 'solutionPlan' as solution_plan_json` (appended
  column; `create or replace view` permits appending).
- `app_question_publication_gate_failures` accepts
  `schema_version in (2, 3)`, requires 3 when `solutionPlan` is present, and
  adds the structural plan gates in section 8.

### 3.2 Sessions and attempts

```sql
alter table tutor_sessions
  add column guided_mode boolean not null default false,
  add column active_path_id text,
  add column current_step_id text,
  add constraint tutor_sessions_step_ids_check check (
    (active_path_id is null or char_length(active_path_id) <= 40)
    and (current_step_id is null or char_length(current_step_id) <= 40)
  );

alter table attempts drop constraint attempts_mode_check;
alter table attempts
  add constraint attempts_mode_check check (
    mode in ('check', 'hint', 'solution', 'full_solution', 'step_check')
  ),
  add column step_id text check (step_id is null or char_length(step_id) <= 40),
  add column step_outcome text check (
    step_outcome is null or step_outcome in ('accepted', 'rejected', 'undetermined', 'revealed', 'self_checked')
  ),
  add column grading_source text check (
    grading_source is null or grading_source in ('rule', 'llm', 'self')
  ),
  add column grading_confidence numeric(4,3) check (
    grading_confidence is null or grading_confidence between 0 and 1
  ),
  add column feedback_code text check (feedback_code is null or char_length(feedback_code) <= 80),
  add column feedback_preview text check (feedback_preview is null or char_length(feedback_preview) <= 240),
  add column misconception_ids_json jsonb not null default '[]'::jsonb,
  add constraint attempts_step_shape_check check (
    (mode <> 'step_check' and step_id is null and step_outcome is null)
    or (mode = 'step_check' and step_id is not null and step_outcome is not null)
  ),
  add constraint attempts_misconception_ids_array_check check (
    jsonb_typeof(misconception_ids_json) = 'array' and jsonb_array_length(misconception_ids_json) <= 3
  );

create table tutor_session_steps (
  session_id text not null references tutor_sessions(id) on delete restrict,
  step_id text not null check (char_length(step_id) <= 40),
  path_id text not null check (char_length(path_id) <= 40),
  status text not null default 'pending' check (
    status in ('pending', 'accepted', 'revealed', 'skipped', 'self_checked')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_normalized_result text check (last_normalized_result is null or char_length(last_normalized_result) <= 500),
  last_feedback_code text check (last_feedback_code is null or char_length(last_feedback_code) <= 80),
  last_misconception_ids_json jsonb not null default '[]'::jsonb,
  accepted_by text check (accepted_by is null or accepted_by in ('rule', 'llm', 'self')),
  grading_confidence numeric(4,3),
  first_attempted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  session_revision bigint not null default 0,
  primary key (session_id, step_id),
  constraint tutor_session_steps_completion_check check (
    (status in ('accepted', 'revealed', 'skipped', 'self_checked')) = (completed_at is not null)
  ),
  constraint tutor_session_steps_accepted_by_check check (
    (status = 'accepted') = (accepted_by is not null)
  )
);
create index tutor_session_steps_status_idx on tutor_session_steps (session_id, status);
alter table tutor_session_steps enable row level security;
```

`misconception_ids_json` on `attempts` is populated for classic `check`
attempts too, which resolves the "codes are per session, not per attempt"
limitation documented in
[instructor-student-analytics.md](instructor-student-analytics.md).

`db/roles/app_runtime.sql` is updated to grant `select, insert, update` on
`tutor_session_steps` and no `delete`. Custody verification expectations are
updated in the same change, and the role script is reapplied through the
approved custody process after the migration so the new table receives its
standard `app_runtime_full_access` RLS policy. Pilot cleanup and the approved
retention path handle deletion. The migration itself does not grant runtime
access.

### 3.3 Integrity and cleanup

New read-only checks in `scripts/lib/database-integrity.mjs`:

- `orphaned_session_steps`: a step row whose session does not exist or
  whose `step_id` is not in the pinned version's plan.
- `step_attempt_linkage`: a `step_check` attempt whose `step_id` has no
  `tutor_session_steps` row for that session.
- `guided_session_without_plan`: `guided_mode = true` on a session whose
  pinned version has no plan.
- `plan_schema_version_mismatch`: a version with `solutionPlan` and
  `schema_version <> 3`.

`scripts/lib/pilot-data-cleanup.mjs` includes `tutor_session_steps` as
student data deleted with its session. The anonymous claim in
`src/lib/auth/anonymous-claims.ts` needs no change because step rows follow
the session id.

## 4. Deterministic checker design

All checkers live in `src/lib/tutor/step-checkers/` as pure functions with the
signature:

```ts
type CheckOutcome = "correct" | "incorrect" | "undetermined";
type StepCheckResult = {
  outcome: CheckOutcome;
  normalized: string; // ≤ 500, what is stored and shown back
  confidence: number; // 1 exact, 0.98 numeric-equivalent, 0.7 keyword rubric
  value?: number; // parsed numeric value when one exists (used by diagnostics)
  detail?: "unsimplified" | "unknown_token" | "domain_violation" | "wrong_form";
};
function checkStep(
  expected: ExpectedResult,
  submission: string,
): StepCheckResult;
```

| Kind         | Parsing                                                                                                                                                      | Equivalence                                                                                                                                                                           | Reuse                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------ | ------------------- |
| `numeric`    | Literal via `parseAnswerNumber` (integers, decimals, `a/b`, `%`, `\frac`); if `allowArithmetic` (default true) fall back to `prob_v1` closed-form evaluation | `                                                                                                                                                                                     | value − expected                       | ≤ tolerance`(default 0.001);`acceptedForms`compared after`normalizeAnswerText` | `answer-checker.ts` |
| `rational`   | `a/b`, `\frac{a}{b}`, mixed decimals when `acceptDecimal`                                                                                                    | Exact cross-multiplication with `BigInt`; `requireSimplified` checks `gcd = 1` and returns `incorrect` with `detail: unsimplified` (value right, form wrong) so feedback is precise   | new                                    |
| `expression` | `prob_v1` grammar (section 4.1)                                                                                                                              | Closed forms: exact rational arithmetic where possible, else double with tolerance. Symbolic forms: both sides restricted to declared `symbols`, evaluated at 16 seeded sample points | new                                    |
| `choice`     | Option id or label after normalization                                                                                                                       | Set equality with `correct`                                                                                                                                                           | `normalizeAnswerText`                  |
| `number_set` | `{1, 2, 3}`, `1,2,3`, `[1 2 3]`                                                                                                                              | Multiset equality with tolerance; order enforced only when `ordered`                                                                                                                  | `parseAnswerNumber`                    |
| `rubric`     | Text; `keywordFallback.allOf` groups                                                                                                                         | All groups matched and no `forbidden` criterion matched → `correct` at confidence 0.7; forbidden matched → `incorrect`; otherwise `undetermined`                                      | term matching from `misconceptions.ts` |

Unknown tokens, empty input, or a domain violation (a probability outside
[0, 1] for an `answerDomain` of probability) yield `undetermined`, never
`incorrect`, so a student is not penalised for notation the grammar does not
know. The response tells the student what forms are readable.

### 4.1 `prob_v1` expression grammar

Purpose-built for introductory probability and statistics, deliberately
small, and versioned so a plan records which grammar graded it.

- Numbers: integers, decimals, `%`, `a/b`, `\frac{a}{b}`, `\dfrac`.
- Operators: `+ - * / ^`, unary minus, factorial `!`, implicit multiplication
  (`2(3)`, `3C(9,3)` is rejected as ambiguous), parentheses, `\cdot`, `\times`.
- Counting: `C(n,k)`, `nCr`, `9C3`, `\binom{9}{3}`, `choose`, `P(n,k)`,
  `nPr`, `9P3`. `P(` followed by two numeric arguments is a permutation;
  `P(` followed by an event name is a probability.
- Probability notation over declared event symbols: `P(A)`, `P(A|B)`,
  `P(A∩B)`, `P(A and B)`, `P(A,B)`, `P(A∪B)`, `P(A or B)`, `P(A')`,
  `P(A^c)`, `P(not A)`. Rewrites applied before evaluation:
  `P(A') → 1 − P(A)`; `P(A∪B) → P(A) + P(B) − P(A∩B)` when `P(A∩B)` is
  declared; `P(A|B) → P(A∩B)/P(B)` when both are declared; otherwise the
  conditional is an opaque symbol.
- Functions: `sqrt`, `abs`, `exp`, `ln`, `log`. No summations, integrals, or
  distribution functions in version 1.
- Evaluation: exact rationals with `BigInt` for `+ − × ÷ ^(integer) ! C P`;
  doubles with tolerance for roots and logs. Symbolic equivalence samples 16
  points from a seeded generator (seed from the step id) with probabilities
  drawn from (0.05, 0.95) and counts from 1..12, requiring agreement at every
  point. Random-sampling false positives for polynomial-rational forms of
  this size are far below the tolerance floor; the professor simulator makes
  any surprising acceptance visible before publication.

### 4.2 Relational diagnostics (targeted feedback without professor authoring)

When a numeric-like step is rejected, the engine compares the parsed value
against the plan before choosing feedback:

| Code                        | Condition                                                  | Feedback intent                                                                                                         |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `repeats_previous_step`     | equals an earlier accepted step's value                    | "That is the result of the previous step; what comes next?"                                                             |
| `skipped_ahead`             | equals a later step's expected value                       | Under `strict`: name the missing step. Under `prerequisites_only`: accept and mark skipped optional steps as `skipped`. |
| `complement_confusion`      | equals `1 − expected`                                      | "You have the opposite event."                                                                                          |
| `percent_decimal_confusion` | equals `expected × 100` or `/ 100`                         | "Check whether the step asks for a percent or a decimal."                                                               |
| `inverted_ratio`            | equals `1 / expected`                                      | "Numerator and denominator look swapped."                                                                               |
| `factor_of_two`             | equals `2 × expected` or `expected / 2`                    | "Check whether a case was counted twice or missed."                                                                     |
| `unsimplified_fraction`     | rational value right, form wrong under `requireSimplified` | "Correct value; simplify the fraction."                                                                                 |
| `professor_misconception`   | a step misconception matched by value, term, or relation   | The professor's feedback text                                                                                           |
| `unreadable`                | outcome `undetermined`                                     | Format guidance with examples drawn from the expected kind                                                              |
| `incorrect_generic`         | none of the above                                          | Professor `feedback.incorrect` or the first step hint                                                                   |

Professor-authored step misconceptions take precedence over generic
relational codes when both match.

## 5. Tutor engine changes

### 5.1 Types

```ts
type TutorMode = "check" | "hint" | "solution" | "full_solution" | "step_check"
type TutorRequest = { …existing; stepId?: string }

type StepGradeResult = {
  stepId: string; pathId: string
  outcome: "accepted" | "rejected" | "undetermined" | "revealed" | "self_checked"
  gradedBy: "rule" | "llm" | "self" | "none"
  confidence?: number
  normalizedResult?: string
  feedbackCode: string
  feedback: string                       // shown text
  explanation?: string                   // rationale, present when accepted or revealed
  misconceptionIds: string[]
  attemptsUsed: number; attemptsAllowed: number
  next?: { stepId: string; index: number; total: number; ask: string; hintCount: number; inputKind: ExpectedResult["kind"] }
}
type TutorProgress = { …existing; steps?: { total: number; accepted: number; revealed: number; selfChecked: number; currentStepId?: string; pathId?: string } }
type TutorResponse = { …existing; step?: StepGradeResult }
type TutorSessionEngineState = { …existing; guidedMode: boolean; activePathId?: string; currentStepId?: string; steps: Record<string, StepProgress> }
```

### 5.2 Behavior by mode in a session whose version has a plan

| Mode            | Guided session                                                                                                                                                                                                                                       | Classic session (no `step_check` yet)       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `step_check`    | Enables `guidedMode` on first use; grades `stepId` (must be the current step, or any unlocked step under `prerequisites_only`); on the final step's acceptance sets `solved`, `stepsRevealed = solutionSteps.length`, `hintsRevealed = hints.length` | Same; switches the session into guided mode |
| `check`         | Final-answer check as today; correct → `solved`, remaining steps `skipped`                                                                                                                                                                           | Unchanged                                   |
| `hint`          | Step hints for the current step first, then question hints; `hintsRevealed` counts question hints only                                                                                                                                               | Unchanged                                   |
| `solution`      | Reveals the current step's explanation, marks it `revealed`, advances; `revealed_steps` increments when the step is on the main path                                                                                                                 | Unchanged (progressive disclosure)          |
| `full_solution` | Reveals all remaining steps as `revealed`                                                                                                                                                                                                            | Unchanged                                   |

`gradeStep` is a pure function in `src/lib/tutor/step-grading.ts`:
`gradeStep(plan, state, stepId, submission, options) → { result, state }`.
It never touches retrieval or the model; the model is invoked by
`decideTutorResponse` only when `gradeStep` returns `undetermined` for a rubric
step and the policy permits, using the same `aiExecutionContext` reservation
path as tutoring. All existing tutor tests must pass without modification,
which is the regression guard for invariant S4.

### 5.3 Persistence per step event

Inside `persistTransition` (same transaction, same `expectedRevision` check):

1. Insert the `attempts` row with `mode = 'step_check'`, `step_id`,
   `step_outcome`, `grading_source`, `grading_confidence`, `feedback_code`,
   `feedback_preview` (≤ 240 chars, only for model feedback because
   professor text is reconstructable from the plan), `misconception_ids_json`,
   redacted `submitted_answer`, and `normalized_answer`.
2. Upsert `tutor_session_steps` for `step_id` (and for any steps marked
   `skipped`), bumping `attempt_count`, `status`, `accepted_by`,
   `grading_confidence`, timestamps, and `session_revision`.
3. Update `tutor_sessions` counters and `guided_mode`, `active_path_id`,
   `current_step_id`, `revision`.

Recovery: `getSession` loads step rows into `engineState.steps`; the client
rebuilds the guided transcript from attempts (codes → plan text) and step
statuses. Idempotent replays return the stored outcome, as today.

## 6. Professor authoring workflow

### 6.1 Where

The revision editor (`professor-question-revision-editor.tsx`) gains a
"Step-by-step plan" section. Saving still creates a new immutable draft through
`POST /api/professor/questions/[id]/versions` with `revision.solutionPlan`;
`parseQuestionRevisionContent` adds `solutionPlan` to `REVISION_FIELDS`.
Initial drafts accept `content.solutionPlan` through
`parseQuestionVersionContent`. Intake AI drafting of plans is a later phase.

### 6.2 Builder

1. **Convert**: "Build from existing steps" creates one plan step per
   `solutionSteps` line with `explanation` set, and proposes `ask`, `title`,
   and `expected` from deterministic extraction: the last numeric literal or
   fraction in the line becomes a `numeric` or `rational` candidate; a
   `C(n,k)`, `nCr`, or `\binom` token becomes an `expression` candidate.
   Nothing is saved without the professor confirming each field.
2. **Edit**: per-step form for `ask`, expected kind and fields, hints,
   misconceptions (value, term, or relation), feedback text, prerequisites,
   optional flag. Path editor is collapsed by default; most plans have one
   path.
3. **Policy**: order policy, attempts per step, model judgment mode with an
   explicit explanation of what `may_accept` means and that it never applies
   to the final step.
4. **Validate**: the same pure validator that backs the publication gates
   runs on every change and lists gate codes and messages inline.
5. **Simulate**: a grader sandbox where the professor types sample student
   inputs per step and sees `checkStep` and `gradeStep` results, including
   the relational diagnostic code and the feedback the student would see.
   Rubric steps show the keyword fallback result; the model is not called
   from the sandbox.
6. **Save**: creates the draft; the change summary shows "Solution plan" via
   `changedQuestionVersionFields`; review, approve, and publish proceed as
   today. Approval evidence covers the plan because the content hash does.

### 6.3 Review surfaces

`ProfessorQuestionReviewCandidateDto` and the friendly review panel show a
plan summary (step titles, asks, expected results, policy) so a reviewer never
approves a plan blind. The detail page's history inspector shows the full plan
per version. Content transfer export includes the plan; import validates it
with the same validator and rejects unknown fields.

## 7. Student UI

- **Entry**: questions whose published version has a plan show a
  "Step-by-step guidance" badge in the catalog and workspace. The workspace
  offers "Solve step by step" and "Enter the final answer"; either can be used
  until the session is solved.
- **Guided panel**: a progress rail ("Step 2 of 4", titles, check marks for
  accepted, an eye icon for revealed, a person icon for self-checked); a
  current-step card with the `ask`, an input matched to the expected kind
  (single line for numeric, rational, expression, and number set; option
  buttons for choice; a textarea for rubric), and "Check step".
- **Feedback**: accepted shows the rationale and "Next step"; rejected shows
  targeted feedback, "Attempt 2 of 3", and a "Step hint" button; after the
  allowed attempts, "Show this step" reveals the rationale and continues;
  undetermined shows readable-format examples for the expected kind. For
  rubric steps: model feedback when the policy allows it, otherwise "Compare
  with the model reasoning", which reveals the exemplar and criteria
  checkboxes the student ticks to record a `self_checked` step.
- **Final step**: same card; acceptance completes the session with the full
  explanation as today. The classic answer box remains available.
- **Labels**: "Checked against the professor's solution" (rule), "AI-checked
  reasoning against the professor's rubric" (llm), "Self-checked" (self).
  Nothing in guided mode claims a model is a grader.
- **Transcript and recovery**: each step event appends a message with a step
  label; a reload rebuilds the rail and transcript from the session DTO's new
  `steps` and `stepAttempts` fields.
- **No leakage**: the DTO for a step includes only the current and completed
  steps' `ask`, hints already revealed, and explanations already disclosed;
  expected results, later asks, and later explanations never cross the
  boundary.

## 8. Publication gates

New `QuestionPublicationGateCode` values, evaluated in
`evaluateQuestionPublicationQualityGates` and mirrored structurally in
`app_question_publication_gate_failures`. Existing gates are unchanged.

| Code                                     | Rule                                                                                                                                                                                                                                                                                                                                                           | Database mirror                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `invalid_solution_plan`                  | Schema: 2–12 steps, unique ids, resolvable acyclic prerequisites, ≥ 1 path, paths reference existing ids, every step on ≥ 1 path, policy values in range, text lengths, kind-specific field validity                                                                                                                                                           | Structural checks (counts, ids, paths, lengths, policy enum)                                                              |
| `solution_plan_disclosure_mismatch`      | `solutionSteps` equals main-path explanations in order                                                                                                                                                                                                                                                                                                         | Full                                                                                                                      |
| `solution_plan_expected_results_invalid` | Each `expected` self-validates: `numeric` finite with tolerance ≥ 0; `rational` integer parts, denominator ≠ 0; `expression` parses in `prob_v1` and its `equivalents` are equivalent to `canonical`; `choice` correct ⊆ options; `number_set` non-empty; `rubric` 1–5 required criteria, exemplar ≤ 2,000 chars and satisfying `keywordFallback` when present | Numeric and rational checks only; grammar validity is application-side and recorded through `validation_status = 'valid'` |
| `solution_plan_final_step_mismatch`      | The last step of every path is not a rubric step and is equivalent to the final answer: numeric or rational value within the answer tolerance of `numericValue`, or an accepted form equal to an accepted answer after normalization                                                                                                                           | Full via `app_publication_numeric_answer_matches`                                                                         |
| `solution_plan_disclosure_leak`          | No `ask`, step hint, or `feedback.incorrect` contains a later step's expected value or an accepted final answer (same normalization as `usefulHint`)                                                                                                                                                                                                           | Full for numeric literals                                                                                                 |
| `solution_plan_llm_policy_invalid`       | `may_accept` requires `llmAcceptConfidence` in [0.75, 1], every rubric step to have ≥ 2 required criteria, and no rubric step in a final position                                                                                                                                                                                                              | Full                                                                                                                      |

Additional changes to existing gates:

- `deterministic_validation_failed`: schema version must be 2 or 3, and 3
  whenever `solutionPlan` is present.
- `forbidden_private_source_metadata`: the private-source regex also scans
  every plan text field.
- Approval evidence and inspection requirements are unchanged: the professor
  approves the exact hash, which includes the plan.

The application validator runs before any version insert
(`validateQuestionVersionContent`), so an invalid plan never reaches
`draft`. The database function remains the final boundary for structural and
numeric properties, matching the current application/database split.

## 9. Guarded model judgment

### 9.1 Scope

Only rubric steps, only when `policy.llmJudgment` is `feedback_only` or
`may_accept`, only after the keyword fallback returned `undetermined`, only in
an owned active session on a published version, and only when the student
explicitly submits the step (no background calls). Never the final step.

### 9.2 Contract

New task `step_reasoning_judgment` in a sibling module to `llm-tutor.ts`
(`src/lib/ai/llm-step-judge.ts`), using the same OpenRouter client settings:
temperature 0.2, reasoning disabled, no tools or streaming, SDK retries off,
two attempts under one 40-second deadline, output ≤ 300 tokens, serialized
Input (versioned JSON, `STEP_JUDGE_PROMPT_VERSION = 1`): the step `ask`,
the rubric's required and forbidden criteria, the exemplar truncated to 400
characters, the redacted student submission (≤ 500 characters, untrusted
data), and the allowed verdicts. Later steps, later expected values, and the
final answer are never included.

Output (exact schema, else rejected):

```
{ schemaVersion: 1, verdict: "meets" | "partial" | "does_not_meet" | "cannot_judge",
  confidence: 0–1, criteria: [{ id, met: boolean }], feedback: plain text ≤ 400 chars }
```

Feedback passes `applyTutorResponseGuardrails`; a guardrail violation or an
invalid schema triggers the one retry, then degrades to `undetermined`.

### 9.3 Decision policy

| Policy          | Effect of verdict                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled`      | Model never called; rubric steps use keyword fallback and self-check.                                                                                                                                                                                       |
| `feedback_only` | Feedback shown with the AI label; step status unchanged; student retries, reveals, or self-checks.                                                                                                                                                          |
| `may_accept`    | Accepted only if verdict is `meets`, every required criterion is `met`, `confidence ≥ llmAcceptConfidence`, and the keyword fallback matched no forbidden criterion. Recorded as `gradedBy: llm` with the confidence. Otherwise treated as `feedback_only`. |

### 9.4 Limits, cache, retry, audit

- Reservation, HMAC cache key (student, version, step id, submission hash,
  prompt version), per-session and per-student-question allowances, burst and
  optional daily limits: all reused from `prepareTutorAiGeneration`. A
  judgment consumes one AI request. A new `AI_STEP_JUDGMENT_MAX_PER_STEP`
  (default 2) caps repeated judgments of one step per session.
- Cache hits use no tokens and are labeled `source: cache`.
- Accounting settles in the same transaction as the step persistence, as
  tutoring does today.
- Audit: every model-accepted step is an `attempts` row with
  `grading_source = 'llm'` and a confidence, and a `tutor_session_steps` row
  with `accepted_by = 'llm'`. The professor oversight view (section 11) lists
  model-accepted steps per question with pseudonymous student keys and the
  redacted submission text. This is a deliberate exception to the analytics
  rule that submitted answers never reach instructors, justified because the
  professor is the accountable grader; it requires explicit sign-off from the
  professor and the privacy reviewer before phase 3, and the export never
  includes it.
- Kill switch: `AI_ENABLED=false` or the existing allowance exhaustion
  degrades every rubric step to keyword fallback and self-check with the
  existing "AI assistance is currently unavailable" wording.

## 10. Progress and analytics impact

| Surface                                            | Change                                                                                                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `solved`, `student_progress`, dashboard completion | Unchanged semantics; a guided session is completed by the final step or the final answer.                                                                                                                                                                     |
| Student dashboard                                  | Optional per-question "Guided: 3 of 4 steps accepted, 1 revealed".                                                                                                                                                                                            |
| Instructor question analytics                      | Step funnel per published version: attempts, first-try acceptance, reveal rate, self-check rate, model-accept rate, top wrong normalized results (numeric kinds only, shown only when ≥ 3 sessions produced the same value), misconception codes per attempt. |
| Instructor student detail                          | Guided sessions count, steps accepted and revealed, per-attempt misconception codes.                                                                                                                                                                          |
| Attention signals                                  | New `step_stall`: ≥ 3 rejected attempts on the same step in ≥ 2 sessions, carrying the counts.                                                                                                                                                                |
| Cohort analytics                                   | Guided versus classic session split; model-accepted step totals.                                                                                                                                                                                              |
| Export                                             | Next schema version adds `stepGrading` with per-question per-step counts; no submission text, no rubric text, no feedback text.                                                                                                                               |
| Retrieval and cache                                | Unchanged; step submissions never enter retrieval or the response cache except through the judgment cache described above.                                                                                                                                    |

Rubric submissions are free text and are never aggregated, listed, or
exported outside the professor audit view described in section 9.4.

## 11. Professor oversight of grading

Inside the existing question detail page, a "Grading" tab per published
version: step funnel, top wrong results, misconception hits per step, and, when
the plan allows model acceptance, the audit list of model-accepted steps. A
professor who disagrees with the grader fixes the plan through a revision; the
diff and the simulator make the change reviewable before publication.

## 12. Migration plan

1. **Content migration (additive)**: the section 3.1 DDL; `create or replace` of
   `app_question_publication_gate_failures` and
   `app_prepare_question_version_lifecycle_fields`; `create or replace view`
   for `app_question_version_content` with the appended column. This migration is
   complete before phase 1 ships.
2. **Content schema 3 in the application**: constant becomes an allowed set
   `{2, 3}`; the approve path's "must be cloned into the current content
   schema" check accepts both; `snapshotForContent` writes `schemaVersion: 3`
   and `solutionPlan` when present; `insertDifficultyRevision` copies the base
   schema version; `review-candidate-import.mjs` writes 3.
3. **Backfill**: none. Existing versions stay at 2 with no plan and remain
   approvable and publishable (invariant S7). A test proves a schema-2
   approved version still publishes after the migration.
4. **Content transfer**: `CONTENT_TRANSFER_SCHEMA_VERSION` becomes 2 with an
   optional plan; version-1 documents still import.
5. **Session-storage migration (additive)**: the section 3.2 DDL in a new,
   later migration. Enable RLS on `tutor_session_steps`; separately update
   `db/roles/app_runtime.sql` and custody verification expectations, then
   reapply the role script through the approved custody process. Never edit
   the content migration after it has been applied.
6. **Docs**: `content-lifecycle.md` (plan as part of the aggregate, new gate
   codes), `database.md` (migration summary), `database-integrity.md` (new
   checks), `instructor-student-analytics.md` (per-attempt codes, step
   funnel), `retrieval-llm-production-policy.md` (judgment task), and
   `authorization-permission-matrix.md` (no new routes; the respond route's
   data policy note gains step fields).
7. **Rollout order**: content migration, phase 1 application, session-storage
   migration, then phase 2 application. Professors can author, review, and
   publish plans after phase 1; students remain in classic mode until the
   phase 2 runtime is available.

## 13. Implementation phases

| Phase | Scope                                                                                                                                                                                                                                                          | Exit criteria                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Pure library: plan types, validator, checkers, `prob_v1` grammar, relational diagnostics, `gradeStep`; exhaustive and property tests                                                                                                                           | No runtime wiring; grammar equivalence and checker tests green                                                                    |
| 1     | Content schema 3 end-to-end: snapshot, parsers, app and database gates, migration DDL for content, view column, diff, DTOs, review panel summary, revision editor builder and simulator, content transfer v2                                                   | Professors can author, review, approve, and publish plans; students unaffected; invariant S7 test passes                          |
| 2     | Runtime: migration DDL for sessions and attempts, `tutor_session_steps`, engine `step_check` and step-aware `solution` and `hint`, respond route, session DTOs, guided UI with recovery, integrity and cleanup updates, step funnel analytics and export block | Students can solve step by step with deterministic grading; model judgment disabled; all existing tutor tests unchanged and green |
| 3     | Guarded model judgment: judge module, policies, reservation and cache reuse, audit view, release-gate test suite, privacy sign-off for the audit view                                                                                                          | `feedback_only` usable in pilot; `may_accept` remains a per-plan professor decision                                               |
| 4     | Later: intake AI proposes plans for professor review; grammar extensions (summations, named distributions); adaptive step granularity; per-step model hints                                                                                                    | Each has its own design note                                                                                                      |

## 14. Risks

| Risk                                                               | Likelihood | Impact | Mitigation                                                                                                                  |
| ------------------------------------------------------------------ | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| Grammar rejects valid notation (false "incorrect")                 | Medium     | High   | Unknown tokens are `undetermined`, never incorrect; `acceptedForms` and `equivalents`; professor simulator; format guidance |
| Symbolic sampling accepts a wrong expression (false positive)      | Very low   | Medium | 16 seeded points, exact rationals, restricted symbol set, simulator visibility                                              |
| Step asks or feedback leak later results                           | Medium     | Medium | `solution_plan_disclosure_leak` gate; DTO exposes only current and completed steps                                          |
| Model acceptance drifts toward leniency                            | Medium     | High   | Default `disabled`; `may_accept` requires threshold, criteria, and no forbidden match; final step deterministic; audit view |
| Schema-version bump breaks approve or publish for existing content | Low        | High   | Single allowed-set constant, database function accepts both, explicit S7 test on a schema-2 fixture                         |
| Authoring burden discourages plans                                 | Medium     | Medium | Converter from plain steps, deterministic expected-value suggestions, optional plans, one path by default                   |
| Client complexity and recovery bugs                                | Medium     | Medium | Transcript rebuilt from stored codes plus the immutable plan; recovery tests mirror `tutor-client-recovery.test.ts`         |
| Free-text rubric submissions in analytics                          | Low        | High   | Never aggregated or exported; audit view gated by sign-off and pseudonymous                                                 |
| Alternate paths create ambiguous "current step"                    | Low        | Low    | Path resolved on first path-unique acceptance; single path by default; validator forbids overlapping ambiguous first steps  |
| Concurrency between guided and classic submissions in one session  | Low        | Low    | Existing revision check serializes every transition                                                                         |

## 15. Codex-ready implementation prompts

Run in order. Each is self-contained and ends with verification commands. Do
not run `npm run build` with the default environment; see the local build note
in `docs/environment-configuration.md`.

### Prompt 1 — Pure step-grading library (phase 0)

```
Read docs/step-grading.md sections 2, 4, and 5.1 first, then src/lib/tutor/answer-checker.ts, src/lib/tutor/misconceptions.ts, src/lib/question-intake/schema.ts (hintRevealsAnswer, answerAppearsInSolution), and src/lib/tutor/question-publication-quality-gates.ts (usefulHint, text limits).

Create src/lib/tutor/solution-plan/types.ts with SolutionPlan, SolutionPlanStep, ExpectedResult, RubricCriterion, StepMisconception, SolutionPath, StepCheckResult, and StepGradeResult exactly as specified.

Create src/lib/tutor/solution-plan/validate.ts exporting validateSolutionPlan(plan, question: { answer, solutionSteps }) → Array<{ code, message }> using the six gate codes in section 8 (invalid_solution_plan, solution_plan_disclosure_mismatch, solution_plan_expected_results_invalid, solution_plan_final_step_mismatch, solution_plan_disclosure_leak, solution_plan_llm_policy_invalid). It must be pure and importable from both server and client code.

Create src/lib/tutor/step-checkers/ with one module per expected kind (numeric.ts, rational.ts, expression.ts, choice.ts, number-set.ts, rubric.ts) and index.ts exporting checkStep(expected, submission). Implement the prob_v1 grammar in expression.ts as a tokenizer, parser to AST, rewrite rules, exact BigInt rational evaluator with double fallback, and seeded 16-point symbolic equivalence. Unknown tokens, empty input, and domain violations return outcome "undetermined". Reuse parseAnswerNumber and normalizeAnswerText; do not modify their behavior.

Create src/lib/tutor/solution-plan/diagnostics.ts implementing the relational codes in section 4.2, and src/lib/tutor/step-grading.ts exporting the pure gradeStep(plan, state, stepId, submission, options) → { result, state } that applies checker → step misconceptions → diagnostics → attempts/reveal policy → path resolution → next-step computation, with no I/O and no model call.

Tests: tests/step-checkers.test.ts (per kind: equivalent forms accepted, non-equivalent rejected, unknown tokens undetermined, LaTeX fractions, percents, C/P/binom/choose forms, P(A') rewrite, P(A|B) symbolic vs expanded, requireSimplified, number sets), tests/prob-expression-grammar.test.ts (property test: for 200 seeded random closed expressions, algebraically rewritten variants are equivalent and perturbed constants are not), tests/solution-plan-validate.test.ts (one failing fixture per gate code and a passing fixture with two paths), tests/step-grading.test.ts (strict vs prerequisites_only, skipped_ahead behavior, attempts exhaustion unlocking reveal, final step acceptance sets solved, path resolution).

Verify: npm run lint && npm run typecheck && npx vitest run tests/step-checkers.test.ts tests/prob-expression-grammar.test.ts tests/solution-plan-validate.test.ts tests/step-grading.test.ts tests/answer-checker.test.ts
```

### Prompt 2 — Content schema version 3 and publication gates (phase 1, server)

```
Read docs/step-grading.md sections 2, 3.1, 8, and 12 first, then src/lib/data/question-lifecycle-repository.ts (snapshotForContent, insertQuestionVersion, insertDifficultyRevision, validateQuestionVersionContent, the approve path's schema-version check), src/lib/api/question-lifecycle.ts (parseQuestionVersionContent, parseQuestionRevisionContent, REVISION_FIELDS), src/lib/tutor/question-publication-quality-gates.ts, db/migrations/011_question_content_lifecycle.sql (app_prepare_question_version_lifecycle_fields, app_question_version_content), db/migrations/015_question_publication_quality_gates.sql, src/lib/data/database-repository.ts (mapQuestionRow), src/lib/data/tutor-session-repository.ts (practiceQuestionFromSnapshot), src/lib/tutor/question-version-diff.ts, src/lib/content-transfer/schema.ts, and scripts/lib/review-candidate-import.mjs.

Types: add optional solutionPlan?: SolutionPlan to QuestionContent in src/lib/types.ts; add the six gate codes to QuestionPublicationGateCode and QUESTION_PUBLICATION_GATE_CODES.

Write the complete content migration db/migrations/<next>_step_grading_content.sql: create or replace app_question_publication_gate_failures to accept schema_version in (2, 3), require 3 when snapshot_json ? 'solutionPlan', add the structural and numeric plan gates from section 8 (use app_publication_numeric_answer_matches for the final-step check), and extend the private-source scan to plan text; create or replace app_prepare_question_version_lifecycle_fields to set schema_version := 3; create or replace view app_question_version_content appending solution_plan_json. Do not add session or attempt DDL and do not change any other object. This migration must be complete and independently deployable; never amend it after it has been applied.

Application: replace CURRENT_QUESTION_SCHEMA_VERSION with ALLOWED_QUESTION_SCHEMA_VERSIONS = new Set([2, 3]) and require 3 when a plan is present; validateQuestionVersionContent runs validateSolutionPlan and throws QuestionLifecycleValidationError on any code; snapshotForContent writes schemaVersion 3 and solutionPlan; insertQuestionVersion writes 3; insertDifficultyRevision copies the base version's schema_version; the approve path accepts 2 or 3; parsers accept solutionPlan (strict shape, unknown keys rejected) for both initial content and revisions; mapQuestionRow and practiceQuestionFromSnapshot read the plan; changedQuestionVersionFields adds ["Solution plan", "solutionPlan"]; content transfer bumps CONTENT_TRANSFER_SCHEMA_VERSION to 2 with an optional plan validated by validateSolutionPlan and still imports version 1 documents; review-candidate-import.mjs writes 3.

Constraints: no session or attempt changes; existing versions must remain approvable and publishable; DTOs for students must not include expected results (add solutionPlanSummary { stepCount, guided: true } to StudentPracticeQuestion instead).

Tests: extend tests/question-publication-quality-gates.test.ts (each new code, schema 2 without plan still passes, schema 2 with plan fails), tests/question-lifecycle-database.test.ts (PGlite: publish a schema-2 approved fixture after the migration; publish a schema-3 version with a valid plan; database rejects a plan whose final step mismatches the answer), tests/professor-question-revision-api.test.ts (revision with solutionPlan creates a schema-3 draft; unknown plan keys rejected), tests/content-transfer-schema.test.ts (v1 and v2 documents), tests/production-schema-migration.test.ts (view column present, function accepts both versions).

Verify: npm run lint && npm run typecheck && npm run test:migrations && npx vitest run tests/question-publication-quality-gates.test.ts tests/question-lifecycle-database.test.ts tests/professor-question-revision-api.test.ts tests/content-transfer-schema.test.ts tests/question-lifecycle.test.ts
```

### Prompt 3 — Professor plan builder, simulator, and review display (phase 1, UI)

```
Read docs/step-grading.md sections 6 and 11 first, then src/components/professor/professor-question-revision-editor.tsx, src/components/professor/professor-friendly-review-panel.tsx, src/components/professor/professor-question-review-panel.tsx, src/components/professor/professor-question-detail-summary.tsx, src/lib/api/professor-dtos.ts, and tests/professor-question-revision-panel.test.tsx.

Add a "Step-by-step plan" section to the revision editor: a "Build from existing steps" converter (one step per solutionSteps line; deterministic expected-value suggestions from the last numeric literal, fraction, or C/P/binom token; nothing saved without confirmation), per-step forms for every field in section 2, a collapsed path editor, the policy form with plain-language explanations, an inline validation list driven by validateSolutionPlan on every change, and a grader simulator that runs checkStep and gradeStep on professor-typed sample inputs and shows outcome, feedback code, and student-facing feedback. The simulator never calls the model. Saving sends revision.solutionPlan through the existing revision request.

Review surfaces: add a plan summary (step titles, asks, expected kinds and values, policy) to ProfessorQuestionReviewCandidateDto and render it in the friendly and standard review panels; show the full plan in the detail summary and history inspector; ensure the change summary lists "Solution plan".

Constraints: keep all existing editor behavior and tests; the plan section is hidden when the working version has no plan and no conversion has been started; math renders through MathText.

Tests: tests/professor-solution-plan-editor.test.tsx (converter output, validation messages, simulator results, save payload shape) and extensions to tests/professor-review-panel.test.tsx and tests/professor-question-detail-api.test.ts for the summary.

Verify: npm run lint && npm run typecheck && npx vitest run tests/professor-solution-plan-editor.test.tsx tests/professor-question-revision-panel.test.tsx tests/professor-review-panel.test.tsx tests/professor-question-detail-api.test.ts
```

### Prompt 4 — Session persistence for steps (phase 2, storage)

```
Read docs/step-grading.md sections 3.2, 3.3, and 5.3 first, then db/migrations/018_production_tutor_session_persistence.sql, src/lib/data/tutor-session-repository.ts (both implementations, persistTransition, getSession, mapTutorSession, initialEngineState), src/lib/api/tutor-session-dto.ts, scripts/lib/database-integrity.mjs, scripts/lib/pilot-data-cleanup.mjs, and db/roles/app_runtime.sql.

Create a new db/migrations/<next>_step_grading_sessions.sql with the session and attempt DDL in section 3.2 (tutor_sessions columns, attempts mode check and step columns, tutor_session_steps table, and RLS enabled on tutor_session_steps). Do not edit the content migration from Prompt 2. Separately update db/roles/app_runtime.sql with select/insert/update on tutor_session_steps and no delete; update the custody verification expectations and tests for those exact grants and the standard app_runtime_full_access policy. The migration itself must not grant runtime access; reapply the role script only through the approved custody process after migration.

Repository: extend TutorSessionEngineState with guidedMode, activePathId, currentStepId, and steps; load step rows in getSession and listSessionsForStudent; extend PersistTutorSessionTransitionInput with an optional step: { stepId, pathId, outcome, gradedBy, confidence?, normalizedResult?, feedbackCode, feedbackPreview?, misconceptionIds, skippedStepIds } and persist the attempt row, the tutor_session_steps upsert, and the session columns in the same revision-checked transaction; populate attempts.misconception_ids_json for classic check attempts as well. Mirror everything in the memory repository.

DTOs: toTutorSessionDto gains guidedMode, activePathId, currentStepId, and steps: Array<{ stepId, status, attemptCount, acceptedBy?, feedbackCode? }>; toStudentTutorSessionDto adds disclosedSteps: Array<{ stepId, ask, explanation? (only when accepted or revealed) }> restricted to completed steps plus the current step's ask, and never expected results.

Integrity and cleanup: add the four checks from section 3.3 to database-integrity.mjs and document them in docs/database-integrity.md; add tutor_session_steps to pilot-data-cleanup.mjs.

Tests: tests/tutor-session-steps-database.test.ts (PGlite: step persistence, revision conflict leaves no step row, idempotent replay, recovery mapping), extensions to tests/tutor-session-api.test.ts (DTO shape, no expected results in any student payload), tests/database-integrity.test.ts, tests/pilot-data-cleanup.test.ts, tests/production-schema-migration.test.ts.

Verify: npm run lint && npm run typecheck && npm run test:migrations && npx vitest run tests/tutor-session-steps-database.test.ts tests/tutor-session-api.test.ts
```

### Prompt 5 — Engine and respond route (phase 2, runtime)

```
Read docs/step-grading.md sections 5 and 9.1 first, then src/lib/tutor/tutor-engine.ts, src/lib/tutor/step-grading.ts (from Prompt 1), src/app/api/tutor/respond/route.ts, src/lib/api/tutor-response-dto.ts, and tests/tutor-engine.test.ts.

Types: add "step_check" to TutorMode; stepId?: string to TutorRequest; step?: StepGradeResult to TutorResponse; steps to TutorProgress.

Engine: in decideTutorResponse, dispatch mode "step_check" to gradeStep (enabling guidedMode on first use, validating stepId against the plan and the current step or unlocked steps); make "hint" step-aware (step hints first, then question hints; hintsRevealed counts question hints only); make "solution" reveal the current step in guided sessions and mark it revealed, incrementing revealed_steps only for main-path steps; make "full_solution" reveal all remaining steps; on final-step acceptance set solved, stepsRevealed, and hintsRevealed exactly as a correct classic check does; on a correct classic check in a guided session mark remaining steps skipped. Leave the model out of this prompt: a rubric step that is undetermined returns feedbackCode "unreadable_rubric" with the self-check offer. Questions without a plan must behave byte-identically; do not modify existing tests.

Route: accept stepId; require it for step_check and reject it otherwise; pass the step result into persistTutorSessionTransition; ensure recoveredResponse rebuilds step responses from the stored attempt for idempotent replays.

Tests: extend tests/tutor-engine.test.ts with guided-mode cases for every mode; tests/tutor-respond-api.test.ts for step_check validation, idempotent replay, revision conflict, and that responses never include later steps' asks or expected values; tests/tutor-response-boundary.test.ts for the new fields.

Verify: npm run lint && npm run typecheck && npm run test:ai-production && npx vitest run tests/tutor-engine.test.ts tests/tutor-respond-api.test.ts tests/tutor-response-boundary.test.ts
```

### Prompt 6 — Guided student UI and recovery (phase 2, client)

```
Read docs/step-grading.md section 7 first, then src/components/tutor/practice-workspace.tsx, src/lib/api/tutor-session-dto.ts, src/lib/api/question-serialization.ts, and tests/tutor-client-recovery.test.ts.

Add the "Step-by-step guidance" badge to catalog and workspace when StudentPracticeQuestion.solutionPlanSummary is present. Implement the guided panel: progress rail, current-step card with kind-matched input (single line, option buttons, or textarea), "Check step", feedback area with attempt counter, "Step hint", "Show this step" after the allowed attempts, unreadable-format guidance, and the self-check flow for rubric steps (exemplar and criteria checkboxes posting a step_check with the self-check marker the engine expects). Keep the classic answer box available; either path completes the session. Append transcript messages per step event with step labels; rebuild rail and transcript on reload from the session DTO's steps and attempts.

Constraints: no expected result, later ask, or undisclosed explanation may exist in client state; the AI-help control remains governed by the existing usage flags; keyboard navigation and aria-live feedback; MathText for math.

Tests: tests/practice-workspace-guided-mode.test.tsx (badge, entry choice, accept/reject/reveal/self-check flows, attempt counter, hint order, completion, reload recovery, no leakage assertions on rendered DOM and network payloads) and extensions to tests/tutor-client-recovery.test.ts.

Verify: npm run lint && npm run typecheck && npx vitest run tests/practice-workspace-guided-mode.test.tsx tests/tutor-client-recovery.test.ts tests/practice-usage-indicators.test.ts
```

### Prompt 7 — Analytics, export, and docs (phase 2, reporting)

```
Read docs/step-grading.md sections 10 and 11 first, then src/lib/data/instructor-student-repository.ts, src/lib/analytics/pilot-export.ts, src/lib/data/pilot-analytics-export-repository.ts, docs/pilot-analytics-export.md, docs/instructor-student-analytics.md, and src/lib/data/student-progress.ts.

Add the per-version step funnel to the professor question analytics (attempts, first-try acceptance, reveal, self-check, model-accept rates, top wrong normalized results for numeric kinds shown only when at least three sessions produced the value, misconception codes per step). Add guided counts to InstructorStudentDetail and the step_stall attention signal with its counts. Add the optional guided summary line to the student dashboard without changing completion semantics. Bump the export schema version and add the stepGrading block with per-question per-step counts only. Render the "Grading" tab on the professor question detail page (funnel and, behind a feature flag defaulting off until Prompt 8, the model-accepted audit list).

Invariant tests: a guided session solved via the final step counts exactly like a classic solved session in getStudentProgress, instructor summaries, cohort analytics, and export; rubric submission text appears nowhere in analytics or export payloads.

Docs: update content-lifecycle.md, database.md, instructor-student-analytics.md (per-attempt codes replace the known limitation), pilot-analytics-export.md, and authorization-permission-matrix.md.

Verify: npm run lint && npm run typecheck && npx vitest run tests/student-progress.test.ts tests/instructor-student-analytics.test.ts tests/instructor-student-analytics-database.test.ts tests/pilot-analytics-export-api.test.ts tests/pilot-analytics-export-database.test.ts tests/step-grading-analytics.test.ts
```

### Prompt 8 — Guarded model judgment (phase 3)

```
Read docs/step-grading.md section 9 first, then src/lib/ai/llm-tutor.ts, src/lib/ai/response-guardrails.ts, src/lib/ai/usage-controls.ts, docs/retrieval-llm-production-policy.md, and tests/ai-production-evaluation.test.ts.

Create src/lib/ai/llm-step-judge.ts with the input contract, output schema, parser, guardrail application, retry, and deadline rules in section 9.2, reusing the OpenRouter client settings from llm-tutor.ts. Add AI_STEP_JUDGMENT_MAX_PER_STEP to src/lib/env/server.ts, .env.example, and docs/environment-configuration.md. Wire the engine: when gradeStep returns undetermined for a rubric step and the plan policy is feedback_only or may_accept, prepare a reservation through prepareTutorAiGeneration with a cache key that includes the step id and submission hash, call the judge, apply the decision policy in section 9.3, and settle accounting through the existing aiAccounting path. Record grading_source, grading_confidence, feedback_preview, and accepted_by. Never call the judge for a final step or for non-rubric steps; degrade to undetermined on any failure with the existing unavailable wording.

Enable the model-accepted audit list from Prompt 7 behind the plan policy and document the privacy exception and sign-off requirement in docs/instructor-student-analytics.md.

Add npm script test:step-judgment running tests/llm-step-judge.test.ts: a fixture set of at least 50 synthetic provider payloads under data/eval/step-judge-outputs.json covering schema rejection, guardrail violations, confidence thresholds, forbidden-criterion vetoes, cache hits, limit blocks, and settlement atomicity (PGlite). Update docs/retrieval-llm-production-policy.md with the judgment task, its inputs, limits, and release gates.

Verify: npm run lint && npm run typecheck && npm run test:step-judgment && npm run test:ai-production
```
