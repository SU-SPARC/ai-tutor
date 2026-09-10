# Phase B implementation report

## Verdict

Implemented with bounded deterministic checking and the SQL structural-safety-floor limitation described below. No push, deployment, or Production access was performed.

## Architecture

`checkAnswer` dispatches to the typed checker only when `answer.spec` is present.
Its sole persisted authority is `question_versions.snapshot_json.answer.spec`.
No `questions.answer_spec_json` column exists. New configuration creates a new
immutable version; existing sessions use their pinned snapshot. Absent specs
keep the Phase A implementation. Snapshot schema remains 2, transfer schema 1,
and pilot export schema 2.

## Supported answer kinds

Numeric, categorical, and number_list. See [answer-checker.md](answer-checker.md)
for complete authored shapes, defaults, boundaries, and examples.

## Numeric behavior

Exact rational grammar and six explicit tolerance modes; inclusive boundaries,
probability/count/real domains, explicit percent interpretation, fraction and
simplification policies, and declared required/optional units. Typed specs have
no hidden tolerance. Legacy JS-double expected values keep their 1e-9 floor.
Decimal percent mode accepts unscaled values and rejects percent notation;
percent mode interprets bare values as percentage points; either accepts decimal
values or marked percentages without rescaling bare numbers.

> **Post-audit remediation note (2026-09-10):** the decimal-mode statement above was superseded by the final remediation: a mathematically equivalent marked percentage is now a `wrong_form` diagnostic that `formPolicy: "note"` accepts with format feedback and `formPolicy: "require"` rejects; see [answer-checker.md](answer-checker.md).

## Categorical behavior

Whole-answer normalized aliases, bounded forbidden phrases, and categorical
incorrect outcomes for wrong word/number aliases. No substring correctness or
LLM grading.

## Number list behavior

Ordered or one-to-one unordered matching, explicit duplicate multiplicity,
optional normalized labels, bounded wrappers/separators, and per-value exact
rational tolerance. Malformed lists follow the guarded unreadable path.

## Professor authoring

Revision and intake workflows expose Answer checking and a professor-authorized
server simulator that calls the real checker. The simulator creates no sessions,
attempts, lifecycle writes, or LLM calls. Stale results are hidden after edits.

## AI intake

AI can propose optional specs and checker confidence. Shared deterministic
validation supplies `answer_checker_config`; invalid proposals fail validation.
The existing professor review and publication workflow remains mandatory.

## Publication gates

Seven typed gate codes cover malformed configuration, unparseable values,
tolerance bounds, inconsistent aliases, missing percent mode, impossible forms,
and empty categorical aliases. Existing provenance/originality/inspection/hash
and lifecycle requirements remain. SQL legacy numeric grammar now includes
LaTeX, Unicode fractions, scientific notation, percent words, and math wrappers.

## Migration 024

- Adds `app_answer_parse_tokens`, `app_answer_number`, and `app_answer_spec_failures`.
- Replaces `app_publication_numeric_answer_matches` and `app_question_publication_gate_failures` with compatible expanded implementations.
- Appends snapshot-derived `answer_spec_json` to `app_question_version_content`, `app_public_questions`, `app_review_queue_questions`, and `app_reserve_practice_questions`.
- Adds nullable `attempts.check_detail` constrained to seven diagnostic codes.
- Grants the runtime role access to the new helpers and preserves view permissions.
- Does not add a questions spec column or mutate historical snapshots or migrations 001–023.

## Backward compatibility

Tests preserve a pre-024 snapshot and its hashes, grade legacy and typed pinned
sessions, publish all three typed kinds, and verify Reserve grading. Typed
transfer-v1 import/export and both CLI import paths preserve explicit specs;
replayed imports do not rewrite snapshots. Existing Phase A checker and
`tutor-engine.test.ts` expectations are unchanged in Phase B.

## Analytics changes

Correctness, low-accuracy thresholds, and attention use correct + incorrect
checks. Guidance/blocked checks remain activity and unscored export records.
Reserve practice remains separate. Export version stays 2.

## Misconception scope adjustments

Reviewed all 12 entries. Only union-versus-intersection gains Conditional
Probability, where joint “and” events still require intersection reasoning.
Positive and out-of-topic regression tests accompany the change. Other scopes,
question-specific matching, and digit-token boundaries remain.

## Security

No eval, CAS, expression execution, or LLM grading. Numeric parsing retains its
500-character, 64-token, 32-digit-literal, and ±30 exponent bounds. New lists and
alias arrays are capped at 32, labels at 80, and unit labels at 40. Authored
tolerances must be finite. The simulator enforces professor access and a 32 KiB
streaming body cap; the existing student check cap remains 500 characters.

