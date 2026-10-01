# Question figures

A question can carry one optional **figure**: a small declarative graph drawn
next to the prompt (a bar chart, a line chart, a normal curve or a two-set Venn
diagram). The figure is part of the prompt. It is public, it is sent to the
browser before a tutor session starts, and it must never carry the answer. Its
`alt` text describes the graph, not the solution.

Code:

| Piece | File |
| --- | --- |
| Types (`QuestionFigure` and the four kinds) | `src/lib/types.ts` |
| Validator, lenient reader, text description | `src/lib/tutor/question-figure.ts` |
| SVG renderer (`QuestionFigureView`) | `src/components/sheet/question-figure.tsx` |
| Tests | `tests/question-figure.test.ts` |

`question-figure.ts` has no server-only imports, so the professor revision
editor validates figure JSON in the browser with exactly the rules the API
applies.

## Schema

Every kind has `kind`, a required `alt` and an optional `title` (shown as a
caption under the graph). Unknown keys are rejected at every level.

### `bar`

Vertical bars from zero, one per category. Good for a PMF or a frequency table.

```json
{
  "kind": "bar",
  "alt": "Bar chart of the probability distribution of X for X = 0 to 4.",
  "title": "Bikes waiting at 8 a.m.",
  "xLabel": "Bikes waiting, x",
  "yLabel": "P(X = x)",
  "bars": [
    { "label": "0", "value": 0.05 },
    { "label": "1", "value": 0.2 },
    { "label": "2", "value": 0.35, "highlight": true }
  ],
  "yMax": 0.4
}
```

- `bars`: 1 to 24 entries; `value` is a finite number, not negative.
- `highlight` draws the bar in mint with a heavy ink outline and a bold value
  label (colour is not the only signal).
- `yMax` (optional) fixes the top of the value axis; it must be positive and at
  least the tallest bar. Without it the axis rounds up to a "nice" value.
- With more than 12 bars the value labels are dropped and the category labels
  thin out; the screen-reader table still lists every bar.

### `line`

One to four series of `[x, y]` points, drawn as polylines with point markers.

```json
{
  "kind": "line",
  "alt": "Line chart of the CDF of X, rising from 0.2 at x = 0 to 1 at x = 2.",
  "xLabel": "x",
  "yLabel": "F(x)",
  "series": [
    { "label": "CDF", "points": [[0, 0.2], [1, 0.5], [2, 1]] }
  ]
}
```

- `series`: 1 to 4; each has a `label` and 1 to 200 finite `[x, y]` pairs.
  Points are sorted by x before drawing.
- Series differ by dash pattern as well as colour; a legend appears under the
  graph when there is more than one series.

### `normal`

A normal curve over mean ± 3.5 standard deviations, with an optional shaded area.

```json
{
  "kind": "normal",
  "alt": "Normal curve with mean 70 and standard deviation 8; the area above 82 is shaded.",
  "xLabel": "Exam score",
  "mean": 70,
  "sd": 8,
  "shade": { "from": 82 }
}
```

- `sd` must be greater than 0.
- `shade` needs at least one of `from` / `to`; leave one out for an open tail.
  When both are given, `from` must be less than `to`.
- Tick marks sit at the mean and ±1, 2, 3 SD. Without `xLabel` they read μ,
  μ+σ, μ−2σ and so on; with `xLabel` they show the numeric values.

### `venn`

Two overlapping sets inside a universe rectangle.

```json
{
  "kind": "venn",
  "alt": "Venn diagram of students in the art club and the music club.",
  "title": "Club membership",
  "sets": [{ "label": "Art" }, { "label": "Music" }],
  "regions": { "left": "12", "both": "5", "right": "9", "neither": "4" }
}
```

- `sets`: exactly two, each with a `label`.
- `regions` (optional): short text drawn in each region. `left` is "only the
  first set", `right` is "only the second set", `neither` sits in the lower
  right corner of the rectangle. Keep region text to a few characters (a count
  or a probability); it is not wrapped.

## Limits

`QUESTION_FIGURE_LIMITS` in `src/lib/tutor/question-figure.ts`:

| Field | Limit |
| --- | --- |
| `alt` | 500 characters |
| `title` | 120 characters |
| every label (`xLabel`, `yLabel`, bar and series labels, set labels, region text) | 40 characters |
| `bars` | 24 |
| `series` | 4 |
| points per series | 200 |

Strings are trimmed and must not be empty. Every number must be finite.

## Validation

- `validateQuestionFigure(value)` is strict and fails closed. It returns
  `{ ok: true, figure }` (a fresh copy holding only known keys) or
  `{ ok: false, issues }` with one readable sentence per problem, for example
  `figure.bars[2].value must be a finite number.` The API, content import and
  the approve/publish checks use it.
- `readQuestionFigure(value, context)` is the lenient reader for data that is
  already stored (demo fixtures, version snapshots, view rows). Absent or `null`
  gives `undefined`; an invalid value gives `undefined` plus a `console.warn`
  naming the context, so one bad figure never breaks a question read.

## Storage and authoring

- The figure lives only in the immutable version snapshot,
  `question_versions.snapshot_json.figure` (same doctrine as `answer.spec`).
  "No figure" means the key is absent. Migration 028 exposes it on the
  question views as `figure_json`.
- Professors edit it in the revision editor under **Figure (JSON, optional)**:
  paste or edit the JSON, which is validated in the browser before submit. An
  empty box removes the figure (`figure: null` in the revision payload); an
  invalid figure is rejected by the API with a 400 that lists the issues.
- Content transfer (v1) carries `figure` on each question; imports validate it
  and report issues as row errors. Documents without the key stay valid.
- Demo fixtures in `data/demo/questions.json` may carry a `figure`;
  `src/lib/data/demo-data.ts` reads it with `readQuestionFigure`. The demo
  question `demo-random-variable-bike-dock-chart` is the reference example.

## Accessibility

- The SVG has `role="img"`, `aria-label` and a `<title>` set to `alt`, so write
  `alt` as a description of the graph a student could work from ("Bar chart of
  the distribution of X for X = 0 to 4"), never the answer.
- Bar and line charts also render an `sr-only` table with every value.
- Colours come only from token classes (`fill-azure-500`, `fill-mint`,
  `stroke-ink`, `stroke-rule`, `fill-ink-muted` and so on), so the chalkboard
  theme works with no extra code. Highlights and series never rely on colour
  alone (outline, bold label, dash pattern).
- The viewBox is 360 units wide with 14-unit text and the graph is capped at
  28rem, so labels render at about 13px on a phone column and about 17px at the
  cap.

## What the tutor sees

`describeQuestionFigure(figure)` turns the figure into one plain-text paragraph:
the kind and title, the `alt` text, the axis labels and the data, for example

```
Bar chart titled "Bikes waiting at 8 a.m.". Bar chart of the probability distribution of X ... Horizontal axis: Bikes waiting, x. Vertical axis: P(X = x). Bars: 0 = 0.05; 1 = 0.2; 2 = 0.35; 3 = 0.25; 4 = 0.15.
```

`src/lib/ai/llm-tutor.ts` appends it to `current_question.prompt` as a trailing
`\n[Figure] ...` line, capped at 600 characters. The line has its own budget on
top of the 2,400-character prompt budget, so a figure never pushes out the
question text; under pressure it shrinks to 300 characters along with the other
fields. The rule-based tutor paths do not read the figure.
