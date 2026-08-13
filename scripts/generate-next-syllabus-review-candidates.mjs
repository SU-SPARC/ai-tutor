#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCanonicalSyllabusTopics } from "./lib/canonical-syllabus-topics.mjs"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const outputPath = path.join(
  repoRoot,
  "data/demo/next-syllabus-review-candidates.json",
)
const checkOnly = process.argv.includes("--check")

const canonicalTopics = await loadCanonicalSyllabusTopics(repoRoot)
const EXPECTED_TOPIC_IDS = canonicalTopics
  .filter(({ order }) => [3, 4, 5].includes(order))
  .map(({ id }) => id)
const ORIGINALITY_NOTE =
  "Original practice draft generated from an abstract probability pattern."

const conditionalCountSpecs = [
  {
    id: "makerspace-evening",
    title: "Makerspace Evening Session",
    prompt:
      "A makerspace has 21 members registered for the evening session. Of those members, 8 reserved a soldering station. Given that a randomly selected member is registered for the evening session, what is the probability that the member reserved a soldering station?",
    favorable: 8,
    conditionedTotal: 21,
  },
  {
    id: "transit-mobile-pass",
    title: "Transit Mobile Pass",
    prompt:
      "Among 28 commuters who ride the express route, 11 use a mobile pass. Given that a randomly selected commuter rides the express route, what is the probability that the commuter uses a mobile pass?",
    favorable: 11,
    conditionedTotal: 28,
  },
  {
    id: "studio-window-seat",
    title: "Studio Window Seat",
    prompt:
      "A design studio has 24 participants in its morning group, and 9 of them selected a window seat. Given that a randomly selected participant is in the morning group, what is the probability that the participant selected a window seat?",
    favorable: 9,
    conditionedTotal: 24,
  },
  {
    id: "garden-tool-loan",
    title: "Garden Tool Loan",
    prompt:
      "Of 30 volunteers assigned to the community garden, 13 borrowed a tool kit. Given that a randomly selected volunteer is assigned to the garden, what is the probability that the volunteer borrowed a tool kit?",
    favorable: 13,
    conditionedTotal: 30,
  },
]

const independenceSpecs = [
  {
    id: "badge-and-coffee",
    title: "Independent Badge and Coffee Choices",
    prompt:
      "At an event, a visitor independently receives a blue badge with probability 0.4 and chooses coffee with probability 0.3. What is the probability that the visitor receives a blue badge and chooses coffee?",
    pA: 0.4,
    pB: 0.3,
  },
  {
    id: "bus-and-locker",
    title: "Independent Bus and Locker Events",
    prompt:
      "A student rides the bus with probability 0.65 and, independently, rents a locker with probability 0.2. What is the probability that both events occur?",
    pA: 0.65,
    pB: 0.2,
  },
  {
    id: "quiz-and-reminder",
    title: "Independent Quiz and Reminder Events",
    prompt:
      "A learner completes a daily quiz with probability 0.75 and, independently, opens a study reminder with probability 0.8. What is the probability that the learner does both?",
    pA: 0.75,
    pB: 0.8,
  },
  {
    id: "poster-and-table",
    title: "Independent Poster and Table Choices",
    prompt:
      "An exhibitor selects a large poster with probability 0.25 and, independently, selects a corner table with probability 0.6. What is the probability that both selections are made?",
    pA: 0.25,
    pB: 0.6,
  },
]

const totalProbabilitySpecs = [
  {
    id: "repair-routing",
    title: "Repair Routing Probability",
    prompt:
      "A service desk routes 30% of requests to team A and the rest to team B. Team A resolves a request on the first attempt with probability 0.8, while team B does so with probability 0.2. What is the probability that a randomly selected request is resolved on the first attempt?",
    groupRate: 0.3,
    rateA: 0.8,
    rateB: 0.2,
  },
  {
    id: "greenhouse-germination",
    title: "Greenhouse Germination Probability",
    prompt:
      "A greenhouse places 40% of seeds in tray A and the rest in tray B. A seed germinates with probability 0.7 in tray A and 0.1 in tray B. What is the probability that a randomly selected seed germinates?",
    groupRate: 0.4,
    rateA: 0.7,
    rateB: 0.1,
  },
  {
    id: "library-return",
    title: "Library Return Probability",
    prompt:
      "A library sends 25% of reminders by text and the rest by email. A borrowed item is returned that day with probability 0.9 after a text reminder and 0.3 after an email reminder. What is the probability that a randomly selected reminded item is returned that day?",
    groupRate: 0.25,
    rateA: 0.9,
    rateB: 0.3,
  },
  {
    id: "workshop-completion",
    title: "Workshop Completion Probability",
    prompt:
      "A workshop assigns 60% of participants to a guided track and the rest to a self-paced track. Completion probabilities are 0.5 for the guided track and 0.15 for the self-paced track. What is the probability that a randomly selected participant completes the workshop?",
    groupRate: 0.6,
    rateA: 0.5,
    rateB: 0.15,
  },
]

