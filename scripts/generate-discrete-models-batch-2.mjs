#!/usr/bin/env node

// Eight original learning tasks, authored from public-safe syllabus concepts.
// This command only writes/checks a local review fixture; it never opens a DB.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAnswerSpec } from "../src/lib/tutor/answer/spec.ts";
import { loadCanonicalSyllabusTopics } from "./lib/canonical-syllabus-topics.mjs";
import {
  REVIEW_CANDIDATE_FILES,
  validatePublicReviewCandidateFixtures,
} from "./lib/review-candidate-import.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DISCRETE_BATCH_FILE =
  "data/demo/discrete-models-batch-2-review-candidates.json";
const PROBABILITY_TOLERANCE = 0.001;
const ORIGINALITY =
  "Original scenario and numerical choices authored for targeted discrete-models batch 2 using canonical syllabus concepts only. No private course text used; no catalogued pattern relationship is claimed.";

function probability(value, decimal, percent, fraction) {
  return {
    acceptedAnswers: [
      ...new Set([decimal, ...(fraction ? [fraction] : []), percent]),
    ],
    numericValue: Number(decimal),
    tolerance: PROBABILITY_TOLERANCE,
    spec: {
      kind: "numeric",
      value,
      domain: "probability",
      percentMode: "either",
      tolerance: { mode: "absolute", value: PROBABILITY_TOLERANCE },
    },
  };
}

