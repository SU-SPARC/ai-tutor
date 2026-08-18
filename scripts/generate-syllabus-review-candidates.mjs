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
  "data/demo/syllabus-review-candidates.json",
)
const checkOnly = process.argv.includes("--check")

const canonicalTopics = await loadCanonicalSyllabusTopics(repoRoot)
const INTRO_TOPIC_ID = canonicalTopics.find(({ order }) => order === 1)?.id
const AXIOMS_TOPIC_ID = canonicalTopics.find(({ order }) => order === 2)?.id
const ORIGINALITY_NOTE =
  "Original generated practice draft from a public-safe topic pattern; no private course text used."

const uniformSpecs = [
  {
    id: "uniform-library-cards",
    title: "Library Card Selection",
    prompt:
      "A tray holds 16 equally likely library cards, and 6 are marked for pickup today. If one card is selected at random, what is the probability that it is marked for pickup today?",
    favorable: 6,
    total: 16,
  },
  {
    id: "uniform-spinner-sectors",
    title: "Spinner Sector Probability",
    prompt:
      "A fair spinner has 12 equal sectors, 5 of which are blue. What is the probability that one spin lands on blue?",
    favorable: 5,
    total: 12,
  },
  {
    id: "uniform-numbered-tiles",
    title: "Numbered Tile Event",
    prompt:
      "One tile is chosen at random from tiles numbered 1 through 18. Six of the numbers are multiples of 3. What is the probability of choosing a multiple of 3?",
    favorable: 6,
    total: 18,
  },
  {
    id: "uniform-event-tokens",
    title: "Event Token Probability",
    prompt:
      "A bag contains 20 equally likely event tokens, and 7 tokens show a star. What is the probability that a randomly selected token shows a star?",
    favorable: 7,
    total: 20,
  },
]

const complementSpecs = [
  {
    id: "complement-not-green",
    title: "Not Green Complement",
    prompt:
      "A box contains 15 equally likely markers, 4 of which are green. If one marker is selected at random, what is the probability that it is not green?",
    excluded: 4,
    total: 15,
  },
  {
    id: "complement-not-late",
    title: "Not Late Complement",
    prompt:
      "Among 24 equally likely delivery records, 5 are labeled late. If one record is selected at random, what is the probability that it is not labeled late?",
    excluded: 5,
    total: 24,
  },
  {
    id: "complement-no-defect",
    title: "No Defect Complement",
    prompt:
      "A sample has 30 equally likely components, and 3 have a visible defect. What is the probability that a randomly selected component has no visible defect?",
    excluded: 3,
    total: 30,
  },
  {
    id: "complement-not-weekend",
    title: "Not Weekend Complement",
    prompt:
      "A scheduling tool chooses one of 14 equally likely time slots, and 4 slots are on a weekend. What is the probability that the chosen slot is not on a weekend?",
    excluded: 4,
    total: 14,
  },
]

const vennUnionSpecs = [
  {
    id: "venn-clubs",
    title: "Club Membership Union",
    prompt:
      "In a group of 40 students, 18 joined the coding club, 14 joined the design club, and 6 joined both. If one student is selected at random, what is the probability that the student joined at least one of the two clubs?",
    a: 18,
    b: 14,
    both: 6,
    total: 40,
  },
  {
    id: "venn-workshops",
    title: "Workshop Attendance Union",
    prompt:
      "Of 50 participants, 23 attended a writing workshop, 21 attended a speaking workshop, and 9 attended both. What is the probability that a randomly selected participant attended at least one workshop?",
    a: 23,
    b: 21,
    both: 9,
    total: 50,
  },
  {
    id: "venn-app-features",
    title: "App Feature Union",
    prompt:
      "Among 60 app users, 28 enabled reminders, 25 enabled calendar sync, and 11 enabled both. What is the probability that a randomly selected user enabled at least one of these features?",
    a: 28,
    b: 25,
    both: 11,
    total: 60,
  },
  {
    id: "venn-transit-passes",
    title: "Transit Pass Union",
    prompt:
      "In a survey of 80 commuters, 35 use a bus pass, 32 use a rail pass, and 12 use both. What is the probability that a randomly selected commuter uses at least one of the two passes?",
    a: 35,
    b: 32,
    both: 12,
    total: 80,
  },
]

