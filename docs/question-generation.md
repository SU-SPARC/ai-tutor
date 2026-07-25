# Original Question Generation Workflow

This workflow turns private course references into original practice-question
drafts without copying course or book problems. Private material is used only to
identify topics, formulas, misconceptions, and abstract problem patterns. Any
generated question starts as `needs_review` and `generated_unverified`.

## Safety Model

Private reference material includes course PDFs, LaTeX files, syllabi,
professor notes, extracted text, private pattern controls, generation audits,
and professor review queues. Keep those files under ignored private paths:

- `data/private/course-materials/`
- `data/private/extracted/`
- `data/private/generated/`

Public or reviewable data may live under `data/demo/` or `data/processed/` only
when it is original, professor-approved, or reduced to safe metadata. Public
files must not include copied textbook questions, examples, solutions, answer
keys, long source excerpts, source page locators, private source IDs, private
pattern IDs, phrase hashes, raw extracted text, API keys, or professor-only
materials.

## Copyright And Content Safety Rules

Treat the course book and professor materials as private references, not as a
source of reusable public wording. Do not copy or lightly paraphrase textbook
questions, examples, story contexts, answer keys, or solution steps into public
files. Do not reuse source number tuples or source story families. If a draft
looks copied, keep it private, reject it, or regenerate it from the abstract
pattern.

The allowed use of private reference material is narrow: extract topic signals,
formula references, misconception ideas, and abstract task shapes. Public
practice content must be original or professor-approved.

## 1. Prepare Private Reference Material

Place private source files only under ignored private storage:

```bash
git check-ignore -v data/private/course-materials/<file>
npm run extract:pdf -- --dry-run
npm run extract:pdf
npm run extract:tex
```

PDF extraction writes private text to `data/private/extracted/`. LaTeX
ingestion writes private parse details to
`data/private/generated/latex-ingestion-details.json` and public-safe metadata
to `data/processed/latex-outline.json`.

## 2. Build Safe Course Metadata

Create a safe course outline from private extraction output:

```bash
npm run prepare:course-outline
```

This writes `data/processed/course-outline.json`. That file is limited to safe
metadata such as topic names, section headings, formula names, symbolic
formulas, learning objectives, and misconception candidates. Lines that look
like copied questions, examples, solutions, answer keys, or long prose stay in
ignored private storage for manual review.

## 3. Suggest Or Prepare Abstract Patterns

Suggest private abstract patterns from safe course metadata, optionally using
private extracted text only for topic-level signals:

```bash
npm run suggest:patterns
```

This writes `data/private/generated/suggested-patterns.json`. Suggestions are
abstract-only, private, and include human review notes. They are not student
questions and should be reviewed before use.

Prepare controlled private generation patterns:

```bash
npm run prepare:patterns
```

This writes `data/private/generated/question-patterns.json`. Private pattern
controls may include audit references, forbidden story families, forbidden
number tuples, and phrase hashes. They must stay private. Pattern templates
should describe concept-level task shapes, variable roles, ranges, reasoning
intents, and misconception targets; they must not contain copied question text
or copied solution steps.

Public-safe seed patterns for deterministic development generation live in
`data/demo/question-patterns.json`. Those seed patterns are generic templates
only.

## 4. Generate Original Drafts

Generate the committed public-safe review drafts for the currently enabled
syllabus topics:

```bash
npm run prepare:syllabus-questions
npm run prepare:syllabus-questions -- --check
```

This deterministic generator uses only project-owned scenarios and short,
public-safe topic metadata. Its output remains review-gated and is never loaded
by student-facing question queries.

The later syllabus batches are preserved as separate review fixtures. Generate
and verify the batch after `next-syllabus-review-candidates.json` with:

```bash
npm run prepare:following-syllabus-questions
npm run prepare:following-syllabus-questions -- --check
```

This writes `data/demo/following-syllabus-review-candidates.json` without
overwriting either earlier batch. It also rejects ID or prompt reuse from the
earlier committed syllabus batches.

Generate and verify the next uncovered syllabus batch with:

```bash
npm run prepare:next-uncovered-syllabus-questions
npm run prepare:next-uncovered-syllabus-questions -- --check
```

This writes `data/demo/next-uncovered-syllabus-review-candidates.json` and
checks all earlier review fixtures for reused IDs or prompts.

Generate deterministic original drafts from public-safe seed patterns:

```bash
npm run generate:questions
```

By default this reads `data/demo/question-patterns.json` and writes
`data/private/generated/generated-questions.json`. Drafts use project-owned
contexts, numbers, hints, answers, and solution wording. They must stay private
and keep:

- `reviewStatus: "needs_review"`
- `trustLevel: "generated_unverified"`
- an originality note

For private abstract pattern candidate generation, use:

```bash
node scripts/generate-review-candidates.mjs
```

That script reads `data/private/generated/question-patterns.json`, writes
public-safe review candidates to `data/demo/generated-review-candidates.json`,
and keeps rejection/audit detail in
`data/private/generated/generation-audit.json`.

## 5. Validate Originality And Review Readiness

Run generated-draft validation:

```bash
npm run validate:patterns
npm run validate:generated
```

Validation checks required fields, private/public visibility expectations,
`needs_review` status, `generated_unverified` trust, hints, solution steps,
misconceptions, and originality notes. It also warns when generated text has
long phrase overlap with private pattern metadata or private extracted text.

Generated drafts must be rejected or revised if they reuse:

- textbook or course problem wording
- source story families
- source number tuples
- copied solution steps
- private locators, source IDs, audit fields, or phrase hashes

## 6. Prepare Professor Review

Convert private generated drafts into the private review queue:

```bash
npm run prepare:review-queue
```

This writes `data/private/generated/review-queue.json`. The queue contains the
question, answer, solution steps, hints, misconceptions, pattern ID,
originality note, topic, difficulty, and review status for lightweight
professor review.

The professor should see enough to approve, reject, or request edits without
having to inspect private book text. Review should focus on correctness,
course fit, clarity, difficulty, and whether the question is genuinely
original.

## 7. Approve And Promote Public Data

Only professor-approved generated items can be promoted:

```bash
npm run promote:approved-questions
```

Promotion reads `data/private/generated/review-queue.json` and writes
`data/processed/approved-generated-questions.json`. It promotes only
`approved` items, changes the public trust level to professor-approved, excludes
`needs_review`, `rejected`, and `needs_edit` items, and refuses copied-source or
textbook-looking content.

Student-facing loaders must exclude generated-unverified drafts. A generated
question becomes student-facing only after the review status and trust level
show professor approval.

## Development Examples

Safe development examples may live in `data/demo/generated-examples.json` when
they are original generated drafts, contain originality notes, and remain
`generated_unverified` and `needs_review`. They are examples for development,
not approved student-facing content.

## Commit Checklist

Before committing generation workflow changes, run:

```bash
git status --short
git status --ignored --short data/private
git check-ignore -v data/private/generated/<private-output>
npm run suggest:patterns
npm run generate:questions
npm run validate:patterns
npm run validate:generated
npm run prepare:review-queue
npm run promote:approved-questions
npm run lint
npm run typecheck
npm test
npm run build
```

Confirm:

- no raw private PDFs, extracted text, professor materials, API keys, chunks, or
  private generated artifacts are staged
- public files contain only original items, approved items, or safe metadata
- generated drafts remain `needs_review` and `generated_unverified`
- professor approval is required before promotion to student-facing data
- OpenAI or other LLM calls, if added later, happen server-side only and use
  environment variables for secrets
