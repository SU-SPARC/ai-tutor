export type AnswerCheckExpected = {
  acceptedAnswers: string[]
  numericValue?: number
  tolerance?: number
}

export type AnswerCheckInput = AnswerCheckExpected & {
  studentAnswer: string
}

export type AnswerCheckResult = {
  confidence: number
  feedback: string
  isCorrect: boolean
  normalizedExpectedAnswer: string
  normalizedStudentAnswer: string
}

const DEFAULT_NUMERIC_TOLERANCE = 0.001

export function checkAnswer(input: AnswerCheckInput): AnswerCheckResult {
  const normalizedStudentAnswer = normalizeAnswerText(input.studentAnswer)
  const normalizedAcceptedAnswers = input.acceptedAnswers.map(normalizeAnswerText)
  const normalizedExpectedAnswer = expectedAnswerLabel(input)

  if (!normalizedStudentAnswer) {
    return {
      confidence: 0,
      feedback: "Enter an answer so the tutor can check it.",
      isCorrect: false,
      normalizedExpectedAnswer,
      normalizedStudentAnswer,
    }
  }

  if (normalizedAcceptedAnswers.includes(normalizedStudentAnswer)) {
    return {
      confidence: 1,
      feedback: "Correct. Your answer matches an accepted answer.",
      isCorrect: true,
      normalizedExpectedAnswer,
      normalizedStudentAnswer,
    }
  }

  const studentNumber = parseAnswerNumber(input.studentAnswer)
  const acceptedNumber = firstParsedNumber(input.acceptedAnswers)
  const expectedNumber =
    typeof input.numericValue === "number" ? input.numericValue : acceptedNumber
  const tolerance = input.tolerance ?? DEFAULT_NUMERIC_TOLERANCE

  if (typeof studentNumber === "number" && typeof expectedNumber === "number") {
    const difference = Math.abs(studentNumber - expectedNumber)

    if (difference <= tolerance) {
      return {
        confidence: 0.98,
        feedback: "Correct. Your answer is numerically equivalent.",
        isCorrect: true,
        normalizedExpectedAnswer,
        normalizedStudentAnswer: formatNumber(studentNumber),
      }
    }

    return {
      confidence: difference <= tolerance * 5 ? 0.45 : 0.2,
      feedback: "Not quite. The numeric value does not match the expected answer.",
      isCorrect: false,
      normalizedExpectedAnswer,
      normalizedStudentAnswer: formatNumber(studentNumber),
    }
  }

  return {
    confidence: 0.1,
    feedback: "Not quite. The answer does not match the accepted form.",
    isCorrect: false,
    normalizedExpectedAnswer,
    normalizedStudentAnswer,
  }
}

export function normalizeAnswerText(value: string) {
  return stripLatexWrappers(value)
    .toLowerCase()
    .replace(/\\%/g, "%")
    .replace(/\s+/g, "")
    .trim()
}

export function parseAnswerNumber(value: string): number | undefined {
  const compact = normalizeAnswerText(value).replaceAll(",", "")
  const latexFraction = compact.match(
    /^\\(?:dfrac|frac|tfrac)\{(-?\d+(?:\.\d+)?)\}\{(-?\d+(?:\.\d+)?)\}$/,
  )

  if (latexFraction) {
    return divide(latexFraction[1], latexFraction[2])
  }

  const fractionMatch = compact.match(
    /^(-?(?:\d+(?:\.\d+)?|\.\d+))\/(-?(?:\d+(?:\.\d+)?|\.\d+))$/,
  )

  if (fractionMatch) {
    return divide(fractionMatch[1], fractionMatch[2])
  }

  const percentMatch = compact.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/)

  if (percentMatch) {
    return Number(percentMatch[1]) / 100
  }

  const numericMatch = compact.match(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/)
  return numericMatch ? Number(numericMatch[0]) : undefined
}

function firstParsedNumber(values: string[]) {
  for (const value of values) {
    const parsed = parseAnswerNumber(value)

    if (typeof parsed === "number") {
      return parsed
    }
  }

  return undefined
}

function expectedAnswerLabel(input: AnswerCheckExpected) {
  if (input.acceptedAnswers[0]) {
    return normalizeAnswerText(input.acceptedAnswers[0])
  }

  if (typeof input.numericValue === "number") {
    return formatNumber(input.numericValue)
  }

  return ""
}

function stripLatexWrappers(value: string) {
  let stripped = value.trim()

  const wrapperPatterns = [
    /^\\\(([\s\S]*)\\\)$/,
    /^\\\[([\s\S]*)\\\]$/,
    /^\$\$([\s\S]*)\$\$$/,
    /^\$([\s\S]*)\$$/,
  ]

  for (const pattern of wrapperPatterns) {
    const match = stripped.match(pattern)

    if (match) {
      stripped = match[1].trim()
      break
    }
  }

  const textMatch = stripped.match(/^\\text\{([\s\S]*)\}$/)
  return textMatch ? textMatch[1].trim() : stripped
}

function divide(numeratorText: string, denominatorText: string) {
  const numerator = Number(numeratorText)
  const denominator = Number(denominatorText)
  return denominator === 0 ? undefined : numerator / denominator
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)))
}
