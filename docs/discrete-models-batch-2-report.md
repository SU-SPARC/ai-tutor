# Targeted discrete-models content batch 2

Prepared 2026-09-10. Eight new original drafts, pending professor review.
Canonical topic: `binomial-models` — **Bernoulli, Binomial, Geometric, Poisson,
and Other Discrete Random Variables**, as specified by
`data/canonical/syllabus-topics.json`. No new topic was introduced.

All IDs below start with `generated-discrete-batch-2-`.

| ID suffix | Learning task | Difficulty | Answer kind | Canonical value |
| --- | --- | --- | --- | --- |
| binomial-at-least | Complement of an inclusive upper-tail event | intermediate | numeric | 0.768212992 |
| binomial-at-most | Sum of an inclusive lower-tail event | intermediate | numeric | 0.735818086223450927734375 |
| binomial-mean-sd | Expected count and standard deviation | foundational | number_list | 12, 3 |
| negative-binomial-third-success | Third success on the seventh trial | challenge | numeric | 0.11480183203125 |
| multinomial-three-categories | Three-category count allocation | challenge | numeric | 189/2500 = 0.0756 |
| geometric-tail | Still waiting after five trials | intermediate | numeric | 0.3707398432 |
| poisson-rate-rescaling | Convert an hourly rate to a 25-minute mean | intermediate | numeric | approximately 0.180447044315484 |
| poisson-binomial-approximation | Choose np and approximate a cumulative event | challenge | numeric | approximately 0.248660397137074 |

## Independent mathematical verification

Answers and wrong values were recomputed separately with Python exact rational
arithmetic for the finite probability models and 50-digit Decimal exponentials
for the Poisson calculations. Tests use separate oracles: Bernoulli convolution,
enumeration of stopping sequences and three-category assignments, and Poisson
mass recurrence starting from a reciprocal exponential series. The tests do not
import mathematical calculations from the generator.

1. **At least:** Summing Binomial(9, 2/5) masses from 3 through 9 gives
   `1500416/1953125 = 0.768212992`. The solution independently uses the
   complement of counts 0, 1, 2, whose sum is `0.231787008`.
2. **At most:** Summing Binomial(12, 3/20) masses from 0 through 2 gives
   `602782176234251/819200000000000 = 0.735818086223450927734375`.
3. **Mean/SD:** Summing the full Binomial(48, 1/4) PMF for the first moment and
   centered second moment gives mean 12 and variance 9; SD is exactly 3.
4. **Negative binomial:** Enumerating seven-trial sequences with exactly three
   successes and a final success agrees with
   `C(6,2)(7/20)^3(13/20)^4 = 29389269/256000000 = 0.11480183203125`.
   The first six must contain exactly two successes, so three cannot be reached
   earlier; trial seven supplies the required third success.
5. **Multinomial:** Enumerating all `3^8` language assignments and retaining
   counts `(3,3,2)` agrees with
   `[8!/(3!3!2!)](1/2)^3(3/10)^3(1/5)^2 = 560(0.000135) = 189/2500`.
6. **Geometric tail:** Subtracting the probabilities of first success on trials
   1 through 5 from 1 agrees with `(41/50)^5 = 115856201/312500000 = 0.3707398432`.
   X explicitly counts trials through the first success, starting at 1.
7. **Rate rescaling:** `lambda = 4.8(25/60) = 2` and
   `P(X=3) = (4/3)exp(-2) = 0.18044704431548358919199932662997920454350872787943...`.
8. **Approximation:** `lambda = 1800(0.0015) = 2.7` and
   `P(Y<=1) = 3.7exp(-2.7) = 0.24866039713707413096824129316707303391061647678091...`.
   The independent, numerous trials and small individual retry probability
   justify the approximation. The prompt and solution label it an approximation
   and ask students to identify lambda in their working; only the final
   probability is automatically graded.

## Typed answer configuration and rounding

**PROFESSOR ROUNDING POLICY STILL REQUIRED.** Repository documentation and
canonical metadata contain no newer professor-approved policy. Batch 1's
generator explicitly records the outstanding policy decision and uses absolute
probability tolerance 0.001. This batch retains that behavior.

The seven probabilities have `kind: numeric`, `domain: probability`,
`percentMode: either`, and `tolerance: {mode: absolute, value: 0.001}`. Their
legacy numeric values and tolerance agree with the typed spec. They accept a
decimal and an explicitly marked percentage; the multinomial also includes its
compact exact fraction. Huge-denominator fraction aliases are unnecessary:
the canonical checker already evaluates rational equivalence.

The mean/SD answer uses the existing `number_list` grammar with
`values: ["12", "3"]`, `ordered: true`, and exact tolerance. The prompt specifies
the order and gives a format instruction. These are real-valued statistical
quantities; `number_list` has no domain property, so none was invented. Both
values happen to be integers and require no rounding. Reversing their order or
submitting variance instead of SD is incorrect.

No decimal-place grading rule, new answer type, expression evaluator, or
answer-checker change was introduced. Long decimal values record mathematical
precision; they are not a requirement that students type all those digits.