const TASKS = [
  {
    key: "binomial-at-least",
    concept: "Binomial upper tail via a complement",
    title: "Habitat Recorder Upload Threshold",
    difficulty: "intermediate",
    prompt:
      "Nine habitat recorders independently attempt an overnight upload. Each recorder completes its upload with probability 0.40. Let X be the number of completed uploads. What is P(X >= 3), the probability that at least three uploads finish?",
    answer: probability("0.768212992", "0.768212992", "76.8212992%"),
    hints: [
      "You are counting successes in a fixed set of independent attempts with the same success probability, so use a binomial model.",
      "The complement of at least three completions consists of zero, one, or two completions: P(X >= 3) = 1 - P(X <= 2).",
      "Evaluate C(9,j)(0.40)^j(0.60)^(9-j) for j = 0, 1, 2, add those terms, then subtract the sum from 1.",
    ],
    solutionSteps: [
      "There are nine independent attempts with a constant completion probability, so X follows Binomial(n = 9, p = 0.40).",
      "The event X >= 3 includes several possible counts. Its complement is X = 0, 1, or 2.",
      "P(X >= 3) = 1 - [(0.60)^9 + 9(0.40)(0.60)^8 + C(9,2)(0.40)^2(0.60)^7].",
      "The three excluded probabilities sum to 0.231787008, so P(X >= 3) = 0.768212992.",
      "There is approximately a 76.8% chance that the overnight batch contains at least three completed uploads.",
    ],
    error: {
      key: "point-instead-of-upper-tail",
      matchTerms: ["0.250822656", "0.250823", "0.2508", "0.251"],
      feedback:
        "This is P(X = 3) = C(9,3)(0.40)^3(0.60)^6. At least three also includes four through nine completions; use the complement of zero, one, or two.",
    },
  },
  {
    key: "binomial-at-most",
    concept: "Inclusive binomial lower tail",
    title: "Community Meal Allergy Requests",
    difficulty: "intermediate",
    prompt:
      "A community kitchen receives 12 meal reservations. Independently, each reservation requests an allergy-safe preparation with probability 0.15. Let X count these requests. What is P(X <= 2), the probability that at most two reservations need allergy-safe preparation?",
    answer: probability(
      "0.735818086223450927734375",
      "0.735818086223450927734375",
      "73.5818086223450927734375%",
    ),
    hints: [
      "Each reservation either needs the special preparation or does not. A fixed number of independent reservations with one common probability gives a binomial count.",
      "At most two includes zero requests as well as one and two, so add P(X = 0), P(X = 1), and P(X = 2).",
      "Substitute n = 12 and p = 0.15 into each term C(n,j)p^j(1-p)^(n-j); keep the sum itself, without subtracting it from 1.",
    ],
    solutionSteps: [
      "The assumptions give X ~ Binomial(n = 12, p = 0.15), with non-request probability 0.85.",
      "The inclusive lower tail is P(X <= 2) = sum from j = 0 to 2 of C(12,j)(0.15)^j(0.85)^(12-j).",
      "Substituting the three counts gives (0.85)^12 + 12(0.15)(0.85)^11 + 66(0.15)^2(0.85)^10.",
      "The probability of at most two special preparations is approximately 0.7358, or about 73.6%.",
    ],
    error: {
      key: "complement-of-requested-lower-tail",
      matchTerms: ["0.264181913776549072265625", "0.264182", "0.2642", "0.264"],
      feedback:
        "Subtracting the sum for zero, one, and two from 1 gives P(X >= 3). The requested event is X <= 2, so retain the cumulative sum.",
    },
  },
  {
    key: "binomial-mean-sd",
    concept: "Binomial expectation and standard deviation",
    title: "Repair Voucher Redemption Planning",
    difficulty: "foundational",
    prompt:
      "A repair cooperative issues 48 vouchers. Each voucher is redeemed independently with probability 0.25. Let X be the number redeemed. Find E[X] and SD(X). Enter two numbers in that order: mean, standard deviation.",
    answer: {
      acceptedAnswers: ["12, 3", "12.0; 3.0"],
      spec: {
        kind: "number_list",
        values: ["12", "3"],
        ordered: true,
        tolerance: { mode: "exact" },
      },
    },
    hints: [
      "The number redeemed is a binomial count; its mean describes the expected count and its standard deviation describes the spread of that count.",
      "For Binomial(n,p), E[X] = np and Var(X) = np(1-p). Standard deviation is the square root of the variance.",
      "Use n = 48 and p = 0.25. Compute 48(0.25) for the first entry and take the square root of 48(0.25)(0.75) for the second.",
    ],
    solutionSteps: [
      "The 48 independent redemption indicators have a common probability 0.25, so X ~ Binomial(48, 0.25).",
      "E[X] = np = 48(0.25) = 12 vouchers.",
      "Var(X) = np(1-p) = 48(0.25)(0.75) = 9 vouchers squared; SD(X) = sqrt(9) = 3 vouchers.",
      "The ordered answer is 12, 3: the expected number redeemed is 12 and the standard deviation is 3.",
    ],
    error: {
      key: "variance-instead-of-sd",
      matchTerms: ["9"],
      feedback:
        "The value 9 is np(1-p), the variance. The second entry asks for standard deviation, so take the square root of that variance while keeping the mean as the first entry.",
    },
  },
  {
    key: "negative-binomial-third-success",
    concept: "Trial of the kth success with a required final success",
    title: "Drone Landing Calibration Milestone",
    difficulty: "challenge",
    prompt:
      "A drone landing calibration succeeds on each independent trial with probability 0.35. Calibration continues until three successful trials have been recorded. What is the probability that the third success occurs on trial 7?",
    answer: probability(
      "0.11480183203125",
      "0.11480183203125",
      "11.480183203125%",
    ),
    hints: [
      "The stopping trial for a specified number of successes uses a negative binomial model. Here the target is the third success, not the first.",
      "For the third success to be on trial 7, the first six trials must contain exactly two successes and trial 7 must succeed.",
      "Choose the two successful positions among the first six with C(6,2), then multiply by (0.35)^2(0.65)^4 and the success probability for trial 7.",
    ],
    solutionSteps: [
      "The independent trials have constant success probability p = 0.35. The stopping time for k = 3 successes is negative binomial, with target trial n = 7.",
      "The first n - 1 = 6 trials must contain exactly k - 1 = 2 successes; fewer would not reach three on trial 7, and more would reach three earlier.",
      "There are C(6,2) = 15 possible placements of those two successes. Trial 7 must independently succeed, so multiply by its probability 0.35.",
      "P(third success on trial 7) = C(6,2)(0.35)^2(0.65)^4(0.35) = 15(0.35)^3(0.65)^4 = 0.11480183203125.",
      "Thus the third successful calibration occurs on trial 7 with probability about 11.4802%.",
    ],
    error: {
      key: "final-success-omitted",
      matchTerms: ["0.328005234375", "0.328005", "0.3280", "0.328"],
      feedback:
        "This counts exactly two successes in the first six trials but does not require trial 7 to succeed. Multiply that probability by 0.35 for the final required success.",
    },
  },
  {
    key: "multinomial-three-categories",
    concept: "Three-category count allocation and multinomial coefficient",
    title: "Museum Audio Guide Language Mix",
    difficulty: "challenge",
    prompt:
      "Eight museum visitors independently select one audio-guide language: English with probability 0.50, Spanish with probability 0.30, or Mandarin with probability 0.20. These are the only options. What is the probability that exactly three select English, three select Spanish, and two select Mandarin?",
    answer: probability("189/2500", "0.0756", "7.56%", "189/2500"),
    hints: [
      "Each visitor produces one of three mutually exclusive outcomes, with fixed probabilities across independent visitors. Use a multinomial count model.",
      "A single specified order has probability (0.50)^3(0.30)^3(0.20)^2, but many visitor orders have the same category counts.",
      "Count the possible orders with 8!/(3!3!2!), then multiply that coefficient by the probability product for one order.",
    ],
    solutionSteps: [
      "The three categories exhaust the choices and their probabilities sum to 1. Across eight independent visitors, the count vector is multinomial with probabilities (0.50, 0.30, 0.20).",
      "The requested counts (3, 3, 2) sum to 8. Their multinomial coefficient is 8!/(3!3!2!) = 560.",
      "P(3 English, 3 Spanish, 2 Mandarin) = [8!/(3!3!2!)](0.50)^3(0.30)^3(0.20)^2.",
      "The probability product is 0.000135. Multiplying by 560 gives 0.0756 = 189/2500 = 7.56%.",
    ],
    error: {
      key: "multinomial-coefficient-omitted",
      matchTerms: ["0.000135"],
      feedback:
        "The product alone gives the probability of one particular ordering of the language choices. Include all 8!/(3!3!2!) orderings with those same counts.",
    },
  },
  {
    key: "geometric-tail",
    concept: "Geometric survival probability with trials counted",
    title: "Remote Buoy Transmission Wait",
    difficulty: "intermediate",
    prompt:
      "A remote buoy attempts a transmission repeatedly. Each attempt succeeds independently with probability 0.18. Let X count the total number of attempts up to and including the first successful transmission, so X = 1 if the first attempt succeeds. What is P(X > 5)?",
    answer: probability("0.3707398432", "0.3707398432", "37.07398432%"),
    hints: [
      "X is a geometric waiting time counting trials through the first success. A tail event asks whether you are still waiting after a given number of attempts.",
      "X > 5 means none of the first five attempts succeeds; it does not specify which later attempt first succeeds.",
      "Use the failure probability 1 - 0.18 for each of the five independent attempts and multiply those five failure factors.",
    ],
    solutionSteps: [
      "Because attempts are independent with constant success probability 0.18, X is geometric on 1, 2, 3, ... .",
      "The event X > 5 is exactly the event that attempts 1 through 5 all fail. Each failure has probability 0.82.",
      "P(X > 5) = (1 - 0.18)^5 = (0.82)^5 = 0.3707398432.",
      "The probability of still waiting after five attempts is approximately 37.1%; no success factor is needed because no particular later success time was requested.",
    ],
    error: {
      key: "point-instead-of-geometric-tail",
      matchTerms: ["0.0813819168", "0.081382", "0.0814", "0.081"],
      feedback:
        "Multiplying four failures by a success gives P(X = 5). The event X > 5 requires five failures and leaves the first later success unspecified.",
    },
  },
  {
    key: "poisson-rate-rescaling",
    concept: "Rescale a Poisson mean to the observation interval",
    title: "Bicycle Workshop Walk-In Window",
    difficulty: "intermediate",
    prompt:
      "Walk-in arrivals at a bicycle workshop form a homogeneous Poisson process with a mean rate of 4.8 arrivals per hour. What is the probability of exactly three arrivals during a 25-minute window?",
    answer: probability(
      "0.180447044315484",
      "0.180447044315484",
      "18.0447044315484%",
    ),
    hints: [
      "A Poisson arrival count uses the expected number of arrivals in the interval being observed, rather than the rate for an arbitrary unit of time.",
      "Convert 25 minutes to 25/60 of an hour, then multiply the hourly rate by that duration to obtain the window mean lambda.",
      "Insert the rescaled mean into P(X = 3) = exp(-lambda) lambda^3 / 3! before evaluating the exponential and product.",
    ],
    solutionSteps: [
      "A homogeneous Poisson process has a Poisson count in a fixed window, with mean equal to rate times window duration.",
      "The window is 25/60 of an hour, so lambda = 4.8(25/60) = 2 arrivals.",
      "For X ~ Poisson(2), P(X = 3) = exp(-2) 2^3 / 3! = (4/3) exp(-2).",
      "The probability of exactly three walk-ins in the 25-minute window is approximately 0.1804, or about 18.0%.",
    ],
    error: {
      key: "hourly-mean-not-rescaled",
      matchTerms: ["0.151690697607537", "0.151691", "0.1517", "0.152"],
      feedback:
        "Using exp(-4.8)(4.8)^3/3! gives the count probability for a full hour. Multiply 4.8 by 25/60 before evaluating the 25-minute probability.",
    },
  },
  {
    key: "poisson-binomial-approximation",
    concept:
      "Rare-event binomial approximation with a cumulative Poisson event",
    title: "Archive Transfer Retry Budget",
    difficulty: "challenge",
    prompt:
      "An archive transfers 1,800 data blocks. Independently, each block needs a retry with probability 0.0015. Let X be the number needing a retry. Use a Poisson approximation to estimate P(X <= 1). Identify the approximating mean lambda and explain why the approximation is reasonable in your working; enter only the final probability.",
    answer: probability(
      "0.248660397137074",
      "0.248660397137074",
      "24.8660397137074%",
    ),
    hints: [
      "The exact count is binomial. Many independent trials with a small individual event probability can be approximated by a Poisson count.",
      "Match the mean with lambda = np using the number of blocks and their retry probability. At most one retry includes zero and one.",
      "Using that mean, add exp(-lambda) for zero retries and lambda exp(-lambda) for one retry; combine them as exp(-lambda)(1 + lambda).",
    ],
    solutionSteps: [
      "Exactly, X ~ Binomial(n = 1800, p = 0.0015). The trials are independent, n is large, and p is small, making a rare-event Poisson approximation reasonable.",
      "Match the expected count: lambda = np = 1800(0.0015) = 2.7. Use Y ~ Poisson(2.7).",
      "The event includes zero and one: P(X <= 1) is approximately P(Y = 0) + P(Y = 1) = exp(-2.7) + 2.7 exp(-2.7).",
      "The Poisson approximation gives P(X <= 1) approximately 0.2487, or about 24.9%. This is an approximation to the binomial probability, not an exact equality.",
    ],
    error: {
      key: "single-trial-probability-as-mean",
      // 1.0 is rounding to nearest; 0.99999 is truncation to five places
      // (rounding toward zero). Avoid the digits-only term "1", whose
      // fraction-part semantics would also match unrelated fractions.
      matchTerms: ["0.999998876124367", "0.999999", "1.0", "0.99999"],
      feedback:
        "Using lambda = 0.0015 in exp(-lambda)(1 + lambda) treats a single-block probability as the expected total. The Poisson mean must be np for all 1,800 blocks.",
    },
  },
];

