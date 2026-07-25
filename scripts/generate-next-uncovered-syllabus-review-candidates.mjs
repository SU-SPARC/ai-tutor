#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const topicsPath = path.join(repoRoot, "data/demo/topics.json")
const previousBatchPaths = [
  path.join(repoRoot, "data/demo/generated-review-candidates.json"),
  path.join(repoRoot, "data/demo/syllabus-review-candidates.json"),
  path.join(repoRoot, "data/demo/next-syllabus-review-candidates.json"),
  path.join(repoRoot, "data/demo/following-syllabus-review-candidates.json"),
]
const outputPath = path.join(
  repoRoot,
  "data/demo/next-uncovered-syllabus-review-candidates.json",
)
const checkOnly = process.argv.includes("--check")

const PREVIOUS_FINAL_TOPIC_ID =
  "moment-generating-functions-joint-distributions"
const EXPECTED_TOPIC_IDS = [
  "independent-random-variables-sums-correlation",
  "chebyshev-law-large-numbers",
  "central-limit-theorem",
]
const ORIGINALITY_NOTE =
  "Original practice draft generated from a project-owned abstract probability pattern with new wording, context, and numbers."

const sumMomentSpecs = [
  {
    id: "sum-mean-two-service-counts",
    title: "Mean of Two Independent Service Counts",
    prompt:
      "Independent random variables X and Y have means 4.2 and 7.8. Find E[X + Y].",
    kind: "sum-mean",
    meanX: 4.2,
    meanY: 7.8,
  },
  {
    id: "sum-variance-two-workloads",
    title: "Variance of Two Independent Workloads",
    prompt:
      "Independent random variables X and Y have variances 3.5 and 2.1. Find Var(X + Y).",
    kind: "sum-variance",
    varianceX: 3.5,
    varianceY: 2.1,
  },
  {
    id: "linear-combination-mean",
    title: "Mean of a Linear Combination",
    prompt:
      "Random variables X and Y have means 5 and 2. Find E[2X - 3Y].",
    kind: "linear-mean",
    coefficientX: 2,
    coefficientY: -3,
    meanX: 5,
    meanY: 2,
  },
  {
    id: "linear-combination-variance",
    title: "Variance of an Independent Linear Combination",
    prompt:
      "Independent random variables X and Y have variances 1.5 and 4. Find Var(2X - Y).",
    kind: "linear-variance",
    coefficientX: 2,
    coefficientY: -1,
    varianceX: 1.5,
    varianceY: 4,
  },
  {
    id: "sum-standard-deviation-three-four",
    title: "Standard Deviation of an Independent Sum",
    prompt:
      "Independent random variables X and Y have standard deviations 3 and 4. Find the standard deviation of X + Y.",
    kind: "sum-standard-deviation",
    standardDeviationX: 3,
    standardDeviationY: 4,
  },
]

const sumDistributionSpecs = [
  {
    id: "poisson-sum-exact-three",
    title: "Exact Count from a Poisson Sum",
    prompt:
      "Independent counts X and Y are Poisson with means 2.3 and 1.7. Find P(X + Y = 3).",
    kind: "poisson",
    lambdaX: 2.3,
    lambdaY: 1.7,
    count: 3,
  },
  {
    id: "binomial-sum-exact-five",
    title: "Exact Count from a Binomial Sum",
    prompt:
      "Independent variables X and Y are Binomial(6, 0.4) and Binomial(9, 0.4). Find P(X + Y = 5).",
    kind: "binomial",
    trialsX: 6,
    trialsY: 9,
    probability: 0.4,
    count: 5,
  },
  {
    id: "normal-sum-below-thirty",
    title: "Normal Sum below a Threshold",
    prompt:
      "Independent normal variables X and Y have means 10 and 15 and variances 4 and 9. Find P(X + Y <= 30).",
    kind: "normal-sum-cdf",
    meanX: 10,
    meanY: 15,
    varianceX: 4,
    varianceY: 9,
    threshold: 30,
  },
  {
    id: "normal-difference-above-fifteen",
    title: "Normal Difference above a Threshold",
    prompt:
      "Independent normal variables X and Y have means 20 and 8 and variances 9 and 4. Find P(X - Y > 15).",
    kind: "normal-difference-tail",
    meanX: 20,
    meanY: 8,
    varianceX: 9,
    varianceY: 4,
    threshold: 15,
  },
  {
    id: "normal-average-below-fifty",
    title: "Average of Two Independent Normal Variables",
    prompt:
      "Independent normal variables X and Y have means 40 and 50 and standard deviations 6 and 8. Let A = (X + Y)/2. Find P(A < 50).",
    kind: "normal-average-cdf",
    meanX: 40,
    meanY: 50,
    standardDeviationX: 6,
    standardDeviationY: 8,
    threshold: 50,
  },
]

const conditionalTables = {
  h: [
    [0.1, 0.15, 0.25],
    [0.2, 0.2, 0.1],
  ],
  i: [
    [0.12, 0.18, 0.1],
    [0.08, 0.22, 0.3],
  ],
  j: [
    [0.05, 0.15, 0.2],
    [0.25, 0.2, 0.15],
  ],
  k: [
    [0.18, 0.12, 0.1],
    [0.12, 0.18, 0.3],
  ],
}

const conditionalDistributionSpecs = [
  {
    id: "conditional-y-two-given-x-zero",
    title: "Conditional Probability from a Three-Column Joint PMF",
    prompt: "Find P(Y = 2 | X = 0).",
    table: conditionalTables.h,
    kind: "probability",
    givenX: 0,
    targetY: 2,
  },
  {
    id: "conditional-mean-y-given-x-one-table-i",
    title: "Conditional Mean from Joint PMF Table I",
    prompt: "Find E[Y | X = 1].",
    table: conditionalTables.i,
    kind: "expectation",
    givenX: 1,
  },
  {
    id: "conditional-y-zero-given-x-one",
    title: "Conditional Probability from Joint PMF Table J",
    prompt: "Find P(Y = 0 | X = 1).",
    table: conditionalTables.j,
    kind: "probability",
    givenX: 1,
    targetY: 0,
  },
  {
    id: "conditional-mean-y-given-x-zero-table-k",
    title: "Conditional Mean from Joint PMF Table K",
    prompt: "Find E[Y | X = 0].",
    table: conditionalTables.k,
    kind: "expectation",
    givenX: 0,
  },
]