## Tests

Final sequential validation:

- `npm run typecheck`: PASS, 0 TypeScript errors.
- `npm run lint`: PASS, 0 errors and 0 warnings.
- `npx vitest run`: 1,070 passed, 1 known provenance timeout; 101 passed files and 1 failed file (102 files / 1,071 tests total).
- Isolated provenance retry: 5 passed / 5 tests, 1 passed file.
- `npx vitest run --maxWorkers=2`: **1,071 passed / 1,071 tests, 102 passed / 102 files**, no failures (59.03 seconds).
- `git diff --check`: PASS.

The original 15-second timeout and existing provenance test expectations were
not changed. The reduced-worker run verifies the complete final implementation.
There are 165 additional tests relative to the 906-test Phase A baseline.

The earlier default full-worker run exposed integration fixtures/inventory and
scored-denominator expectations; those were corrected. The known provenance
repair timeout passed independently (5 tests / 1 file), and the subsequent
pre-boundary-fix default full suite passed all 1,067 tests / 102 files.

Migration/runtime verification passes 58 tests / 4 files. The additional SQL
parity run passes 66 tests / 2 files, including the unchanged Phase A parity test.
The local in-memory migration runner reports 24 applied, 0 pending, 0 issues,
state current, and check exit code 0. No Production database was used.

## Existing tests modified

| File                                               | Phase B change and reason                                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `tests/app-runtime-role.test.ts`                   | Expected executable routine count 8 → 11 for the three new helpers.                                        |
| `tests/database-migration-workflow.test.ts`        | Expected contiguous migration history and ledger count 23 → 24.                                            |
| `tests/instructor-student-analytics.test.ts`       | Supplies explicit scored incorrect counts and expects “scored attempts” in the attention detail.           |
| `tests/pilot-analytics-export-database.test.ts`    | Correctness expectation 0.6 → 0.75: 3 correct / 4 scored, retaining the fifth unscored activity record.    |
| `tests/production-database-reliability.test.ts`    | Synthetic attempts table gains nullable check_detail; existing behavioral expectations unchanged.          |
| `tests/question-publication-quality-gates.test.ts` | Adds seven blocking typed-gate cases; existing cases unchanged.                                            |
| `tests/approved-content-import.test.ts`            | Adds typed snapshot persistence/replay coverage; legacy expectations unchanged.                            |
| `tests/content-transfer-database.test.ts`          | Adds typed transfer-v1/snapshot-v2 round-trip coverage; legacy expectations unchanged.                     |
| `tests/review-candidate-import.test.ts`            | Adds authored typed-candidate import/replay coverage with a legacy sibling; legacy expectations unchanged. |

The server-boundary inventory test itself is unchanged; its production permission
matrix now includes the professor simulator. Earlier engagement and Phase A
changes already in the working tree are excluded from this Phase B inventory.

## Remaining limitations

SQL provides structural validation; the application remains authoritative for
full alias consistency and exact form satisfiability. The SQL legacy numeric
comparison retains double-precision semantics. Lists have explicit separators
and no thousands grouping. Unit conversion and arbitrary text understanding
are unsupported. UI controls have component and API coverage; this task did not
perform a live browser walkthrough. Historical fixtures are intentionally not
converted to typed specs.

## Phase C readiness

The five checked-in syllabus batches contain 234 questions: 232 have numeric
accepted answers and two use “Yes, independent.” The eight demo questions
include the currency answer `$1.60` and a labeled three-entry PMF. Phase B covers
these needs; this repository sample provides no current justification for a
general symbolic grader. This claim is about checked-in public content, not
live Production. Symbolic algebra, event/interval expressions, partial credit,
explanation grading, and step grading remain future work.

## Files changed

This 55-file inventory is relative to the Phase B starting tree, preserving the
earlier engagement and Phase A edits. It includes this report.

### Checker, runtime, authoring, and analytics