export function buildDiscreteModelsBatch(topics) {
  const topic = topics.find(
    (entry) => entry.id === "binomial-models" && entry.active,
  );
  if (!topic)
    throw new Error("Missing active canonical discrete-models topic.");
  return TASKS.map((task) => {
    if (
      task.hints.length !== 3 ||
      task.solutionSteps.length < 3 ||
      task.solutionSteps.length > 5
    )
      throw new Error(`Invalid hint/solution structure: ${task.key}`);
    const issues = validateAnswerSpec(
      task.answer.spec,
      task.answer.acceptedAnswers,
    );
    if (issues.length)
      throw new Error(`${task.key}: ${JSON.stringify(issues)}`);
    return {
      id: `generated-discrete-batch-2-${task.key}`,
      topicId: topic.id,
      topic: topic.title,
      title: task.title,
      prompt: task.prompt,
      patternSource: `Original targeted learning task: ${task.concept}.`,
      difficulty: task.difficulty,
      answer: { ...task.answer, explanation: task.solutionSteps.at(-1) },
      hints: task.hints,
      solutionSteps: task.solutionSteps,
      misconceptions: [
        {
          id: `misconception-discrete-batch-2-${task.error.key}`,
          matchTerms: task.error.matchTerms,
          feedback: task.error.feedback,
        },
      ],
      source: {
        sourceType: "generated_original",
        trustLevel: "generated_unverified",
        visibility: "public",
        originalityNote: ORIGINALITY,
      },
      review: {
        status: "needs_review",
        notes: `Targeted content generation batch 2 (2026-09-10): ${task.concept}. Professor review required. No priority or approval assigned. ${task.answer.spec.kind === "numeric" ? "Preserves the existing absolute probability tolerance of 0.001; PROFESSOR ROUNDING POLICY STILL REQUIRED." : "Ordered mean and SD are exact real-valued quantities; number_list has no domain field."}`,
      },
    };
  });
}

