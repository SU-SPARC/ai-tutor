import {
  checkTypedAnswer,
  type AnswerSpec,
  type CheckDetail,
} from "@/lib/tutor/answer/spec";
import {
  parseRational,
  rationalFromNumber,
  rationalsEqual,
  rationalToNumber,
  withinTolerance,
  type Rational,
  type RationalParseOptions,
} from "@/lib/tutor/answer/rational";

export type AnswerCheckExpected = {
  spec?: AnswerSpec;
  acceptedAnswers: string[];
  numericValue?: number;
  tolerance?: number;
};

export type AnswerCheckInput = AnswerCheckExpected &
  RationalParseOptions & {
    studentAnswer: string;
  };

export type AnswerCheckResult = {
  outcome: "correct" | "incorrect" | "unreadable";
  detail?: CheckDetail;
  confidence: number;
  feedback: string;
  isCorrect: boolean;
  normalizedExpectedAnswer: string;
  normalizedStudentAnswer: string;
};

const DEFAULT_NUMERIC_TOLERANCE = 0.001;

export function checkAnswer(input: AnswerCheckInput): AnswerCheckResult {
  if (input.spec !== undefined)
    return checkTypedAnswer(input.studentAnswer, input.spec);
  const normalizedStudentAnswer = normalizeAnswerText(input.studentAnswer);
  const normalizedAcceptedAnswers =
    input.acceptedAnswers.map(normalizeAnswerText);
  const normalizedExpectedAnswer = expectedAnswerLabel(input);

  if (!normalizedStudentAnswer) {
    return {
      outcome: "incorrect",
      confidence: 0,
      feedback: "Enter an answer so the tutor can check it.",
      isCorrect: false,
      normalizedExpectedAnswer,
      normalizedStudentAnswer,
    };
  }

  if (normalizedAcceptedAnswers.includes(normalizedStudentAnswer)) {
    return {
      outcome: "correct",
      confidence: 1,
      feedback: "Correct. Your answer matches an accepted answer.",
      isCorrect: true,
      normalizedExpectedAnswer,
      normalizedStudentAnswer,
    };
  }

  const studentValue = parseRational(input.studentAnswer, input);
  const acceptedValues = input.acceptedAnswers.flatMap((answer) => {
    const value = parseRational(answer, input);
    return value ? [value] : [];
  });
  const expectedFromNumericValue = typeof input.numericValue === "number";
  const expectedValue =
    typeof input.numericValue === "number"
      ? rationalFromNumber(input.numericValue)
      : acceptedValues[0];
  const authoredTolerance = input.tolerance ?? DEFAULT_NUMERIC_TOLERANCE;
  // JS doubles need the same precision floor used by publication checks.
  const tolerance = rationalFromNumber(
    expectedFromNumericValue
      ? Math.max(authoredTolerance, 1e-9)
      : authoredTolerance,
  );

  if (studentValue) {
    const studentNumber = rationalToNumber(studentValue);
    const exact =
      acceptedValues.some((value) => rationalsEqual(studentValue, value)) ||
      Boolean(expectedValue && rationalsEqual(studentValue, expectedValue));
    if (
      exact ||
      (expectedValue &&
        tolerance &&
        withinTolerance(studentValue, expectedValue, tolerance))
    ) {
      return {
        outcome: "correct",
        confidence: 0.98,
        feedback: "Correct. Your answer is numerically equivalent.",
        isCorrect: true,
        normalizedExpectedAnswer,
        normalizedStudentAnswer: formatNumber(studentNumber),
      };
    }
    if (expectedValue) {
      return {
        outcome: "incorrect",
        detail: diagnosticDetail(studentValue, expectedValue, tolerance),
        confidence:
          tolerance &&
          withinTolerance(studentValue, expectedValue, {
            n: tolerance.n * BigInt(5),
            d: tolerance.d,
          })
            ? 0.45
            : 0.2,
        feedback:
          "Not quite. The numeric value does not match the expected answer.",
        isCorrect: false,
        normalizedExpectedAnswer,
        normalizedStudentAnswer: formatNumber(studentNumber),
      };
    }
  }

  return {
    outcome:
      !studentValue && (expectedFromNumericValue || acceptedValues.length > 0)
        ? "unreadable"
        : "incorrect",
    confidence: 0.1,
    feedback: "Not quite. The answer does not match the accepted form.",
    isCorrect: false,
    normalizedExpectedAnswer,
    normalizedStudentAnswer,
  };
}

function diagnosticDetail(
  student: Rational,
  expected: Rational,
  tolerance: Rational | undefined,
): AnswerCheckResult["detail"] {
  // Specific relational errors take precedence over generic rounding proximity.
  if (
    rationalsEqual(student, { n: expected.n * BigInt(100), d: expected.d }) ||
    rationalsEqual(student, { n: expected.n, d: expected.d * BigInt(100) })
  )
    return "percent_decimal_confusion";
  if (
    expected.n >= BigInt(0) &&
    expected.n <= expected.d &&
    rationalsEqual(student, { n: expected.d - expected.n, d: expected.d })
  )
    return "complement";
  if (
    tolerance &&
    withinTolerance(student, expected, {
      n: tolerance.n * BigInt(10),
      d: tolerance.d,
    })
  )
    return "close_rounding";
  return undefined;
}

export function normalizeAnswerText(value: string) {
  return stripLatexWrappers(value)
    .toLowerCase()
    .replace(/\\%/g, "%")
    .replace(/\s+/g, "")
    .trim();
}

/** Compatibility number API; parsing now uses the shared exact grammar. */
export function parseAnswerNumber(
  value: string,
  options: RationalParseOptions = {},
): number | undefined {
  const parsed = parseRational(value, options);
  return parsed ? rationalToNumber(parsed) : undefined;
}

function expectedAnswerLabel(input: AnswerCheckExpected) {
  if (input.acceptedAnswers[0]) {
    return normalizeAnswerText(input.acceptedAnswers[0]);
  }

  if (typeof input.numericValue === "number") {
    return formatNumber(input.numericValue);
  }

  return "";
}

function stripLatexWrappers(value: string) {
  let stripped = value.trim();

  const wrapperPatterns = [
    /^\\\(([\s\S]*)\\\)$/,
    /^\\\[([\s\S]*)\\\]$/,
    /^\$\$([\s\S]*)\$\$$/,
    /^\$([\s\S]*)\$$/,
  ];

  for (const pattern of wrapperPatterns) {
    const match = stripped.match(pattern);

    if (match) {
      stripped = match[1].trim();
      break;
    }
  }

  const textMatch = stripped.match(/^\\text\{([\s\S]*)\}$/);
  return textMatch ? textMatch[1].trim() : stripped;
}

function formatNumber(value: number) {
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(12)));
}
