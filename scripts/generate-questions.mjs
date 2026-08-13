#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  canonicalTopicMap,
  compareTopics,
  loadCanonicalSyllabusTopics,
} from "./lib/canonical-syllabus-topics.mjs"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const defaultInputPath = path.join(repoRoot, "data/demo/question-patterns.json")
const defaultOutputPath = path.join(
  repoRoot,
  "data/private/generated/generated-questions.json",
)
const args = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(repoRoot, args.input ?? defaultInputPath)
const outputPath = path.resolve(repoRoot, args.output ?? defaultOutputPath)

async function main() {
  if (!assertPrivateOrTempOutput(outputPath)) {
    process.exitCode = 1
    return
  }

  const patternPayload = JSON.parse(await readFile(inputPath, "utf8"))
  const canonicalTopicList = await loadCanonicalSyllabusTopics(repoRoot)
  const canonicalTopics = canonicalTopicMap(canonicalTopicList)
  for (const pattern of patternPayload.patterns ?? []) {
    if (!canonicalTopics.has(pattern.topicId)) {
      throw new Error(
        `Pattern ${pattern.id} references unknown canonical topic ${pattern.topicId}.`,
      )
    }
  }
  const generatedQuestions = generateQuestions(
    [...(patternPayload.patterns ?? [])].sort((left, right) =>
      compareTopics(left, right, canonicalTopicList),
    ),
  )
  const payload = {
    schemaVersion: 1,
    visibility: "private",
    source: {
      type: "deterministic_generation_from_public_seed_patterns",
      inputPath: relativeToRepo(inputPath),
    },
    safety: {
      usesPrivateSourceText: false,
      copiesSourceQuestions: false,
      copiesSourceExamples: false,
      copiesSourceContexts: false,
      copiesSourceSolutions: false,
      requiresProfessorReview: true,
    },
    questions: generatedQuestions,
  }
  const errors = validateGeneratedPayload(payload)

  if (errors.length > 0) {
    console.error("Generated question payload failed validation:")
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(
    `Generated ${generatedQuestions.length} private question draft(s) at ${relativeToRepo(
      outputPath,
    )}.`,
  )
}

function generateQuestions(patterns) {
  return patterns.map((pattern) => {
    switch (pattern.id) {
      case "pattern-basic-probability-complement":
        return buildBasicProbabilityQuestion(pattern)
      case "pattern-counting-choose-committee":
        return buildCountingQuestion(pattern)
      case "pattern-conditional-probability-restricted-table":
        return buildConditionalProbabilityQuestion(pattern)
      case "pattern-independence-product-rule":
        return buildIndependenceQuestion(pattern)
      case "pattern-expected-value-discrete-payoff":
        return buildExpectedValueQuestion(pattern)
      case "pattern-permutations-ordered-selection":
        return buildPermutationQuestion(pattern)
      case "pattern-combinations-unordered-selection":
        return buildCombinationQuestion(pattern)
      case "pattern-bayes-rule-alert-update":
        return buildBayesRuleQuestion(pattern)
      case "pattern-binomial-distribution-exact-count":
        return buildBinomialDistributionQuestion(pattern)
      case "pattern-hypergeometric-distribution-without-replacement":
        return buildHypergeometricDistributionQuestion(pattern)
      case "pattern-variance-discrete-random-variable":
        return buildVarianceQuestion(pattern)
      case "pattern-normal-approximation-binomial-count":
        return buildNormalApproximationQuestion(pattern)
      default:
        throw new Error(`No deterministic generator for pattern ${pattern.id}.`)
    }
  })
}

function buildBasicProbabilityQuestion(pattern) {
  const blue = 5
  const green = 4
  const silver = 3
  const total = blue + green + silver
  const favorable = blue + silver

  return generatedQuestion(pattern, {
    id: "generated-basic-probability-sticker-complement",
    questionText:
      "A desk tray has 5 blue stickers, 4 green stickers, and 3 silver stickers. If one sticker is chosen at random, what is the probability that it is not green?",
    finalAnswer: "2/3",
    hints: [
      "Find the total number of stickers first.",
      "Not green means blue or silver.",
      "Use favorable outcomes divided by total outcomes.",
    ],
    solutionSteps: [
      "There are 5 + 4 + 3 = 12 stickers in all.",
      "The stickers that are not green are the 5 blue and 3 silver stickers, for 8 favorable choices.",
      "The probability is 8/12 = 2/3.",
    ],
    misconceptions: [
      misconception(
        "uses-excluded-count",
        pattern.misconceptionHooks[0],
        "That uses the green stickers as favorable outcomes. The phrase 'not green' means every sticker except green.",
      ),
      misconception(
        "wrong-total",
        pattern.misconceptionHooks[1],
        "The denominator should include every sticker in the tray.",
      ),
    ],
    check: { favorable, total },
  })
}

function buildCountingQuestion(pattern) {
  const totalItems = 9
  const selectedItems = 3
  const count = combination(totalItems, selectedItems)

  return generatedQuestion(pattern, {
    id: "generated-counting-mural-team",
    questionText:
      "A campus art club has 9 mural sketches and will choose 3 of them for a hallway display. How many different groups of sketches can be chosen?",
    finalAnswer: "84",
    hints: [
      "The order of the chosen sketches does not matter.",
      "Use a combination, not a permutation.",
      "Compute C(9,3).",
    ],
    solutionSteps: [
      "This is an unordered selection of 3 sketches from 9 sketches.",
      "Use C(9,3) = 9! / (3!6!).",
      "C(9,3) = 84, so there are 84 possible groups.",
    ],
    misconceptions: [
      misconception(
        "uses-permutation",
        pattern.misconceptionHooks[0],
        "That treats different orders of the same sketches as different outcomes. For a group, order does not matter.",
      ),
      misconception(
        "wrong-k",
        pattern.misconceptionHooks[2],
        "The value of k is the number chosen for the display, which is 3.",
      ),
    ],
    check: { count },
  })
}

function buildConditionalProbabilityQuestion(pattern) {
  const conditionGroupCount = 15
  const favorableWithinCondition = 6
  const outsideConditionCount = 11

  return generatedQuestion(pattern, {
    id: "generated-conditional-probability-workshop-survey",
    questionText:
      "A workshop survey lists 15 students who chose the afternoon session and 11 who chose the morning session. Among the afternoon students, 6 requested a statistics review sheet. Given that a randomly selected student chose the afternoon session, what is the probability that the student requested the review sheet?",
    finalAnswer: "2/5",
    hints: [
      "The condition restricts the denominator to afternoon students.",
      "Count how many afternoon students requested the review sheet.",
      "Compute the favorable count within the condition divided by the condition count.",
    ],
    solutionSteps: [
      "Given the student chose the afternoon session, the relevant sample space has 15 students.",
      "Within that group, 6 students requested the statistics review sheet.",
      "The conditional probability is 6/15 = 2/5.",
    ],
    misconceptions: [
      misconception(
        "uses-full-sample-space",
        pattern.misconceptionHooks[0],
        "The morning students should not be in the denominator after conditioning on the afternoon session.",
      ),
      misconception(
        "counts-outside-condition",
        pattern.misconceptionHooks[2],
        "Only students inside the given condition should be counted.",
      ),
    ],
    check: {
      conditionGroupCount,
      favorableWithinCondition,
      outsideConditionCount,
    },
  })
}

function buildIndependenceQuestion(pattern) {
  const firstProbability = 0.4
  const secondProbability = 0.25
  const both = firstProbability * secondProbability

  return generatedQuestion(pattern, {
    id: "generated-independence-app-checks",
    questionText:
      "Two independent app checks run overnight. The first check has a 40% chance of finding a stale link, and the second check has a 25% chance of finding a stale image. What is the probability that both checks find their issue?",
    finalAnswer: "0.10",
    hints: [
      "For independent events, multiply the probabilities.",
      "Convert each percent to a decimal before multiplying.",
      "The question asks for both events, not either event.",
    ],
    solutionSteps: [
      "Convert the probabilities: 40% = 0.40 and 25% = 0.25.",
      "Because the checks are independent, multiply: 0.40 * 0.25 = 0.10.",
      "The probability that both checks find their issue is 0.10, or 10%.",
    ],
    misconceptions: [
      misconception(
        "adds-probabilities",
        pattern.misconceptionHooks[0],
        "Adding would answer a different kind of question. For independent events both happening, multiply.",
      ),
      misconception(
        "mutually-exclusive-confusion",
        pattern.misconceptionHooks[1],
        "Independent events can happen together; they are not automatically mutually exclusive.",
      ),
    ],
    check: { both },
  })
}

function buildExpectedValueQuestion(pattern) {
  const outcomes = [
    { value: 0, probability: 0.2 },
    { value: 5, probability: 0.5 },
    { value: 10, probability: 0.3 },
  ]
  const expectedValue = outcomes.reduce(
    (sum, outcome) => sum + outcome.value * outcome.probability,
    0,
  )

  return generatedQuestion(pattern, {
    id: "generated-expected-value-cafe-credits",
    questionText:
      "A campus cafe reward card gives 0, 5, or 10 bonus credits with probabilities 0.20, 0.50, and 0.30. What is the expected number of bonus credits from one card?",
    finalAnswer: "5.5",
    hints: [
      "Multiply each possible credit amount by its probability.",
      "Add the weighted values.",
      "Expected value is a long-run average, not necessarily one exact card outcome.",
    ],
    solutionSteps: [
      "Multiply each value by its probability: 0(0.20), 5(0.50), and 10(0.30).",
      "Add the products: 0 + 2.5 + 3 = 5.5.",
      "The expected number of bonus credits is 5.5.",
    ],
    misconceptions: [
      misconception(
        "unweighted-average",
        pattern.misconceptionHooks[0],
        "The outcomes should be weighted by their probabilities before adding.",
      ),
      misconception(
        "most-likely-value",
        pattern.misconceptionHooks[1],
        "Expected value is a weighted average, not the same thing as the most likely outcome.",
      ),
    ],
    check: { expectedValue },
  })
}

function buildPermutationQuestion(pattern) {
  const totalItems = 7
  const orderedSlots = 3
  const arrangements = permutation(totalItems, orderedSlots)

  return generatedQuestion(pattern, {
    id: "generated-permutations-tutorial-playlist",
    questionText:
      "A study site has 7 short tutorial clips and will place 3 of them into first, second, and third positions on a featured playlist. No clip can be repeated. How many different ordered playlists are possible?",
    finalAnswer: "210",
    hints: [
      "The positions are ordered, so use a permutation.",
      "After one clip is placed, it cannot be used again.",
      "Multiply the number of choices for first, second, and third positions.",
    ],
    solutionSteps: [
      "There are 7 choices for the first position.",
      "After that choice, 6 clips remain for the second position and 5 remain for the third position.",
      "The number of ordered playlists is 7 * 6 * 5 = 210.",
    ],
    misconceptions: [
      misconception(
        "uses-combination",
        pattern.misconceptionHooks[0],
        "A combination would ignore order. Here first, second, and third positions create different playlists.",
      ),
      misconception(
        "allows-repeats",
        pattern.misconceptionHooks[1],
        "The prompt says no clip can be repeated, so the number of choices decreases after each position is filled.",
      ),
    ],
    check: { arrangements },
  })
}

function buildCombinationQuestion(pattern) {
  const totalItems = 10
  const groupSize = 4
  const count = combination(totalItems, groupSize)

  return generatedQuestion(pattern, {
    id: "generated-combinations-practice-prompts",
    questionText:
      "A study app has 10 short practice prompts and will choose 4 of them for a warm-up set. The prompts in the set are not ordered. How many different warm-up sets can be chosen?",
    finalAnswer: "210",
    hints: [
      "The chosen prompts form a group, so order does not matter.",
      "Use a combination rather than a permutation.",
      "Compute C(10,4).",
    ],
    solutionSteps: [
      "This is an unordered selection of 4 prompts from 10 prompts.",
      "Use C(10,4) = 10! / (4!6!).",
      "C(10,4) = 210, so there are 210 possible warm-up sets.",
    ],
    misconceptions: [
      misconception(
        "uses-permutation",
        pattern.misconceptionHooks[0],
        "That would count different orders of the same 4 prompts as different sets.",
      ),
      misconception(
        "wrong-group-size",
        pattern.misconceptionHooks[2],
        "The group size is 4, the number chosen for the warm-up set.",
      ),
    ],
    check: { count },
  })
}

function buildBayesRuleQuestion(pattern) {
  const baseRate = 0.09
  const trueAlertRate = 0.85
  const falseAlertRate = 0.06
  const alertAndNeedsTuneUp = baseRate * trueAlertRate
  const alertAndNoTuneUp = (1 - baseRate) * falseAlertRate
  const totalAlertRate = alertAndNeedsTuneUp + alertAndNoTuneUp
  const posterior = alertAndNeedsTuneUp / totalAlertRate

  return generatedQuestion(pattern, {
    id: "generated-bayes-bike-share-alert",
    questionText:
      "A bike-share maintenance app flags 85% of bikes that need a tune-up and flags 6% of bikes that do not need one. About 9% of bikes need a tune-up. If a bike is flagged, what is the probability that it needs a tune-up?",
    finalAnswer: `${formatDecimal(posterior)} (about 58.35%)`,
    hints: [
      "Write down the prior probability that a bike needs a tune-up.",
      "Find the probability of a flag from bikes that need tune-ups and from bikes that do not.",
      "Divide the tune-up-and-flag probability by the total flag probability.",
    ],
    solutionSteps: [
      "The probability a bike both needs a tune-up and is flagged is 0.09 * 0.85 = 0.0765.",
      "The probability a bike does not need a tune-up but is flagged is 0.91 * 0.06 = 0.0546.",
      "The total probability of a flag is 0.0765 + 0.0546 = 0.1311.",
      "So P(needs tune-up | flagged) = 0.0765 / 0.1311 = 0.5835, or about 58.35%.",
    ],
    misconceptions: [
      misconception(
        "reverses-conditional",
        pattern.misconceptionHooks[0],
        "The 85% is P(flagged | needs tune-up). The question asks for P(needs tune-up | flagged).",
      ),
      misconception(
        "ignores-base-rate",
        pattern.misconceptionHooks[1],
        "The 9% base rate affects how much of the flagged group comes from bikes that actually need tune-ups.",
      ),
    ],
    check: { posterior },
  })
}

function buildBinomialDistributionQuestion(pattern) {
  const trialCount = 9
  const successCount = 4
  const successProbability = 0.4
  const probability =
    combination(trialCount, successCount) *
    successProbability ** successCount *
    (1 - successProbability) ** (trialCount - successCount)

  return generatedQuestion(pattern, {
    id: "generated-binomial-review-prompts",
    questionText:
      "A study app sends 9 independent review prompts. Each prompt has a 40% chance of receiving an on-time response. What is the probability that exactly 4 prompts receive on-time responses?",
    finalAnswer: formatDecimal(probability),
    hints: [
      "This has a fixed number of independent trials.",
      "Use the binomial formula for exactly k successes.",
      "The number of failures is 9 - 4.",
    ],
    solutionSteps: [
      "Let X be the number of on-time responses. Then X follows a binomial model with n = 9 and p = 0.40.",
      "Use P(X = 4) = C(9,4)(0.40)^4(0.60)^5.",
      "C(9,4) = 126, so the probability is 126(0.40)^4(0.60)^5 = 0.2508.",
    ],
    misconceptions: [
      misconception(
        "missing-combination-factor",
        pattern.misconceptionHooks[0],
        "The combination factor counts which 4 of the 9 prompts receive on-time responses.",
      ),
      misconception(
        "uses-k-as-failures",
        pattern.misconceptionHooks[1],
        "The value k = 4 is the number of on-time responses, not the number of late responses.",
      ),
    ],
    check: { probability },
  })
}

function buildHypergeometricDistributionQuestion(pattern) {
  const populationSize = 14
  const successItems = 5
  const drawCount = 4
  const observedSuccesses = 2
  const otherItems = populationSize - successItems
  const otherDraws = drawCount - observedSuccesses
  const numerator =
    combination(successItems, observedSuccesses) *
    combination(otherItems, otherDraws)
  const denominator = combination(populationSize, drawCount)
  const probability = numerator / denominator

  return generatedQuestion(pattern, {
    id: "generated-hypergeometric-charger-check",
    questionText:
      "A laptop cart has 14 chargers, and 5 of them are labeled for an update. A technician checks 4 chargers without replacement. What is the probability that exactly 2 of the checked chargers are labeled for an update?",
    finalAnswer: `${numerator}/${denominator} (about ${formatDecimal(
      probability,
    )})`,
    hints: [
      "The chargers are checked without replacement.",
      "Choose the updated chargers and the non-updated chargers separately.",
      "Divide by the number of all possible groups of 4 chargers.",
    ],
    solutionSteps: [
      "Choose exactly 2 of the 5 labeled chargers: C(5,2).",
      "The other 2 checked chargers must come from the 9 not labeled for an update: C(9,2).",
      "Divide by all possible groups of 4 chargers: C(14,4).",
      "The probability is [C(5,2)C(9,2)] / C(14,4) = 360/1001, about 0.3596.",
    ],
    misconceptions: [
      misconception(
        "uses-binomial",
        pattern.misconceptionHooks[0],
        "A binomial model assumes independent trials with a constant probability. Without replacement, the probabilities change after each draw.",
      ),
      misconception(
        "ignores-other-items",
        pattern.misconceptionHooks[1],
        "After choosing the labeled chargers, you still need to choose the non-labeled chargers that fill the sample.",
      ),
    ],
    check: { probability },
  })
}

function buildVarianceQuestion(pattern) {
  const outcomes = [
    { value: 1, probability: 0.2 },
    { value: 3, probability: 0.5 },
    { value: 6, probability: 0.3 },
  ]
  const expectedValue = outcomes.reduce(
    (sum, outcome) => sum + outcome.value * outcome.probability,
    0,
  )
  const expectedSquare = outcomes.reduce(
    (sum, outcome) => sum + outcome.value ** 2 * outcome.probability,
    0,
  )
  const variance = expectedSquare - expectedValue ** 2

  return generatedQuestion(pattern, {
    id: "generated-variance-help-desk-tickets",
    questionText:
      "The number of quick help-desk tickets in an hour can be 1, 3, or 6 with probabilities 0.20, 0.50, and 0.30. What is the variance of this random variable?",
    finalAnswer: formatDecimal(variance, 2),
    hints: [
      "Find the mean before finding the variance.",
      "Compute E(X^2) by squaring each value before weighting it.",
      "Use Var(X) = E(X^2) - [E(X)]^2.",
    ],
    solutionSteps: [
      "First find the mean: E(X) = 1(0.20) + 3(0.50) + 6(0.30) = 3.5.",
      "Next find E(X^2): 1^2(0.20) + 3^2(0.50) + 6^2(0.30) = 15.5.",
      "Use Var(X) = E(X^2) - [E(X)]^2 = 15.5 - 3.5^2 = 3.25.",
    ],
    misconceptions: [
      misconception(
        "reports-mean",
        pattern.misconceptionHooks[0],
        "The mean is needed, but the variance measures weighted squared spread around that mean.",
      ),
      misconception(
        "drops-probability-weights",
        pattern.misconceptionHooks[1],
        "Each squared term should still be multiplied by its probability.",
      ),
    ],
    check: { variance },
  })
}

function buildNormalApproximationQuestion(pattern) {
  const trialCount = 120
  const successProbability = 0.35
  const thresholdCount = 50
  const mean = trialCount * successProbability
  const standardDeviation = Math.sqrt(
    trialCount * successProbability * (1 - successProbability),
  )
  const correctedThreshold = thresholdCount - 0.5
  const zScore = (correctedThreshold - mean) / standardDeviation
  const upperTail = 1 - normalCdf(zScore)

  return generatedQuestion(pattern, {
    id: "generated-normal-approximation-flagged-submissions",
    questionText:
      "In a set of 120 independent practice submissions, each has a 35% chance of being flagged for follow-up. Using a normal approximation with continuity correction, estimate the probability that 50 or more submissions are flagged.",
    finalAnswer: `${formatDecimal(upperTail)} (about 7.6%)`,
    hints: [
      "For a binomial count, use mu = np and sigma = sqrt(np(1-p)).",
      "For 50 or more, apply the continuity correction at 49.5.",
      "Convert the corrected value to a z-score and use the upper tail.",
    ],
    solutionSteps: [
      "For X ~ Binomial(120, 0.35), the mean is 120(0.35) = 42.",
      "The standard deviation is sqrt(120(0.35)(0.65)) = sqrt(27.3), about 5.225.",
      "For X >= 50, use the continuity correction 49.5, giving z = (49.5 - 42) / 5.225 = 1.44.",
      "So P(X >= 50) is approximately P(Z >= 1.44), about 0.0756.",
    ],
    misconceptions: [
      misconception(
        "forgets-continuity-correction",
        pattern.misconceptionHooks[0],
        "Because a discrete count is being approximated by a continuous normal curve, 50 or more starts at 49.5.",
      ),
      misconception(
        "wrong-tail",
        pattern.misconceptionHooks[2],
        "The event is 50 or more, so use the upper tail after standardizing.",
      ),
    ],
    check: { upperTail },
  })
}

function generatedQuestion(pattern, draft) {
  return {
    id: draft.id,
    patternId: pattern.id,
    topic: pattern.topic,
    topicId: pattern.topicId,
    difficulty: pattern.difficulty,
    questionText: draft.questionText,
    finalAnswer: draft.finalAnswer,
    solutionSteps: draft.solutionSteps,
    hints: draft.hints,
    misconceptions: draft.misconceptions,
    sourceType: "generated_original",
    trustLevel: "generated_unverified",
    reviewStatus: "needs_review",
    originalityNote:
      "Original deterministic draft generated from a public-safe abstract pattern with new context, numbers, and solution wording; no private source text used.",
  }
}

function misconception(id, hook, feedback) {
  return { id, hook, feedback }
}

function validateGeneratedPayload(payload) {
  const errors = []

  if (payload.visibility !== "private") {
    errors.push("Generated question output must be private.")
  }

  if (!Array.isArray(payload.questions) || payload.questions.length === 0) {
    errors.push("Generated output must include at least one question.")
    return errors
  }

  const seenIds = new Set()

  for (const [index, question] of payload.questions.entries()) {
    const label = `questions[${index}]`

    for (const key of [
      "id",
      "patternId",
      "topic",
      "topicId",
      "difficulty",
      "questionText",
      "finalAnswer",
      "originalityNote",
    ]) {
      if (typeof question[key] !== "string" || question[key].trim() === "") {
        errors.push(`${label}.${key} must be a non-empty string.`)
      }
    }

    if (seenIds.has(question.id)) {
      errors.push(`${label}.id is duplicated: ${question.id}.`)
    }
    seenIds.add(question.id)

    if (question.sourceType !== "generated_original") {
      errors.push(`${label}.sourceType must be generated_original.`)
    }

    if (question.trustLevel !== "generated_unverified") {
      errors.push(`${label}.trustLevel must be generated_unverified.`)
    }

    if (question.reviewStatus !== "needs_review") {
      errors.push(`${label}.reviewStatus must be needs_review.`)
    }

    for (const key of ["solutionSteps", "hints", "misconceptions"]) {
      if (!Array.isArray(question[key]) || question[key].length === 0) {
        errors.push(`${label}.${key} must be a non-empty array.`)
      }
    }

    if (containsForbiddenText(question)) {
      errors.push(`${label} contains forbidden private/source wording.`)
    }
  }

  return errors
}

function containsForbiddenText(value) {
  return /textbook|source page|answer key|worked example|copied from/i.test(
    JSON.stringify(value),
  )
}

function combination(n, k) {
  return factorial(n) / (factorial(k) * factorial(n - k))
}

function permutation(n, k) {
  return factorial(n) / factorial(n - k)
}

function factorial(value) {
  let product = 1

  for (let factor = 2; factor <= value; factor += 1) {
    product *= factor
  }

  return product
}

function formatDecimal(value, places = 4) {
  return value.toFixed(places)
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.SQRT2))
}

function erf(value) {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const approximation =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x)

  return sign * approximation
}

function assertPrivateOrTempOutput(targetPath) {
  if (
    isInside(targetPath, "/tmp") ||
    isInside(targetPath, "/private/tmp") ||
    isInside(targetPath, tmpdir())
  ) {
    return true
  }

  if (!isInside(targetPath, path.join(repoRoot, "data/private"))) {
    console.warn(
      `WARNING: generated question output must stay under data/private by default: ${relativeToRepo(
        targetPath,
      )}`,
    )
    return false
  }

  const relativePath = relativeToRepo(targetPath)
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--", relativePath],
    {
      cwd: repoRoot,
    },
  )

  if (result.status === 0) {
    return true
  }

  console.warn(
    [
      `WARNING: generated question output is not ignored by Git: ${relativePath}`,
      "Refusing to continue because generated drafts must stay private until review.",
    ].join("\n"),
  )
  return false
}

function isInside(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath)
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  )
}

function parseArgs(rawArgs) {
  const parsed = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]

    if (arg === "--input") {
      parsed.input = rawArgs[index + 1]
      index += 1
    } else if (arg === "--output") {
      parsed.output = rawArgs[index + 1]
      index += 1
    }
  }

  return parsed
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