const bayesSpecs = [
  {
    id: "sensor-alert",
    title: "Sensor Alert Update",
    prompt:
      "A sensor is installed in a location with an issue on 20% of days. It sends an alert with probability 0.8 when an issue is present and with probability 0.1 when no issue is present. If the sensor sends an alert, what is the probability that an issue is present?",
    prior: 0.2,
    trueRate: 0.8,
    falseRate: 0.1,
  },
  {
    id: "portfolio-shortlist",
    title: "Portfolio Shortlist Update",
    prompt:
      "Twenty-five percent of submitted portfolios use format A. A portfolio is shortlisted with probability 0.75 when it uses format A and with probability 0.15 otherwise. Given that a portfolio was shortlisted, what is the probability that it used format A?",
    prior: 0.25,
    trueRate: 0.75,
    falseRate: 0.15,
  },
  {
    id: "maintenance-flag",
    title: "Maintenance Flag Update",
    prompt:
      "Ten percent of machines need maintenance. A monitor flags a machine with probability 0.9 when maintenance is needed and with probability 0.05 otherwise. Given that a machine is flagged, what is the probability that it needs maintenance?",
    prior: 0.1,
    trueRate: 0.9,
    falseRate: 0.05,
  },
  {
    id: "priority-message",
    title: "Priority Message Update",
    prompt:
      "Thirty percent of incoming messages are priority messages. A filter marks a priority message with probability 0.7 and marks a nonpriority message with probability 0.2. Given that a message is marked, what is the probability that it is a priority message?",
    prior: 0.3,
    trueRate: 0.7,
    falseRate: 0.2,
  },
]

const withoutReplacementSpecs = [
  {
    id: "blue-gold-tokens",
    title: "Second Gold Token",
    prompt:
      "A bag contains 6 blue tokens and 4 gold tokens. Two tokens are drawn without replacement. Given that the first token is blue, what is the probability that the second token is gold?",
    firstCount: 6,
    favorableCount: 4,
    total: 10,
  },
  {
    id: "novel-reference-books",
    title: "Second Reference Book",
    prompt:
      "A shelf has 7 novels and 5 reference books. Two books are selected without replacement. Given that the first selected book is a novel, what is the probability that the second book is a reference book?",
    firstCount: 7,
    favorableCount: 5,
    total: 12,
  },
  {
    id: "standard-express-tickets",
    title: "Second Express Ticket",
    prompt:
      "A box holds 9 standard tickets and 3 express tickets. Two tickets are drawn without replacement. Given that the first ticket is standard, what is the probability that the second ticket is express?",
    firstCount: 9,
    favorableCount: 3,
    total: 12,
  },
  {
    id: "oak-maple-saplings",
    title: "Second Maple Sapling",
    prompt:
      "A nursery row contains 8 oak saplings and 6 maple saplings. Two saplings are chosen without replacement. Given that the first chosen sapling is oak, what is the probability that the second is maple?",
    firstCount: 8,
    favorableCount: 6,
    total: 14,
  },
]

const missingPmfSpecs = [
  {
    id: "pmf-missing-deliveries",
    title: "Missing Delivery PMF Value",
    values: [0, 1, 2, 3],
    probabilities: [0.18, 0.35, 0.27, null],
  },
  {
    id: "pmf-missing-calls",
    title: "Missing Call PMF Value",
    values: [0, 1, 2, 3],
    probabilities: [0.12, null, 0.31, 0.22],
  },
  {
    id: "pmf-missing-tasks",
    title: "Missing Task PMF Value",
    values: [1, 2, 3, 4],
    probabilities: [0.2, 0.3, null, 0.1],
  },
  {
    id: "pmf-missing-visits",
    title: "Missing Visit PMF Value",
    values: [0, 1, 2, 3, 4],
    probabilities: [0.1, 0.25, 0.3, null, 0.15],
  },
]