const vennRegionSpecs = [
  {
    id: "venn-exactly-one-language",
    title: "Exactly One Language Group",
    prompt:
      "Of 36 students, 17 study French, 15 study Spanish, and 6 study both. What is the probability that a randomly selected student studies exactly one of the two languages?",
    a: 17,
    b: 15,
    both: 6,
    total: 36,
    variant: "exactly-one",
  },
  {
    id: "venn-neither-newsletter",
    title: "Neither Newsletter",
    prompt:
      "Among 45 subscribers, 20 read the morning newsletter, 18 read the evening newsletter, and 8 read both. What is the probability that a randomly selected subscriber reads neither newsletter?",
    a: 20,
    b: 18,
    both: 8,
    total: 45,
    variant: "neither",
  },
  {
    id: "venn-exactly-one-course",
    title: "Exactly One Course",
    prompt:
      "In a cohort of 50 students, 24 take economics, 19 take programming, and 7 take both. What is the probability that a randomly selected student takes exactly one of the two courses?",
    a: 24,
    b: 19,
    both: 7,
    total: 50,
    variant: "exactly-one",
  },
  {
    id: "venn-neither-service",
    title: "Neither Support Service",
    prompt:
      "Of 70 respondents, 31 used tutoring, 26 used advising, and 10 used both. What is the probability that a randomly selected respondent used neither service?",
    a: 31,
    b: 26,
    both: 10,
    total: 70,
    variant: "neither",
  },
]

const introductoryRuleSpecs = [
  {
    id: "rule-complement-rain",
    title: "Complement of Rain",
    prompt:
      "The probability of rain during an event is 0.37. What is the probability that it does not rain during the event?",
    kind: "complement",
    value: 0.37,
  },
  {
    id: "rule-complement-update",
    title: "Complement of an Update",
    prompt:
      "The probability that a device needs an update is 0.18. What is the probability that it does not need an update?",
    kind: "complement",
    value: 0.18,
  },
  {
    id: "rule-intersection-from-union",
    title: "Recovering an Intersection",
    prompt:
      "For two events A and B, P(A) = 0.48, P(B) = 0.39, and P(A union B) = 0.72. What is P(A intersection B)?",
    a: 0.48,
    b: 0.39,
    kind: "intersection",
    union: 0.72,
  },
  {
    id: "rule-intersection-surveys",
    title: "Survey Intersection",
    prompt:
      "For two survey events A and B, P(A) = 0.52, P(B) = 0.41, and P(A union B) = 0.78. What is P(A intersection B)?",
    a: 0.52,
    b: 0.41,
    kind: "intersection",
    union: 0.78,
  },
]

const productSpecs = [
  {
    id: "product-outfits",
    title: "Outfit Choice Product",
    prompt:
      "A display pairs one of 3 shirts with one of 4 pairs of pants and one of 2 pairs of shoes. How many different outfits can be displayed?",
    choices: [3, 4, 2],
  },
  {
    id: "product-menu",
    title: "Menu Choice Product",
    prompt:
      "A lunch option consists of 5 sandwiches, 3 side dishes, and 4 drinks. How many different lunches can be formed by choosing one of each?",
    choices: [5, 3, 4],
  },
  {
    id: "product-route-code",
    title: "Route Code Product",
    prompt:
      "A route code uses one of 6 letters followed by one of 10 digits. Repetition is irrelevant because there is one position of each kind. How many route codes are possible?",
    choices: [6, 10],
  },
  {
    id: "product-dashboard",
    title: "Dashboard Configuration Product",
    prompt:
      "A dashboard lets a user choose 4 layouts, 3 color themes, and 5 data views. How many configurations are possible?",
    choices: [4, 3, 5],
  },
]

