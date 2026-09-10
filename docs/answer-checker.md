# Deterministic final-answer checking

Phase B adds explicitly authored `answer.spec` configurations. Questions without
that property keep the verified Phase A checker: normalized accepted-string
matching, exact rational equality, then authored absolute tolerance (default
0.001). A canonical JS `numericValue` retains its 1e-9 comparison floor. Typed
answers have no hidden tolerance and do not use legacy aliases as a shortcut.
Every authored `acceptedAnswers` entry must pass the configured checker.

## Snapshot authority and compatibility

The sole persisted answer-spec configuration is
`question_versions.snapshot_json.answer.spec`. There is no answer-spec column on
`questions`. Current-content views expose a value derived from the exact version
snapshot. Changing the kind, value, tolerance, aliases, form, or units creates a
new immutable version; existing sessions continue grading their pinned version.
Historical snapshots are not upgraded or rewritten. Malformed typed metadata
fails closed rather than silently falling back to legacy checking.

Immutable snapshots remain schema version **2**, content transfer remains version
**1**, and pilot analytics export remains version **2**. These are independent
contracts. Transfer v1 optionally carries `answer.spec`; existing v1 documents
remain valid. Approved-manifest and review-candidate imports preserve explicitly
authored specs and validate them; existing fixture content remains legacy.

## Numeric answers

```json
{
  "kind": "numeric",
  "value": "1/4",
  "domain": "probability",
  "percentMode": "either",
  "tolerance": { "mode": "exact" },
  "requiredForm": "simplified_fraction",
  "formPolicy": "note"
}
```

The Phase A hand-written rational grammar supports signed integers, decimals,
fractions, LaTeX fractions, scientific notation, valid thousands grouping,
Unicode fractions, and marked percentages. Numeric comparisons and tolerance
boundaries use BigInt rationals, including equality exactly on the boundary.

| Tolerance     | Allowed absolute difference                                              |
| ------------- | ------------------------------------------------------------------------ |
| `exact`       | 0                                                                        |
| `absolute`    | `value`                                                                  |
| `relative`    | `value * abs(expected)`; expected must be nonzero                        |
| `combined`    | `max(absolute, relative * abs(expected))`                                |
| `decimals`    | `0.5 * 10^(-places)`                                                     |
| `significant` | Half a unit at the specified significant digit; expected must be nonzero |

Places are 0–15, significant digits 1–15, and authored tolerance values are
finite, nonnegative, and at most 1e30. Counts require exact integer canonical
values and integer submissions. Probabilities require expected and submitted
values in [0,1], absolute tolerance at most 0.01, and relative tolerance at most
0.02. Real values use the authored tolerance.

Percent interpretation applies to the canonical answer and student answer:

| Mode      | Canonical | `0.25`    | `25%` / `25 percent`        | Bare `25` |
| --------- | --------- | --------- | --------------------------- | --------- |
| `decimal` | `0.25`    | Correct   | Correct value, `wrong_form` | Incorrect |
| `percent` | `25`      | Incorrect | Correct                     | Correct   |
| `either`  | `0.25`    | Correct   | Correct                     | Incorrect |

Tolerance values use decimal units after percent conversion. In percent mode,
`25` means 25 percentage points. No mode guesses from a bare student number. Decimal mode also accepts unscaled
fractions such as `1/4`; use `requiredForm` to constrain presentation.

In decimal mode a correct value written with percent notation (`25%`,
`25 percent`, `25\%`, also inside math wrappers) is a `wrong_form` diagnostic
that follows the same `formPolicy` as `requiredForm`: with `note` (the default)
the outcome is correct, the question is solved, and the response carries format
feedback; with `require` the outcome is incorrect and the question is not
solved. Value comparison is unchanged: a bare `25` in decimal mode is still 25,
not 0.25, and remains incorrect with `percent_decimal_confusion`. Only percent
mode rescales bare numbers. Legacy Phase A questions without `answer.spec` keep
their existing percent behavior.

