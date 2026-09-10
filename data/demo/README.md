# Demo Data

Public, original sample content for local demos belongs here.

Do not place raw private PDFs, extracted full textbook text, professor-only
materials, API keys, or student data in this directory.

Generated review candidates may live here only when they are original,
public-safe, and marked `needs_review` with `generated_unverified` trust.
Private pattern IDs, source locators, source number tuples, phrase hashes, and
generation audit notes must stay under ignored `data/private/` paths.

`generated-examples.json` contains public-safe sample output for development.
These examples are original generated drafts and must stay marked
`generated_unverified` and `needs_review` unless they are intentionally promoted
through professor review.

`question-patterns.json` contains generic public seed patterns only. It should
describe reusable task shapes, variable ranges, constraints, generation notes,
and misconception hooks without copying course or book problems.
Running `npm run generate:questions` uses these seed patterns but writes drafts
to ignored private storage by default.
Running `npm run prepare:review-queue` keeps generated review queues under
ignored private storage as well.
Approved generated questions are promoted to `data/processed/`, not `data/demo/`.

`topics.json` is the public-safe syllabus catalog. It contains only short topic
titles, week/order metadata, descriptions, and active status. Keep its entries
in strictly increasing syllabus order; the public seed validator rejects
duplicate or out-of-order positions.

`syllabus-review-candidates.json` contains original review drafts for the
currently added syllabus topics. Rebuild and validate it with:

```bash
npm run prepare:syllabus-questions
npm run prepare:syllabus-questions -- --check
```

These candidates must remain `needs_review` and `generated_unverified`, so they
cannot appear in student practice until professor approval.

`remediated-syllabus-review-candidates.json` holds content remediation batch 1
(2026-09-10): 22 `-v2` replacements for the strongest representatives of the
first two syllabus topics. Each keeps its original's prompt (two clarified
wordings), accepted answers, numeric value, and tolerance, and adds three
question-specific hints, misconceptions with computed wrong-value match terms,
a typed answer spec, and review notes that name the suggested publish or
Reserve disposition and any difficulty relabel. `reviewPriority` is
intentionally not preset: marking a draft as priority is the professor's own
explicit review action, so every v2 imports at the default `normal` priority.
The originals stay untouched because the importer never updates an existing
ID. Rebuild and validate with:

```bash
npm run prepare:remediated-syllabus-questions
npm run prepare:remediated-syllabus-questions -- --check
```

`next-syllabus-review-candidates.json` preserves the 60-question batch for the
first three topics after the initial syllabus topics.
`following-syllabus-review-candidates.json` contains the separate 60-question
batch for the following three content topics. Rebuild and validate the latter
without overwriting the earlier batch with:

```bash
npm run prepare:following-syllabus-questions
npm run prepare:following-syllabus-questions -- --check
```

`next-uncovered-syllabus-review-candidates.json` contains the next separate
60-question batch after the Week 8-10 content. Rebuild and validate it with:

```bash
npm run prepare:next-uncovered-syllabus-questions
npm run prepare:next-uncovered-syllabus-questions -- --check
```