const pmfEventSpecs = [
  {
    id: "pmf-event-ge-two",
    title: "PMF Event at Least Two",
    values: [0, 1, 2, 3],
    probabilities: [0.1, 0.25, 0.4, 0.25],
    event: "X is at least 2",
    selected: [2, 3],
  },
  {
    id: "pmf-event-le-one",
    title: "PMF Event at Most One",
    values: [0, 1, 2, 3],
    probabilities: [0.22, 0.33, 0.28, 0.17],
    event: "X is at most 1",
    selected: [0, 1],
  },
  {
    id: "pmf-event-odd",
    title: "PMF Odd-Value Event",
    values: [0, 1, 2, 3, 4],
    probabilities: [0.12, 0.18, 0.26, 0.24, 0.2],
    event: "X is odd",
    selected: [1, 3],
  },
  {
    id: "pmf-event-between",
    title: "PMF Middle-Value Event",
    values: [1, 2, 3, 4],
    probabilities: [0.15, 0.3, 0.35, 0.2],
    event: "2 <= X <= 3",
    selected: [2, 3],
  },
]

const cdfSpecs = [
  {
    id: "cdf-at-one",
    title: "CDF at One",
    values: [0, 1, 2, 3],
    probabilities: [0.16, 0.34, 0.29, 0.21],
    threshold: 1,
  },
  {
    id: "cdf-at-two-point-five",
    title: "CDF at 2.5",
    values: [0, 1, 2, 3, 4],
    probabilities: [0.08, 0.2, 0.32, 0.25, 0.15],
    threshold: 2.5,
  },
  {
    id: "cdf-at-negative-one",
    title: "CDF at Negative One",
    values: [-2, -1, 0, 1],
    probabilities: [0.15, 0.25, 0.4, 0.2],
    threshold: -1,
  },
  {
    id: "cdf-at-three",
    title: "CDF at Three",
    values: [1, 2, 3, 4, 5],
    probabilities: [0.1, 0.18, 0.27, 0.25, 0.2],
    threshold: 3,
  },
]

const expectationSpecs = [
  {
    id: "expectation-reward",
    title: "Expected Reward Points",
    values: [0, 2, 5],
    probabilities: [0.3, 0.5, 0.2],
  },
  {
    id: "expectation-repairs",
    title: "Expected Repair Count",
    values: [0, 1, 2, 3],
    probabilities: [0.25, 0.4, 0.25, 0.1],
  },
  {
    id: "expectation-tokens",
    title: "Expected Token Count",
    values: [1, 3, 6],
    probabilities: [0.45, 0.35, 0.2],
  },
  {
    id: "expectation-hours",
    title: "Expected Support Hours",
    values: [0, 2, 4, 6],
    probabilities: [0.1, 0.35, 0.4, 0.15],
  },
]

const varianceSpecs = [
  {
    id: "variance-small-count",
    title: "Variance of a Small Count",
    values: [0, 1, 2],
    probabilities: [0.2, 0.5, 0.3],
  },
  {
    id: "variance-credit",
    title: "Variance of a Credit Value",
    values: [0, 2, 4],
    probabilities: [0.25, 0.5, 0.25],
  },
  {
    id: "variance-visits",
    title: "Variance of Visit Count",
    values: [1, 2, 3, 4],
    probabilities: [0.1, 0.4, 0.3, 0.2],
  },
  {
    id: "variance-delay",
    title: "Variance of Delay Units",
    values: [0, 1, 3],
    probabilities: [0.4, 0.35, 0.25],
  },
]

const bernoulliSpecs = [
  {
    id: "bernoulli-mean-checkin",
    title: "Bernoulli Check-In Mean",
    prompt:
      "Let X equal 1 when a participant checks in before noon and 0 otherwise. If the probability of checking in before noon is 0.72, what is E[X]?",
    p: 0.72,
    kind: "mean",
  },
  {
    id: "bernoulli-variance-reply",
    title: "Bernoulli Reply Variance",
    prompt:
      "Let X equal 1 when a message receives a reply and 0 otherwise. If P(X = 1) = 0.4, what is Var(X)?",
    p: 0.4,
    kind: "variance",
  },
  {
    id: "bernoulli-mean-pass",
    title: "Bernoulli Pass Mean",
    prompt:
      "Let X equal 1 when a quality check passes and 0 otherwise. If the pass probability is 0.85, what is E[X]?",
    p: 0.85,
    kind: "mean",
  },
  {
    id: "bernoulli-variance-open",
    title: "Bernoulli Open Variance",
    prompt:
      "Let X equal 1 when a notification is opened and 0 otherwise. If P(X = 1) = 0.25, what is Var(X)?",
    p: 0.25,
    kind: "variance",
  },
]

