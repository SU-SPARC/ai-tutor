# Protected question content transfer

The professor workspace exposes `/professor/content-transfer` for structured
question imports and sanitized exports. This operation is separate from the
private PDF/LaTeX metadata preview and never accepts raw course-source files.

## JSON format

The only accepted format is JSON with an exact, versioned root shape:

```json
{
  "format": "professor_question_content",
  "schemaVersion": 1,
  "topics": [
    {
      "id": "canonical-topic-id",
      "title": "Canonical topic title",
      "order": 1
    }
  ],
  "questions": [
    {
      "stableId": "stable-question-id",
      "topicId": "canonical-topic-id",
      "title": "Question title",
      "prompt": "Public-safe original question text",
      "difficulty": "foundational",
      "answer": {
        "acceptedAnswers": ["0.5", "1/2"],
        "numericValue": 0.5,
        "tolerance": 0.001,
        "explanation": "Public-safe answer explanation"
      },
      "hints": ["Public-safe hint"],
      "solutionSteps": ["Public-safe solution step"],
      "misconceptions": [
        {
          "id": "stable-misconception-id",
          "feedback": "Corrective feedback",
          "matchTerms": ["common wrong answer"]
        }
      ],
      "reviewState": "draft"
    }
  ]
}
```

`answer.spec` is an optional backward-compatible extension to transfer schema
**1**. It carries explicitly authored numeric, categorical, or number-list
checking metadata and is validated by the shared deterministic checker. Existing
v1 documents without it preserve legacy checking. Imports store it only in a new
immutable question snapshot (snapshot schema **2**); exports recover it from the
selected version. Transfer and snapshot version numbers are separate contracts.
See [answer-checker.md](answer-checker.md) for the complete configuration rules.

`figure` is a second optional backward-compatible field on a question row. It
holds a bar, line, normal-curve, or two-set Venn figure shown with the prompt and
is validated strictly by the shared figure validator; any issue becomes a row
error. Absent or `null` means no figure, so existing v1 documents stay valid.
Imports store it only at `snapshot_json.figure` of the new immutable version and
exports copy it from the selected version. See
[question-figures.md](question-figures.md) for the schema and limits.

Importable states are `draft`, `needs_review`, `revision_requested`,
`approved`, and `rejected`. Published and unpublished states are not
importable. An imported approved version remains invisible to students until a
professor performs a separate publication transition.

## Safety and transaction behavior

- Professor authorization is checked for every preview, import, and export.
- A dry run validates exact fields, canonical topic mappings, bounds, numeric
  answer consistency, duplicate IDs and question content, stored question and
  misconception IDs, and database topic availability. It returns root and
  row-level errors without writing data.
- Private-source fields, raw/extracted textbook text markers, source locators,
  embeddings, user/session/progress fields, and student identifiers are
  rejected.
- Apply requires the exact confirmation value `IMPORT` and configured
  production database storage.
- Every row is inserted in one transaction. Any topic, validation, constraint,
  or duplicate failure rolls back every question and the success audit event.
- Lifecycle events derive professor identity and timestamp from the active
  authenticated account. A successful import also appends one
  `content_transfer.import` audit event containing counts and schema version,
  never question text.

## Exports

`GET /api/professor/content-transfer?scope=approved|drafts|all` downloads the
same JSON format. Exports contain eligible public-safe question aggregates and
canonical topic mappings only. They omit private-source versions, reviewer and
publisher identities, lifecycle notes/events, generation metadata, source
controls, prompts used for generation, and all student data.
