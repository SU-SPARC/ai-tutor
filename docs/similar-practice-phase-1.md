# Similar practice, Phase 1: contract and offline validators

"Give me a similar question" will let a student practice a new problem that
keeps the concept, skill, difficulty, and answer form of a published question.
Phase 1 builds only the contract and the deterministic checks. The fuller
future design (storage, sessions, professor oversight) is in
[`practice-variants-future.md`](practice-variants-future.md); this note
records what is implemented now.

## Principles

- **The LLM proposes; code decides.** A model output is untrusted data until
  every gate in `src/lib/similar-practice/verify.ts` passes. The model's own
  claimed answer is checked, never trusted.
- **T1 vs T2.**
  - **T1**: every gate passed *and* a deterministic oracle (code for a known
    problem family) computed the same answer from the parameters. T1 may later
    become runtime-servable.
  - **T2**: every gate passed, but code cannot prove that the problem's
    wording describes its computation. T2 always requires professor review
    before any student sees it.
- **Skipped is not passed.** A check that cannot run (for example, a source
  question with no typed answer spec) is reported as `skipped` and blocks
  verification. The only optional gate is the oracle, which can only raise a
  candidate to T1.
- **No student exposure yet.** There are no routes, UI, tables, sessions,
  pool, quotas, or provider calls. The dispositions are `rejected`,
  `awaiting_review`, and `verified_t1`; nothing is "available".
- **No fine-tuning, no Calculus generation.** V1 accepts numeric answers
  only. Calculus generation waits for the Calculus checker and a CAS.
- **No professor content leaves the server.** Whether professor-authored
  question text may be sent to OpenRouter is an open policy decision; until
  it is settled, everything runs on recorded fixtures.

## Modules (`src/lib/similar-practice/`)

| File | Purpose |
| --- | --- |
| `contract.ts` | `SIMILAR_QUESTION_SCHEMA_VERSION = 1`, `SIMILAR_QUESTION_PROMPT_VERSION = 1`, model output, stored variant, reports, tiers, student view type |
| `schema.ts` | Closed-schema validation of a raw model output (unknown keys rejected, length and count limits, numeric answers only) |
| `computation.ts` | Computation expressions through the existing exact evaluator (`evaluateEntry`) behind a character allowlist; operator signatures |
| `verify.ts` | The ordered gates (below) and the similarity evidence |
| `similarity.ts` | The 0–2 per-dimension rubric; no model involved |
| `hash.ts` | Content identity: SHA-256 over sorted-key canonical JSON of the content only |
| `evaluate.ts` | Offline harness: source + recorded output → schema, gates, similarity, tier, disposition, reasons; plus a batch summary |
| `student-view.ts` | The only projection toward a student (display fields and a derived answer format) |

## Gates, in order

`schema_valid`, `course_topic_match`, `supported_answer_kind`, `text_safety`
(no URLs, HTML, or LaTeX commands outside an allowlist),
`private_source_signal`, `answer_spec_valid` (`validateAnswerSpec`),
`accepted_answers_correct` (`checkTypedAnswer`), `computation_evaluates`,
`computation_matches_answer`, `claimed_answer_matches`, `answer_domain`
(probability in [0, 1], integer counts, via `validateAnswerSpec`),
`source_computation_matches_source` (the model must reproduce the source's own
answer), `parameters_consistent` (the prompt states exactly the parameters;
the computation uses only them plus 0, 1, 2), `answer_in_solution`,
`no_answer_in_prompt`, `no_answer_in_first_hint`,
`misconception_terms_not_correct`, `not_duplicate_of_source`,
`novelty_threshold` (prompt-token Jaccard with the source ≤ 0.60),
`numbers_changed`, `change_categories`, `not_duplicate_published` (the
intake's duplicate ranking, ≥ 0.72 wording threshold), `content_hash_unique`,
`similarity_threshold`, `deterministic_oracle` (optional).

## Similarity rubric

Seven dimensions, 0–2 each, maximum 14, minimum 11
(`SIMILARITY_MIN_SCORE`): course/topic, concept (declared tag must be one of
the topic's canonical keywords), skill (operator signature of the variant's
computation against the verified source computation), difficulty (same label
and solution length within ±1; ±2 is borderline), answer form (kind, domain,
percent mode, required form, unit), novelty, and leakage. A 0 on any dimension
is a hard failure. A dimension code cannot establish is `undetermined`, scores
0, and blocks the threshold.

## Known limits

- Code cannot prove the wording describes the computation (why T2 exists).
- Sources without a valid numeric typed answer spec (legacy answers) cannot be
  verified and are rejected.
- Leakage checks are conservative: a count answer that also appears as a
  number in the prompt is treated as leaked.
- The concept check trusts the model's declared tag within the topic's
  vocabulary; it is not semantic.

## Tests

`tests/similar-practice-verification.test.ts`,
`tests/similar-practice-contract.test.ts`, with recorded fixtures in
`tests/fixtures/similar-practice.ts` (good probability, count, and
real-valued variants; 32 bad cases; adversarial source text).