const binomialSpecs = [
  {
    id: "binomial-samples",
    title: "Exactly Three Successful Samples",
    prompt:
      "Eight independent samples each pass a check with probability 0.55. What is the probability that exactly 3 samples pass?",
    n: 8,
    k: 3,
    p: 0.55,
  },
  {
    id: "binomial-signups",
    title: "Exactly Four Signups",
    prompt:
      "Ten independent visitors each sign up for a newsletter with probability 0.3. What is the probability that exactly 4 visitors sign up?",
    n: 10,
    k: 4,
    p: 0.3,
  },
  {
    id: "binomial-goals",
    title: "Exactly Five Daily Goals",
    prompt:
      "Seven independent daily goals are each completed with probability 0.7. What is the probability that exactly 5 goals are completed?",
    n: 7,
    k: 5,
    p: 0.7,
  },
  {
    id: "binomial-arrivals",
    title: "Exactly Two On-Time Arrivals",
    prompt:
      "Six independent arrivals are each on time with probability 0.8. What is the probability that exactly 2 arrivals are on time?",
    n: 6,
    k: 2,
    p: 0.8,
  },
]

const geometricSpecs = [
  {
    id: "geometric-first-reply",
    title: "First Reply on Attempt Four",
    prompt:
      "Independent contact attempts receive a reply with probability 0.35. What is the probability that the first reply occurs on the 4th attempt?",
    p: 0.35,
    k: 4,
  },
  {
    id: "geometric-first-success",
    title: "First Success on Trial Three",
    prompt:
      "Independent trials succeed with probability 0.6. What is the probability that the first success occurs on the 3rd trial?",
    p: 0.6,
    k: 3,
  },
  {
    id: "geometric-first-defect",
    title: "First Defect on Inspection Five",
    prompt:
      "Independent inspected items are defective with probability 0.1. What is the probability that the first defective item is found on the 5th inspection?",
    p: 0.1,
    k: 5,
  },
  {
    id: "geometric-first-booking",
    title: "First Booking on Call Two",
    prompt:
      "Independent calls produce a booking with probability 0.25. What is the probability that the first booking occurs on the 2nd call?",
    p: 0.25,
    k: 2,
  },
]

const poissonSpecs = [
  {
    id: "poisson-two-arrivals",
    title: "Two Arrivals in an Interval",
    prompt:
      "Arrivals in a 10-minute interval follow a Poisson distribution with mean 1.8. What is the probability of exactly 2 arrivals in an interval?",
    lambda: 1.8,
    k: 2,
  },
  {
    id: "poisson-zero-errors",
    title: "Zero Errors on a Page",
    prompt:
      "The number of errors on a page follows a Poisson distribution with mean 0.7. What is the probability of zero errors on a page?",
    lambda: 0.7,
    k: 0,
  },
  {
    id: "poisson-three-requests",
    title: "Three Requests per Minute",
    prompt:
      "Requests per minute follow a Poisson distribution with mean 2.4. What is the probability of exactly 3 requests in a minute?",
    lambda: 2.4,
    k: 3,
  },
  {
    id: "poisson-one-repair",
    title: "One Repair per Day",
    prompt:
      "Repair calls per day follow a Poisson distribution with mean 1.2. What is the probability of exactly 1 repair call in a day?",
    lambda: 1.2,
    k: 1,
  },
]

const hypergeometricSpecs = [
  {
    id: "hypergeometric-blue-parts",
    title: "Two Blue Parts",
    prompt:
      "A bin contains 7 blue parts and 5 silver parts. Four parts are selected without replacement. What is the probability that exactly 2 selected parts are blue?",
    success: 7,
    failure: 5,
    draws: 4,
    selectedSuccess: 2,
  },
  {
    id: "hypergeometric-featured-books",
    title: "One Featured Book",
    prompt:
      "A shelf contains 6 featured books and 9 other books. Three books are selected without replacement. What is the probability that exactly 1 selected book is featured?",
    success: 6,
    failure: 9,
    draws: 3,
    selectedSuccess: 1,
  },
  {
    id: "hypergeometric-priority-tickets",
    title: "Three Priority Tickets",
    prompt:
      "A queue contains 8 priority tickets and 12 standard tickets. Five tickets are selected without replacement. What is the probability that exactly 3 selected tickets are priority tickets?",
    success: 8,
    failure: 12,
    draws: 5,
    selectedSuccess: 3,
  },
  {
    id: "hypergeometric-green-seeds",
    title: "Two Green Seed Packets",
    prompt:
      "A tray contains 5 green seed packets and 7 yellow seed packets. Three packets are selected without replacement. What is the probability that exactly 2 selected packets are green?",
    success: 5,
    failure: 7,
    draws: 3,
    selectedSuccess: 2,
  },
]

function buildCandidates(topicMap) {
  return [
    ...buildConditionalCandidates(topicMap.get(EXPECTED_TOPIC_IDS[0])),
    ...buildRandomVariableCandidates(topicMap.get(EXPECTED_TOPIC_IDS[1])),
    ...buildDiscreteModelCandidates(topicMap.get(EXPECTED_TOPIC_IDS[2])),
  ]
}

