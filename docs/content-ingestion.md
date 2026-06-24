# Content Ingestion Workflow

This project treats course PDFs, LaTeX files, syllabi, and professor notes as
private reference material. Public app data must be original, synthetic,
professor-approved, or reduced to safe abstract metadata.

## Private Input Locations

Put private source files only under ignored private storage:

- PDFs: `data/private/course-materials/`
- LaTeX files: `data/private/course-materials/`
- Syllabus snippets and professor notes: `data/private/course-materials/`

Before processing a private file, verify Git ignores it:

```bash
git check-ignore -v data/private/course-materials/<file>
```

Do not place raw course files in `data/demo/`, `data/eval/`,
`data/processed/`, or `src/`.

## Extraction Commands

Extract private PDF text locally:

```bash
npm run extract:pdf -- --dry-run
npm run extract:pdf
```

`extract:pdf` reads PDFs from `data/private/course-materials/` and writes
private `.txt` output only to `data/private/extracted/`. It refuses to continue
if the input or planned output path is not ignored by Git.

Extract private LaTeX metadata locally:

```bash
npm run extract:tex
```

`extract:tex` reads `.tex` files from `data/private/course-materials/`, writes
private parse details to `data/private/generated/latex-ingestion-details.json`,
and writes safe public metadata to `data/processed/latex-outline.json`.

Prepare a safe outline from private extracted text:

```bash
npm run prepare:course-outline
```

`prepare:course-outline` reads from `data/private/extracted/`, keeps uncertain
or copied-looking lines under `data/private/generated/`, and writes public-safe
metadata to `data/processed/course-outline.json`.

## Public vs Private Outputs

Private outputs:

- `data/private/extracted/`
- `data/private/generated/`
- `data/private/embeddings/`
- `data/processed/private/`

These may contain extracted text, parse details, uncertain lines, source
locators, and private review notes. They must stay ignored by Git.

Public outputs:

- `data/processed/course-outline.json`
- `data/processed/latex-outline.json`
- original demo fixtures in `data/demo/`

Public processed metadata may include only:

- topic names
- section headings
- formula names
- symbolic formulas
- learning objectives
- misconception candidates
- abstract problem patterns

Public files must not include copied textbook paragraphs, copied questions,
worked examples, solutions, answer keys, professor-only notes, page locators, or
raw extracted text.

## Why Copying Is Not Allowed

The course PDF and other course materials are private references. Copying
textbook questions, solutions, examples, answer keys, or long excerpts into
public files can expose copyrighted or professor-only material. It also makes
review harder for the professor because they would need to inspect copied source
material instead of reviewing lightweight abstractions.

Use private material only to identify concepts, formulas, misconceptions, and
abstract patterns. Public practice questions must be original.

## Original Questions From Abstract Patterns

The safe generation flow is:

1. Extract private source text into ignored private storage.
2. Derive abstract patterns such as "conditional probability with a restricted
   sample space" or "binomial exact-count probability."
3. Generate a new scenario, new numbers, and new wording from the abstract
   pattern.
4. Mark the generated question as `needs_review` and `generated_unverified`.
5. Send it through professor review before treating it as student-facing.

Generated questions should not mention source pages, source examples, textbook
problem numbers, or private pattern IDs in public UI.

## Safety Checklist Before Commit

Run these checks before committing ingestion-related changes:

```bash
git status --short
git status --ignored --short data/private
git check-ignore -v data/private/course-materials/<private-file>
git check-ignore -v data/private/extracted/<private-output>
git check-ignore -v data/private/generated/<private-output>
npm run lint
npm run typecheck
npm test
npm run build
```

Confirm before commit:

- No raw PDFs, LaTeX sources, extracted text, chunks, embeddings, professor
  notes, or generated private artifacts are staged.
- Public files contain only safe metadata or original questions.
- Generated questions are marked `needs_review` and `generated_unverified`
  until approved.
- OpenAI or other LLM calls remain server-side only.
- Secrets are in environment variables, not committed files.