const permutationSpecs = [
  {
    id: "permutation-presentations",
    title: "Ordered Presentations",
    prompt:
      "Seven students volunteer to give the first three presentations. No student presents twice. How many ordered choices for first, second, and third presenter are possible?",
    n: 7,
    k: 3,
  },
  {
    id: "permutation-photo-row",
    title: "Photo Row Arrangement",
    prompt:
      "Six distinct posters are arranged in a row. How many different arrangements are possible?",
    n: 6,
    k: 6,
  },
  {
    id: "permutation-stations",
    title: "Ordered Station Visits",
    prompt:
      "A tour selects 2 distinct stations from 8 and visits them in order. How many ordered station sequences are possible?",
    n: 8,
    k: 2,
  },
  {
    id: "permutation-awards",
    title: "Award Placements",
    prompt:
      "Nine finalists can receive first, second, and third place, with no ties. How many different award outcomes are possible?",
    n: 9,
    k: 3,
  },
]

const combinationSpecs = [
  {
    id: "combination-projects",
    title: "Project Group Selection",
    prompt:
      "A class has 9 distinct projects and chooses 3 for a showcase. The order of the chosen projects does not matter. How many groups are possible?",
    n: 9,
    k: 3,
  },
  {
    id: "combination-books",
    title: "Book Set Selection",
    prompt:
      "A shelf has 10 distinct books and a reader selects 4 to borrow. How many different sets of books can be selected?",
    n: 10,
    k: 4,
  },
  {
    id: "combination-partners",
    title: "Partner Pair Selection",
    prompt:
      "A group has 12 students. How many different unordered pairs of partners can be formed?",
    n: 12,
    k: 2,
  },
  {
    id: "combination-samples",
    title: "Sample Group Selection",
    prompt:
      "A lab has 11 distinct samples and chooses 5 for a screening batch. How many different batches are possible?",
    n: 11,
    k: 5,
  },
]

const additionSpecs = [
  {
    id: "addition-calendar",
    title: "Calendar or Reminder",
    prompt:
      "For events A and B, P(A) = 0.45, P(B) = 0.38, and P(A intersection B) = 0.20. What is P(A union B)?",
    a: 0.45,
    b: 0.38,
    both: 0.2,
  },
  {
    id: "addition-transit",
    title: "Bus or Rail Event",
    prompt:
      "For two commuter events A and B, P(A) = 0.51, P(B) = 0.34, and P(A intersection B) = 0.16. What is P(A union B)?",
    a: 0.51,
    b: 0.34,
    both: 0.16,
  },
  {
    id: "addition-disjoint-checks",
    title: "Disjoint Check Outcomes",
    prompt:
      "Two events A and B are disjoint, with P(A) = 0.27 and P(B) = 0.31. What is P(A union B)?",
    a: 0.27,
    b: 0.31,
    both: 0,
  },
  {
    id: "addition-disjoint-labels",
    title: "Disjoint Label Outcomes",
    prompt:
      "Two label events A and B cannot occur together. If P(A) = 0.22 and P(B) = 0.46, what is P(A union B)?",
    a: 0.22,
    b: 0.46,
    both: 0,
  },
]

const roleAndGroupSpecs = [
  {
    id: "role-volunteers",
    title: "Coordinator and Assistants",
    prompt:
      "From 8 volunteers, choose one coordinator and then choose 2 assistants from the remaining volunteers. How many teams with these roles are possible?",
    assistants: 2,
    total: 8,
  },
  {
    id: "role-editors",
    title: "Lead and Reviewers",
    prompt:
      "From 7 editors, choose one lead editor and then choose 3 reviewers from the remaining editors. How many teams with these roles are possible?",
    assistants: 3,
    total: 7,
  },
  {
    id: "role-guides",
    title: "Guide and Helpers",
    prompt:
      "From 9 guides, choose one head guide and then choose 2 helpers from the remaining guides. How many teams with these roles are possible?",
    assistants: 2,
    total: 9,
  },
  {
    id: "role-mentors",
    title: "Mentor and Support Pair",
    prompt:
      "From 10 mentors, choose one primary mentor and then choose 2 support mentors from the remaining mentors. How many teams with these roles are possible?",
    assistants: 2,
    total: 10,
  },
]

