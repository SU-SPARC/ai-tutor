import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLlmTutorUserPrompt,
  type LlmTutorInput,
} from "@/lib/ai/llm-tutor";
import { normalizeSummary } from "@/lib/api/question-serialization";
import { QuestionFigureView } from "@/components/sheet/question-figure";
import { demoQuestions } from "@/lib/data/demo-data";
import { activeCanonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import {
  QUESTION_FIGURE_KINDS,
  QUESTION_FIGURE_LIMITS,
  describeQuestionFigure,
  readQuestionFigure,
  validateQuestionFigure,
} from "@/lib/tutor/question-figure";
import type { QuestionFigure } from "@/lib/types";

const barFigure: QuestionFigure = {
  kind: "bar",
  alt: "Bar chart of the distribution of X for X = 0, 1, 2.",
  title: "Distribution of X",
  xLabel: "x",
  yLabel: "P(X = x)",
  bars: [
    { label: "0", value: 0.1 },
    { label: "1", value: 0.6, highlight: true },
    { label: "2", value: 0.3 },
  ],
  yMax: 0.8,
};

const lineFigure: QuestionFigure = {
  kind: "line",
  alt: "Line chart of two cumulative distribution functions.",
  xLabel: "x",
  yLabel: "F(x)",
  series: [
    {
      label: "Plant A",
      points: [
        [0, 0.2],
        [1, 0.5],
        [2, 1],
      ],
    },
    {
      label: "Plant B",
      points: [
        [0, 0.1],
        [1, 0.4],
        [2, 1],
      ],
    },
  ],
};

const normalFigure: QuestionFigure = {
  kind: "normal",
  alt: "Normal curve with mean 70 and standard deviation 8, shaded above 82.",
  xLabel: "Score",
  mean: 70,
  sd: 8,
  shade: { from: 82 },
};

const vennFigure: QuestionFigure = {
  kind: "venn",
  alt: "Venn diagram of students taking Art and Music.",
  sets: [{ label: "Art" }, { label: "Music" }],
  regions: { left: "12", both: "5", right: "9", neither: "4" },
};

describe("validateQuestionFigure", () => {
  it("accepts each kind and returns a clean copy", () => {
    for (const figure of [barFigure, lineFigure, normalFigure, vennFigure]) {
      const result = validateQuestionFigure(figure);
      expect(result).toEqual({ ok: true, figure });
      if (result.ok) expect(result.figure).not.toBe(figure);
    }
    expect(QUESTION_FIGURE_KINDS).toEqual(["bar", "line", "normal", "venn"]);
  });

  it("trims strings", () => {
    const result = validateQuestionFigure({ ...vennFigure, alt: "  Venn.  " });
    expect(result.ok && result.figure.alt).toBe("Venn.");
  });

  it("rejects non-objects and unknown kinds", () => {
    expect(validateQuestionFigure(null).ok).toBe(false);
    expect(validateQuestionFigure([barFigure]).ok).toBe(false);
    const result = validateQuestionFigure({ ...barFigure, kind: "pie" });
    expect(result).toEqual({
      ok: false,
      issues: ["figure.kind must be one of bar, line, normal, venn."],
    });
  });

  it("rejects unknown keys at every level", () => {
    const top = validateQuestionFigure({ ...barFigure, answer: "0.9" });
    expect(top.ok).toBe(false);
    expect(!top.ok && top.issues).toContain(
      'figure has an unknown key "answer".',
    );
    const nested = validateQuestionFigure({
      ...barFigure,
      bars: [{ label: "0", value: 0.1, color: "red" }],
    });
    expect(!nested.ok && nested.issues).toContain(
      'figure.bars[0] has an unknown key "color".',
    );
  });

  it("rejects non-finite numbers", () => {
    const result = validateQuestionFigure({
      ...barFigure,
      bars: [{ label: "0", value: Number.NaN }],
    });
    expect(!result.ok && result.issues).toContain(
      "figure.bars[0].value must be a finite number.",
    );
    const line = validateQuestionFigure({
      ...lineFigure,
      series: [{ label: "A", points: [[0, Number.POSITIVE_INFINITY]] }],
    });
    expect(line.ok).toBe(false);
  });

  it("rejects sd <= 0 and inverted shading", () => {
    const zero = validateQuestionFigure({ ...normalFigure, sd: 0 });
    expect(!zero.ok && zero.issues).toContain(
      "figure.sd must be greater than 0.",
    );
    const inverted = validateQuestionFigure({
      ...normalFigure,
      shade: { from: 90, to: 80 },
    });
    expect(inverted.ok).toBe(false);
  });

  it("rejects empty and oversized lists", () => {
    expect(validateQuestionFigure({ ...barFigure, bars: [] }).ok).toBe(false);
    expect(validateQuestionFigure({ ...lineFigure, series: [] }).ok).toBe(
      false,
    );
    const tooMany = validateQuestionFigure({
      ...barFigure,
      yMax: undefined,
      bars: Array.from({ length: QUESTION_FIGURE_LIMITS.bars + 1 }, (_, i) => ({
        label: String(i),
        value: 1,
      })),
    });
    expect(!tooMany.ok && tooMany.issues).toContain(
      `figure.bars may contain at most ${QUESTION_FIGURE_LIMITS.bars} bars.`,
    );
  });

  it("rejects over-long strings and a missing alt", () => {
    const longAlt = validateQuestionFigure({
      ...barFigure,
      alt: "a".repeat(QUESTION_FIGURE_LIMITS.alt + 1),
    });
    expect(!longAlt.ok && longAlt.issues).toContain(
      `figure.alt must be at most ${QUESTION_FIGURE_LIMITS.alt} characters.`,
    );
    const { alt: _alt, ...withoutAlt } = barFigure;
    void _alt;
    expect(validateQuestionFigure(withoutAlt).ok).toBe(false);
  });

  it("rejects a yMax below the tallest bar and a venn without two sets", () => {
    expect(validateQuestionFigure({ ...barFigure, yMax: 0.5 }).ok).toBe(false);
    expect(
      validateQuestionFigure({ ...vennFigure, sets: [{ label: "A" }] }).ok,
    ).toBe(false);
  });
});

describe("readQuestionFigure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined quietly for absent values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readQuestionFigure(undefined, "q1")).toBeUndefined();
    expect(readQuestionFigure(null, "q1")).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("returns undefined with a warning for invalid values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(readQuestionFigure({ kind: "bar" }, "question q7")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("question q7"));
  });

  it("returns the figure for valid values", () => {
    expect(readQuestionFigure(normalFigure, "q1")).toEqual(normalFigure);
  });
});