Required forms are decimal, fraction, simplified fraction, percent, or integer.
Fraction form requires explicit integer numerator/denominator notation; Unicode
fractions remain numerically supported but do not satisfy this presentation
requirement. Simplified fractions require coprime terms and a positive
denominator. Integer form requires an integer value. With `formPolicy: note`
(the default), a correct value solves the question and returns a form diagnostic;
with `require`, an unmet form requirement is incorrect and does not solve it.
An exact repeating rational cannot require finite decimal form.

A unit is optional explicit metadata, for example
`"unit": { "label": "$", "required": false }`. Only that literal prefix or suffix
is removed; `$1.60` and `1.60` then agree. With `required: true`, a missing unit
is incorrect. Unit conversion, inferred currencies, and arbitrary unit stripping
are not supported. Math wrappers retain the Phase A notation behavior.

## Categorical answers and number lists

Categorical specs use `canonical`, `aliases`, and optional `forbiddenTerms`.
Normalization uses Unicode NFKC, lowercase, whitespace collapse, and safe
punctuation normalization. Correctness compares the whole normalized answer.
Forbidden phrases match whole normalized tokens and override aliases. Thus
`independent` never makes `not independent` correct by substring matching.
A categorical `seven` / `7` question grades `eight` as incorrect. The same
legacy mixed-alias question keeps its Phase A behavior.

Number lists contain 1–32 canonical numeric `values`, `ordered`, a tolerance,
and optional unique `labels`. Commas and semicolons separate entries; whitespace
separates values when a single numeric parse is impossible. Optional `{}`, `[]`,
or `()` wrap the list. Commas always separate entries, so thousands grouping
must not be used in lists. Labeled PMFs accept, for example,
`P(X=0)=1/10, P(X=1)=6/10, P(X=2)=3/10`. Labels are case-insensitive with
whitespace removed. Ordered lists compare positions; unordered lists match
one-to-one, preserving duplicates even when tolerance windows overlap.
Missing/extra numeric entries are incorrect; malformed notation is unreadable.

Because `,` and `;` are always separators, a canonical list value or label that
contains either character (for example `"1,000"`) could never be reproduced by
a student. `validateAnswerSpec` rejects such specs with `invalid_answer_spec`;
write `1000`. The student grammar is unchanged and does not reinterpret
`1,000, 2` as two values. This rule is enforced by the application only: the
SQL structural floor parses `1,000` as thousands grouping, so the application
gate is deliberately stricter here, as the migration parity tests record.

## Tutor outcomes and diagnostics

Outcomes remain `correct`, `incorrect`, and `unreadable`. Numeric or number-list
unreadable submissions return guidance without a wrong attempt or hint when no
misconception matched and LLM fallback is disabled. Existing misconception,
hint progression, retrieval, and free-text coaching paths retain priority when
that guard does not apply. Categorical wrong answers are scored incorrect.

Optional diagnostics are `close_rounding`, `percent_decimal_confusion`,
`complement` (only expected values in [0,1]), `unsimplified`, `wrong_form`,
`missing_unit`, and `unknown_token`. Typed diagnostics survive attempt
persistence in nullable bounded `attempts.check_detail`. Guidance remains
unscored activity in the pilot export. Correctness and difficulty denominators
use correct + incorrect checks; activity counts still retain guidance and
blocked interactions. Reserve practice retains its existing separate population.

## Question-specific misconception match terms

Question-authored `matchTerms` are matched by value, never by substring, when
the term parses with the bounded numeric grammar. A numeric term (integer,
decimal, fraction, percent, `\frac`) fires only on a whole numeric token of the
student's answer with exactly the same rational value in any notation, so
`3/5`, `0.6`, `.60`, and `60%` all match one another, while `7/45` no longer
fires inside `27/45`, `0.6` inside `0.625`, or `40` inside `5040`. A digits-only
term also matches the numerator or denominator of a fraction token, so `36`
still finds the full sample space in `2/36` but not in `0.136`. Terms that do
not parse as a number keep the whitespace-insensitive substring match, and an
empty term matches nothing. Author order among a question's misconceptions is
the precedence, and any question-level match still shadows the topic library.

## Professor authoring and AI intake