- [src/app/api/tutor/respond/route.ts](../src/app/api/tutor/respond/route.ts)
- [src/components/professor/instructor-cohort-panel.tsx](../src/components/professor/instructor-cohort-panel.tsx)
- [src/components/professor/instructor-practice-performance.tsx](../src/components/professor/instructor-practice-performance.tsx)
- [src/components/professor/instructor-student-detail.tsx](../src/components/professor/instructor-student-detail.tsx)
- [src/components/professor/instructor-student-table.tsx](../src/components/professor/instructor-student-table.tsx)
- [src/components/professor/professor-question-intake-panel.tsx](../src/components/professor/professor-question-intake-panel.tsx)
- [src/components/professor/professor-question-revision-editor.tsx](../src/components/professor/professor-question-revision-editor.tsx)
- [src/lib/analytics/pilot-export.ts](../src/lib/analytics/pilot-export.ts)
- [src/lib/api/question-lifecycle.ts](../src/lib/api/question-lifecycle.ts)
- [src/lib/auth/server-boundary-policy.ts](../src/lib/auth/server-boundary-policy.ts)
- [src/lib/content-transfer/schema.ts](../src/lib/content-transfer/schema.ts)
- [src/lib/content-transfer/types.ts](../src/lib/content-transfer/types.ts)
- [src/lib/data/database-repository.ts](../src/lib/data/database-repository.ts)
- [src/lib/data/demo-repository.ts](../src/lib/data/demo-repository.ts)
- [src/lib/data/instructor-student-repository.ts](../src/lib/data/instructor-student-repository.ts)
- [src/lib/data/pilot-analytics-export-repository.ts](../src/lib/data/pilot-analytics-export-repository.ts)
- [src/lib/data/question-lifecycle-repository.ts](../src/lib/data/question-lifecycle-repository.ts)
- [src/lib/data/tutor-session-repository.ts](../src/lib/data/tutor-session-repository.ts)
- [src/lib/question-intake/ai.ts](../src/lib/question-intake/ai.ts)
- [src/lib/question-intake/schema.ts](../src/lib/question-intake/schema.ts)
- [src/lib/question-intake/types.ts](../src/lib/question-intake/types.ts)
- [src/lib/tutor/answer-checker.ts](../src/lib/tutor/answer-checker.ts)
- [src/lib/tutor/misconceptions.ts](../src/lib/tutor/misconceptions.ts)
- [src/lib/tutor/question-publication-quality-gates.ts](../src/lib/tutor/question-publication-quality-gates.ts)
- [src/lib/tutor/tutor-engine.ts](../src/lib/tutor/tutor-engine.ts)
- [src/lib/types.ts](../src/lib/types.ts)
- [src/lib/tutor/answer/spec.ts](../src/lib/tutor/answer/spec.ts)
- [src/components/professor/answer-checking-editor.tsx](../src/components/professor/answer-checking-editor.tsx)
- [src/app/api/professor/answer-checker/route.ts](../src/app/api/professor/answer-checker/route.ts)

### Migration and runtime custody

- [db/roles/app_runtime.sql](../db/roles/app_runtime.sql)
- [db/migrations/024_typed_answer_spec.sql](../db/migrations/024_typed_answer_spec.sql)

### Import and verification scripts

- [scripts/lib/approved-content-import.d.mts](../scripts/lib/approved-content-import.d.mts)
- [scripts/lib/approved-content-import.mjs](../scripts/lib/approved-content-import.mjs)
- [scripts/lib/review-candidate-import.mjs](../scripts/lib/review-candidate-import.mjs)
- [scripts/verify-production-database-custody.mjs](../scripts/verify-production-database-custody.mjs)

### Tests

- [tests/app-runtime-role.test.ts](../tests/app-runtime-role.test.ts)
- [tests/approved-content-import.test.ts](../tests/approved-content-import.test.ts)
- [tests/content-transfer-database.test.ts](../tests/content-transfer-database.test.ts)
- [tests/database-migration-workflow.test.ts](../tests/database-migration-workflow.test.ts)
- [tests/instructor-student-analytics.test.ts](../tests/instructor-student-analytics.test.ts)
- [tests/pilot-analytics-export-database.test.ts](../tests/pilot-analytics-export-database.test.ts)
- [tests/production-database-reliability.test.ts](../tests/production-database-reliability.test.ts)
- [tests/question-publication-quality-gates.test.ts](../tests/question-publication-quality-gates.test.ts)
- [tests/review-candidate-import.test.ts](../tests/review-candidate-import.test.ts)
- [tests/typed-answer-checker.test.ts](../tests/typed-answer-checker.test.ts)
- [tests/typed-answer-database.test.ts](../tests/typed-answer-database.test.ts)
- [tests/typed-answer-integration.test.ts](../tests/typed-answer-integration.test.ts)

### Documentation

- [docs/content-lifecycle.md](../docs/content-lifecycle.md)
- [docs/content-transfer.md](../docs/content-transfer.md)
- [docs/database.md](../docs/database.md)
- [docs/instructor-student-analytics.md](../docs/instructor-student-analytics.md)
- [docs/pilot-analytics-export.md](../docs/pilot-analytics-export.md)
- [docs/answer-checker.md](../docs/answer-checker.md)
- [docs/answer-checker-phase-b-report.md](../docs/answer-checker-phase-b-report.md)

### Build configuration

- [tsconfig.json](../tsconfig.json): permits explicit TypeScript import extensions for the shared checker used by native Node import scripts.
