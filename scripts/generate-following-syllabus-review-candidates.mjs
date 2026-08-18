#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCanonicalSyllabusTopics } from "./lib/canonical-syllabus-topics.mjs"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const previousBatchPaths = [
  path.join(repoRoot, "data/demo/syllabus-review-candidates.json"),
  path.join(repoRoot, "data/demo/next-syllabus-review-candidates.json"),
]
const outputPath = path.join(
  repoRoot,
  "data/demo/following-syllabus-review-candidates.json",
)
const checkOnly = process.argv.includes("--check")

const canonicalTopics = await loadCanonicalSyllabusTopics(repoRoot)
const PREVIOUS_FINAL_TOPIC_ID = canonicalTopics.find(
  ({ order }) => order === 5,
)?.id
const EXPECTED_TOPIC_IDS = canonicalTopics
  .filter(({ order }) => [8, 9, 10].includes(order))
  .map(({ id }) => id)
const ORIGINALITY_NOTE =
  "Original practice draft generated from a project-owned abstract probability pattern with new wording, context, and numbers."

const uniformIntervalSpecs = [
  {
    id: "uniform-transit-window",
    title: "Transit Window Interval",
    prompt:
      "A shuttle's arrival offset X is modeled as uniform from 2 to 14 minutes. What is P(5 <= X <= 9)?",
    minimum: 2,
    maximum: 14,
    lower: 5,
    upper: 9,
  },
  {
    id: "uniform-queue-tail",
    title: "Queue Duration Tail",
    prompt:
      "A service queue duration X is uniformly distributed from 6 to 26 minutes. What is P(X > 18)?",
    minimum: 6,
    maximum: 26,
    lower: 18,
    upper: 26,
  },
  {
    id: "uniform-calibration-band",
    title: "Calibration Offset Band",
    prompt:
      "A calibration offset X is uniform on the interval from -3 to 5 units. What is P(-1 < X < 2)?",
    minimum: -3,
    maximum: 5,
    lower: -1,
    upper: 2,
  },
  {
    id: "uniform-cycle-threshold",
    title: "Cycle Point Threshold",
    prompt:
      "A cycle point X is uniformly distributed from 10 to 34 seconds. What is P(X <= 16)?",
    minimum: 10,
    maximum: 34,
    lower: 10,
    upper: 16,
  },
]

const densityNormalizationSpecs = [
  {
    id: "density-normalize-four",
    title: "Normalize a Linear Density on Four Units",
    prompt:
      "A continuous random variable has density f(x) = c x for 0 <= x <= 4 and f(x) = 0 otherwise. Find c.",
    endpoint: 4,
  },
  {
    id: "density-normalize-five",
    title: "Normalize a Linear Density on Five Units",
    prompt:
      "A continuous random variable has density f(x) = c x for 0 <= x <= 5 and f(x) = 0 otherwise. Find c.",
    endpoint: 5,
  },
  {
    id: "density-normalize-six",
    title: "Normalize a Linear Density on Six Units",
    prompt:
      "A continuous random variable has density f(x) = c x for 0 <= x <= 6 and f(x) = 0 otherwise. Find c.",
    endpoint: 6,
  },
  {
    id: "density-normalize-eight",
    title: "Normalize a Linear Density on Eight Units",
    prompt:
      "A continuous random variable has density f(x) = c x for 0 <= x <= 8 and f(x) = 0 otherwise. Find c.",
    endpoint: 8,
  },
]

const cdfIntervalSpecs = [
  {
    id: "cdf-square-zero-four",
    title: "Quadratic CDF Interval from One to Three",
    start: 0,
    width: 4,
    lower: 1,
    upper: 3,
  },
  {
    id: "cdf-square-two-eight",
    title: "Quadratic CDF Interval from Three to Five",
    start: 2,
    width: 6,
    lower: 3,
    upper: 5,
  },
  {
    id: "cdf-square-negative-one-four",
    title: "Quadratic CDF Interval from Zero to Two",
    start: -1,
    width: 5,
    lower: 0,
    upper: 2,
  },
  {
    id: "cdf-square-one-four",
    title: "Quadratic CDF Interval from One Point Five to Three",
    start: 1,
    width: 3,
    lower: 1.5,
    upper: 3,
  },
]

const uniformMomentSpecs = [
  {
    id: "uniform-mean-negative-two-ten",
    title: "Uniform Mean on a Twelve-Unit Range",
    minimum: -2,
    maximum: 10,
    metric: "mean",
  },
  {
    id: "uniform-variance-three-fifteen",
    title: "Uniform Variance from Three to Fifteen",
    minimum: 3,
    maximum: 15,
    metric: "variance",
  },
  {
    id: "uniform-mean-eight-twenty",
    title: "Uniform Mean from Eight to Twenty",
    minimum: 8,
    maximum: 20,
    metric: "mean",
  },
  {
    id: "uniform-variance-negative-five-seven",
    title: "Uniform Variance from Negative Five to Seven",
    minimum: -5,
    maximum: 7,
    metric: "variance",
  },
]