async function main() {
  const topics = await loadCanonicalSyllabusTopics(root);
  const candidates = buildDiscreteModelsBatch(topics);
  if (candidates.length !== 8)
    throw new Error("Batch 2 must contain exactly eight tasks.");
  const groups = [];
  for (const sourceFile of REVIEW_CANDIDATE_FILES) {
    groups.push({
      sourceFile,
      candidates:
        sourceFile === DISCRETE_BATCH_FILE
          ? candidates
          : JSON.parse(await readFile(path.join(root, sourceFile), "utf8")),
    });
  }
  const entries = groups.flatMap(({ sourceFile, candidates: group }) =>
    group.map((candidate) => ({ candidate, sourceFile })),
  );
  validatePublicReviewCandidateFixtures(
    { topics, candidates: entries },
    groups,
  );
  const oldPrompts = new Set(
    entries
      .filter(({ sourceFile }) => sourceFile !== DISCRETE_BATCH_FILE)
      .map(({ candidate }) => candidate.prompt.trim().toLowerCase()),
  );
  const newPrompts = new Set(
    candidates.map((candidate) => candidate.prompt.trim().toLowerCase()),
  );
  if (
    newPrompts.size !== 8 ||
    [...newPrompts].some((prompt) => oldPrompts.has(prompt))
  )
    throw new Error("Repeated prompt in targeted batch.");
  const output = `${JSON.stringify(candidates, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    if (
      (await readFile(path.join(root, DISCRETE_BATCH_FILE), "utf8")) !== output
    )
      throw new Error(
        "Discrete batch 2 fixture is stale; run npm run prepare:discrete-models-batch-2.",
      );
    console.log(
      `Discrete batch 2 is current: 8 typed drafts; fixture validator passed (${entries.length} total candidates).`,
    );
  } else {
    await writeFile(path.join(root, DISCRETE_BATCH_FILE), output);
    console.log(
      `Generated 8 discrete-models batch 2 drafts; fixture validator passed (${entries.length} total candidates).`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