## Misconceptions

Each question has one high-value numeric misconception. IDs start with
`misconception-discrete-batch-2-`. The values below were independently recomputed;
additional terms represent explicit roundings of the same wrong calculation,
including the requested five-place truncation described below, not substring patterns. The matcher compares parsed rational values.

| Question suffix | Misconception suffix | Wrong reasoning and independently computed value | Match terms |
| --- | --- | --- | --- |
| binomial-at-least | point-instead-of-upper-tail | Only `P(X=3) = 489888/1953125 = 0.250822656` | `0.250822656`, `0.250823`, `0.2508`, `0.251` |
| binomial-at-most | complement-of-requested-lower-tail | Returns `P(X>=3) = 216417823765749/819200000000000 = 0.264181913776549072265625` | `0.264181913776549072265625`, `0.264182`, `0.2642`, `0.264` |
| binomial-mean-sd | variance-instead-of-sd | Reports `np(1-p) = 9` instead of SD; full wrong answer is `12, 9` | `9` |
| negative-binomial-third-success | final-success-omitted | Only two successes in six trials: `4198467/12800000 = 0.328005234375`; omits final factor 0.35 | `0.328005234375`, `0.328005`, `0.3280`, `0.328` |
| multinomial-three-categories | multinomial-coefficient-omitted | One ordering: `(0.5)^3(0.3)^3(0.2)^2 = 27/200000 = 0.000135` | `0.000135` |
| geometric-tail | point-instead-of-geometric-tail | `P(X=5) = (0.82)^4(0.18) = 25431849/312500000 = 0.0813819168` | `0.0813819168`, `0.081382`, `0.0814`, `0.081` |
| poisson-rate-rescaling | hourly-mean-not-rescaled | `exp(-4.8)(4.8)^3/3! = 0.15169069760753717160398487735228122425253618218178...` | `0.151690697607537`, `0.151691`, `0.1517`, `0.152` |
| poisson-binomial-approximation | single-trial-probability-as-mean | `exp(-0.0015)(1.0015) = 0.99999887612436744054591877345317019740500214143577...` | `0.999998876124367`, `0.999999`, `1.0`, `0.99999` |

The small integer term 9 is justified by the exact variance in the mean/SD
question. It is not a generic count or fragment. The correct ordered answer has
no 9 token. All correct accepted forms are checked against misconception
false positives; every authored wrong term is checked for incorrect grading and
the intended first question-specific match.

## Hints and solutions

Every question has exactly three distinct progressive hints: recognition, setup,
then structure before arithmetic. There are 24 distinct hints across the batch.
None states an accepted final answer. Solutions have four or five substantive
steps, with definitions/assumptions, parameters, formula, arithmetic, and
interpretation as appropriate. The negative binomial solution explains the
first-six/final-trial split; the multinomial shows both coefficient and product.

## Pairwise diversity audit

**RAW QUESTIONS: 8. EFFECTIVE DIVERSE QUESTIONS: 8.**

All 28 unordered pairs were reviewed by their required reasoning, not their
stories. The closest pairs still test distinct operations:

- The two binomial tails distinguish the complement excluding 0,1,2 from the
  inclusive sum retaining 0,1,2. They are deliberately separate upper/lower-tail
  tasks requested for this batch, not number-swapped point probabilities.
- Mean/SD uses moments and a square root rather than a probability mass or tail.
- Negative binomial fixes a kth-success stopping trial and requires a final
  success; geometric tail leaves all later outcomes unrestricted.
- Multinomial allocates three category counts and counts their arrangements.
- Poisson rescaling converts time units before evaluating one mass; Poisson
  approximation selects a new model with mean np and sums two masses.
- Cross-family tail questions require different event structures: binomial
  cumulative terms, geometric survival, or rare-event approximation followed by
  a Poisson cumulative event.

Existing public demo/review fixtures under this topic were inspected: they
cover Bernoulli moments, binomial point probabilities, geometric first-success
point probabilities, same-interval Poisson masses, and hypergeometric counts.
The new tasks add the listed reasoning rather than changing only their numbers
or stories. No historical candidate was edited or given a new ID.

## Provenance, registration, and local verification

All eight are `generated_original`, `generated_unverified`, and `needs_review`.
No `patternId`/`patternIds`, priority override, reviewer, approval, or publication
is assigned. `patternSource` is a truthful plain-language task description, as
required by the existing fixture schema; it is not an invented catalog ID.

The separate generator writes only the new fixture. It is registered in the
existing demo review loader and the importer's fixed allowlist. Repository
totals rise from 256 to 264 drafts and from six to seven fixture files. Existing
test changes are restricted to those totals and inclusion in the aggregate
queue/provenance checks. All database verification uses test PGlite databases;
no operator import command is run against any external database.

Local preparation and verification commands:

```bash
npm run prepare:discrete-models-batch-2
npm run prepare:discrete-models-batch-2 -- --check
npx vitest run tests/discrete-models-batch-2.test.ts
npm run typecheck
npm run lint
npx vitest run
git diff --check
```