const correlationSpecs = [
  {
    id: "correlation-from-positive-covariance",
    title: "Correlation from Positive Covariance",
    prompt:
      "Random variables X and Y have Cov(X,Y) = 6, SD(X) = 3, and SD(Y) = 4. Find Corr(X,Y).",
    kind: "correlation",
    covariance: 6,
    standardDeviationX: 3,
    standardDeviationY: 4,
  },
  {
    id: "correlation-from-negative-covariance",
    title: "Correlation from Negative Covariance",
    prompt:
      "Random variables X and Y have Cov(X,Y) = -4.5, SD(X) = 3, and SD(Y) = 5. Find Corr(X,Y).",
    kind: "correlation",
    covariance: -4.5,
    standardDeviationX: 3,
    standardDeviationY: 5,
  },
  {
    id: "covariance-from-correlation",
    title: "Covariance from Correlation",
    prompt:
      "Random variables X and Y have Corr(X,Y) = 0.25, SD(X) = 2, and SD(Y) = 6. Find Cov(X,Y).",
    kind: "covariance",
    correlation: 0.25,
    standardDeviationX: 2,
    standardDeviationY: 6,
  },
  {
    id: "variance-sum-with-covariance",
    title: "Variance of a Sum with Covariance",
    prompt:
      "Random variables X and Y have variances 4 and 9 and covariance 3. Find Var(X + Y).",
    kind: "sum-variance-with-covariance",
    varianceX: 4,
    varianceY: 9,
    covariance: 3,
  },
  {
    id: "variance-difference-negative-covariance",
    title: "Variance of a Difference with Negative Covariance",
    prompt:
      "Random variables X and Y have variances 16 and 25 and covariance -4. Find Var(X - Y).",
    kind: "difference-variance-with-covariance",
    varianceX: 16,
    varianceY: 25,
    covariance: -4,
  },
  {
    id: "correlation-after-opposite-scaling",
    title: "Correlation after Opposite-Sign Scaling",
    prompt:
      "Suppose Corr(X,Y) = 0.4. Let U = -2X + 5 and V = 3Y - 1. Find Corr(U,V).",
    kind: "transformed-correlation",
    correlation: 0.4,
    coefficientX: -2,
    coefficientY: 3,
  },
]

const chebyshevSpecs = [
  {
    id: "within-two-standard-deviations",
    title: "Chebyshev Bound within Two Standard Deviations",
    prompt:
      "Using Chebyshev's inequality, give the minimum probability that a random variable lies within 2 standard deviations of its mean.",
    boundType: "within",
    variance: 1,
    radius: 2,
  },
  {
    id: "within-three-standard-deviations",
    title: "Chebyshev Bound within Three Standard Deviations",
    prompt:
      "Using Chebyshev's inequality, give the minimum probability that a random variable lies within 3 standard deviations of its mean.",
    boundType: "within",
    variance: 1,
    radius: 3,
  },
  {
    id: "within-one-point-five-standard-deviations",
    title: "Chebyshev Bound within One Point Five Deviations",
    prompt:
      "Using Chebyshev's inequality, give the minimum probability that a random variable lies within 1.5 standard deviations of its mean.",
    boundType: "within",
    variance: 1,
    radius: 1.5,
  },
  {
    id: "within-four-standard-deviations",
    title: "Chebyshev Bound within Four Standard Deviations",
    prompt:
      "Using Chebyshev's inequality, give the minimum probability that a random variable lies within 4 standard deviations of its mean.",
    boundType: "within",
    variance: 1,
    radius: 4,
  },
  {
    id: "within-eight-variance-sixteen",
    title: "Chebyshev Bound with Variance Sixteen",
    prompt:
      "A random variable has mean 30 and variance 16. Use Chebyshev's inequality to bound P(|X - 30| < 8) from below.",
    boundType: "within",
    variance: 16,
    radius: 8,
  },
  {
    id: "within-ten-variance-twenty-five",
    title: "Chebyshev Bound with Variance Twenty-Five",
    prompt:
      "A random variable has mean 12 and variance 25. Use Chebyshev's inequality to bound P(|X - 12| < 10) from below.",
    boundType: "within",
    variance: 25,
    radius: 10,
  },
  {
    id: "within-fifteen-standard-deviation-six",
    title: "Chebyshev Bound with Standard Deviation Six",
    prompt:
      "A random variable has mean 80 and standard deviation 6. Use Chebyshev's inequality to bound P(|X - 80| < 15) from below.",
    boundType: "within",
    variance: 36,
    radius: 15,
  },
  {
    id: "within-six-variance-nine",
    title: "Chebyshev Bound with Variance Nine",
    prompt:
      "A random variable has mean -4 and variance 9. Use Chebyshev's inequality to bound P(|X + 4| < 6) from below.",
    boundType: "within",
    variance: 9,
    radius: 6,
  },
  {
    id: "outside-five-variance-four",
    title: "Chebyshev Upper Bound outside Five Units",
    prompt:
      "A random variable has mean 9 and variance 4. Use Chebyshev's inequality to bound P(|X - 9| >= 5) from above.",
    boundType: "outside",
    variance: 4,
    radius: 5,
  },
  {
    id: "outside-seven-standard-deviation-three",
    title: "Chebyshev Upper Bound outside Seven Units",
    prompt:
      "A random variable has mean 22 and standard deviation 3. Use Chebyshev's inequality to bound P(|X - 22| >= 7) from above.",
    boundType: "outside",
    variance: 9,
    radius: 7,
  },
]

const sampleMeanChebyshevSpecs = [
  {
    id: "sample-mean-bound-variance-thirty-six",
    title: "Sample Mean Bound with One Hundred Observations",
    populationVariance: 36,
    sampleSize: 100,
    distance: 1,
  },
  {
    id: "sample-mean-bound-variance-sixteen",
    title: "Sample Mean Bound with Sixty-Four Observations",
    populationVariance: 16,
    sampleSize: 64,
    distance: 1,
  },
  {
    id: "sample-mean-bound-half-unit",
    title: "Sample Mean Bound within Half a Unit",
    populationVariance: 25,
    sampleSize: 200,
    distance: 0.5,
  },
  {
    id: "sample-mean-bound-standard-deviation-ten",
    title: "Sample Mean Bound with Four Hundred Observations",
    populationVariance: 100,
    sampleSize: 400,
    distance: 1.5,
  },
]

