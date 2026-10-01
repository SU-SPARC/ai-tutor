/**
 * Question figures: a small, declarative graph attached to a question prompt
 * (bar chart, line chart, normal curve, two-set Venn diagram).
 *
 * Pure module with no server-only imports: the professor revision editor
 * validates figure JSON in the browser with the same rules the API applies.
 * See docs/question-figures.md.
 */
import type {
  QuestionFigure,
  QuestionFigureBar,
  QuestionFigureLine,
  QuestionFigureNormal,
  QuestionFigureVenn,
} from "@/lib/types";

export const QUESTION_FIGURE_KINDS = ["bar", "line", "normal", "venn"] as const;

export const QUESTION_FIGURE_LIMITS = {
  alt: 500,
  title: 120,
  label: 40,
  bars: 24,
  series: 4,
  points: 200,
} as const;

export type QuestionFigureValidation =
  | { ok: true; figure: QuestionFigure }
  | { ok: false; issues: string[] };

type Issues = string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: Issues,
) {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      issues.push(`${path} has an unknown key "${key}".`);
    }
  }
}

function readString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  max: number,
  issues: Issues,
  required: boolean,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) issues.push(`${path}.${key} is required.`);
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push(`${path}.${key} must be a string.`);
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    issues.push(`${path}.${key} must not be empty.`);
    return undefined;
  }
  if (trimmed.length > max) {
    issues.push(`${path}.${key} must be at most ${max} characters.`);
    return undefined;
  }
  return trimmed;
}

function readNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: Issues,
  required: boolean,
): number | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) issues.push(`${path}.${key} is required.`);
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${path}.${key} must be a finite number.`);
    return undefined;
  }
  return value;
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: Issues,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.push(`${path}.${key} must be true or false.`);
    return undefined;
  }
  return value;
}

/** Copies the optional string keys that are present and valid. */
function withOptional<T extends object>(
  target: T,
  entries: Array<[string, string | number | boolean | undefined]>,
): T {
  for (const [key, value] of entries) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}

function validateBar(
  record: Record<string, unknown>,
  issues: Issues,
): QuestionFigureBar | undefined {
  const L = QUESTION_FIGURE_LIMITS;
  checkKeys(
    record,
    ["kind", "alt", "title", "xLabel", "yLabel", "bars", "yMax"],
    "figure",
    issues,
  );
  const alt = readString(record, "alt", "figure", L.alt, issues, true);
  const title = readString(record, "title", "figure", L.title, issues, false);
  const xLabel = readString(record, "xLabel", "figure", L.label, issues, false);
  const yLabel = readString(record, "yLabel", "figure", L.label, issues, false);
  const yMax = readNumber(record, "yMax", "figure", issues, false);
  const bars: QuestionFigureBar["bars"] = [];
  if (!Array.isArray(record.bars)) {
    issues.push("figure.bars must be a list of bars.");
  } else if (record.bars.length === 0) {
    issues.push("figure.bars must contain at least one bar.");
  } else if (record.bars.length > L.bars) {
    issues.push(`figure.bars may contain at most ${L.bars} bars.`);
  } else {
    record.bars.forEach((bar, index) => {
      const path = `figure.bars[${index}]`;
      if (!isRecord(bar)) {
        issues.push(`${path} must be an object.`);
        return;
      }
      checkKeys(bar, ["label", "value", "highlight"], path, issues);
      const label = readString(bar, "label", path, L.label, issues, true);
      const value = readNumber(bar, "value", path, issues, true);
      const highlight = readBoolean(bar, "highlight", path, issues);
      if (value !== undefined && value < 0) {
        issues.push(`${path}.value must not be negative.`);
        return;
      }
      if (label !== undefined && value !== undefined) {
        bars.push(withOptional({ label, value }, [["highlight", highlight]]));
      }
    });
  }
  if (yMax !== undefined) {
    if (yMax <= 0) {
      issues.push("figure.yMax must be greater than 0.");
    } else if (bars.some((bar) => bar.value > yMax)) {
      issues.push("figure.yMax must be at least the largest bar value.");
    }
  }
  if (issues.length > 0 || alt === undefined) return undefined;
  return withOptional({ kind: "bar", alt, bars } as QuestionFigureBar, [
    ["title", title],
    ["xLabel", xLabel],
    ["yLabel", yLabel],
    ["yMax", yMax],
  ]);
}

function validateLine(
  record: Record<string, unknown>,
  issues: Issues,
): QuestionFigureLine | undefined {
  const L = QUESTION_FIGURE_LIMITS;
  checkKeys(
    record,
    ["kind", "alt", "title", "xLabel", "yLabel", "series"],
    "figure",
    issues,
  );
  const alt = readString(record, "alt", "figure", L.alt, issues, true);
  const title = readString(record, "title", "figure", L.title, issues, false);
  const xLabel = readString(record, "xLabel", "figure", L.label, issues, false);
  const yLabel = readString(record, "yLabel", "figure", L.label, issues, false);
  const series: QuestionFigureLine["series"] = [];
  if (!Array.isArray(record.series)) {
    issues.push("figure.series must be a list of series.");
  } else if (record.series.length === 0) {
    issues.push("figure.series must contain at least one series.");
  } else if (record.series.length > L.series) {
    issues.push(`figure.series may contain at most ${L.series} series.`);
  } else {
    record.series.forEach((entry, index) => {
      const path = `figure.series[${index}]`;
      if (!isRecord(entry)) {
        issues.push(`${path} must be an object.`);
        return;
      }
      checkKeys(entry, ["label", "points"], path, issues);
      const label = readString(entry, "label", path, L.label, issues, true);
      const points: Array<[number, number]> = [];
      if (!Array.isArray(entry.points)) {
        issues.push(`${path}.points must be a list of [x, y] pairs.`);
      } else if (entry.points.length === 0) {
        issues.push(`${path}.points must contain at least one point.`);
      } else if (entry.points.length > L.points) {
        issues.push(`${path}.points may contain at most ${L.points} points.`);
      } else {
        entry.points.forEach((point, pointIndex) => {
          if (
            !Array.isArray(point) ||
            point.length !== 2 ||
            !point.every(
              (coordinate) =>
                typeof coordinate === "number" && Number.isFinite(coordinate),
            )
          ) {
            issues.push(
              `${path}.points[${pointIndex}] must be a pair of finite numbers.`,
            );
            return;
          }
          points.push([point[0] as number, point[1] as number]);
        });
      }
      if (label !== undefined) series.push({ label, points });
    });
  }
  if (issues.length > 0 || alt === undefined) return undefined;
  return withOptional({ kind: "line", alt, series } as QuestionFigureLine, [
    ["title", title],
    ["xLabel", xLabel],
    ["yLabel", yLabel],
  ]);
}

function validateNormal(
  record: Record<string, unknown>,
  issues: Issues,
): QuestionFigureNormal | undefined {
  const L = QUESTION_FIGURE_LIMITS;
  checkKeys(
    record,
    ["kind", "alt", "title", "xLabel", "mean", "sd", "shade"],
    "figure",
    issues,
  );
  const alt = readString(record, "alt", "figure", L.alt, issues, true);
  const title = readString(record, "title", "figure", L.title, issues, false);
  const xLabel = readString(record, "xLabel", "figure", L.label, issues, false);
  const mean = readNumber(record, "mean", "figure", issues, true);
  const sd = readNumber(record, "sd", "figure", issues, true);
  if (sd !== undefined && sd <= 0) {
    issues.push("figure.sd must be greater than 0.");
  }
  let shade: QuestionFigureNormal["shade"];
  if (record.shade !== undefined) {
    if (!isRecord(record.shade)) {
      issues.push("figure.shade must be an object with from and/or to.");
    } else {
      checkKeys(record.shade, ["from", "to"], "figure.shade", issues);
      const from = readNumber(
        record.shade,
        "from",
        "figure.shade",
        issues,
        false,
      );
      const to = readNumber(record.shade, "to", "figure.shade", issues, false);
      if (from === undefined && to === undefined) {
        if (!("from" in record.shade) && !("to" in record.shade)) {
          issues.push("figure.shade needs a from or a to value.");
        }
      } else if (from !== undefined && to !== undefined && from >= to) {
        issues.push("figure.shade.from must be less than figure.shade.to.");
      }
      shade = withOptional({}, [
        ["from", from],
        ["to", to],
      ]);
    }
  }
  if (
    issues.length > 0 ||
    alt === undefined ||
    mean === undefined ||
    sd === undefined
  ) {
    return undefined;
  }
  const figure = withOptional(
    { kind: "normal", alt, mean, sd } as QuestionFigureNormal,
    [
      ["title", title],
      ["xLabel", xLabel],
    ],
  );
  if (shade) figure.shade = shade;
  return figure;
}

function validateVenn(
  record: Record<string, unknown>,
  issues: Issues,
): QuestionFigureVenn | undefined {
  const L = QUESTION_FIGURE_LIMITS;
  checkKeys(
    record,
    ["kind", "alt", "title", "sets", "regions"],
    "figure",
    issues,
  );
  const alt = readString(record, "alt", "figure", L.alt, issues, true);
  const title = readString(record, "title", "figure", L.title, issues, false);
  const labels: string[] = [];
  if (!Array.isArray(record.sets) || record.sets.length !== 2) {
    issues.push("figure.sets must be a list of exactly two sets.");
  } else {
    record.sets.forEach((set, index) => {
      const path = `figure.sets[${index}]`;
      if (!isRecord(set)) {
        issues.push(`${path} must be an object.`);
        return;
      }
      checkKeys(set, ["label"], path, issues);
      const label = readString(set, "label", path, L.label, issues, true);
      if (label !== undefined) labels.push(label);
    });
  }
  let regions: QuestionFigureVenn["regions"];
  if (record.regions !== undefined) {
    if (!isRecord(record.regions)) {
      issues.push("figure.regions must be an object.");
    } else {
      const keys = ["left", "right", "both", "neither"] as const;
      checkKeys(record.regions, keys, "figure.regions", issues);
      regions = {};
      for (const key of keys) {
        const text = readString(
          record.regions,
          key,
          "figure.regions",
          L.label,
          issues,
          false,
        );
        if (text !== undefined) regions[key] = text;
      }
    }
  }
  if (issues.length > 0 || alt === undefined || labels.length !== 2) {
    return undefined;
  }
  const figure: QuestionFigureVenn = {
    kind: "venn",
    alt,
    sets: [{ label: labels[0] }, { label: labels[1] }],
  };
  if (title !== undefined) figure.title = title;
  if (regions && Object.keys(regions).length > 0) figure.regions = regions;
  return figure;
}

/**
 * Strict validation for authored figures (API payloads, imports, approval).
 * Fails closed: unknown keys, non-finite numbers, empty lists, and strings
 * over the limits are all issues. On success the returned figure is a fresh
 * copy holding only known keys, with strings trimmed.
 */
export function validateQuestionFigure(
  value: unknown,
): QuestionFigureValidation {
  if (!isRecord(value)) {
    return { ok: false, issues: ["figure must be an object."] };
  }
  const kind = value.kind;
  if (
    typeof kind !== "string" ||
    !(QUESTION_FIGURE_KINDS as readonly string[]).includes(kind)
  ) {
    return {
      ok: false,
      issues: [
        `figure.kind must be one of ${QUESTION_FIGURE_KINDS.join(", ")}.`,
      ],
    };
  }
  const issues: Issues = [];
  let figure: QuestionFigure | undefined;
  switch (kind as QuestionFigure["kind"]) {
    case "bar":
      figure = validateBar(value, issues);
      break;
    case "line":
      figure = validateLine(value, issues);
      break;
    case "normal":
      figure = validateNormal(value, issues);
      break;
    case "venn":
      figure = validateVenn(value, issues);
      break;
  }
  if (issues.length > 0 || !figure) {
    return {
      ok: false,
      issues: issues.length > 0 ? issues : ["figure is invalid."],
    };
  }
  return { ok: true, figure };
}

/**
 * Lenient reader for stored data (fixtures, snapshot JSON, view rows).
 * Absent or null yields undefined quietly; an invalid value yields undefined
 * with a console warning naming `context`, so one bad figure never breaks a
 * question read.
 */
export function readQuestionFigure(
  value: unknown,
  context: string,
): QuestionFigure | undefined {
  if (value === undefined || value === null) return undefined;
  const result = validateQuestionFigure(value);
  if (result.ok) return result.figure;
  console.warn(
    `[question-figure] Ignoring invalid figure for ${context}: ${result.issues.join(" ")}`,
  );
  return undefined;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * One plain-text paragraph describing the figure for the tutor model: the
 * author's alt text followed by the data the graph encodes.
 */
export function describeQuestionFigure(figure: QuestionFigure): string {
  const parts: string[] = [];
  const kindLabel = {
    bar: "Bar chart",
    line: "Line chart",
    normal: "Normal curve",
    venn: "Venn diagram",
  }[figure.kind];
  parts.push(
    figure.title ? `${kindLabel} titled "${figure.title}".` : `${kindLabel}.`,
  );
  parts.push(sentence(figure.alt));

  switch (figure.kind) {
    case "bar": {
      if (figure.xLabel) parts.push(`Horizontal axis: ${figure.xLabel}.`);
      if (figure.yLabel) parts.push(`Vertical axis: ${figure.yLabel}.`);
      const bars = figure.bars
        .map(
          (bar) =>
            `${bar.label} = ${formatNumber(bar.value)}${bar.highlight ? " (highlighted)" : ""}`,
        )
        .join("; ");
      parts.push(`Bars: ${bars}.`);
      break;
    }
    case "line": {
      if (figure.xLabel) parts.push(`Horizontal axis: ${figure.xLabel}.`);
      if (figure.yLabel) parts.push(`Vertical axis: ${figure.yLabel}.`);
      for (const series of figure.series) {
        const points = series.points
          .map(([x, y]) => `(${formatNumber(x)}, ${formatNumber(y)})`)
          .join(", ");
        parts.push(`Series "${series.label}": ${points}.`);
      }
      break;
    }
    case "normal": {
      parts.push(
        `Mean ${formatNumber(figure.mean)}, standard deviation ${formatNumber(figure.sd)}${
          figure.xLabel ? `, horizontal axis ${figure.xLabel}` : ""
        }.`,
      );
      const from = figure.shade?.from;
      const to = figure.shade?.to;
      if (from !== undefined && to !== undefined) {
        parts.push(
          `Shaded area between ${formatNumber(from)} and ${formatNumber(to)}.`,
        );
      } else if (from !== undefined) {
        parts.push(`Shaded area to the right of ${formatNumber(from)}.`);
      } else if (to !== undefined) {
        parts.push(`Shaded area to the left of ${formatNumber(to)}.`);
      }
      break;
    }
    case "venn": {
      const [a, b] = figure.sets;
      parts.push(`Sets: ${a.label} and ${b.label}.`);
      const regions = figure.regions ?? {};
      const regionParts = [
        regions.left !== undefined
          ? `only ${a.label}: ${regions.left}`
          : undefined,
        regions.both !== undefined
          ? `both ${a.label} and ${b.label}: ${regions.both}`
          : undefined,
        regions.right !== undefined
          ? `only ${b.label}: ${regions.right}`
          : undefined,
        regions.neither !== undefined
          ? `neither: ${regions.neither}`
          : undefined,
      ].filter((part): part is string => part !== undefined);
      if (regionParts.length > 0) {
        parts.push(`Regions: ${regionParts.join("; ")}.`);
      }
      break;
    }
  }
  return parts.join(" ");
}