The revision and intake editors expose **Answer checking** with Numeric,
Short answer, and List of numbers. Probability defaults use an explicit percent
mode and small absolute tolerance; counts default to exact integers. The panel
exposes forms, units, aliases, labels, and the six tolerance modes. Existing
questions keep “Existing answer checking” until a professor chooses a kind.

Multiline fields (aliases, forbidden phrases, list values, labels, and typed
accepted answers) trim every line and drop blank lines before the draft
changes, so a trailing newline never creates an empty alias, value, or label.
For Short answer questions the canonical answer and its aliases _are_ the
accepted answers: the editor hides the separate accepted-answer list and stores
canonical plus aliases in `acceptedAnswers`, so legacy questions, historical
snapshots, gates, transfer, and exports keep the same persisted shape.

**Try answer** calls the real server checker at
`POST /api/professor/answer-checker`. Professor authorization is mandatory, the
body is capped at 32 KiB, and the submitted answer is capped at 500 characters.
The preview records no session, attempt, lifecycle change, or LLM request.
Changing the draft or trial hides stale results. Saving still follows the
normal review and publication workflow.

AI intake may propose the same optional configuration and `confidence.checker`.
The deterministic `answer_checker_config` verification checks the actual spec
and all accepted answers. Invalid configurations are rejected. Confidence is
informational; professor review, provenance checks, and approval remain required.

## Publication and migration 024

Application gates share `validateAnswerSpec` and the actual checker with intake,
transfer, and imports. They report `invalid_answer_spec`,
`answer_value_unparseable`, `tolerance_out_of_bounds`,
`accepted_answer_inconsistent`, `percent_mode_missing`,
`required_form_unsatisfiable`, or `categorical_alias_empty` as applicable.
Existing provenance, originality, inspection, hash, and lifecycle gates remain.

Migration 024 adds three bounded helper functions (`app_answer_parse_tokens`,
`app_answer_number`, `app_answer_spec_failures`), expands the existing numeric
publication function's grammar, and adds typed structural checks to the
publication gate function. Four current-content views expose snapshot-derived
`answer_spec_json`; `attempts` gains nullable `check_detail` with seven allowed
codes. Runtime execute grants cover the new helpers. No question column,
snapshot rewrite, migration 001–023 edit, or schema-version bump is needed.

SQL is a structural safety floor, not a second typed grader. Full accepted-answer
equivalence, forbidden-alias conflicts, exact form satisfiability, and the
list-separator rule are checked by the application. SQL legacy numeric comparison deliberately retains its
existing double-precision operation order and 1e-9 floor. Migration tests cover
extended grammar and typed structural parity plus real lifecycle publication.

## Bounds and scope

There is no eval, arbitrary code execution, CAS, or LLM final-answer grading.
Numeric parsing retains the 500-character, 64-token, 32-digit-literal, and ±30
scientific-exponent bounds. Those bounds also bound recursive depth and BigInt
magnitude. Category arrays and lists have at most 32 items; labels have at most
80 characters and units 40. The simulator and normal check route bound input
before grading. Finite-number validation applies to all authored tolerances.

All 12 misconception library entries were reviewed against their existing
course topics. Only union-versus-intersection gained `conditional-probability`:
conditioning still uses joint “and” events, so confusing addition with
intersection is relevant there. Other topic lists retain their focused coverage
of counting, conditional denominators/Bayes, distributions, moments, normal
approximation, and CLT. Question-specific matchers and whole-token numeric
matching are unchanged; regression tests cover the added scope and exclusion
outside it.

The checked-in public corpus provides no current evidence for a general symbolic
Phase C grader. The six syllabus batch files contain 256 questions: 254 have a
numeric accepted answer and two use “Yes, independent.” The eight demo questions
include `$1.60` and a labeled three-entry PMF, both addressed by Phase B. This is
repository evidence, not an assertion about live Production content. None of
these historical fixtures was silently converted to typed specs; the 22
remediated `-v2` candidates carry explicitly authored numeric specs that keep
their originals' tolerance. Symbolic
algebra, interval/event expressions, partial credit, explanation grading, and
step grading remain future work requiring actual authored examples.