const lawLargeNumbersSpecs = [
  {
    id: "lln-required-n-variance-nine",
    title: "LLN Sample Size with Variance Nine",
    kind: "sample-size",
    variance: 9,
    distance: 0.5,
    errorProbability: 0.1,
  },
  {
    id: "lln-required-n-variance-four",
    title: "LLN Sample Size with Variance Four",
    kind: "sample-size",
    variance: 4,
    distance: 0.25,
    errorProbability: 0.2,
  },
  {
    id: "lln-required-n-bernoulli-point-four",
    title: "LLN Sample Size for a Bernoulli Proportion",
    kind: "sample-size",
    variance: 0.24,
    distance: 0.05,
    errorProbability: 0.1,
  },
  {
    id: "lln-required-n-variance-sixteen",
    title: "LLN Sample Size with Five Percent Error Bound",
    kind: "sample-size",
    variance: 16,
    distance: 1,
    errorProbability: 0.05,
  },
  {
    id: "lln-convergence-sample-average",
    title: "Long-Run Limit of a Sample Average",
    kind: "limit",
    prompt:
      "Independent identically distributed observations have finite mean 7.5. According to the law of large numbers, what value does their sample average approach?",
    limit: 7.5,
  },
  {
    id: "lln-convergence-sample-proportion",
    title: "Long-Run Limit of a Sample Proportion",
    kind: "limit",
    prompt:
      "Independent Bernoulli trials have success probability 0.38. According to the law of large numbers, what value does the sample proportion of successes approach?",
    limit: 0.38,
  },
]

const cltSampleMeanSpecs = [
  {
    id: "sample-mean-below-fifty-three",
    title: "Sample Mean below Fifty-Three",
    mean: 50,
    standardDeviation: 12,
    sampleSize: 36,
    kind: "cdf",
    threshold: 53,
  },
  {
    id: "sample-mean-above-twenty-one-point-five",
    title: "Sample Mean above Twenty-One Point Five",
    mean: 20,
    standardDeviation: 5,
    sampleSize: 25,
    kind: "tail",
    threshold: 21.5,
  },
  {
    id: "sample-mean-between-seventy-eight-eighty-three",
    title: "Sample Mean in an Asymmetric Interval",
    mean: 80,
    standardDeviation: 16,
    sampleSize: 64,
    kind: "between",
    lower: 78,
    upper: 83,
  },
  {
    id: "sample-mean-below-ninety-four",
    title: "Sample Mean below Ninety-Four",
    mean: 100,
    standardDeviation: 30,
    sampleSize: 100,
    kind: "cdf",
    threshold: 94,
  },
  {
    id: "sample-mean-above-seven-point-six",
    title: "Sample Mean above Seven Point Six",
    mean: 7,
    standardDeviation: 2.4,
    sampleSize: 64,
    kind: "tail",
    threshold: 7.6,
  },
  {
    id: "sample-mean-between-one-ninety-two-ten",
    title: "Sample Mean around Two Hundred",
    mean: 200,
    standardDeviation: 40,
    sampleSize: 25,
    kind: "between",
    lower: 190,
    upper: 210,
  },
  {
    id: "sample-mean-below-sixteen",
    title: "Sample Mean below Sixteen",
    mean: 15,
    standardDeviation: 9,
    sampleSize: 81,
    kind: "cdf",
    threshold: 16,
  },
  {
    id: "sample-mean-above-one-twenty-six",
    title: "Sample Mean above One Twenty-Six",
    mean: 120,
    standardDeviation: 18,
    sampleSize: 36,
    kind: "tail",
    threshold: 126,
  },
]

const cltSampleSumSpecs = [
  {
    id: "sample-sum-below-four-thirty",
    title: "Sample Sum below Four Hundred Thirty",
    mean: 4,
    standardDeviation: 2,
    sampleSize: 100,
    kind: "cdf",
    threshold: 430,
  },
  {
    id: "sample-sum-above-six-sixty-four",
    title: "Sample Sum above Six Hundred Sixty-Four",
    mean: 10,
    standardDeviation: 3,
    sampleSize: 64,
    kind: "tail",
    threshold: 664,
  },
  {
    id: "sample-sum-between-eight-sixty-four-nine-thirty-six",
    title: "Sample Sum around Nine Hundred",
    mean: 25,
    standardDeviation: 6,
    sampleSize: 36,
    kind: "between",
    lower: 864,
    upper: 936,
  },
  {
    id: "sample-sum-below-one-fifty-eight",
    title: "Sample Sum below One Hundred Fifty-Eight",
    mean: 1.5,
    standardDeviation: 0.8,
    sampleSize: 100,
    kind: "cdf",
    threshold: 158,
  },
]

const cltProportionSpecs = [
  {
    id: "proportion-below-point-four-five",
    title: "Sample Proportion below Point Four Five",
    probability: 0.4,
    sampleSize: 200,
    kind: "cdf",
    threshold: 0.45,
  },
  {
    id: "proportion-above-point-seven",
    title: "Sample Proportion above Point Seven",
    probability: 0.65,
    sampleSize: 400,
    kind: "tail",
    threshold: 0.7,
  },
  {
    id: "proportion-between-point-two-two-point-two-eight",
    title: "Sample Proportion around One Quarter",
    probability: 0.25,
    sampleSize: 300,
    kind: "between",
    lower: 0.22,
    upper: 0.28,
  },
  {
    id: "proportion-below-point-five-eight",
    title: "Sample Proportion below Point Five Eight",
    probability: 0.5,
    sampleSize: 100,
    kind: "cdf",
    threshold: 0.58,
  },
]