describe("describeQuestionFigure", () => {
  it("describes a bar chart with its data", () => {
    expect(describeQuestionFigure(barFigure)).toBe(
      'Bar chart titled "Distribution of X". Bar chart of the distribution of X for X = 0, 1, 2. Horizontal axis: x. Vertical axis: P(X = x). Bars: 0 = 0.1; 1 = 0.6 (highlighted); 2 = 0.3.',
    );
  });

  it("describes line, normal and venn figures", () => {
    expect(describeQuestionFigure(lineFigure)).toContain(
      'Series "Plant A": (0, 0.2), (1, 0.5), (2, 1).',
    );
    expect(describeQuestionFigure(normalFigure)).toContain(
      "Mean 70, standard deviation 8, horizontal axis Score. Shaded area to the right of 82.",
    );
    expect(describeQuestionFigure(vennFigure)).toContain(
      "Regions: only Art: 12; both Art and Music: 5; only Music: 9; neither: 4.",
    );
  });
});

describe("QuestionFigureView", () => {
  it("renders an accessible bar chart with an sr-only data table", () => {
    const markup = renderToStaticMarkup(
      createElement(QuestionFigureView, { figure: barFigure }),
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain(`aria-label="${barFigure.alt}"`);
    expect(markup).toContain(`<title>${barFigure.alt}</title>`);
    expect(markup).toContain('class="sr-only"');
    expect(markup).toMatch(
      /<th scope="row">1<\/th><td>0\.6 \(highlighted\)<\/td>/,
    );
    expect(markup).toContain("<figcaption");
    expect(markup).toContain("fill-mint");
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgb\(|oklch\(/);
  });

  it("renders line, normal and venn figures", () => {
    const line = renderToStaticMarkup(
      createElement(QuestionFigureView, { figure: lineFigure }),
    );
    expect(line).toContain("<polyline");
    expect(line).toContain("Plant B");
    expect(line).toContain('class="sr-only"');

    const normal = renderToStaticMarkup(
      createElement(QuestionFigureView, { figure: normalFigure }),
    );
    expect(normal).toContain('role="img"');
    expect(normal).toContain("fill-azure-100");
    expect(normal).toContain(">94<");

    const unlabeled = renderToStaticMarkup(
      createElement(QuestionFigureView, {
        figure: { kind: "normal", alt: "Standard normal", mean: 0, sd: 1 },
      }),
    );
    expect(unlabeled).toContain("μ+2σ");

    const venn = renderToStaticMarkup(
      createElement(QuestionFigureView, { figure: vennFigure }),
    );
    expect(venn).toContain(">Music<");
    expect(venn).toContain(">4<");
  });
});

describe("demo figure question", () => {
  const question = demoQuestions.find(
    (item) => item.id === "demo-random-variable-bike-dock-chart",
  );

  it("loads with a valid bar figure in an active topic", () => {
    expect(question?.figure?.kind).toBe("bar");
    expect(
      activeCanonicalSyllabusTopics.some(
        (topic) => topic.id === question?.topicId,
      ),
    ).toBe(true);
    const total =
      question?.figure?.kind === "bar"
        ? question.figure.bars.reduce((sum, bar) => sum + bar.value, 0)
        : 0;
    expect(total).toBeCloseTo(1, 10);
  });

  it("exposes the figure in the public summary without answers", () => {
    const summary = normalizeSummary(question!);
    expect(summary.figure).toEqual(question!.figure);
    expect(JSON.stringify(summary.figure)).not.toContain("0.75");
  });

  it("appends the figure description to the tutor prompt", () => {
    const input: LlmTutorInput = {
      allowedDisclosure: "hint_only",
      currentQuestion: {
        figure: question!.figure,
        prompt: question!.prompt,
        title: question!.title,
      },
      mode: "hint",
      provenanceNote: "Demo context only.",
      retrievedContext: [],
      sessionState: { hintsRevealed: 0, solved: false, stepsRevealed: 0 },
      studentMessage: "How do I read the chart?",
      task: "hint",
    };
    const prompt = buildLlmTutorUserPrompt(input);
    const parsed = JSON.parse(prompt) as {
      current_question: { prompt: string };
    };
    expect(parsed.current_question.prompt).toContain("\n[Figure] Bar chart");
    expect(parsed.current_question.prompt).toContain("2 = 0.35");
  });
});
