# Course Material Safety

Course PDFs and professor-provided materials are local and private only. Store
them under `data/private/course-materials/` and keep all extracted text,
private chunks, embeddings, and generated private artifacts under ignored
private paths.

Public demo data must be original, synthetic, or explicitly approved for
release. Do not commit textbook questions, solutions, examples, answer keys,
raw course PDFs, extracted textbook text, professor-only notes, private chunks,
embeddings, or generated files derived from private course material.

Safe public fixtures can live in `data/demo/`, `data/eval/`, or non-private
processed outputs under `data/processed/` only when they contain no private
course content.

## Private PDF extraction

Place local course PDFs under `data/private/course-materials/`. To verify the
private input and output paths without writing extracted text, run:

```bash
npm run extract:pdf -- --dry-run
```

To extract text locally, install Poppler so the `pdftotext` command is
available, then run:

```bash
npm run extract:pdf
```

The script reads only from `data/private/course-materials/` and writes extracted
`.txt` files only to `data/private/extracted/`. Before extraction it checks that
each input PDF and planned output file is ignored by Git. If a private path is
not ignored, the script prints a warning and refuses to continue.

## Safe course outline metadata

After private text extraction, prepare public-safe outline metadata with:

```bash
npm run prepare:course-outline
```

The script reads only from `data/private/extracted/` and writes
`data/processed/course-outline.json`. Public output is limited to topic names,
section headings, formula names and symbolic formulas, learning objectives, and
misconception candidates. It must not contain copied textbook paragraphs,
questions, solutions, examples, or answer keys.

Lines that look like copied questions, examples, solutions, answer keys, or long
prose are kept out of the public outline. When such lines are found, they are
written only to ignored private storage under `data/private/generated/` for
manual review.

## Private LaTeX ingestion

Place local `.tex` course files under `data/private/course-materials/`, then
run:

```bash
npm run extract:tex
```

The script reads only private `.tex` files from
`data/private/course-materials/`. It writes private parse details to
`data/private/generated/latex-ingestion-details.json` and writes safe public
metadata to `data/processed/latex-outline.json`.

Public LaTeX outline output is limited to section titles, formula names and
symbolic formulas, topic labels, and learning objectives. Lines that look like
lecture-note prose, copied examples, problems, solutions, answer keys, or
questions are kept only in the private parse-details file.

## Pattern-based question generation

Prepare private generation controls with:

```bash
npm run prepare:patterns
```

The script writes `data/private/generated/question-patterns.json`, which is
ignored by Git. This file may contain private audit references, source-story
families to avoid, source number tuples to avoid, and phrase hashes. It should
contain abstract templates only, not copied textbook questions or solutions.

Generate private original drafts with:

```bash
npm run generate:questions
```

The generator reads public-safe seed patterns from
`data/demo/question-patterns.json` and writes original draft questions to
`data/private/generated/generated-questions.json` by default. Drafts use new
contexts, numbers, hints, and solution wording; they must stay marked
`needs_review` and `generated_unverified` until professor approval.

Validate generated drafts with:

```bash
npm run validate:generated
```

The validator fails on missing required fields, missing final answers, missing
solution steps, missing hints, non-`needs_review` status, or missing originality
notes. It also prints local-only warnings when generated text appears too close
to private pattern metadata or extracted private source text.

Prepare the local private review queue with:

```bash
npm run prepare:review-queue
```

The queue is written to `data/private/generated/review-queue.json`, which is
ignored by Git. It is for professor review only and must not be imported into
student-facing or public demo data.

Promote approved generated questions with:

```bash
npm run promote:approved-questions
```

The promotion script reads the private review queue and writes public-safe
approved generated questions to
`data/processed/approved-generated-questions.json`. Only `approved` queue items
are promoted; `needs_review`, `rejected`, and `needs_edit` items are excluded.
The script refuses copied-source or textbook-looking approved items.