const exponentialSpecs = [
  {
    id: "exponential-tail-rate-point-four",
    title: "Exponential Tail after Five Units",
    prompt:
      "A waiting time X follows an exponential distribution with rate 0.4 per minute. Find P(X > 5).",
    kind: "tail",
    rate: 0.4,
    time: 5,
  },
  {
    id: "exponential-cdf-rate-point-two-five",
    title: "Exponential CDF by Six Units",
    prompt:
      "A component lifetime X follows an exponential distribution with rate 0.25 per hour. Find P(X <= 6).",
    kind: "cdf",
    rate: 0.25,
    time: 6,
  },
  {
    id: "exponential-between-rate-point-three",
    title: "Exponential Probability between Two Times",
    prompt:
      "A response delay X follows an exponential distribution with rate 0.3 per second. Find P(2 < X <= 7).",
    kind: "between",
    rate: 0.3,
    lower: 2,
    upper: 7,
  },
  {
    id: "exponential-memoryless-rate-point-one-five",
    title: "Exponential Memoryless Update",
    prompt:
      "A device lifetime X is exponential with rate 0.15 per day. Given that it has lasted 4 days, what is the probability that it lasts at least 3 additional days?",
    kind: "memoryless",
    rate: 0.15,
    additional: 3,
  },
]

const zScoreSpecs = [
  {
    id: "zscore-sensor-reading",
    title: "Sensor Reading Z-Score",
    prompt:
      "Sensor readings are approximately normal with mean 48 and standard deviation 6. What is the z-score of a reading of 57?",
    mean: 48,
    standardDeviation: 6,
    value: 57,
  },
  {
    id: "zscore-packing-time",
    title: "Packing Time Z-Score",
    prompt:
      "Packing times are approximately normal with mean 32 minutes and standard deviation 4 minutes. What is the z-score of a 25-minute packing time?",
    mean: 32,
    standardDeviation: 4,
    value: 25,
  },
  {
    id: "zscore-signal-strength",
    title: "Signal Strength Z-Score",
    prompt:
      "Signal strengths are approximately normal with mean 70 units and standard deviation 8 units. What is the z-score of a signal strength of 86 units?",
    mean: 70,
    standardDeviation: 8,
    value: 86,
  },
  {
    id: "zscore-refill-volume",
    title: "Refill Volume Z-Score",
    prompt:
      "Refill volumes are approximately normal with mean 520 milliliters and standard deviation 15 milliliters. What is the z-score of a 497.5-milliliter refill?",
    mean: 520,
    standardDeviation: 15,
    value: 497.5,
  },
]

const normalProbabilitySpecs = [
  {
    id: "normal-cdf-one-sd",
    title: "Normal Probability below One Standard Deviation",
    prompt:
      "A delivery score is normally distributed with mean 40 and standard deviation 5. Find P(X <= 45).",
    kind: "cdf",
    z: 1,
  },
  {
    id: "normal-tail-at-mean",
    title: "Normal Probability above the Mean",
    prompt:
      "A stability measure is normally distributed with mean 18 and standard deviation 3. Find P(X > 18).",
    kind: "tail",
    z: 0,
  },
  {
    id: "normal-within-one-point-five",
    title: "Normal Probability within One Point Five Deviations",
    prompt:
      "A process index is normally distributed with mean 100 and standard deviation 12. Find P(82 <= X <= 118).",
    kind: "between",
    lowerZ: -1.5,
    upperZ: 1.5,
  },
  {
    id: "normal-asymmetric-interval",
    title: "Normal Probability on an Asymmetric Interval",
    prompt:
      "A measurement is normally distributed with mean 64 and standard deviation 7. Find P(57 <= X <= 78).",
    kind: "between",
    lowerZ: -1,
    upperZ: 2,
  },
]

const percentileSpecs = [
  {
    id: "normal-percentile-ninety",
    title: "Normal Ninetieth Percentile Cutoff",
    prompt:
      "A score is normal with mean 62 and standard deviation 9. Using z = 1.2816 for the 90th percentile, find the corresponding score cutoff.",
    mean: 62,
    standardDeviation: 9,
    z: 1.2816,
  },
  {
    id: "normal-percentile-tenth",
    title: "Normal Tenth Percentile Cutoff",
    prompt:
      "A duration is normal with mean 44 and standard deviation 6. Using z = -1.2816 for the 10th percentile, find the corresponding duration cutoff.",
    mean: 44,
    standardDeviation: 6,
    z: -1.2816,
  },
  {
    id: "normal-percentile-seventy-five",
    title: "Normal Seventy-Fifth Percentile Cutoff",
    prompt:
      "A calibration result is normal with mean 125 and standard deviation 10. Using z = 0.6745 for the 75th percentile, find the corresponding result.",
    mean: 125,
    standardDeviation: 10,
    z: 0.6745,
  },
  {
    id: "normal-percentile-twenty-five",
    title: "Normal Twenty-Fifth Percentile Cutoff",
    prompt:
      "A response metric is normal with mean 30 and standard deviation 4. Using z = -0.6745 for the 25th percentile, find the corresponding metric value.",
    mean: 30,
    standardDeviation: 4,
    z: -0.6745,
  },
]

const normalApproximationSpecs = [
  {
    id: "normal-approx-at-least-forty-two",
    title: "Approximate At Least Forty-Two Successes",
    prompt:
      "Let X be binomial with n = 80 and p = 0.45. Use a normal approximation with continuity correction to estimate P(X >= 42).",
    n: 80,
    p: 0.45,
    kind: "tail",
    boundary: 41.5,
  },
  {
    id: "normal-approx-at-most-forty",
    title: "Approximate At Most Forty Successes",
    prompt:
      "Let X be binomial with n = 120 and p = 0.3. Use a normal approximation with continuity correction to estimate P(X <= 40).",
    n: 120,
    p: 0.3,
    kind: "cdf",
    boundary: 40.5,
  },
  {
    id: "normal-approx-between-fifty-sixty",
    title: "Approximate a Binomial Middle Range",
    prompt:
      "Let X be binomial with n = 90 and p = 0.6. Use a normal approximation with continuity correction to estimate P(50 <= X <= 60).",
    n: 90,
    p: 0.6,
    kind: "between",
    lowerBoundary: 49.5,
    upperBoundary: 60.5,
  },
  {
    id: "normal-approx-more-than-thirty-five",
    title: "Approximate More Than Thirty-Five Successes",
    prompt:
      "Let X be binomial with n = 150 and p = 0.2. Use a normal approximation with continuity correction to estimate P(X > 35).",
    n: 150,
    p: 0.2,
    kind: "tail",
    boundary: 35.5,
  },
]