const cltSampleSizeSpecs = [
  {
    id: "sample-size-standard-error-two",
    title: "Sample Size for Standard Error Two",
    kind: "mean",
    standardDeviation: 12,
    maximumStandardError: 2,
  },
  {
    id: "sample-size-standard-error-two-point-five",
    title: "Sample Size for Standard Error Two Point Five",
    kind: "mean",
    standardDeviation: 20,
    maximumStandardError: 2.5,
  },
  {
    id: "sample-size-proportion-worst-case",
    title: "Worst-Case Proportion Standard Error",
    kind: "proportion",
    maximumStandardError: 0.025,
  },
  {
    id: "sample-size-standard-error-one",
    title: "Sample Size for Standard Error One",
    kind: "mean",
    standardDeviation: 15,
    maximumStandardError: 1,
  },
]

function buildCandidates(topicMap) {
  return [
    ...buildIndependentVariableCandidates(topicMap.get(EXPECTED_TOPIC_IDS[0])),
    ...buildChebyshevLlnCandidates(topicMap.get(EXPECTED_TOPIC_IDS[1])),
    ...buildCltCandidates(topicMap.get(EXPECTED_TOPIC_IDS[2])),
  ]
}

function buildIndependentVariableCandidates(topic) {
  return [
    ...sumMomentSpecs.map((spec) => buildSumMomentCandidate(topic, spec)),
    ...sumDistributionSpecs.map((spec) =>
      buildSumDistributionCandidate(topic, spec),
    ),
    ...conditionalDistributionSpecs.map((spec) =>
      buildConditionalDistributionCandidate(topic, spec),
    ),
    ...correlationSpecs.map((spec) => buildCorrelationCandidate(topic, spec)),
  ]
}

