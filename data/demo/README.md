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

`next-syllabus-review-candidates.json` preserves the 60-question batch for the
first three topics after the initial syllabus topics.
`following-syllabus-review-candidates.json` contains the separate 60-question
batch for the following three content topics. Rebuild and validate the latter
without overwriting the earlier batch with:

```bash
npm run prepare:following-syllabus-questions
npm run prepare:following-syllabus-questions -- --check
```