function buildCandidates() {
  const candidates = [
    ...uniformSpecs.map(buildUniformCandidate),
    ...complementSpecs.map(buildComplementCandidate),
    ...vennUnionSpecs.map(buildVennUnionCandidate),
    ...vennRegionSpecs.map(buildVennRegionCandidate),
    ...introductoryRuleSpecs.map(buildIntroductoryRuleCandidate),
    ...productSpecs.map(buildProductCandidate),
    ...permutationSpecs.map(buildPermutationCandidate),
    ...combinationSpecs.map(buildCombinationCandidate),
    ...additionSpecs.map(buildAdditionCandidate),
    ...roleAndGroupSpecs.map(buildRoleAndGroupCandidate),
  ]

  validateCandidates(candidates)
  return candidates
}

function buildUniformCandidate(spec) {
  const answer = fractionAnswer(spec.favorable, spec.total)
  return candidate({
    answer,
    difficulty: "foundational",
    id: spec.id,
    misconception:
      "The denominator must count every equally likely outcome, not only the favorable outcomes.",
    patternSource: "finite equally likely outcomes",
    prompt: spec.prompt,
    steps: [
      `There are ${spec.total} equally likely outcomes in the sample space.`,
      `${spec.favorable} outcomes satisfy the event.`,
      `The probability is ${spec.favorable}/${spec.total} = ${answer.acceptedAnswers[0]}.`,
    ],
    title: spec.title,
    topic: "Introduction to probability",
    topicId: INTRO_TOPIC_ID,
  })
}

function buildComplementCandidate(spec) {
  const favorable = spec.total - spec.excluded
  const answer = fractionAnswer(favorable, spec.total)
  return candidate({
    answer,
    difficulty: "foundational",
    id: spec.id,
    misconception:
      "The excluded count describes the event being avoided; subtract it from the total before forming the probability.",
    patternSource: "finite complement event",
    prompt: spec.prompt,
    steps: [
      `There are ${spec.total} outcomes in total and ${spec.excluded} are in the excluded event.`,
      `The complement has ${spec.total} - ${spec.excluded} = ${favorable} outcomes.`,
      `The probability is ${favorable}/${spec.total} = ${answer.acceptedAnswers[0]}.`,
    ],
    title: spec.title,
    topic: "Complements",
    topicId: INTRO_TOPIC_ID,
  })
}

function buildVennUnionCandidate(spec) {
  const union = spec.a + spec.b - spec.both
  const answer = fractionAnswer(union, spec.total)
  return candidate({
    answer,
    difficulty: "intermediate",
    id: spec.id,
    misconception:
      "Adding both group counts without subtracting the overlap counts the intersection twice.",
    patternSource: "two-set Venn union",
    prompt: spec.prompt,
    steps: [
      `Add the two group counts and subtract the overlap: ${spec.a} + ${spec.b} - ${spec.both} = ${union}.`,
      `The union therefore contains ${union} of the ${spec.total} outcomes.`,
      `The probability is ${union}/${spec.total} = ${answer.acceptedAnswers[0]}.`,
    ],
    title: spec.title,
    topic: "Venn diagrams",
    topicId: INTRO_TOPIC_ID,
  })
}

function buildVennRegionCandidate(spec) {
  const union = spec.a + spec.b - spec.both
  const favorable =
    spec.variant === "exactly-one"
      ? spec.a + spec.b - 2 * spec.both
      : spec.total - union
  const answer = fractionAnswer(favorable, spec.total)
  const regionExplanation =
    spec.variant === "exactly-one"
      ? `Exactly one group contains ${spec.a} + ${spec.b} - 2(${spec.both}) = ${favorable} outcomes.`
      : `The union contains ${union} outcomes, so neither contains ${spec.total} - ${union} = ${favorable}.`

  return candidate({
    answer,
    difficulty: "intermediate",
    id: spec.id,
    misconception:
      spec.variant === "exactly-one"
        ? "The overlap belongs to both groups, so remove it from each group when counting exactly one."
        : "Neither is the complement of the union, not the complement of only one group.",
    patternSource: "two-set Venn regions",
    prompt: spec.prompt,
    steps: [
      `The union count is ${spec.a} + ${spec.b} - ${spec.both} = ${union}.`,
      regionExplanation,
      `The probability is ${favorable}/${spec.total} = ${answer.acceptedAnswers[0]}.`,
    ],
    title: spec.title,
    topic: "Venn diagrams",
    topicId: INTRO_TOPIC_ID,
  })
}

