import "server-only"

import type { AdminQuestion, ReviewCandidate } from "@/lib/types"

type RegenerationInput = {
  id: string
  keepPattern: boolean
  original: AdminQuestion
  sequence: number
}

export function generateDeterministicRegeneratedQuestion({
  id,
  keepPattern,
  original,
  sequence,
}: RegenerationInput): ReviewCandidate {
  const topicSignal = [
    original.topicId,
    original.topicTitle,
    original.patternSource,
    original.source.patternIds?.join(" "),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  const patternId =
    keepPattern && original.source.patternIds?.[0]
      ? original.source.patternIds[0]
      : undefined
  const patternSource =
    keepPattern && original.patternSource
      ? original.patternSource
      : `${original.topicId}-deterministic-regeneration`
  const sourceType = original.source.sourceType

  const candidate = candidateForTopic(topicSignal, sequence)

  return {
    ...candidate,
    id,
    patternSource,
    review: {
      notes: `Deterministic regeneration of ${original.id}; old version preserved for audit.`,
      reviewPriority: original.review.reviewPriority ?? "normal",
      status: "needs_review",
    },
    source: {
      originalityNote:
        "Original deterministic regeneration from the same public-safe topic and abstract pattern; no private textbook content copied.",
      patternIds: patternId ? [patternId] : undefined,
      sourceType,
      trustLevel: "generated_unverified",
      visibility: "public",
    },
    topic: original.topicTitle,
    topicId: original.topicId,
  }
}

function candidateForTopic(topicSignal: string, sequence: number) {
  if (/bayes/.test(topicSignal)) {
    return bayesCandidate(sequence)
  }

  if (/conditional|given|restricted/.test(topicSignal)) {
    return conditionalCandidate(sequence)
  }

  if (/binomial|bernoulli|exact-count|exact count/.test(topicSignal)) {
    return binomialCandidate(sequence)
  }

  if (/expected|expectation/.test(topicSignal)) {
    return expectedValueCandidate(sequence)
  }

  if (/variance|standard deviation/.test(topicSignal)) {
    return varianceCandidate(sequence)
  }

  if (/normal|z-score|standardization/.test(topicSignal)) {
    return normalCandidate(sequence)
  }

  if (/combination|counting|permutation|choose/.test(topicSignal)) {
    return combinationCandidate(sequence)
  }

  return proportionCandidate(sequence)
}

function conditionalCandidate(sequence: number) {
  const usedApp = 42 + sequence * 4
  const both = 14 + sequence * 2
  const probability = both / usedApp
  const rounded = round(probability)

  return {
    answer: {
      acceptedAnswers: [String(rounded), `${both}/${usedApp}`],
      explanation: `Among the ${usedApp} students who used the app, ${both} attended the review lab, so the conditional probability is ${both}/${usedApp} = ${rounded}.`,
      numericValue: rounded,
      tolerance: 0.001,
    },
    difficulty: "foundational" as const,
    hints: [
      "Start with the group after the word given.",
      "Use the count in both groups over the count in the conditioned group.",
    ],
    misconceptions: [
      {
        feedback:
          "Use the conditioned group as the denominator, not the whole survey.",
        id: "uses-unconditioned-denominator",
        matchTerms: ["total", "all"],
      },
    ],
    prompt: `In a campus workshop survey, ${usedApp} students used the study app. Of those students, ${both} also attended the review lab. What is the probability that a student attended the review lab given that the student used the app?`,
    solutionSteps: [
      `The conditioned group is the ${usedApp} students who used the app.`,
      `${both} of those students attended the review lab.`,
      `Compute ${both}/${usedApp} = ${rounded}.`,
    ],
    title: "Regenerated conditional probability item",
  }
}

function bayesCandidate(sequence: number) {
  const base = 0.12 + sequence * 0.01
  const hit = 0.84
  const falseAlarm = 0.08
  const numerator = base * hit
  const denominator = numerator + (1 - base) * falseAlarm
  const probability = round(numerator / denominator)

  return {
    answer: {
      acceptedAnswers: [String(probability)],
      explanation: `Use Bayes' rule: (${base} x ${hit}) / [(${base} x ${hit}) + (${round(1 - base)} x ${falseAlarm})] = ${probability}.`,
      numericValue: probability,
      tolerance: 0.001,
    },
    difficulty: "intermediate" as const,
    hints: [
      "Write the true-positive part of the alert rate first.",
      "The denominator is the total probability of an alert.",
    ],
    misconceptions: [
      {
        feedback: "Do not use the alert accuracy alone as the posterior probability.",
        id: "uses-alert-rate-directly",
        matchTerms: ["0.84", "84"],
      },
    ],
    prompt: `A campus equipment monitor flags a device. Before any alert, ${Math.round(base * 100)}% of devices need service. The monitor flags 84% of devices that need service and 8% of devices that do not. Given that a device was flagged, what is the probability that it needs service?`,
    solutionSteps: [
      `The true alert probability is ${base} x ${hit} = ${round(numerator)}.`,
      `The false alert probability is ${round(1 - base)} x ${falseAlarm} = ${round((1 - base) * falseAlarm)}.`,
      `Divide the true alert probability by the total alert probability to get ${probability}.`,
    ],
    title: "Regenerated Bayes item",
  }
}

function binomialCandidate(sequence: number) {
  const n = 5 + sequence
  const k = 2
  const p = 0.35
  const probability = round(combination(n, k) * p ** k * (1 - p) ** (n - k))

  return {
    answer: {
      acceptedAnswers: [String(probability)],
      explanation: `Use C(${n}, ${k})(${p})^${k}(${round(1 - p)})^${n - k} = ${probability}.`,
      numericValue: probability,
      tolerance: 0.001,
    },
    difficulty: "intermediate" as const,
    hints: [
      "Use the binomial exact-count formula.",
      "Include the combination factor for which trials are successes.",
    ],
    misconceptions: [
      {
        feedback:
          "The combination factor is needed because the successes can occur in different positions.",
        id: "omits-combination-factor",
        matchTerms: ["0.35^2", "only"],
      },
    ],
    prompt: `A study app notification gets a response from 35% of students independently. If ${n} students receive the notification, what is the probability that exactly ${k} respond?`,
    solutionSteps: [
      `There are C(${n}, ${k}) ways to choose which students respond.`,
      `The probability for one exact arrangement is ${p}^${k} x ${round(1 - p)}^${n - k}.`,
      `Multiply to get ${probability}.`,
    ],
    title: "Regenerated binomial exact-count item",
  }
}

function expectedValueCandidate(sequence: number) {
  const low = sequence
  const mid = low + 3
  const high = mid + 4
  const expected = round(low * 0.25 + mid * 0.5 + high * 0.25)

  return {
    answer: {
      acceptedAnswers: [String(expected)],
      explanation: `Compute the weighted average: ${low}(0.25) + ${mid}(0.50) + ${high}(0.25) = ${expected}.`,
      numericValue: expected,
      tolerance: 0.001,
    },
    difficulty: "foundational" as const,
    hints: [
      "Multiply each outcome by its probability.",
      "Add the weighted outcomes.",
    ],
    misconceptions: [
      {
        feedback: "Use probability weights instead of averaging the outcomes equally.",
        id: "unweighted-average",
        matchTerms: ["average", "divide by 3"],
      },
    ],
    prompt: `A participation reward gives ${low}, ${mid}, or ${high} bonus points with probabilities 0.25, 0.50, and 0.25. What is the expected number of bonus points?`,
    solutionSteps: [
      `Weight the outcomes by their probabilities: ${low}(0.25), ${mid}(0.50), and ${high}(0.25).`,
      `Add the weighted values.`,
      `The expected value is ${expected}.`,
    ],
    title: "Regenerated expected value item",
  }
}

function varianceCandidate(sequence: number) {
  const high = 2 + sequence
  const mean = round(0 * 0.2 + 1 * 0.5 + high * 0.3)
  const secondMoment = round(0 ** 2 * 0.2 + 1 ** 2 * 0.5 + high ** 2 * 0.3)
  const variance = round(secondMoment - mean ** 2)

  return {
    answer: {
      acceptedAnswers: [String(variance)],
      explanation: `First compute E(X) = ${mean} and E(X^2) = ${secondMoment}. Then Var(X) = E(X^2) - [E(X)]^2 = ${variance}.`,
      numericValue: variance,
      tolerance: 0.001,
    },
    difficulty: "challenge" as const,
    hints: [
      "Find E(X) and E(X^2) separately.",
      "Use Var(X) = E(X^2) - [E(X)]^2.",
    ],
    misconceptions: [
      {
        feedback: "Variance uses squared deviations or E(X^2), not just E(X).",
        id: "uses-mean-as-variance",
        matchTerms: ["mean"],
      },
    ],
    prompt: `A support queue has X follow-up messages with values 0, 1, and ${high}, with probabilities 0.20, 0.50, and 0.30. What is Var(X)?`,
    solutionSteps: [
      `Compute E(X) = 0(0.20) + 1(0.50) + ${high}(0.30) = ${mean}.`,
      `Compute E(X^2) = 0^2(0.20) + 1^2(0.50) + ${high}^2(0.30) = ${secondMoment}.`,
      `Subtract the squared mean: ${secondMoment} - ${mean}^2 = ${variance}.`,
    ],
    title: "Regenerated variance item",
  }
}

function normalCandidate(sequence: number) {
  const mean = 70 + sequence * 2
  const standardDeviation = 8
  const value = mean + 12
  const zScore = round((value - mean) / standardDeviation)

  return {
    answer: {
      acceptedAnswers: [String(zScore)],
      explanation: `Standardize with z = (x - mean) / standard deviation = (${value} - ${mean}) / ${standardDeviation} = ${zScore}.`,
      numericValue: zScore,
      tolerance: 0.001,
    },
    difficulty: "foundational" as const,
    hints: [
      "Subtract the mean before dividing.",
      "Divide by the standard deviation.",
    ],
    misconceptions: [
      {
        feedback: "Do not divide by the mean; divide the distance from the mean by the standard deviation.",
        id: "divides-by-mean",
        matchTerms: ["mean"],
      },
    ],
    prompt: `Scores on a placement check are approximately normal with mean ${mean} and standard deviation ${standardDeviation}. What is the z-score for a score of ${value}?`,
    solutionSteps: [
      `Subtract the mean: ${value} - ${mean} = ${value - mean}.`,
      `Divide by the standard deviation: ${value - mean}/${standardDeviation} = ${zScore}.`,
    ],
    title: "Regenerated normal standardization item",
  }
}

function combinationCandidate(sequence: number) {
  const total = 7 + sequence
  const selected = 3
  const count = combination(total, selected)

  return {
    answer: {
      acceptedAnswers: [String(count)],
      explanation: `Order does not matter, so use C(${total}, ${selected}) = ${count}.`,
      numericValue: count,
      tolerance: 0,
    },
    difficulty: "foundational" as const,
    hints: [
      "Decide whether order matters.",
      "Use combinations because this is a selected group.",
    ],
    misconceptions: [
      {
        feedback: "Use combinations, not permutations, when order does not matter.",
        id: "uses-permutation",
        matchTerms: ["order", "permutation"],
      },
    ],
    prompt: `A professor chooses ${selected} workshop topics from a list of ${total} possible topics. How many different sets of topics can be chosen if order does not matter?`,
    solutionSteps: [
      `Use the combination formula C(n, k).`,
      `Substitute n = ${total} and k = ${selected}.`,
      `C(${total}, ${selected}) = ${count}.`,
    ],
    title: "Regenerated combinations item",
  }
}

function proportionCandidate(sequence: number) {
  const successes = 18 + sequence * 3
  const total = 45 + sequence * 5
  const probability = round(successes / total)

  return {
    answer: {
      acceptedAnswers: [String(probability), `${successes}/${total}`],
      explanation: `Divide the successful outcomes by the total outcomes: ${successes}/${total} = ${probability}.`,
      numericValue: probability,
      tolerance: 0.001,
    },
    difficulty: "foundational" as const,
    hints: [
      "Identify the count of successful outcomes.",
      "Divide by the total number of outcomes.",
    ],
    misconceptions: [
      {
        feedback: "Use successes over total outcomes, not total over successes.",
        id: "reverses-ratio",
        matchTerms: [`${total}/${successes}`],
      },
    ],
    prompt: `A campus service desk resolved ${successes} of ${total} requests during the first visit. What proportion of requests were resolved during the first visit?`,
    solutionSteps: [
      `The success count is ${successes}.`,
      `The total count is ${total}.`,
      `Compute ${successes}/${total} = ${probability}.`,
    ],
    title: "Regenerated probability proportion item",
  }
}

function round(value: number) {
  return Number(value.toFixed(4))
}

function combination(n: number, k: number) {
  if (k < 0 || k > n) {
    return 0
  }

  const adjustedK = Math.min(k, n - k)
  let numerator = 1
  let denominator = 1

  for (let index = 1; index <= adjustedK; index += 1) {
    numerator *= n - adjustedK + index
    denominator *= index
  }

  return numerator / denominator
}