function buildConditionalCandidates(topic) {
  return [
    ...conditionalCountSpecs.map((spec) => {
      const answer = fractionAnswer(spec.favorable, spec.conditionedTotal)
      return candidate(topic, {
        ...spec,
        answer,
        difficulty: "foundational",
        patternSource: "conditional restricted-sample-space pattern",
        hints: [
          "Use the group named after the word given as the sample space.",
          "Divide the favorable count within that group by its total.",
        ],
        solutionSteps: [
          `The condition restricts the sample space to ${spec.conditionedTotal} outcomes.`,
          `${spec.favorable} of those outcomes are favorable.`,
          `The conditional probability is ${answer.acceptedAnswers[0]}, or about ${formatDecimal(answer.numericValue)}.`,
        ],
        misconception: misconception(
          "uses-unconditioned-space",
          "The denominator must be the conditioned group, not a larger original population.",
        ),
      })
    }),
    ...independenceSpecs.map((spec) => {
      const value = spec.pA * spec.pB
      return candidate(topic, {
        ...spec,
        answer: decimalAnswer(value),
        difficulty: "foundational",
        patternSource: "independent-event intersection pattern",
        hints: [
          "The problem states that the two events are independent.",
          "For independent events, multiply their probabilities.",
        ],
        solutionSteps: [
          "For independent events A and B, P(A and B) = P(A)P(B).",
          `Substitute the probabilities: ${spec.pA} * ${spec.pB}.`,
          `The probability of both events is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "adds-independent-probabilities",
          "For an intersection of independent events, multiply rather than add the two probabilities.",
        ),
      })
    }),
    ...totalProbabilitySpecs.map((spec) => {
      const otherRate = 1 - spec.groupRate
      const value = spec.groupRate * spec.rateA + otherRate * spec.rateB
      return candidate(topic, {
        ...spec,
        answer: decimalAnswer(value),
        difficulty: "intermediate",
        patternSource: "two-group total-probability pattern",
        hints: [
          "Split the desired event by the two mutually exclusive groups.",
          "Weight each conditional rate by its group probability, then add.",
        ],
        solutionSteps: [
          `The second group has probability 1 - ${spec.groupRate} = ${formatDecimal(otherRate)}.`,
          `The two weighted contributions are ${spec.groupRate} * ${spec.rateA} and ${formatDecimal(otherRate)} * ${spec.rateB}.`,
          `Their sum is ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "averages-conditional-rates",
          "The conditional rates need group-probability weights; a simple average is generally incorrect.",
        ),
      })
    }),
    ...bayesSpecs.map((spec) => {
      const jointTrue = spec.prior * spec.trueRate
      const jointFalse = (1 - spec.prior) * spec.falseRate
      const value = jointTrue / (jointTrue + jointFalse)
      return candidate(topic, {
        ...spec,
        answer: decimalAnswer(value),
        difficulty: "challenge",
        patternSource: "Bayes posterior-update pattern",
        hints: [
          "Compute the joint probability of the target group and the observed mark.",
          "Divide that joint probability by the total probability of the mark.",
        ],
        solutionSteps: [
          `The target-and-marked probability is ${spec.prior} * ${spec.trueRate} = ${formatDecimal(jointTrue)}.`,
          `The other-and-marked probability is ${formatDecimal(1 - spec.prior)} * ${spec.falseRate} = ${formatDecimal(jointFalse)}.`,
          `Bayes' formula gives ${formatDecimal(jointTrue)} / ${formatDecimal(jointTrue + jointFalse)} = ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "ignores-base-rate",
          "A conditional mark rate is not the posterior probability; include the base rates of both groups.",
        ),
      })
    }),
    ...withoutReplacementSpecs.map((spec) => {
      const remainingTotal = spec.total - 1
      const answer = fractionAnswer(spec.favorableCount, remainingTotal)
      return candidate(topic, {
        ...spec,
        answer,
        difficulty: "intermediate",
        patternSource: "conditional draw-without-replacement pattern",
        hints: [
          "Condition on the stated first draw before counting what remains.",
          "The total number of remaining objects is one less than the original total.",
        ],
        solutionSteps: [
          `After the stated first draw, ${remainingTotal} objects remain.`,
          `The first draw removed a different type, so all ${spec.favorableCount} favorable objects remain.`,
          `The conditional probability is ${answer.acceptedAnswers[0]}, or about ${formatDecimal(answer.numericValue)}.`,
        ],
        misconception: misconception(
          "keeps-original-denominator",
          "Without replacement, the second-draw denominator is one less than the original total.",
        ),
      })
    }),
  ]
}

function buildRandomVariableCandidates(topic) {
  return [
    ...missingPmfSpecs.map((spec) => {
      const missingIndex = spec.probabilities.indexOf(null)
      const givenSum = spec.probabilities.reduce(
        (sum, probability) => sum + (probability ?? 0),
        0,
      )
      const value = 1 - givenSum
      return candidate(topic, {
        ...spec,
        prompt: `A discrete random variable X has PMF ${renderDistribution(spec.values, spec.probabilities)}. What is P(X = ${spec.values[missingIndex]})?`,
        answer: decimalAnswer(value),
        difficulty: "foundational",
        patternSource: "complete-a-discrete-PMF pattern",
        hints: [
          "All probabilities in a PMF must add to 1.",
          "Subtract the sum of the known probabilities from 1.",
        ],
        solutionSteps: [
          `The known probabilities sum to ${formatDecimal(givenSum)}.`,
          `The missing probability is 1 - ${formatDecimal(givenSum)}.`,
          `Therefore P(X = ${spec.values[missingIndex]}) = ${formatDecimal(value)}.`,
        ],
        misconception: misconception(
          "does-not-normalize-pmf",
          "A valid PMF has total probability 1, so the missing value must complete that total.",
        ),
      })
    }),
    ...pmfEventSpecs.map((spec) => {
      const selectedProbabilities = spec.selected.map(
        (value) => spec.probabilities[spec.values.indexOf(value)],
      )
      const result = selectedProbabilities.reduce(
        (sum, value) => sum + value,
        0,
      )
      return candidate(topic, {
        ...spec,
        prompt: `A discrete random variable X has PMF ${renderDistribution(spec.values, spec.probabilities)}. Find the probability that ${spec.event}.`,
        answer: decimalAnswer(result),
        difficulty: "foundational",
        patternSource: "sum-PMF-event-probabilities pattern",
        hints: [
          "Identify every value of X that belongs to the event.",
          "Add the PMF values for those outcomes.",
        ],
        solutionSteps: [
          `The event includes X values ${spec.selected.join(", ")}.`,
          `Add their probabilities: ${selectedProbabilities.join(" + ")}.`,
          `The event probability is ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "counts-values-instead-of-probabilities",
          "Add the probabilities attached to qualifying values, not the values of the random variable themselves.",
        ),
      })
    }),
    ...cdfSpecs.map((spec) => {
      const included = spec.values.filter((value) => value <= spec.threshold)
      const includedProbabilities = included.map(
        (value) => spec.probabilities[spec.values.indexOf(value)],
      )
      const result = includedProbabilities.reduce(
        (sum, probability) => sum + probability,
        0,
      )
      return candidate(topic, {
        ...spec,
        prompt: `A discrete random variable X has PMF ${renderDistribution(spec.values, spec.probabilities)}. Find F(${spec.threshold}) = P(X <= ${spec.threshold}).`,
        answer: decimalAnswer(result),
        difficulty: "intermediate",
        patternSource: "discrete-CDF evaluation pattern",
        hints: [
          "A CDF includes every probability at or below its input.",
          "Sum the PMF values for all X values no greater than the threshold.",
        ],
        solutionSteps: [
          `The values no greater than ${spec.threshold} are ${included.join(", ")}.`,
          `Their probabilities are ${includedProbabilities.join(", ")}.`,
          `Thus F(${spec.threshold}) = ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "uses-point-probability-for-cdf",
          "A CDF is cumulative; it includes all probability at or below the threshold.",
        ),
      })
    }),
    ...expectationSpecs.map((spec) => {
      const products = spec.values.map(
        (value, index) => value * spec.probabilities[index],
      )
      const result = products.reduce((sum, value) => sum + value, 0)
      return candidate(topic, {
        ...spec,
        prompt: `A discrete random variable X has PMF ${renderDistribution(spec.values, spec.probabilities)}. Find E[X].`,
        answer: numericAnswer(result),
        difficulty: "intermediate",
        patternSource: "discrete-expectation weighted-sum pattern",
        hints: [
          "Multiply each possible value by its probability.",
          "Add all of the value-probability products.",
        ],
        solutionSteps: [
          "Use E[X] = sum of x times P(X = x).",
          `The products are ${products
            .map((value) => formatDecimal(value))
            .join(", ")}.`,
          `Their sum is E[X] = ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "takes-unweighted-average",
          "Expectation is a probability-weighted sum, not an unweighted average of the possible values.",
        ),
      })
    }),
    ...varianceSpecs.map((spec) => {
      const mean = spec.values.reduce(
        (sum, value, index) => sum + value * spec.probabilities[index],
        0,
      )
      const secondMoment = spec.values.reduce(
        (sum, value, index) => sum + value * value * spec.probabilities[index],
        0,
      )
      const result = secondMoment - mean * mean
      return candidate(topic, {
        ...spec,
        prompt: `A discrete random variable X has PMF ${renderDistribution(spec.values, spec.probabilities)}. Find Var(X).`,
        answer: numericAnswer(result),
        difficulty: "challenge",
        patternSource: "discrete-variance moment pattern",
        hints: [
          "First compute E[X] and E[X squared].",
          "Use Var(X) = E[X squared] - (E[X]) squared.",
        ],
        solutionSteps: [
          `The mean is E[X] = ${formatDecimal(mean)}.`,
          `The second moment is E[X squared] = ${formatDecimal(secondMoment)}.`,
          `Var(X) = ${formatDecimal(secondMoment)} - (${formatDecimal(mean)}) squared = ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "forgets-to-square-mean",
          "The shortcut subtracts the square of E[X], not E[X] itself.",
        ),
      })
    }),
  ]
}

function buildDiscreteModelCandidates(topic) {
  return [
    ...bernoulliSpecs.map((spec) => {
      const result = spec.kind === "mean" ? spec.p : spec.p * (1 - spec.p)
      return candidate(topic, {
        ...spec,
        answer: numericAnswer(result),
        difficulty: "foundational",
        patternSource: "Bernoulli mean-or-variance pattern",
        hints:
          spec.kind === "mean"
            ? [
                "A Bernoulli random variable takes values 0 and 1.",
                "Its expected value equals its success probability.",
              ]
            : [
                "A Bernoulli random variable has variance p(1 - p).",
                `Use p = ${spec.p} and 1 - p = ${formatDecimal(1 - spec.p)}.`,
              ],
        solutionSteps:
          spec.kind === "mean"
            ? [
                "For a Bernoulli random variable, E[X] = p.",
                `Here p = ${spec.p}.`,
                `Therefore E[X] = ${formatDecimal(result)}.`,
              ]
            : [
                "For a Bernoulli random variable, Var(X) = p(1 - p).",
                `Substitute p = ${spec.p}: ${spec.p} * ${formatDecimal(1 - spec.p)}.`,
                `Therefore Var(X) = ${formatDecimal(result)}.`,
              ],
        misconception: misconception(
          "uses-wrong-bernoulli-formula",
          spec.kind === "mean"
            ? "The Bernoulli mean is p; no extra factor is needed."
            : "Bernoulli variance is p(1 - p), not p alone.",
        ),
      })
    }),
    ...binomialSpecs.map((spec) => {
      const result =
        combination(spec.n, spec.k) *
        spec.p ** spec.k *
        (1 - spec.p) ** (spec.n - spec.k)
      return candidate(topic, {
        ...spec,
        answer: decimalAnswer(result),
        difficulty: "intermediate",
        patternSource: "binomial exact-count pattern",
        hints: [
          "Use the binomial model with n trials, k successes, and success probability p.",
          "Include the combination factor for all placements of the successes.",
        ],
        solutionSteps: [
          `Here n = ${spec.n}, k = ${spec.k}, and p = ${spec.p}.`,
          `Compute C(${spec.n}, ${spec.k})(${spec.p})^${spec.k}(${formatDecimal(1 - spec.p)})^${spec.n - spec.k}.`,
          `The result is ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "omits-binomial-coefficient",
          "The combination factor counts every possible placement of the specified number of successes.",
        ),
      })
    }),
    ...geometricSpecs.map((spec) => {
      const result = (1 - spec.p) ** (spec.k - 1) * spec.p
      return candidate(topic, {
        ...spec,
        answer: decimalAnswer(result),
        difficulty: "intermediate",
        patternSource: "geometric first-success pattern",
        hints: [
          `The first ${spec.k - 1} trials must fail.`,
          `Multiply those failure probabilities by a success on trial ${spec.k}.`,
        ],
        solutionSteps: [
          `The failure probability is 1 - ${spec.p} = ${formatDecimal(1 - spec.p)}.`,
          `Use (${formatDecimal(1 - spec.p)})^${spec.k - 1} * ${spec.p}.`,
          `The first-success probability is ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "counts-success-too-early",
          "For the first success to occur on trial k, every earlier trial must be a failure.",
        ),
      })
    }),
    ...poissonSpecs.map((spec) => {
      const result =
        (Math.exp(-spec.lambda) * spec.lambda ** spec.k) / factorial(spec.k)
      return candidate(topic, {
        ...spec,
        answer: decimalAnswer(result),
        difficulty: "intermediate",
        patternSource: "Poisson exact-count pattern",
        hints: [
          "Use P(X = k) = exp(-lambda) times lambda^k divided by k factorial.",
          "Substitute the mean for lambda and the requested count for k.",
        ],
        solutionSteps: [
          `Here lambda = ${spec.lambda} and k = ${spec.k}.`,
          `Compute exp(-${spec.lambda})(${spec.lambda})^${spec.k}/${spec.k}!.`,
          `The probability is approximately ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "uses-poisson-mean-as-probability",
          "The Poisson mean is a rate parameter, not the final event probability; use the full PMF.",
        ),
      })
    }),
    ...hypergeometricSpecs.map((spec) => {
      const numerator =
        combination(spec.success, spec.selectedSuccess) *
        combination(spec.failure, spec.draws - spec.selectedSuccess)
      const denominator = combination(spec.success + spec.failure, spec.draws)
      const result = numerator / denominator
      return candidate(topic, {
        ...spec,
        answer: decimalAnswer(result),
        difficulty: "challenge",
        patternSource: "hypergeometric exact-count pattern",
        hints: [
          "Because selection is without replacement, use combinations rather than a binomial model.",
          "Choose the requested successes and the remaining draws from the other group.",
        ],
        solutionSteps: [
          `Choose ${spec.selectedSuccess} of the ${spec.success} target objects and ${spec.draws - spec.selectedSuccess} of the ${spec.failure} other objects.`,
          `Divide C(${spec.success}, ${spec.selectedSuccess})C(${spec.failure}, ${spec.draws - spec.selectedSuccess}) by C(${spec.success + spec.failure}, ${spec.draws}).`,
          `The probability is ${formatDecimal(result)}.`,
        ],
        misconception: misconception(
          "assumes-replacement",
          "Selections without replacement are dependent, so a fixed-p binomial calculation is not appropriate.",
        ),
      })
    }),
  ]
}