function buildIntroductoryRuleCandidate(spec) {
  if (spec.kind === "complement") {
    const value = 1 - spec.value
    return candidate({
      answer: decimalAnswer(value),
      difficulty: "foundational",
      id: spec.id,
      misconception:
        "An event and its complement must have probabilities that add to 1.",
      patternSource: "probability complement rule",
      prompt: spec.prompt,
      steps: [
        "An event and its complement partition the sample space.",
        `Subtract the event probability from 1: 1 - ${spec.value} = ${formatDecimal(value)}.`,
        `The complement probability is ${formatDecimal(value)}.`,
      ],
      title: spec.title,
      topic: "Introduction to probability",
      topicId: INTRO_TOPIC_ID,
    })
  }

  const value = spec.a + spec.b - spec.union
  return candidate({
    answer: decimalAnswer(value),
    difficulty: "intermediate",
    id: spec.id,
    misconception:
      "The addition rule includes the intersection because the overlap is counted in both individual event probabilities.",
    patternSource: "probability addition rule",
    prompt: spec.prompt,
    steps: [
      "Use P(A intersection B) = P(A) + P(B) - P(A union B).",
      `Substitute: ${spec.a} + ${spec.b} - ${spec.union} = ${formatDecimal(value)}.`,
      `Therefore P(A intersection B) = ${formatDecimal(value)}.`,
    ],
    title: spec.title,
    topic: "Venn diagrams",
    topicId: INTRO_TOPIC_ID,
  })
}

function buildProductCandidate(spec) {
  const value = spec.choices.reduce((product, choice) => product * choice, 1)
  return candidate({
    answer: integerAnswer(value),
    difficulty: "foundational",
    id: spec.id,
    misconception:
      "Additive counting is not appropriate when one choice is made at every stage; multiply the stage counts.",
    patternSource: "fundamental counting principle",
    prompt: spec.prompt,
    steps: [
      `The successive stages have ${spec.choices.join(", ")} choices.`,
      `Use the multiplication principle: ${spec.choices.join(" * ")} = ${value}.`,
      `There are ${value} possible outcomes.`,
    ],
    title: spec.title,
    topic: "Counting methods",
    topicId: AXIOMS_TOPIC_ID,
  })
}

function buildPermutationCandidate(spec) {
  const value = permutation(spec.n, spec.k)
  return candidate({
    answer: integerAnswer(value),
    difficulty: "intermediate",
    id: spec.id,
    misconception:
      "Order matters in this selection, so a combination would merge outcomes that belong in different positions.",
    patternSource: "permutations without replacement",
    prompt: spec.prompt,
    steps: [
      `This is an ordered selection of ${spec.k} items from ${spec.n}.`,
      `Use P(${spec.n},${spec.k}) = ${descendingProduct(spec.n, spec.k)}.`,
      `The number of ordered outcomes is ${value}.`,
    ],
    title: spec.title,
    topic: "Counting methods",
    topicId: AXIOMS_TOPIC_ID,
  })
}

function buildCombinationCandidate(spec) {
  const value = combination(spec.n, spec.k)
  return candidate({
    answer: integerAnswer(value),
    difficulty: "intermediate",
    id: spec.id,
    misconception:
      "The selected items form an unordered group, so rearranging the same group does not create a new outcome.",
    patternSource: "combinations without replacement",
    prompt: spec.prompt,
    steps: [
      `This is an unordered selection of ${spec.k} items from ${spec.n}.`,
      `Use C(${spec.n},${spec.k}) = ${spec.n}! / (${spec.k}!(${spec.n - spec.k})!).`,
      `The number of groups is ${value}.`,
    ],
    title: spec.title,
    topic: "Counting methods",
    topicId: AXIOMS_TOPIC_ID,
  })
}

