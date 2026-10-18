import "server-only"

import {
  difficultyLabel,
  sourceLabel,
  studentQuestionTitle,
} from "@/lib/labels"
import { parseRational } from "@/lib/tutor/answer/rational"
import {
  SOURCE_TYPES,
  type Difficulty,
  type SourceType,
  type StudentPracticeQuestion,
  type TutorQuestion,
} from "@/lib/types"

export const DIFFICULTIES: readonly Difficulty[] = [
  "foundational",
  "intermediate",
  "challenge",
]

export type QuestionSummary = StudentPracticeQuestion
export type QuestionDetail = QuestionSummary

const NUMERIC_FORMAT_HINT =
  "Enter a decimal, fraction, or percentage, for example 0.25, 1/4, or 25%."
const DECIMAL_FORMAT_HINT =
  "Enter a decimal or fraction, for example 0.25 or 1/4."
const COUNT_FORMAT_HINT = "Enter a whole number, for example 12."
const CATEGORICAL_FORMAT_HINT = "Type a short response in words."
const FREEFORM_FORMAT_HINT = "Type your response in the box below."

const REQUIRED_FORM_LABELS = {
  decimal: "a decimal",
  fraction: "a fraction",
  integer: "a whole number",
  percent: "a percentage",
  simplified_fraction: "a simplified fraction",
} as const

/**
 * Student-facing guidance on how to type an answer. It describes only the
 * accepted notation for the question's answer rules and never the expected
 * value, so it is safe to send before a tutor session starts.
 */
type AnswerSpecValue = NonNullable<TutorQuestion["answer"]["spec"]>

const CONSTANT_FORMAT_HINT =
  "Enter the exact value, for example 3/4, pi/6, sqrt(2) or inf, or DNE if it does not exist."

/** Notation guidance for the calculus answer kinds; never mentions the answer. */
function calculusFormatHint(spec: AnswerSpecValue): string | undefined {
  switch (spec.kind) {
    case "expression":
      if (spec.variables.length === 0)
        return spec.approximateRelative
          ? "Enter the value; a decimal rounded to the requested accuracy is fine."
          : CONSTANT_FORMAT_HINT
      return `Enter an expression in ${spec.variables.join(" and ")}, for example 3${spec.variables[0]}^2 + sin(${spec.variables[0]}) or sqrt(${spec.variables[0]})/2.`
    case "antiderivative":
      return `Enter an antiderivative in ${spec.variable}${
        spec.constant === "required" ? ", including + C" : "; + C is optional"
      }.`
    case "equation":
      return "Enter an equation, for example y = 2x + 1."
    case "interval":
      return "Enter intervals like (-inf, 2) U (3, inf), or inequalities like x < 2 or x > 3. Write none if there are none."
    case "expression_list":
      return "Enter the values separated by commas, for example x = -1, 2; write points as (a, b); write none if there are none."
    case "dne":
      return CONSTANT_FORMAT_HINT
    case "parts":
      return `Label each part and separate them with semicolons: ${spec.parts
        .map((part) => `(${part.label}) ${part.description ?? "…"}`)
        .join("; ")}.`
    default:
      return undefined
  }
}

export function inputFormatHintFor(
  answer: TutorQuestion["answer"],
): string {
  const spec = answer.spec
  const calculusHint = spec ? calculusFormatHint(spec) : undefined
  if (calculusHint) return calculusHint

  if (spec?.kind === "categorical") {
    return CATEGORICAL_FORMAT_HINT
  }

  if (spec?.kind === "number_list") {
    const count = spec.values.length
    if (spec.labels && spec.labels.length === count) {
      return `Enter ${count} values separated by commas${
        spec.ordered ? ", in this order" : ""
      }: ${spec.labels.join(", ")}.`
    }
    return `Enter ${count} numbers separated by commas.`
  }

  if (spec?.kind === "numeric") {
    const parts: string[] = []
    if (spec.domain === "count") {
      parts.push(COUNT_FORMAT_HINT)
    } else if (spec.percentMode === "decimal") {
      parts.push(DECIMAL_FORMAT_HINT)
    } else {
      parts.push(NUMERIC_FORMAT_HINT)
    }
    if (spec.formPolicy === "require" && spec.requiredForm) {
      parts.push(
        `This question asks for ${REQUIRED_FORM_LABELS[spec.requiredForm]}.`,
      )
    }
    if (spec.unit?.required) {
      parts.push(`Include the unit (${spec.unit.label}).`)
    }
    return parts.join(" ")
  }

  const numeric =
    typeof answer.numericValue === "number" ||
    answer.acceptedAnswers.some(
      (accepted) => parseRational(accepted) !== undefined,
    )
  return numeric ? NUMERIC_FORMAT_HINT : FREEFORM_FORMAT_HINT
}

/**
 * Public list shape. Deliberately omits answers, solution steps, and
 * misconception match terms so a plain listing never leaks solutions.
 */
export function normalizeSummary(question: TutorQuestion): QuestionSummary {
  return {
    id: question.id,
    topicId: question.topicId,
    title: studentQuestionTitle(question.title),
    prompt: question.prompt,
    difficulty: question.difficulty,
    difficultyLabel: difficultyLabel(question.difficulty),
    sourceType: question.source.sourceType,
    sourceLabel: sourceLabel(question.source),
    hintCount: question.hints.length,
    inputFormatHint: inputFormatHintFor(question.answer),
    stepCount: question.solutionSteps.length,
  }
}

/**
 * Public detail is intentionally the same pre-session metadata as the list.
 * Hint bodies, solution steps, answer rules/explanations, and misconception
 * feedback are disclosed only through an owned tutor session as progress
 * permits.
 */
export function normalizeDetail(question: TutorQuestion): QuestionDetail {
  return normalizeSummary(question)
}

export function isValidDifficulty(value: string): value is Difficulty {
  return (DIFFICULTIES as readonly string[]).includes(value)
}

export function isValidSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value)
}

export function matchesSearch(question: TutorQuestion, query: string) {
  const haystack = `${question.title} ${question.prompt}`.toLowerCase()
  return haystack.includes(query.toLowerCase())
}