const normalTransformSpecs = [
  {
    id: "normal-transform-mean-positive",
    title: "Mean of a Positive Linear Transform",
    prompt:
      "A normal random variable X has mean 12 and standard deviation 3. Let Y = 4X - 5. Find E[Y].",
    mean: 12,
    standardDeviation: 3,
    factor: 4,
    shift: -5,
    metric: "mean",
  },
  {
    id: "normal-transform-sd-negative",
    title: "Standard Deviation of a Negative Linear Transform",
    prompt:
      "A normal random variable X has mean 20 and standard deviation 2.5. Let Y = -3X + 8. Find the standard deviation of Y.",
    mean: 20,
    standardDeviation: 2.5,
    factor: -3,
    shift: 8,
    metric: "standard deviation",
  },
  {
    id: "normal-transform-mean-half",
    title: "Mean of a Half-Scale Transform",
    prompt:
      "A normal random variable X has mean 50 and standard deviation 6. Let Y = 0.5X + 7. Find E[Y].",
    mean: 50,
    standardDeviation: 6,
    factor: 0.5,
    shift: 7,
    metric: "mean",
  },
  {
    id: "normal-transform-sd-one-point-two",
    title: "Standard Deviation of a Scaled Normal Variable",
    prompt:
      "A normal random variable X has mean -4 and standard deviation 5. Let Y = 1.2X - 9. Find the standard deviation of Y.",
    mean: -4,
    standardDeviation: 5,
    factor: 1.2,
    shift: -9,
    metric: "standard deviation",
  },
]

const mgfMomentSpecs = [
  {
    id: "mgf-normal-mean-three",
    title: "Mean from a Quadratic-Exponent MGF",
    prompt:
      "A random variable has moment generating function M(t) = exp(3t + 2t^2). Find E[X].",
    mgf: "exp(3t + 2t^2)",
    mean: 3,
    variance: 4,
    metric: "mean",
  },
  {
    id: "mgf-normal-variance-nine",
    title: "Variance from a Quadratic-Exponent MGF",
    prompt:
      "A random variable has moment generating function M(t) = exp(-2t + 4.5t^2). Find Var(X).",
    mgf: "exp(-2t + 4.5t^2)",
    mean: -2,
    variance: 9,
    metric: "variance",
  },
  {
    id: "mgf-bernoulli-mean-point-three-five",
    title: "Bernoulli Mean from Its MGF",
    prompt:
      "A random variable has moment generating function M(t) = 0.65 + 0.35e^t. Find E[X].",
    mgf: "0.65 + 0.35e^t",
    mean: 0.35,
    variance: 0.2275,
    metric: "mean",
  },
  {
    id: "mgf-bernoulli-variance-point-one-six",
    title: "Bernoulli Variance from Its MGF",
    prompt:
      "A random variable has moment generating function M(t) = 0.2 + 0.8e^t. Find Var(X).",
    mgf: "0.2 + 0.8e^t",
    mean: 0.8,
    variance: 0.16,
    metric: "variance",
  },
  {
    id: "mgf-poisson-variance-two-point-four",
    title: "Poisson Variance from Its MGF",
    prompt:
      "A random variable has moment generating function M(t) = exp(2.4(e^t - 1)). Find Var(X).",
    mgf: "exp(2.4(e^t - 1))",
    mean: 2.4,
    variance: 2.4,
    metric: "variance",
  },
  {
    id: "mgf-exponential-mean-one-fifth",
    title: "Exponential Mean from Its MGF",
    prompt:
      "A nonnegative random variable has moment generating function M(t) = 5/(5 - t) for t < 5. Find E[X].",
    mgf: "5/(5 - t)",
    mean: 0.2,
    variance: 0.04,
    metric: "mean",
  },
]

const mgfTransformSpecs = [
  {
    id: "mgf-independent-poisson-sum",
    title: "Mean of a Sum from Product MGFs",
    prompt:
      "Independent random variables X and Y have MGFs exp(1.2(e^t - 1)) and exp(0.8(e^t - 1)). Let S = X + Y. Find E[S].",
    result: 2,
    steps: [
      "Independence gives M_S(t) = M_X(t)M_Y(t).",
      "Multiplying combines the exponents to exp(2(e^t - 1)).",
      "This is a Poisson MGF with mean 2, so E[S] = 2.",
    ],
  },
  {
    id: "mgf-scaled-poisson-mean",
    title: "Mean after Scaling from an MGF",
    prompt:
      "A random variable X has MGF M_X(t) = exp(1.5(e^t - 1)). Let Y = 2X. Find E[Y].",
    result: 3,
    steps: [
      "The given MGF is Poisson with E[X] = 1.5.",
      "For Y = 2X, linearity gives E[Y] = 2E[X].",
      "Therefore E[Y] = 2(1.5) = 3.",
    ],
  },
]