function buildAdditionCandidate(spec) {
  const value = spec.a + spec.b - spec.both
  return candidate({
    answer: decimalAnswer(value),
    difficulty: "intermediate",
    id: spec.id,
    misconception:
      spec.both === 0
        ? "Disjoint events have no overlap, so their union probability is the sum of the two probabilities."
        : "Subtract the intersection once so outcomes in both events are not counted twice.",
    patternSource: "probability addition axiom",
    prompt: spec.prompt,
    steps: [
      "Use P(A union B) = P(A) + P(B) - P(A intersection B).",
      `Substitute: ${spec.a} + ${spec.b} - ${spec.both} = ${formatDecimal(value)}.`,
      `Therefore P(A union B) = ${formatDecimal(value)}.`,
    ],
    title: spec.title,
    topic: "Axioms of probability",
    topicId: AXIOMS_TOPIC_ID,
  })
}

function buildRoleAndGroupCandidate(spec) {
  const groupChoices = combination(spec.total - 1, spec.assistants)
  const value = spec.total * groupChoices
  return candidate({
    answer: integerAnswer(value),
    difficulty: "challenge",
    id: spec.id,
    misconception:
      "The primary role is distinct, while the remaining support roles form an unordered group; account for both stages.",
    patternSource: "distinguished role plus combination",
    prompt: spec.prompt,
    steps: [
      `Choose the primary role in ${spec.total} ways.`,
      `Then choose ${spec.assistants} support members from the remaining ${spec.total - 1}: C(${spec.total - 1},${spec.assistants}) = ${groupChoices}.`,
      `Multiply the stages: ${spec.total} * ${groupChoices} = ${value}.`,
    ],
    title: spec.title,
    topic: "Counting methods",
    topicId: AXIOMS_TOPIC_ID,
  })
}

function candidate({
  answer,
  difficulty,
  id,
  misconception,
  patternSource,
  prompt,
  steps,
  title,
  topic,
  topicId,
}) {
  return {
    id: `generated-syllabus-${id}`,
    topicId,
    topic,
    title: `${title} Draft`,
    prompt,
    patternSource,
    difficulty,
    answer: {
      ...answer,
      explanation: steps.at(-1),
    },
    hints: [
      `Identify whether this is a ${topic.toLowerCase()} question.`,
      "Write the relevant counts or probabilities before calculating.",
      "Check that the result has the correct scale and interpretation.",
    ],
    solutionSteps: steps,
    misconceptions: [
      {
        id: `misconception-${id}`,
        matchTerms: [],
        feedback: misconception,
      },
    ],
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

function integerAnswer(value) {
  return {
    acceptedAnswers: [String(value)],
    numericValue: value,
    tolerance: 0,
  }
}

function validateCandidates(candidates) {
  const expectedCounts = new Map([
    [INTRO_TOPIC_ID, 20],
    [AXIOMS_TOPIC_ID, 20],
  ])
  const ids = new Set()

  for (const candidateItem of candidates) {
    if (ids.has(candidateItem.id)) {
      throw new Error(`Duplicate generated question id: ${candidateItem.id}`)
    }
    ids.add(candidateItem.id)

    if (
      candidateItem.review.status !== "needs_review" ||
      candidateItem.source.trustLevel !== "generated_unverified"
    ) {
      throw new Error(
        `Unsafe student visibility metadata on ${candidateItem.id}.`,
      )
    }
  }

  for (const [topicId, expected] of expectedCounts) {
    const actual = candidates.filter(
      (candidateItem) => candidateItem.topicId === topicId,
    ).length
    if (actual !== expected) {
      throw new Error(
        `Expected ${expected} candidates for ${topicId}, received ${actual}.`,
      )
    }
  }
}

function permutation(n, k) {
  let result = 1
  for (let index = 0; index < k; index += 1) {
    result *= n - index
  }
  return result
}

function combination(n, k) {
  return permutation(n, k) / permutation(k, k)
}

function descendingProduct(n, k) {
  return Array.from({ length: k }, (_, index) => n - index).join(" * ")
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

async function main() {
  const output = `${JSON.stringify(buildCandidates(), null, 2)}\n`

  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8")
    if (existing !== output) {
      throw new Error(
        "Syllabus review candidates are stale. Run npm run prepare:syllabus-questions.",
      )
    }
    console.log("Syllabus review candidates are current.")
    return
  }

  await writeFile(outputPath, output)
  console.log("Generated 40 syllabus-aligned review candidates.")
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