function buildSumMomentCandidate(topic, spec) {
  let value
  let steps

  if (spec.kind === "sum-mean") {
    value = spec.meanX + spec.meanY
    steps = [
      "Use linearity: E[X + Y] = E[X] + E[Y].",
      `Substitute ${spec.meanX} + ${spec.meanY}.`,
      `The mean of the sum is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "sum-variance") {
    value = spec.varianceX + spec.varianceY
    steps = [
      "Independence makes the covariance term zero.",
      `Add the variances: ${spec.varianceX} + ${spec.varianceY}.`,
      `The variance of the sum is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "linear-mean") {
    value =
      spec.coefficientX * spec.meanX + spec.coefficientY * spec.meanY
    steps = [
      "Use E[aX + bY] = aE[X] + bE[Y].",
      `Substitute (${spec.coefficientX})(${spec.meanX}) + (${spec.coefficientY})(${spec.meanY}).`,
      `The result is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "linear-variance") {
    value =
      spec.coefficientX ** 2 * spec.varianceX +
      spec.coefficientY ** 2 * spec.varianceY
    steps = [
      "For independent variables, Var(aX + bY) = a^2 Var(X) + b^2 Var(Y).",
      `Substitute (${spec.coefficientX})^2(${spec.varianceX}) + (${spec.coefficientY})^2(${spec.varianceY}).`,
      `The result is ${formatDecimal(value)}.`,
    ]
  } else {
    const variance =
      spec.standardDeviationX ** 2 + spec.standardDeviationY ** 2
    value = Math.sqrt(variance)
    steps = [
      "For an independent sum, add variances rather than standard deviations.",
      `The sum variance is ${spec.standardDeviationX}^2 + ${spec.standardDeviationY}^2 = ${formatDecimal(variance)}.`,
      `Taking the square root gives standard deviation ${formatDecimal(value)}.`,
    ]
  }

  return candidate(topic, {
    ...spec,
    answer: numericAnswer(value),
    difficulty:
      spec.kind === "sum-mean" || spec.kind === "sum-variance"
        ? "foundational"
        : "intermediate",
    patternSource: "independent-variable moment-combination pattern",
    hints: [
      "Apply linearity for means and squared coefficients for variances.",
      "Use independence to remove covariance terms when computing variance.",
    ],
    solutionSteps: steps,
    misconception: misconception(
      "adds-standard-deviations-or-unsquared-scales",
      "Variances add for independent sums, and scaling coefficients must be squared in a variance calculation.",
    ),
  })
}

function buildSumDistributionCandidate(topic, spec) {
  let value
  let steps

  if (spec.kind === "poisson") {
    const lambda = spec.lambdaX + spec.lambdaY
    value =
      (Math.exp(-lambda) * lambda ** spec.count) / factorial(spec.count)
    steps = [
      `The independent Poisson sum has mean ${spec.lambdaX} + ${spec.lambdaY} = ${lambda}.`,
      `Use P(S = ${spec.count}) = exp(-${lambda})${lambda}^${spec.count}/${spec.count}!.`,
      `The probability is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "binomial") {
    const trials = spec.trialsX + spec.trialsY
    value =
      combination(trials, spec.count) *
      spec.probability ** spec.count *
      (1 - spec.probability) ** (trials - spec.count)
    steps = [
      `The independent binomial variables share p, so their sum is Binomial(${trials}, ${spec.probability}).`,
      `Use C(${trials},${spec.count})(${spec.probability})^${spec.count}(${formatDecimal(1 - spec.probability)})^${trials - spec.count}.`,
      `The probability is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "normal-sum-cdf") {
    const mean = spec.meanX + spec.meanY
    const standardDeviation = Math.sqrt(spec.varianceX + spec.varianceY)
    const z = (spec.threshold - mean) / standardDeviation
    value = normalCdf(z)
    steps = [
      `The sum is normal with mean ${mean} and variance ${spec.varianceX + spec.varianceY}.`,
      `Standardize ${spec.threshold}: z = (${spec.threshold} - ${mean})/${formatDecimal(standardDeviation)} = ${formatDecimal(z)}.`,
      `The lower-tail probability is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "normal-difference-tail") {
    const mean = spec.meanX - spec.meanY
    const standardDeviation = Math.sqrt(spec.varianceX + spec.varianceY)
    const z = (spec.threshold - mean) / standardDeviation
    value = 1 - normalCdf(z)
    steps = [
      `The difference is normal with mean ${mean} and variance ${spec.varianceX + spec.varianceY}.`,
      `Standardize ${spec.threshold}: z = (${spec.threshold} - ${mean})/${formatDecimal(standardDeviation)} = ${formatDecimal(z)}.`,
      `The upper-tail probability is ${formatDecimal(value)}.`,
    ]
  } else {
    const mean = (spec.meanX + spec.meanY) / 2
    const variance =
      (spec.standardDeviationX ** 2 + spec.standardDeviationY ** 2) / 4
    const standardDeviation = Math.sqrt(variance)
    const z = (spec.threshold - mean) / standardDeviation
    value = normalCdf(z)
    steps = [
      `The average is normal with mean ${mean} and variance ${formatDecimal(variance)}.`,
      `Its standard deviation is ${formatDecimal(standardDeviation)}, so z = ${formatDecimal(z)} at ${spec.threshold}.`,
      `The lower-tail probability is ${formatDecimal(value)}.`,
    ]
  }

  return candidate(topic, {
    ...spec,
    answer: probabilityAnswer(value),
    difficulty: "challenge",
    patternSource: "independent-sum distribution pattern",
    hints: [
      "First identify the distribution and parameters of the sum, difference, or average.",
      "Then evaluate the requested probability in that combined distribution.",
    ],
    solutionSteps: steps,
    misconception: misconception(
      "combines-distribution-parameters-incorrectly",
      "Independent sums combine means and variances; standard deviations are not added directly.",
    ),
  })
}

function buildConditionalDistributionCandidate(topic, spec) {
  const row = spec.table[spec.givenX]
  const rowTotal = row.reduce((sum, probability) => sum + probability, 0)
  let value
  let steps

  if (spec.kind === "probability") {
    const joint = row[spec.targetY]
    value = joint / rowTotal
    steps = [
      `The joint numerator is ${formatDecimal(joint)}.`,
      `The marginal P(X = ${spec.givenX}) is ${formatDecimal(rowTotal)}.`,
      `The conditional probability is ${formatDecimal(joint)}/${formatDecimal(rowTotal)} = ${formatDecimal(value)}.`,
    ]
  } else {
    const weightedSum = row.reduce(
      (sum, probability, y) => sum + y * probability,
      0,
    )
    value = weightedSum / rowTotal
    steps = [
      `Conditioning on X = ${spec.givenX} gives row total ${formatDecimal(rowTotal)}.`,
      `The joint weighted sum across Y = 0, 1, 2 is ${formatDecimal(weightedSum)}.`,
      `Divide to obtain E[Y | X = ${spec.givenX}] = ${formatDecimal(value)}.`,
    ]
  }

  return candidate(topic, {
    ...spec,
    prompt:
      `X in {0,1} and Y in {0,1,2} have joint PMF ${renderConditionalTable(spec.table)}. ` +
      spec.prompt,
    answer:
      spec.kind === "probability"
        ? probabilityAnswer(value)
        : numericAnswer(value),
    difficulty: spec.kind === "probability" ? "intermediate" : "challenge",
    patternSource: "conditional-distribution from joint-PMF pattern",
    hints: [
      "Restrict the joint table to the row named by the conditioning event.",
      "Normalize that row before finding a probability or conditional mean.",
    ],
    solutionSteps: steps,
    misconception: misconception(
      "uses-unnormalized-joint-row",
      "A conditional distribution must divide the selected joint row by its marginal row total.",
    ),
  })
}

function buildCorrelationCandidate(topic, spec) {
  let value
  let steps

  if (spec.kind === "correlation") {
    value =
      spec.covariance /
      (spec.standardDeviationX * spec.standardDeviationY)
    steps = [
      "Use Corr(X,Y) = Cov(X,Y)/(SD(X)SD(Y)).",
      `Substitute ${spec.covariance}/(${spec.standardDeviationX} times ${spec.standardDeviationY}).`,
      `The correlation is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "covariance") {
    value =
      spec.correlation *
      spec.standardDeviationX *
      spec.standardDeviationY
    steps = [
      "Rearrange to Cov(X,Y) = Corr(X,Y)SD(X)SD(Y).",
      `Substitute (${spec.correlation})(${spec.standardDeviationX})(${spec.standardDeviationY}).`,
      `The covariance is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "sum-variance-with-covariance") {
    value = spec.varianceX + spec.varianceY + 2 * spec.covariance
    steps = [
      "Use Var(X + Y) = Var(X) + Var(Y) + 2Cov(X,Y).",
      `Substitute ${spec.varianceX} + ${spec.varianceY} + 2(${spec.covariance}).`,
      `The variance is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "difference-variance-with-covariance") {
    value = spec.varianceX + spec.varianceY - 2 * spec.covariance
    steps = [
      "Use Var(X - Y) = Var(X) + Var(Y) - 2Cov(X,Y).",
      `Substitute ${spec.varianceX} + ${spec.varianceY} - 2(${spec.covariance}).`,
      `The variance is ${formatDecimal(value)}.`,
    ]
  } else {
    value =
      Math.sign(spec.coefficientX * spec.coefficientY) * spec.correlation
    steps = [
      "Additive shifts do not change correlation.",
      "Scaling both variables changes only the sign when the scale factors have opposite signs.",
      `Because ${spec.coefficientX} and ${spec.coefficientY} have opposite signs, Corr(U,V) = ${formatDecimal(value)}.`,
    ]
  }

  return candidate(topic, {
    ...spec,
    answer: numericAnswer(value),
    difficulty:
      spec.kind === "correlation" || spec.kind === "covariance"
        ? "intermediate"
        : "challenge",
    patternSource: "covariance-correlation identity pattern",
    hints: [
      "Choose the covariance, correlation, or variance identity that matches the request.",
      "Keep the sign of covariance and any scale factors throughout the calculation.",
    ],
    solutionSteps: steps,
    misconception: misconception(
      "drops-covariance-or-scale-sign",
      "Dependence calculations must retain covariance terms and the signs of transformation coefficients.",
    ),
  })
}

function buildChebyshevLlnCandidates(topic) {
  return [
    ...chebyshevSpecs.map((spec) => {
      const outsideBound = spec.variance / spec.radius ** 2
      const value =
        spec.boundType === "within" ? 1 - outsideBound : outsideBound
      return candidate(topic, {
        ...spec,
        answer: probabilityAnswer(value),
        difficulty:
          spec.variance === 1 ? "foundational" : "intermediate",
        patternSource: "Chebyshev probability-bound pattern",
        hints: [
          "Chebyshev gives P(|X - mean| >= a) <= variance/a^2.",
          "For an inside probability, subtract the outside bound from 1.",
        ],
        solutionSteps: [
          `The outside bound is ${formatDecimal(spec.variance)}/${formatDecimal(spec.radius)}^2 = ${formatDecimal(outsideBound)}.`,
          spec.boundType === "within"
            ? "Convert the outside upper bound to an inside lower bound by subtracting from 1."
            : "The requested event is already the outside event.",
          `${spec.boundType === "within" ? "The lower" : "The upper"} bound is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "reverses-chebyshev-bound-direction",
          "Chebyshev gives an upper bound outside the interval and a lower bound inside it.",
        ),
      })
    }),
    ...sampleMeanChebyshevSpecs.map((spec) => {
      const value =
        spec.populationVariance /
        (spec.sampleSize * spec.distance ** 2)
      return candidate(topic, {
        ...spec,
        prompt:
          `Independent observations have population variance ${spec.populationVariance}. For a sample of size ${spec.sampleSize}, use Chebyshev's inequality to bound ` +
          `P(|sample mean - population mean| >= ${spec.distance}) from above.`,
        answer: probabilityAnswer(value),
        difficulty: "intermediate",
        patternSource: "Chebyshev sample-mean bound pattern",
        hints: [
          "The sample mean variance is the population variance divided by n.",
          "Apply Chebyshev using the requested distance from the mean.",
        ],
        solutionSteps: [
          `Var(sample mean) = ${spec.populationVariance}/${spec.sampleSize} = ${formatDecimal(spec.populationVariance / spec.sampleSize)}.`,
          `The bound is Var(sample mean)/${spec.distance}^2.`,
          `The upper bound is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "uses-population-variance-for-sample-mean",
          "The sample mean variance is population variance divided by sample size.",
        ),
      })
    }),
    ...lawLargeNumbersSpecs.map((spec) =>
      buildLawLargeNumbersCandidate(topic, spec),
    ),
  ]
}

function buildLawLargeNumbersCandidate(topic, spec) {
  if (spec.kind === "limit") {
    return candidate(topic, {
      ...spec,
      answer: numericAnswer(spec.limit),
      difficulty: "foundational",
      patternSource: "law-of-large-numbers convergence-target pattern",
      hints: [
        "The law of large numbers centers the sample average at the population mean.",
        "For Bernoulli trials, the population mean equals the success probability.",
      ],
      solutionSteps: [
        "Identify the population mean of one observation.",
        "The law of large numbers says the sample average or proportion approaches that mean.",
        `The limiting value is ${formatDecimal(spec.limit)}.`,
      ],
      misconception: misconception(
        "expects-convergence-to-zero",
        "A sample average converges to the population mean, not automatically to zero.",
      ),
    })
  }

  const rawSampleSize =
    spec.variance / (spec.errorProbability * spec.distance ** 2)
  const value = Math.ceil(rawSampleSize - 1e-12)
  return candidate(topic, {
    ...spec,
    prompt:
      `Independent observations have variance ${spec.variance}. Use the Chebyshev form of the law of large numbers to find the smallest integer n that guarantees ` +
      `P(|sample mean - population mean| >= ${spec.distance}) <= ${spec.errorProbability}.`,
    answer: numericAnswer(value),
    difficulty: "challenge",
    patternSource: "law-of-large-numbers sample-size guarantee pattern",
    hints: [
      "Use variance/(n times distance squared) as the Chebyshev upper bound.",
      "Solve the inequality for n and round up to an integer.",
    ],
    solutionSteps: [
      `Require ${spec.variance}/(n times ${spec.distance}^2) <= ${spec.errorProbability}.`,
      `This gives n >= ${formatDecimal(rawSampleSize)}.`,
      `The smallest integer sample size is ${value}.`,
    ],
    misconception: misconception(
      "rounds-sample-size-down",
      "A guaranteed sample-size inequality must be rounded up, not down.",
    ),
  })
}

function buildCltCandidates(topic) {
  return [
    ...cltSampleMeanSpecs.map((spec) =>
      buildCltLocationCandidate(topic, spec, "mean"),
    ),
    ...cltSampleSumSpecs.map((spec) =>
      buildCltLocationCandidate(topic, spec, "sum"),
    ),
    ...cltProportionSpecs.map((spec) =>
      buildCltProportionCandidate(topic, spec),
    ),
    ...cltSampleSizeSpecs.map((spec) =>
      buildCltSampleSizeCandidate(topic, spec),
    ),
  ]
}

function buildCltLocationCandidate(topic, spec, mode) {
  const center = mode === "mean" ? spec.mean : spec.sampleSize * spec.mean
  const standardError =
    mode === "mean"
      ? spec.standardDeviation / Math.sqrt(spec.sampleSize)
      : spec.standardDeviation * Math.sqrt(spec.sampleSize)
  const symbol = mode === "mean" ? "sample mean" : "sample sum"
  let value
  let probabilityStep
  let eventText

  if (spec.kind === "cdf") {
    const z = (spec.threshold - center) / standardError
    value = normalCdf(z)
    probabilityStep = `z = (${spec.threshold} - ${formatDecimal(center)})/${formatDecimal(standardError)} = ${formatDecimal(z)}`
    eventText = `${symbol} <= ${spec.threshold}`
  } else if (spec.kind === "tail") {
    const z = (spec.threshold - center) / standardError
    value = 1 - normalCdf(z)
    probabilityStep = `z = (${spec.threshold} - ${formatDecimal(center)})/${formatDecimal(standardError)} = ${formatDecimal(z)}`
    eventText = `${symbol} > ${spec.threshold}`
  } else {
    const lowerZ = (spec.lower - center) / standardError
    const upperZ = (spec.upper - center) / standardError
    value = normalCdf(upperZ) - normalCdf(lowerZ)
    probabilityStep = `the z-boundaries are ${formatDecimal(lowerZ)} and ${formatDecimal(upperZ)}`
    eventText = `${spec.lower} <= ${symbol} <= ${spec.upper}`
  }

  return candidate(topic, {
    ...spec,
    prompt:
      `A population has mean ${spec.mean} and standard deviation ${spec.standardDeviation}. For an independent sample of size ${spec.sampleSize}, use the central limit theorem to approximate P(${eventText}).`,
    answer: probabilityAnswer(value),
    difficulty: spec.kind === "between" ? "challenge" : "intermediate",
    patternSource: `CLT sample-${mode} normal-approximation pattern`,
    hints: [
      mode === "mean"
        ? "The sample mean has standard error population SD divided by square root of n."
        : "The sample sum has mean n times the population mean and SD square root of n times the population SD.",
      "Standardize the requested boundary or boundaries and use the normal CDF.",
    ],
    solutionSteps: [
      `The approximate ${symbol} distribution has center ${formatDecimal(center)} and standard deviation ${formatDecimal(standardError)}.`,
      `After standardizing, ${probabilityStep}.`,
      `The approximate probability is ${formatDecimal(value)}.`,
    ],
    misconception: misconception(
      mode === "mean"
        ? "uses-population-sd-for-sample-mean"
        : "uses-mean-standard-error-for-sum",
      mode === "mean"
        ? "The sample mean standard error divides the population standard deviation by square root of n."
        : "A sample sum multiplies the population standard deviation by square root of n.",
    ),
  })
}

function buildCltProportionCandidate(topic, spec) {
  const standardError = Math.sqrt(
    (spec.probability * (1 - spec.probability)) / spec.sampleSize,
  )
  let value
  let eventText
  let probabilityStep

  if (spec.kind === "cdf") {
    const z = (spec.threshold - spec.probability) / standardError
    value = normalCdf(z)
    eventText = `sample proportion <= ${spec.threshold}`
    probabilityStep = `z = (${spec.threshold} - ${spec.probability})/${formatDecimal(standardError)} = ${formatDecimal(z)}`
  } else if (spec.kind === "tail") {
    const z = (spec.threshold - spec.probability) / standardError
    value = 1 - normalCdf(z)
    eventText = `sample proportion > ${spec.threshold}`
    probabilityStep = `z = (${spec.threshold} - ${spec.probability})/${formatDecimal(standardError)} = ${formatDecimal(z)}`
  } else {
    const lowerZ = (spec.lower - spec.probability) / standardError
    const upperZ = (spec.upper - spec.probability) / standardError
    value = normalCdf(upperZ) - normalCdf(lowerZ)
    eventText = `${spec.lower} <= sample proportion <= ${spec.upper}`
    probabilityStep = `the z-boundaries are ${formatDecimal(lowerZ)} and ${formatDecimal(upperZ)}`
  }

  return candidate(topic, {
    ...spec,
    prompt:
      `Independent Bernoulli trials have success probability ${spec.probability}. For n = ${spec.sampleSize}, use a normal approximation to find P(${eventText}).`,
    answer: probabilityAnswer(value),
    difficulty: spec.kind === "between" ? "challenge" : "intermediate",
    patternSource: "CLT sample-proportion normal-approximation pattern",
    hints: [
      "Center the sample proportion at p.",
      "Its standard error is sqrt(p(1-p)/n).",
    ],
    solutionSteps: [
      `The sample proportion has approximate mean ${spec.probability} and standard error ${formatDecimal(standardError)}.`,
      `After standardizing, ${probabilityStep}.`,
      `The approximate probability is ${formatDecimal(value)}.`,
    ],
    misconception: misconception(
      "uses-count-standard-deviation-for-proportion",
      "A sample proportion uses standard error sqrt(p(1-p)/n), not sqrt(np(1-p)).",
    ),
  })
}

function buildCltSampleSizeCandidate(topic, spec) {
  const rawSampleSize =
    spec.kind === "mean"
      ? (spec.standardDeviation / spec.maximumStandardError) ** 2
      : 0.25 / spec.maximumStandardError ** 2
  const value = Math.ceil(rawSampleSize - 1e-12)
  const prompt =
    spec.kind === "mean"
      ? `A population has standard deviation ${spec.standardDeviation}. Find the smallest integer sample size that makes the standard error of the sample mean at most ${spec.maximumStandardError}.`
      : `Without a prior value of p, find the smallest integer sample size that makes the worst-case standard error of a sample proportion at most ${spec.maximumStandardError}.`

  return candidate(topic, {
    ...spec,
    prompt,
    answer: numericAnswer(value),
    difficulty: "challenge",
    patternSource: "CLT standard-error sample-size pattern",
    hints: [
      spec.kind === "mean"
        ? "Use standard error = population SD divided by square root of n."
        : "For a worst-case proportion standard error, use p(1-p) <= 0.25.",
      "Solve for n and round up to preserve the requested maximum.",
    ],
    solutionSteps: [
      spec.kind === "mean"
        ? `Require ${spec.standardDeviation}/sqrt(n) <= ${spec.maximumStandardError}.`
        : `Require sqrt(0.25/n) <= ${spec.maximumStandardError}.`,
      `Solving gives n >= ${formatDecimal(rawSampleSize)}.`,
      `The smallest integer sample size is ${value}.`,
    ],
    misconception: misconception(
      "rounds-standard-error-sample-size-down",
      "Round a required sample size up so the standard error does not exceed the target.",
    ),
  })
}

function candidate(topic, spec) {
  if (!topic) {
    throw new Error("Cannot build a candidate without a syllabus topic.")
  }

  return {
    id: `generated-uncovered-${spec.id}`,
    topicId: topic.id,
    topic: topic.title,
    title: `${spec.title} Draft`,
    prompt: spec.prompt,
    patternSource: spec.patternSource,
    difficulty: spec.difficulty,
    answer: {
      ...spec.answer,
      explanation: spec.solutionSteps.at(-1),
    },
    hints: spec.hints,
    solutionSteps: spec.solutionSteps,
    misconceptions: [spec.misconception],
    source: {
      sourceType: "pattern_derived_original",
      trustLevel: "generated_unverified",
      visibility: "public",
      originalityNote: ORIGINALITY_NOTE,
    },
    review: {
      status: "needs_review",
    },
  }
}

function misconception(id, feedback) {
  return { feedback, id, matchTerms: [] }
}

function probabilityAnswer(value) {
  return {
    acceptedAnswers: [
      formatDecimal(value),
      `${formatDecimal(value * 100, 2)}%`,
    ],
    numericValue: value,
    tolerance: 0.001,
  }
}

function numericAnswer(value) {
  return {
    acceptedAnswers: [formatDecimal(value)],
    numericValue: value,
    tolerance: 0.001,
  }
}

function renderConditionalTable(table) {
  return (
    `{P(0,0)=${table[0][0]}, P(0,1)=${table[0][1]}, P(0,2)=${table[0][2]}, ` +
    `P(1,0)=${table[1][0]}, P(1,1)=${table[1][1]}, P(1,2)=${table[1][2]}}`
  )
}

function combination(n, k) {
  if (k < 0 || k > n) return 0
  const smaller = Math.min(k, n - k)
  let result = 1
  for (let index = 1; index <= smaller; index += 1) {
    result = (result * (n - smaller + index)) / index
  }
  return result
}

function factorial(value) {
  let result = 1
  for (let index = 2; index <= value; index += 1) {
    result *= index
  }
  return result
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)))
}

function erf(value) {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * x)
  const approximation =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x)
  return sign * approximation
}

function formatDecimal(value, digits = 6) {
  return Number(value.toFixed(digits)).toString()
}

function validateTopicSequence(topics) {
  const activeTopics = topics
    .filter((topic) => topic.active)
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    )
  const previousIndex = activeTopics.findIndex(
    (topic) => topic.id === PREVIOUS_FINAL_TOPIC_ID,
  )
  const selected = activeTopics.slice(previousIndex + 1, previousIndex + 4)

  if (
    previousIndex < 0 ||
    selected.length !== EXPECTED_TOPIC_IDS.length ||
    selected.some((topic, index) => topic.id !== EXPECTED_TOPIC_IDS[index])
  ) {
    throw new Error(
      `Expected the next uncovered syllabus topics to be ${EXPECTED_TOPIC_IDS.join(", ")}; received ${selected.map((topic) => topic.id).join(", ")}.`,
    )
  }

  return new Map(selected.map((topic) => [topic.id, topic]))
}

function validateSpecificationInputs() {
  for (const [name, table] of Object.entries(conditionalTables)) {
    const probabilities = table.flat()
    const total = probabilities.reduce((sum, value) => sum + value, 0)
    if (
      probabilities.some((value) => value < 0 || value > 1) ||
      Math.abs(total - 1) > 1e-12
    ) {
      throw new Error(`Conditional-distribution table ${name} is invalid.`)
    }
  }

  for (const spec of cltProportionSpecs) {
    if (
      spec.sampleSize * spec.probability < 5 ||
      spec.sampleSize * (1 - spec.probability) < 5
    ) {
      throw new Error(`CLT proportion conditions fail for ${spec.id}.`)
    }
  }

  for (const spec of chebyshevSpecs) {
    if (spec.radius ** 2 <= spec.variance && spec.boundType === "within") {
      throw new Error(`Chebyshev inside bound is nonpositive for ${spec.id}.`)
    }
  }
}

function validateCandidates(candidates, topicMap, previousBatches) {
  if (candidates.length !== 60) {
    throw new Error(
      `Expected exactly 60 candidates; received ${candidates.length}.`,
    )
  }

  const ids = new Set()
  const prompts = new Set()
  const previousIds = new Set(previousBatches.map((item) => item.id))
  const previousPrompts = new Set(previousBatches.map((item) => item.prompt))

  for (const topicId of EXPECTED_TOPIC_IDS) {
    const topic = topicMap.get(topicId)
    const topicCandidates = candidates.filter(
      (candidateItem) => candidateItem.topicId === topicId,
    )
    if (topicCandidates.length !== 20) {
      throw new Error(
        `Expected 20 candidates for ${topicId}; received ${topicCandidates.length}.`,
      )
    }
    if (
      topicCandidates.some(
        (candidateItem) => candidateItem.topic !== topic.title,
      )
    ) {
      throw new Error(`Candidate topic titles do not match ${topicId}.`)
    }
  }

  for (const candidateItem of candidates) {
    if (ids.has(candidateItem.id) || previousIds.has(candidateItem.id)) {
      throw new Error(`Duplicate generated question id: ${candidateItem.id}`)
    }
    if (
      prompts.has(candidateItem.prompt) ||
      previousPrompts.has(candidateItem.prompt)
    ) {
      throw new Error(`Duplicate generated prompt: ${candidateItem.id}`)
    }
    ids.add(candidateItem.id)
    prompts.add(candidateItem.prompt)

    if (
      candidateItem.review.status !== "needs_review" ||
      candidateItem.source.trustLevel !== "generated_unverified" ||
      candidateItem.source.sourceType !== "pattern_derived_original" ||
      candidateItem.source.visibility !== "public"
    ) {
      throw new Error(`Unsafe review metadata on ${candidateItem.id}.`)
    }
    if (
      !candidateItem.patternSource ||
      !candidateItem.source.originalityNote ||
      candidateItem.answer.acceptedAnswers.length === 0 ||
      candidateItem.hints.length < 2 ||
      candidateItem.solutionSteps.length < 3 ||
      candidateItem.misconceptions.length === 0
    ) {
      throw new Error(`Incomplete review candidate: ${candidateItem.id}.`)
    }
  }

  const serialized = JSON.stringify(candidates)
  if (
    /"patternIds"|"sourceItemIds"|"sourceNumberSets"|"sourceStoryFamilies"|"privatePhraseHashes"|"rawText"|"extractedText"|"locator"/i.test(
      serialized,
    )
  ) {
    throw new Error(
      "Generated candidates include forbidden private-source metadata.",
    )
  }
}

async function main() {
  const [topics, ...previousBatches] = await Promise.all([
    readFile(topicsPath, "utf8").then(JSON.parse),
    ...previousBatchPaths.map((batchPath) =>
      readFile(batchPath, "utf8").then(JSON.parse),
    ),
  ])
  validateSpecificationInputs()
  const topicMap = validateTopicSequence(topics)
  const candidates = buildCandidates(topicMap)
  validateCandidates(candidates, topicMap, previousBatches.flat())
  const output = `${JSON.stringify(candidates, null, 2)}\n`

  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8")
    if (existing !== output) {
      throw new Error(
        "Next-uncovered syllabus review candidates are stale. Run npm run prepare:next-uncovered-syllabus-questions.",
      )
    }
    console.log(
      "Next-uncovered syllabus review candidates are current: 60 total, 20 per topic.",
    )
    return
  }

  await writeFile(outputPath, output)
  console.log(
    "Generated 60 review-gated candidates for syllabus Weeks 11, 12, and 13.",
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