The preparation/check command runs the repository's public review-fixture
validator over every registered file and validates all eight typed specs with
the real `validateAnswerSpec`. The separate private-generation payload validator
expects a different private-envelope schema and is not used for public review
fixtures. Tests cover canonical and equivalent forms, every accepted answer,
wrong-value grading/detection, malformed submissions, independent arithmetic,
fixture reproducibility, and review-only loading.

Initial batch verification results on 2026-09-10 (before final cleanup):

| Command | Result |
| --- | --- |
| `npm run prepare:discrete-models-batch-2` | Generated exactly 8; all 264 registered candidates passed the public fixture validator |
| `npm run prepare:discrete-models-batch-2 -- --check` | Current; all 8 typed specs valid; no duplicate IDs/prompts |
| `npx vitest run tests/discrete-models-batch-2.test.ts` | 29/29 tests passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npx vitest run` | 1,269 passed; 2 PGlite timeouts; 105 files passed and 1 failed, out of 106 files / 1,271 tests |
| `npx vitest run tests/review-candidate-provenance-repair.test.ts` | Isolated rerun: 5/5 passed in 9.18 seconds |
| `git diff --check` | Passed |

The two full-suite failures were the previously observed 15-second timeouts in
the provenance-repair file, not assertion failures. Both passed when that file
ran alone. No timeout or unrelated test behavior was changed. The full run also
passed the import test that loads all 264 candidates idempotently into PGlite and
checks that students see no questions, counts, or retrieval content from them.

Final baseline comparison confirmed byte-identical historical candidates,
canonical topics, migrations, tutor architecture, answer checker, rational
parser, and misconception matcher. Pre-existing workspace edits were preserved.

Remaining limitations: professor review, approval/publication decisions, and
course rounding policy remain outstanding. Deterministic grading checks final
values, not students' written distribution justification. Approximate wrong
values match only the authored precisions and their rational equivalents; this
batch does not redesign rounded misconception coverage. Nothing was pushed,
deployed, approved, published, or applied to Production.


## Final cleanup following independent content audit

Only the generator's final solution prose and existing misconception match-term
arrays were edited, then the fixture was regenerated. The final explanation is
derived from the last solution step by the generator.

| Question | Before presentation | After presentation |
| --- | --- | --- |
| binomial-at-least | 76.8212992% | approximately 76.8% |
| binomial-at-most | 0.735818086223450927734375 / 73.5818% | approximately 0.7358 / about 73.6% |
| geometric-tail | 37.07398432% | approximately 37.1% |
| poisson-rate-rescaling | 0.180447044315484 / 18.0447044315484% | approximately 0.1804 / about 18.0% |
| poisson-binomial-approximation | 0.248660397137074 / 24.8660% | approximately 0.2487 / about 24.9% |

The misconception table above includes all twelve requested additions. Eleven
are rounding to nearest at the stated number of decimal places. The term
`0.99999` is specifically **truncation to five decimal places (rounding toward
zero)** of `exp(-0.0015)(1.0015)`, not rounding to nearest; rounding that wrong
value to nearest at five places would yield `1.00000`. The requested `1.0` is
rounding to nearest at one decimal place. It is deliberately not authored as
`1`, to avoid the digits-only fraction-part exception.

New tests independently derive each rounded value, check its exact rational
distance from the canonical value against the 0.001 tolerance band, and require
incorrect grading plus only the intended question-specific misconception.
Additional tests lock every pre-cleanup grading field for all eight questions
and check that `1/2`, `2/1`, and `7/11` do not trigger the probability-as-mean
misconception. Every question still has exactly one misconception; all prior
terms remain.

**Grading semantics: UNCHANGED.** Accepted answers, numeric values, complete typed
specs, tolerances, prompts, difficulty, hints, provenance, and review state are
unchanged. Only final prose uses shorter presentation; it does not impose a
student rounding rule. **PROFESSOR ROUNDING POLICY STILL REQUIRED.**

Final cleanup validation results (2026-09-10):

| Command | Result |
| --- | --- |
| `npm run prepare:discrete-models-batch-2` | Regenerated exactly 8; fixture validation passed for all 264 registered candidates |
| `npm run prepare:discrete-models-batch-2 -- --check` | Current; no generator drift |
| `npx vitest run tests/discrete-models-batch-2.test.ts` | 50/50 passed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npx vitest run` | 1,292/1,292 tests passed across 106/106 files; no PGlite timeout |
| `git diff --check` | Passed |

The 21 added tests comprise twelve per-term rounding/checker/matcher checks,
eight frozen grading-field checks, and one fraction-part collision regression.
All existing assertions remain intact. The cleanup changed only the generator,
its regenerated fixture, the batch tests, and this report. A structural diff
against the pre-cleanup fixture confirmed five changed final steps/explanations
and twelve added terms, with all other fields identical. No other workspace
file changed during cleanup, including migrations and checker/matcher code.