function candidate(topic, spec) {
  if (!topic) {
    throw new Error("Cannot build a candidate without a syllabus topic.")
  }

  return {
    id: `generated-next-${spec.id}`,
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
  return {
    id,
    matchTerms: [],
    feedback,
  }
}

function renderDistribution(values, probabilities) {
  return values
    .map((value, index) => `P(X = ${value}) = ${probabilities[index] ?? "?"}`)
    .join(", ")
}

function fractionAnswer(numerator, denominator) {
  const divisor = gcd(numerator, denominator)
  const reducedNumerator = numerator / divisor
  const reducedDenominator = denominator / divisor
  const value = numerator / denominator

  return {
    acceptedAnswers: [
      `${reducedNumerator}/${reducedDenominator}`,
      formatDecimal(value),
      `${formatDecimal(value * 100, 2)}%`,
    ],
    numericValue: value,
    tolerance: 0.001,
  }
}

function decimalAnswer(value) {
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

function gcd(left, right) {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b !== 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
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
  const selected = activeTopics.slice(2, 5)

  if (
    selected.length !== EXPECTED_TOPIC_IDS.length ||
    selected.some((topic, index) => topic.id !== EXPECTED_TOPIC_IDS[index])
  ) {
    throw new Error(
      `Expected the next syllabus topics to be ${EXPECTED_TOPIC_IDS.join(", ")}; received ${selected.map((topic) => topic.id).join(", ")}.`,
    )
  }

  return new Map(selected.map((topic) => [topic.id, topic]))
}

function validateCandidates(candidates, topicMap) {
  if (candidates.length !== 60) {
    throw new Error(
      `Expected exactly 60 candidates; received ${candidates.length}.`,
    )
  }

  const ids = new Set()
  const prompts = new Set()

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
    if (ids.has(candidateItem.id)) {
      throw new Error(`Duplicate generated question id: ${candidateItem.id}`)
    }
    if (prompts.has(candidateItem.prompt)) {
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
    /"patternIds"|"sourceItemIds"|"sourceNumberSets"|"sourceStoryFamilies"|"privatePhraseHashes"|"rawText"|"extractedText"/i.test(
      serialized,
    )
  ) {
    throw new Error(
      "Generated candidates include forbidden private-source metadata.",
    )
  }
}

async function main() {
  const topics = canonicalTopics
  const topicMap = validateTopicSequence(topics)
  const candidates = buildCandidates(topicMap)
  validateCandidates(candidates, topicMap)
  const output = `${JSON.stringify(candidates, null, 2)}\n`

  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8")
    if (existing !== output) {
      throw new Error(
        "Next-syllabus review candidates are stale. Run npm run prepare:next-syllabus-questions.",
      )
    }
    console.log(
      "Next-syllabus review candidates are current: 60 total, 20 per topic.",
    )
    return
  }

  await writeFile(outputPath, output)
  console.log(
    "Generated 60 review-gated candidates for syllabus Weeks 3, 4, and 5.",
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