const jointTables = {
  a: { p00: 0.12, p01: 0.18, p10: 0.28, p11: 0.42 },
  b: { p00: 0.15, p01: 0.25, p10: 0.2, p11: 0.4 },
  c: { p00: 0.1, p01: 0.3, p10: 0.25, p11: 0.35 },
  d: { p00: 0.22, p01: 0.18, p10: 0.33, p11: 0.27 },
  e: { p00: 0.4, p01: 0.1, p10: 0.1, p11: 0.4 },
  f: { p00: 0.1, p01: 0.4, p10: 0.4, p11: 0.1 },
  g: { p00: 0.21, p01: 0.09, p10: 0.49, p11: 0.21 },
}

const jointMarginalSpecs = [
  {
    id: "joint-marginal-x-one-table-a",
    title: "Marginal Probability of X Equal to One",
    table: jointTables.a,
    variable: "X",
    value: 1,
  },
  {
    id: "joint-marginal-y-zero-table-b",
    title: "Marginal Probability of Y Equal to Zero",
    table: jointTables.b,
    variable: "Y",
    value: 0,
  },
  {
    id: "joint-marginal-x-zero-table-c",
    title: "Marginal Probability of X Equal to Zero",
    table: jointTables.c,
    variable: "X",
    value: 0,
  },
  {
    id: "joint-marginal-y-one-table-d",
    title: "Marginal Probability of Y Equal to One",
    table: jointTables.d,
    variable: "Y",
    value: 1,
  },
]

const jointConditionalSpecs = [
  {
    id: "joint-conditional-y-one-given-x-zero",
    title: "Conditional Y Given X from Table A",
    table: jointTables.a,
    targetVariable: "Y",
    targetValue: 1,
    givenVariable: "X",
    givenValue: 0,
  },
  {
    id: "joint-conditional-x-one-given-y-one",
    title: "Conditional X Given Y from Table B",
    table: jointTables.b,
    targetVariable: "X",
    targetValue: 1,
    givenVariable: "Y",
    givenValue: 1,
  },
  {
    id: "joint-conditional-y-zero-given-x-one",
    title: "Conditional Y Given X from Table C",
    table: jointTables.c,
    targetVariable: "Y",
    targetValue: 0,
    givenVariable: "X",
    givenValue: 1,
  },
  {
    id: "joint-conditional-x-zero-given-y-zero",
    title: "Conditional X Given Y from Table D",
    table: jointTables.d,
    targetVariable: "X",
    targetValue: 0,
    givenVariable: "Y",
    givenValue: 0,
  },
]

const jointDependenceSpecs = [
  {
    id: "joint-independence-table-a",
    title: "Check Independence in Table A",
    prompt:
      "Binary random variables X and Y have the joint PMF shown. Are X and Y independent?",
    table: jointTables.a,
    kind: "independence",
    independent: true,
  },
  {
    id: "joint-covariance-positive-table-e",
    title: "Positive Covariance from a Binary Joint PMF",
    prompt:
      "Binary random variables X and Y have the joint PMF shown. Find Cov(X,Y).",
    table: jointTables.e,
    kind: "covariance",
  },
  {
    id: "joint-covariance-negative-table-f",
    title: "Negative Covariance from a Binary Joint PMF",
    prompt:
      "Binary random variables X and Y have the joint PMF shown. Find Cov(X,Y).",
    table: jointTables.f,
    kind: "covariance",
  },
  {
    id: "joint-independence-table-g",
    title: "Check Independence in Table G",
    prompt:
      "Binary random variables X and Y have the joint PMF shown. Are X and Y independent?",
    table: jointTables.g,
    kind: "independence",
    independent: true,
  },
]

function buildCandidates(topicMap) {
  return [
    ...buildContinuousCandidates(topicMap.get(EXPECTED_TOPIC_IDS[0])),
    ...buildNormalCandidates(topicMap.get(EXPECTED_TOPIC_IDS[1])),
    ...buildMgfJointCandidates(topicMap.get(EXPECTED_TOPIC_IDS[2])),
  ]
}

function buildContinuousCandidates(topic) {
  return [
    ...uniformIntervalSpecs.map((spec) => {
      const favorableLength = spec.upper - spec.lower
      const totalLength = spec.maximum - spec.minimum
      const value = favorableLength / totalLength
      return candidate(topic, {
        ...spec,
        answer: probabilityAnswer(value),
        difficulty: "foundational",
        patternSource: "continuous-uniform interval-length pattern",
        hints: [
          "For a uniform model, probability is proportional to interval length.",
          "Divide the favorable interval length by the full support length.",
        ],
        solutionSteps: [
          `The full support length is ${spec.maximum} - (${spec.minimum}) = ${formatDecimal(totalLength)}.`,
          `The favorable interval length is ${spec.upper} - (${spec.lower}) = ${formatDecimal(favorableLength)}.`,
          `The probability is ${formatDecimal(favorableLength)}/${formatDecimal(totalLength)} = ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "uses-endpoints-instead-of-lengths",
          "Uniform probabilities use interval lengths, not a ratio of endpoint values.",
        ),
      })
    }),
    ...densityNormalizationSpecs.map((spec) => {
      const value = 2 / spec.endpoint ** 2
      return candidate(topic, {
        ...spec,
        answer: numericAnswer(value),
        difficulty: "intermediate",
        patternSource: "continuous-density normalization pattern",
        hints: [
          "A probability density must integrate to 1 over its support.",
          "Integrate c x from 0 to the stated endpoint and solve for c.",
        ],
        solutionSteps: [
          `Set the total area equal to 1: integral from 0 to ${spec.endpoint} of c x dx = 1.`,
          `The integral is c(${spec.endpoint}^2)/2 = ${formatDecimal(spec.endpoint ** 2 / 2)}c.`,
          `Solving gives c = ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "sets-density-height-to-one",
          "A density's total area must be 1; the density value itself need not equal 1.",
        ),
      })
    }),
    ...cdfIntervalSpecs.map((spec) => {
      const cdfLower = ((spec.lower - spec.start) / spec.width) ** 2
      const cdfUpper = ((spec.upper - spec.start) / spec.width) ** 2
      const value = cdfUpper - cdfLower
      const end = spec.start + spec.width
      return candidate(topic, {
        ...spec,
        prompt:
          `A continuous random variable has CDF F(x) = 0 for x < ${spec.start}, ` +
          `F(x) = ((x - (${spec.start}))/${spec.width})^2 for ${spec.start} <= x <= ${end}, ` +
          `and F(x) = 1 for x > ${end}. Find P(${spec.lower} < X <= ${spec.upper}).`,
        answer: probabilityAnswer(value),
        difficulty: "intermediate",
        patternSource: "continuous-CDF interval-difference pattern",
        hints: [
          "Use P(a < X <= b) = F(b) - F(a).",
          "Evaluate the middle CDF formula at both interval endpoints.",
        ],
        solutionSteps: [
          `F(${spec.upper}) = ${formatDecimal(cdfUpper)}.`,
          `F(${spec.lower}) = ${formatDecimal(cdfLower)}.`,
          `The interval probability is ${formatDecimal(cdfUpper)} - ${formatDecimal(cdfLower)} = ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "adds-cdf-endpoints",
          "An interval probability is the upper CDF value minus the lower CDF value.",
        ),
      })
    }),
    ...uniformMomentSpecs.map((spec) => {
      const width = spec.maximum - spec.minimum
      const value =
        spec.metric === "mean"
          ? (spec.minimum + spec.maximum) / 2
          : width ** 2 / 12
      return candidate(topic, {
        ...spec,
        prompt: `Let X be uniform on [${spec.minimum}, ${spec.maximum}]. Find ${
          spec.metric === "mean" ? "E[X]" : "Var(X)"
        }.`,
        answer: numericAnswer(value),
        difficulty: spec.metric === "mean" ? "foundational" : "intermediate",
        patternSource: "continuous-uniform moment pattern",
        hints:
          spec.metric === "mean"
            ? [
                "The mean of Uniform(a,b) is the midpoint of the interval.",
                "Average the two endpoints.",
              ]
            : [
                "For Uniform(a,b), Var(X) = (b - a)^2 / 12.",
                "Find the interval width before squaring.",
              ],
        solutionSteps:
          spec.metric === "mean"
            ? [
                "Use E[X] = (a + b)/2.",
                `Substitute the endpoints: (${spec.minimum} + ${spec.maximum})/2.`,
                `Therefore E[X] = ${formatDecimal(value)}.`,
              ]
            : [
                "Use Var(X) = (b - a)^2/12.",
                `The interval width is ${spec.maximum} - (${spec.minimum}) = ${formatDecimal(width)}.`,
                `Therefore Var(X) = ${formatDecimal(width)}^2/12 = ${formatDecimal(value)}.`,
              ],
        misconception: misconception(
          spec.metric === "mean"
            ? "uses-interval-width-as-mean"
            : "forgets-square-in-uniform-variance",
          spec.metric === "mean"
            ? "The uniform mean is the interval midpoint, not its width."
            : "Uniform variance uses the square of the interval width divided by 12.",
        ),
      })
    }),
    ...exponentialSpecs.map((spec) => buildExponentialCandidate(topic, spec)),
  ]
}

function buildExponentialCandidate(topic, spec) {
  let value
  let solutionSteps
  let hints

  if (spec.kind === "tail") {
    value = Math.exp(-spec.rate * spec.time)
    hints = [
      "For an exponential variable, P(X > t) = exp(-rate times t).",
      "Substitute the rate and the requested time.",
    ]
    solutionSteps = [
      "Use the exponential survival function P(X > t) = exp(-lambda t).",
      `Substitute lambda = ${spec.rate} and t = ${spec.time}: exp(-${spec.rate * spec.time}).`,
      `The probability is ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "cdf") {
    value = 1 - Math.exp(-spec.rate * spec.time)
    hints = [
      "The exponential CDF is 1 - exp(-rate times t).",
      "Compute the tail first, then subtract it from 1.",
    ]
    solutionSteps = [
      "Use P(X <= t) = 1 - exp(-lambda t).",
      `Substitute lambda = ${spec.rate} and t = ${spec.time}.`,
      `The probability is 1 - exp(-${spec.rate * spec.time}) = ${formatDecimal(value)}.`,
    ]
  } else if (spec.kind === "between") {
    const lowerTail = Math.exp(-spec.rate * spec.lower)
    const upperTail = Math.exp(-spec.rate * spec.upper)
    value = lowerTail - upperTail
    hints = [
      "Express the interval probability as a difference of exponential tails.",
      "Use P(a < X <= b) = exp(-lambda a) - exp(-lambda b).",
    ]
    solutionSteps = [
      `P(X > ${spec.lower}) = ${formatDecimal(lowerTail)}.`,
      `P(X > ${spec.upper}) = ${formatDecimal(upperTail)}.`,
      `Subtracting gives ${formatDecimal(lowerTail)} - ${formatDecimal(upperTail)} = ${formatDecimal(value)}.`,
    ]
  } else {
    value = Math.exp(-spec.rate * spec.additional)
    hints = [
      "Use the memoryless property of the exponential distribution.",
      "Only the additional lifetime matters after conditioning on survival so far.",
    ]
    solutionSteps = [
      "The memoryless property removes the elapsed 4 days from the calculation.",
      `The needed probability is exp(-${spec.rate} times ${spec.additional}).`,
      `The conditional probability is ${formatDecimal(value)}.`,
    ]
  }

  return candidate(topic, {
    ...spec,
    answer: probabilityAnswer(value),
    difficulty: spec.kind === "memoryless" ? "challenge" : "intermediate",
    patternSource: `exponential-${spec.kind} pattern`,
    hints,
    solutionSteps,
    misconception: misconception(
      spec.kind === "memoryless"
        ? "restarts-with-total-elapsed-time"
        : "uses-exponential-density-as-probability",
      spec.kind === "memoryless"
        ? "For an exponential lifetime, the conditional remaining-life probability depends only on the additional time."
        : "Use the exponential CDF or survival function; the density at one point is not an interval probability.",
    ),
  })
}

function buildNormalCandidates(topic) {
  return [
    ...zScoreSpecs.map((spec) => {
      const value = (spec.value - spec.mean) / spec.standardDeviation
      return candidate(topic, {
        ...spec,
        answer: numericAnswer(value),
        difficulty: "foundational",
        patternSource: "normal-standardization z-score pattern",
        hints: [
          "Subtract the mean from the observation.",
          "Divide that difference by the standard deviation.",
        ],
        solutionSteps: [
          "Use z = (x - mean)/standard deviation.",
          `Substitute the values: (${spec.value} - ${spec.mean})/${spec.standardDeviation}.`,
          `The z-score is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "reverses-z-score-subtraction",
          "Standardization subtracts the mean from the observation, not the observation from the mean.",
        ),
      })
    }),
    ...normalProbabilitySpecs.map((spec) => {
      let value
      let computation
      if (spec.kind === "cdf") {
        value = normalCdf(spec.z)
        computation = `Phi(${spec.z})`
      } else if (spec.kind === "tail") {
        value = 1 - normalCdf(spec.z)
        computation = `1 - Phi(${spec.z})`
      } else {
        value = normalCdf(spec.upperZ) - normalCdf(spec.lowerZ)
        computation = `Phi(${spec.upperZ}) - Phi(${spec.lowerZ})`
      }
      return candidate(topic, {
        ...spec,
        answer: probabilityAnswer(value),
        difficulty: "intermediate",
        patternSource: "standard-normal probability pattern",
        hints: [
          "Convert each boundary to a z-score.",
          "Use the standard normal CDF and subtract for an interval.",
        ],
        solutionSteps: [
          "Standardize the stated boundary or boundaries.",
          `The probability is ${computation}.`,
          `Using a standard normal table or calculator gives ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "uses-z-score-as-probability",
          "A z-score is a standardized location; use the normal CDF to turn it into a probability.",
        ),
      })
    }),
    ...percentileSpecs.map((spec) => {
      const value = spec.mean + spec.z * spec.standardDeviation
      return candidate(topic, {
        ...spec,
        answer: numericAnswer(value),
        difficulty: "intermediate",
        patternSource: "normal-percentile unstandardization pattern",
        hints: [
          "Convert a z-score back to the original scale with x = mean + z times standard deviation.",
          "Use the supplied percentile z-value.",
        ],
        solutionSteps: [
          "Use x = mean + z standard deviation.",
          `Substitute: ${spec.mean} + (${spec.z})(${spec.standardDeviation}).`,
          `The cutoff is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "standardizes-instead-of-unstandardizes",
          "A percentile z-value must be converted back with mean plus z times standard deviation.",
        ),
      })
    }),
    ...normalApproximationSpecs.map((spec) =>
      buildNormalApproximationCandidate(topic, spec),
    ),
    ...normalTransformSpecs.map((spec) => {
      const value =
        spec.metric === "mean"
          ? spec.factor * spec.mean + spec.shift
          : Math.abs(spec.factor) * spec.standardDeviation
      return candidate(topic, {
        ...spec,
        answer: numericAnswer(value),
        difficulty: "intermediate",
        patternSource: "linear-transformation of normal variable pattern",
        hints:
          spec.metric === "mean"
            ? [
                "Expectation follows the full linear transformation.",
                "Use E[aX + b] = aE[X] + b.",
              ]
            : [
                "Adding a constant does not change standard deviation.",
                "Scaling by a multiplies standard deviation by the absolute value of a.",
              ],
        solutionSteps:
          spec.metric === "mean"
            ? [
                "Use E[Y] = aE[X] + b.",
                `Substitute: (${spec.factor})(${spec.mean}) + (${spec.shift}).`,
                `Therefore E[Y] = ${formatDecimal(value)}.`,
              ]
            : [
                "Use SD(Y) = |a|SD(X).",
                `The shift ${spec.shift} does not affect spread.`,
                `Therefore SD(Y) = |${spec.factor}|(${spec.standardDeviation}) = ${formatDecimal(value)}.`,
              ],
        misconception: misconception(
          spec.metric === "mean"
            ? "drops-shift-from-transformed-mean"
            : "adds-shift-to-standard-deviation",
          spec.metric === "mean"
            ? "The additive shift changes the transformed mean and must be included."
            : "An additive shift changes location but not standard deviation.",
        ),
      })
    }),
  ]
}

function buildNormalApproximationCandidate(topic, spec) {
  const mean = spec.n * spec.p
  const standardDeviation = Math.sqrt(spec.n * spec.p * (1 - spec.p))
  let value
  let zDescription

  if (spec.kind === "cdf") {
    const z = (spec.boundary - mean) / standardDeviation
    value = normalCdf(z)
    zDescription = `z = (${spec.boundary} - ${formatDecimal(mean)})/${formatDecimal(standardDeviation)} = ${formatDecimal(z)}`
  } else if (spec.kind === "tail") {
    const z = (spec.boundary - mean) / standardDeviation
    value = 1 - normalCdf(z)
    zDescription = `z = (${spec.boundary} - ${formatDecimal(mean)})/${formatDecimal(standardDeviation)} = ${formatDecimal(z)}`
  } else {
    const lowerZ = (spec.lowerBoundary - mean) / standardDeviation
    const upperZ = (spec.upperBoundary - mean) / standardDeviation
    value = normalCdf(upperZ) - normalCdf(lowerZ)
    zDescription = `the corrected z-boundaries are ${formatDecimal(lowerZ)} and ${formatDecimal(upperZ)}`
  }

  return candidate(topic, {
    ...spec,
    answer: probabilityAnswer(value),
    difficulty: "challenge",
    patternSource:
      "binomial normal-approximation continuity-correction pattern",
    hints: [
      "Use mean np and standard deviation sqrt(np(1-p)).",
      "Apply the stated half-unit continuity correction before standardizing.",
    ],
    solutionSteps: [
      `The approximating normal model has mean ${formatDecimal(mean)} and standard deviation ${formatDecimal(standardDeviation)}.`,
      `After continuity correction, ${zDescription}.`,
      `The requested normal probability is approximately ${formatDecimal(value)}.`,
    ],
    misconception: misconception(
      "omits-continuity-correction",
      "A binomial count uses half-unit boundaries when it is approximated by a continuous normal model.",
    ),
  })
}

function buildMgfJointCandidates(topic) {
  return [
    ...mgfMomentSpecs.map((spec) => {
      const value = spec.metric === "mean" ? spec.mean : spec.variance
      return candidate(topic, {
        ...spec,
        answer: numericAnswer(value),
        difficulty: "intermediate",
        patternSource: "MGF derivative moment pattern",
        hints: [
          "The first MGF derivative at zero gives E[X].",
          "Variance can be found from M''(0) - (M'(0))^2 or from the recognized MGF family.",
        ],
        solutionSteps: [
          `Start from M(t) = ${spec.mgf}.`,
          `Its parameters or derivatives give E[X] = ${formatDecimal(spec.mean)} and Var(X) = ${formatDecimal(spec.variance)}.`,
          `Therefore the requested ${spec.metric} is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "evaluates-mgf-instead-of-derivative",
          "M(0) equals 1 for an MGF; moments come from derivatives evaluated at zero.",
        ),
      })
    }),
    ...mgfTransformSpecs.map((spec) =>
      candidate(topic, {
        ...spec,
        answer: numericAnswer(spec.result),
        difficulty: "challenge",
        patternSource: "MGF independent-sum or scaling pattern",
        hints: [
          "Use products of MGFs for independent sums or M_X(at) for a scaled variable.",
          "Then read the mean from the resulting MGF or apply linearity.",
        ],
        solutionSteps: spec.steps,
        misconception: misconception(
          "adds-independent-mgfs",
          "Independent sums correspond to multiplying MGFs, not adding them.",
        ),
      }),
    ),
    ...jointMarginalSpecs.map((spec) => {
      const value = marginalProbability(spec.table, spec.variable, spec.value)
      const included =
        spec.variable === "X"
          ? [
              jointCell(spec.table, spec.value, 0),
              jointCell(spec.table, spec.value, 1),
            ]
          : [
              jointCell(spec.table, 0, spec.value),
              jointCell(spec.table, 1, spec.value),
            ]
      return candidate(topic, {
        ...spec,
        prompt:
          `Binary random variables X and Y have joint PMF ${renderJointTable(spec.table)}. ` +
          `Find P(${spec.variable} = ${spec.value}).`,
        answer: probabilityAnswer(value),
        difficulty: "foundational",
        patternSource: "joint-PMF marginalization pattern",
        hints: [
          "Hold the requested variable fixed and sum over every value of the other variable.",
          "A marginal probability is a row sum or column sum of the joint PMF.",
        ],
        solutionSteps: [
          `The relevant joint probabilities are ${included
            .map((probability) => formatDecimal(probability))
            .join(" and ")}.`,
          `Sum them: ${included
            .map((probability) => formatDecimal(probability))
            .join(" + ")}.`,
          `The marginal probability is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "uses-one-joint-cell-as-marginal",
          "A marginal probability sums all joint cells compatible with the requested value.",
        ),
      })
    }),
    ...jointConditionalSpecs.map((spec) => {
      const joint = jointCell(
        spec.table,
        spec.targetVariable === "X" ? spec.targetValue : spec.givenValue,
        spec.targetVariable === "Y" ? spec.targetValue : spec.givenValue,
      )
      const given = marginalProbability(
        spec.table,
        spec.givenVariable,
        spec.givenValue,
      )
      const value = joint / given
      return candidate(topic, {
        ...spec,
        prompt:
          `Binary random variables X and Y have joint PMF ${renderJointTable(spec.table)}. ` +
          `Find P(${spec.targetVariable} = ${spec.targetValue} | ${spec.givenVariable} = ${spec.givenValue}).`,
        answer: probabilityAnswer(value),
        difficulty: "intermediate",
        patternSource: "joint-PMF conditional-distribution pattern",
        hints: [
          "Use the joint probability in the numerator.",
          "Divide by the marginal probability of the conditioning event.",
        ],
        solutionSteps: [
          `The joint numerator is ${formatDecimal(joint)}.`,
          `The conditioning marginal is ${formatDecimal(given)}.`,
          `The conditional probability is ${formatDecimal(joint)}/${formatDecimal(given)} = ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "reverses-conditional-denominator",
          "The denominator is the marginal probability of the event after the conditioning bar.",
        ),
      })
    }),
    ...jointDependenceSpecs.map((spec) =>
      buildJointDependenceCandidate(topic, spec),
    ),
  ]
}

function buildJointDependenceCandidate(topic, spec) {
  if (spec.kind === "independence") {
    const pX1 = marginalProbability(spec.table, "X", 1)
    const pY1 = marginalProbability(spec.table, "Y", 1)
    const product = pX1 * pY1
    const joint = spec.table.p11
    return candidate(topic, {
      ...spec,
      prompt: `${spec.prompt} ${renderJointTable(spec.table)}`,
      answer: textAnswer(
        spec.independent ? "Yes, independent" : "No, dependent",
      ),
      difficulty: "intermediate",
      patternSource: "joint-PMF independence-check pattern",
      hints: [
        "Compare joint probabilities with products of the corresponding marginals.",
        "For binary variables, verify the factorization across the table.",
      ],
      solutionSteps: [
        `The marginals are P(X = 1) = ${formatDecimal(pX1)} and P(Y = 1) = ${formatDecimal(pY1)}.`,
        `Their product is ${formatDecimal(product)}, while P(X = 1,Y = 1) = ${formatDecimal(joint)}.`,
        spec.independent
          ? "The joint PMF factors into the marginal PMFs across all four cells, so X and Y are independent."
          : "The factorization fails, so X and Y are dependent.",
      ],
      misconception: misconception(
        "checks-only-equal-marginals",
        "Independence requires joint probabilities to factor into marginal products; equal marginals alone are not enough.",
      ),
    })
  }

  const pX1 = marginalProbability(spec.table, "X", 1)
  const pY1 = marginalProbability(spec.table, "Y", 1)
  const expectedProduct = spec.table.p11
  const value = expectedProduct - pX1 * pY1
  return candidate(topic, {
    ...spec,
    prompt: `${spec.prompt} ${renderJointTable(spec.table)}`,
    answer: numericAnswer(value),
    difficulty: "challenge",
    patternSource: "binary-joint-PMF covariance pattern",
    hints: [
      "Use Cov(X,Y) = E[XY] - E[X]E[Y].",
      "For binary variables, E[XY] equals P(X = 1,Y = 1).",
    ],
    solutionSteps: [
      `E[X] = ${formatDecimal(pX1)}, E[Y] = ${formatDecimal(pY1)}, and E[XY] = ${formatDecimal(expectedProduct)}.`,
      `Compute ${formatDecimal(expectedProduct)} - (${formatDecimal(pX1)})(${formatDecimal(pY1)}).`,
      `Therefore Cov(X,Y) = ${formatDecimal(value)}.`,
    ],
    misconception: misconception(
      "uses-product-of-means-as-covariance",
      "Covariance subtracts the product of the means from E[XY]; it is not just E[X]E[Y].",
    ),
  })
}

function candidate(topic, spec) {
  if (!topic) {
    throw new Error("Cannot build a candidate without a syllabus topic.")
  }

  return {
    id: `generated-following-${spec.id}`,
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
      // Ad-hoc template output. pattern_derived_original requires a linked
      // catalogued pattern ID (publication quality gate
      // invalid_source_classification); these drafts have none.
      sourceType: "generated_original",
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

function textAnswer(value) {
  return { acceptedAnswers: [value] }
}

function marginalProbability(table, variable, value) {
  if (variable === "X") {
    return jointCell(table, value, 0) + jointCell(table, value, 1)
  }
  return jointCell(table, 0, value) + jointCell(table, 1, value)
}

function jointCell(table, x, y) {
  return table[`p${x}${y}`]
}

function renderJointTable(table) {
  return (
    `{P(X=0,Y=0)=${table.p00}, P(X=0,Y=1)=${table.p01}, ` +
    `P(X=1,Y=0)=${table.p10}, P(X=1,Y=1)=${table.p11}}`
  )
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
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
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
      `Expected the following syllabus topics to be ${EXPECTED_TOPIC_IDS.join(", ")}; received ${selected.map((topic) => topic.id).join(", ")}.`,
    )
  }

  return new Map(selected.map((topic) => [topic.id, topic]))
}

function validateSpecificationInputs() {
  for (const [name, table] of Object.entries(jointTables)) {
    const probabilities = Object.values(table)
    const total = probabilities.reduce((sum, value) => sum + value, 0)
    if (
      probabilities.some((value) => value < 0 || value > 1) ||
      Math.abs(total - 1) > 1e-12
    ) {
      throw new Error(`Joint PMF table ${name} is invalid.`)
    }
  }

  for (const spec of normalApproximationSpecs) {
    if (spec.n * spec.p < 5 || spec.n * (1 - spec.p) < 5) {
      throw new Error(`Normal approximation conditions fail for ${spec.id}.`)
    }
  }

  for (const spec of cdfIntervalSpecs) {
    if (
      spec.lower < spec.start ||
      spec.upper > spec.start + spec.width ||
      spec.lower >= spec.upper
    ) {
      throw new Error(`CDF interval is outside its support for ${spec.id}.`)
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
      candidateItem.source.sourceType !== "generated_original" ||
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
    Promise.resolve(canonicalTopics),
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
        "Following-syllabus review candidates are stale. Run npm run prepare:following-syllabus-questions.",
      )
    }
    console.log(
      "Following-syllabus review candidates are current: 60 total, 20 per topic.",
    )
    return
  }

  await writeFile(outputPath, output)
  console.log(
    "Generated 60 review-gated candidates for syllabus Weeks 8, 9, and 10.",
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
