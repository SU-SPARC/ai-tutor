#!/usr/bin/env node

// Content remediation batch 1 (2026-09-10): review-ready "-v2" replacements
// for the strongest representatives of the first two syllabus topics.
//
// Every v2 candidate is derived from its original in
// data/demo/syllabus-review-candidates.json: the prompt, difficulty, accepted
// answers, numeric value, and tolerance are copied verbatim (two documented
// wording fixes and three documented difficulty relabels aside). Only the
// hints, solution steps, misconceptions, typed answer spec, title, and review
// notes are new. reviewPriority is never preset: marking a draft as priority
// is the professor's own explicit review action.
//
// The review-candidate importer never updates an existing ID, so the originals
// stay untouched in their fixture and the improvements travel under new IDs.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const originalsPath = path.join(
  repoRoot,
  "data/demo/syllabus-review-candidates.json",
);
const outputPath = path.join(
  repoRoot,
  "data/demo/remediated-syllabus-review-candidates.json",
);
const checkOnly = process.argv.includes("--check");

export const REMEDIATED_ID_SUFFIX = "-v2";

const ORIGINALITY_NOTE =
  "Original generated practice draft from a public-safe topic pattern; no private course text used.";

// Exact-tolerance count answers (domain count, integer form).
function countSpec(original) {
  return {
    kind: "numeric",
    value: original.answer.acceptedAnswers[0],
    domain: "count",
    percentMode: "decimal",
    tolerance: { mode: "exact" },
    requiredForm: "integer",
    formPolicy: "note",
  };
}

// Probability answers keep the legacy absolute tolerance of the original
// draft (0.001). No professor-approved course rounding policy exists yet, so
// nothing wider or narrower is introduced here; that policy is a pending
// professor decision, not a generator setting.
function probabilitySpec(original) {
  return {
    kind: "numeric",
    value: original.answer.acceptedAnswers[0],
    domain: "probability",
    percentMode: "either",
    tolerance: { mode: "absolute", value: original.answer.tolerance },
  };
}

function trimmed(value, digits) {
  return Number(value.toFixed(digits)).toString();
}

// Match terms are the forms a student would actually type for a computed
// wrong value: fraction, common decimal roundings, and percent forms.
function fractionTerms(numerator, denominator) {
  const divisor = gcd(numerator, denominator);
  const value = numerator / denominator;
  return unique([
    `${numerator}/${denominator}`,
    `${numerator / divisor}/${denominator / divisor}`,
    ...decimalTerms(value),
  ]);
}

function decimalTerms(value) {
  const percent = value * 100;
  return unique([
    trimmed(value, 6),
    trimmed(value, 4),
    trimmed(value, 3),
    trimmed(value, 2),
    `${trimmed(percent, 2)}%`,
    `${trimmed(percent, 1)}%`,
    // A whole-number percent is included only when it is exact: the
    // question-level matcher is substring-based, so a rounded "56%" would
    // also fire on a sibling misconception's "15.56%".
    ...(Number.isInteger(Number(percent.toFixed(6)))
      ? [`${trimmed(percent, 0)}%`]
      : []),
  ]);
}

function countTerms(value) {
  return [String(value)];
}

function unique(values) {
  return [...new Set(values)];
}

// The question-level matcher is substring-based, so a short form such as
// "0.6" or "40" also fires inside a longer, differently reasoned wrong answer
// ("0.625", "5040"). Drop those spellings and keep the unambiguous forms.
function without(terms, omitted) {
  return terms.filter((term) => !omitted.includes(term));
}

function gcd(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

// disposition: "publish" candidates are the representative of their template
// family; "reserve" candidates are the suggested similar-practice sibling.
const REMEDIATIONS = [
  // ---------------------------------------------------------------------
  // Introduction to Probability and Venn Diagrams
  // ---------------------------------------------------------------------
  {
    id: "uniform-library-cards",
    concept: "equally likely outcomes",
    disposition: "publish",
    reserveSibling: "uniform-spinner-sectors",
    spec: probabilitySpec,
    hints: [
      "Every card is equally likely to be selected, so the probability compares the number of favorable cards with the number of cards in the whole tray.",
      "The sample space is all 16 cards; the event is the set of cards marked for pickup today.",
      "Divide the favorable count by the total count, then reduce the fraction or convert it to a decimal or percent.",
    ],
    steps: [
      "Each of the 16 cards is equally likely, so P(event) = (favorable cards)/(all cards).",
      "The event 'marked for pickup today' contains 6 of the 16 cards.",
      "P(marked) = 6/16 = 3/8 = 0.375.",
    ],
    misconceptions: [
      {
        id: "odds-instead-of-probability",
        feedback:
          "This compares marked cards with unmarked cards. A probability divides by every card in the tray, including the marked ones: 6 out of 16.",
        // "0.6" is omitted: it would also fire on 0.625, the 10/16 complement error.
        matchTerms: without(fractionTerms(6, 10), ["0.6"]),
      },
      {
        id: "favorable-count-as-denominator",
        feedback:
          "A probability can never exceed 1. The number of equally likely outcomes, 16, belongs in the denominator and the favorable count, 6, in the numerator.",
        matchTerms: fractionTerms(16, 6),
      },
    ],
  },
  {
    id: "uniform-numbered-tiles",
    concept: "equally likely outcomes with an event that must be counted",
    disposition: "publish",
    // The original prompt stated "Six of the numbers are multiples of 3",
    // which handed over the count and made the missed-endpoint misconception
    // impossible. The event, answer, spec, and accepted answers are unchanged.
    prompt:
      "One tile is chosen at random from tiles numbered 1 through 18. What is the probability of choosing a multiple of 3?",
    spec: probabilitySpec,
    hints: [
      "With equally likely tiles, the probability is the number of tiles that satisfy the condition divided by the number of tiles.",
      "List the multiples of 3 between 1 and 18 explicitly, including the endpoint 18, and count them.",
      "Divide that count by 18 and simplify the fraction.",
    ],
    steps: [
      "The 18 tiles are equally likely, so P(multiple of 3) = (multiples of 3)/(all tiles).",
      "The multiples of 3 from 1 to 18 are 3, 6, 9, 12, 15, 18: six tiles.",
      "P(multiple of 3) = 6/18 = 1/3, about 0.3333.",
    ],
    misconceptions: [
      {
        id: "missed-endpoint-multiple",
        feedback:
          "Counting 3, 6, 9, 12, 15 misses 18, which is also a multiple of 3 and is one of the tiles.",
        matchTerms: fractionTerms(5, 18),
      },
      {
        id: "odds-instead-of-probability",
        feedback:
          "This compares multiples of 3 with the other tiles. The denominator must be all 18 tiles.",
        matchTerms: fractionTerms(6, 12),
      },
    ],
  },
  {
    id: "complement-not-green",
    concept: "complement of a single event",
    disposition: "publish",
    spec: probabilitySpec,
    hints: [
      "'Not green' is the complement of 'green': find the probability of the event you are avoiding, or count the markers that are not green.",
      "P(not green) = 1 - P(green), where P(green) is green markers over all markers.",
      "Compute 1 - 4/15, or equivalently count the 15 - 4 non-green markers out of 15.",
    ],
    steps: [
      "The 15 markers are equally likely, and 'not green' is the complement of 'green'.",
      "P(green) = 4/15, so P(not green) = 1 - 4/15 = 11/15.",
      "P(not green) = 11/15, about 0.7333.",
    ],
    misconceptions: [
      {
        id: "complement-not-applied",
        feedback:
          "4/15 is the probability of drawing a green marker. The question asks for the complement, 1 - 4/15.",
        matchTerms: fractionTerms(4, 15),
      },
    ],
  },
  {
    id: "venn-clubs",
    concept: "two-set union (at least one)",
    disposition: "publish",
    reserveSibling: "venn-transit-passes",
    spec: probabilitySpec,
    hints: [
      "'At least one of the two clubs' is the union of the two membership groups. Students in both clubs belong to the union once, not twice.",
      "Use |A or B| = |A| + |B| - |A and B| with A = coding club and B = design club.",
      "Compute 18 + 14 - 6, then divide by the 40 students.",
    ],
    steps: [
      "'At least one club' is the union A or B, and P(A or B) = P(A) + P(B) - P(A and B).",
      "Counting members: 18 + 14 - 6 = 26 students, because the 6 in both clubs were counted twice.",
      "P(at least one club) = 26/40 = 13/20 = 0.65.",
    ],
    misconceptions: [
      {
        id: "overlap-not-subtracted",
        feedback:
          "Adding 18 and 14 counts the 6 students in both clubs twice. Subtract the overlap once.",
        matchTerms: fractionTerms(32, 40),
      },
      {
        id: "exactly-one-instead-of-union",
        feedback:
          "Removing the overlap from both groups counts students in exactly one club. 'At least one' also keeps the students in both clubs.",
        matchTerms: fractionTerms(20, 40),
      },
    ],
  },
  {
    id: "venn-exactly-one-language",
    concept: "two-set Venn region: exactly one",
    disposition: "publish",
    reserveSibling: "venn-exactly-one-course",
    spec: probabilitySpec,
    hints: [
      "'Exactly one language' excludes the students who study both, so the overlap is removed from each group.",
      "Draw a two-set Venn diagram: French only = 17 - 6, Spanish only = 15 - 6, both = 6.",
      "Add the two 'only' regions and divide by 36.",
    ],
    steps: [
      "Exactly one language means French only or Spanish only, two disjoint Venn regions.",
      "French only: 17 - 6 = 11. Spanish only: 15 - 6 = 9. Together: 11 + 9 = 20 students.",
      "P(exactly one language) = 20/36 = 5/9, about 0.5556.",
    ],
    misconceptions: [
      {
        id: "union-instead-of-exactly-one",
        feedback:
          "17 + 15 - 6 = 26 counts students who study at least one language, including those who study both. For exactly one, remove the overlap from each group.",
        matchTerms: fractionTerms(26, 36),
      },
      {
        id: "one-group-only",
        feedback:
          "11 counts only the French-only students. Exactly one language also includes the Spanish-only students.",
        matchTerms: fractionTerms(11, 36),
      },
    ],
  },
  {
    id: "venn-neither-newsletter",
    concept: "two-set Venn region: neither (complement of the union)",
    disposition: "publish",
    spec: probabilitySpec,
    hints: [
      "'Neither newsletter' is the complement of 'at least one newsletter', so first find how many subscribers read at least one.",
      "At least one: 20 + 18 - 8. Neither: 45 minus that union count.",
      "Divide the neither count by 45.",
    ],
    steps: [
      "'Neither' is the complement of the union, so count the union first.",
      "At least one newsletter: 20 + 18 - 8 = 30 subscribers, so 45 - 30 = 15 read neither.",
      "P(neither) = 15/45 = 1/3, about 0.3333.",
    ],
    misconceptions: [
      {
        id: "overlap-subtracted-twice",
        feedback:
          "Subtracting both group sizes from 45 removes the 8 readers of both newsletters twice. Subtract the union count, 20 + 18 - 8, instead.",
        // "7/45" is omitted: it would also fire inside "27/45", the
        // not-evening answer that belongs to complement-of-one-group.
        matchTerms: decimalTerms(7 / 45),
      },
      {
        id: "complement-of-one-group",
        feedback:
          "That is the probability of not reading one particular newsletter. 'Neither' means outside both groups, the complement of the union.",
        // Not morning (25/45) and not evening (27/45). "0.6" is omitted from
        // the 27/45 forms: it would also fire on 0.667, the union left
        // uncomplemented (30/45).
        matchTerms: unique([
          ...fractionTerms(25, 45),
          ...without(fractionTerms(27, 45), ["0.6"]),
        ]),
      },
    ],
  },
  {
    id: "rule-complement-rain",
    concept: "complement rule with a given probability",
    disposition: "publish",
    spec: probabilitySpec,
    hints: [
      "'Does not rain' is the complement of 'rains'. An event and its complement together cover the whole sample space.",
      "P(not A) = 1 - P(A).",
      "Subtract 0.37 from 1.",
    ],
    steps: [
      "An event and its complement have probabilities that add to 1, so P(no rain) = 1 - P(rain).",
      "Substitute: 1 - 0.37.",
      "P(no rain) = 0.63.",
    ],
    misconceptions: [
      {
        id: "given-probability-repeated",
        feedback:
          "0.37 is the probability of rain. The question asks for the complement, 1 - 0.37.",
        matchTerms: decimalTerms(0.37),
      },
    ],
  },
  {
    id: "rule-intersection-from-union",
    concept: "addition rule solved for the intersection",
    disposition: "publish",
    spec: probabilitySpec,
    hints: [
      "A ∪ B (A union B) is the event 'A or B', and A ∩ B (A intersection B) is 'A and B'. The addition rule links P(A), P(B), P(A or B), and P(A and B), and three of the four are given.",
      "Rearrange P(A or B) = P(A) + P(B) - P(A and B) to isolate the intersection.",
      "Compute 0.48 + 0.39 - 0.72.",
    ],
    steps: [
      "Addition rule, with A ∪ B read as 'A or B' and A ∩ B as 'A and B': P(A or B) = P(A) + P(B) - P(A and B), so P(A and B) = P(A) + P(B) - P(A or B).",
      "Substitute: 0.48 + 0.39 - 0.72.",
      "P(A and B) = 0.15.",
    ],
    misconceptions: [
      {
        id: "independence-assumed",
        feedback:
          "Multiplying P(A) by P(B) assumes the events are independent, which was not given. Use the addition rule with the given union probability.",
        matchTerms: decimalTerms(0.48 * 0.39),
      },
    ],
  },
  {
    id: "uniform-spinner-sectors",
    concept: "equally likely outcomes",
    disposition: "reserve",
    publishSibling: "uniform-library-cards",
    spec: probabilitySpec,
    hints: [
      "Every sector is equally likely, so the probability compares the number of blue sectors with the number of sectors on the spinner.",
      "The sample space is all 12 sectors; the event is the set of blue sectors.",
      "Divide the blue count by the total count and simplify.",
    ],
    steps: [
      "Each of the 12 sectors is equally likely, so P(blue) = (blue sectors)/(all sectors).",
      "There are 5 blue sectors out of 12.",
      "P(blue) = 5/12, about 0.4167.",
    ],
    misconceptions: [
      {
        id: "odds-instead-of-probability",
        feedback:
          "This compares blue sectors with non-blue sectors. A probability divides by all 12 sectors.",
        matchTerms: fractionTerms(5, 7),
      },
      {
        id: "favorable-count-as-denominator",
        feedback:
          "A probability can never exceed 1. The 12 equally likely sectors belong in the denominator and the 5 blue sectors in the numerator.",
        matchTerms: fractionTerms(12, 5),
      },
    ],
  },
  {
    id: "venn-transit-passes",
    concept: "two-set union (at least one)",
    disposition: "reserve",
    publishSibling: "venn-clubs",
    spec: probabilitySpec,
    hints: [
      "'At least one of the two passes' is the union of the bus-pass group and the rail-pass group. Commuters with both passes belong to the union once.",
      "Use |A or B| = |A| + |B| - |A and B| with A = bus pass and B = rail pass.",
      "Compute 35 + 32 - 12, then divide by the 80 commuters.",
    ],
    steps: [
      "'At least one pass' is the union A or B, and P(A or B) = P(A) + P(B) - P(A and B).",
      "Counting commuters: 35 + 32 - 12 = 55, because the 12 with both passes were counted twice.",
      "P(at least one pass) = 55/80 = 11/16 = 0.6875.",
    ],
    misconceptions: [
      {
        id: "overlap-not-subtracted",
        feedback:
          "Adding 35 and 32 counts the 12 commuters with both passes twice. Subtract the overlap once.",
        matchTerms: fractionTerms(67, 80),
      },
      {
        id: "exactly-one-instead-of-union",
        feedback:
          "Removing the overlap from both groups counts commuters with exactly one pass. 'At least one' also keeps those with both passes.",
        matchTerms: fractionTerms(43, 80),
      },
    ],
  },
  {
    id: "venn-exactly-one-course",
    concept: "two-set Venn region: exactly one",
    disposition: "reserve",
    publishSibling: "venn-exactly-one-language",
    spec: probabilitySpec,
    hints: [
      "'Exactly one of the two courses' excludes the students who take both, so the overlap is removed from each group.",
      "Draw a two-set Venn diagram: economics only = 24 - 7, programming only = 19 - 7, both = 7.",
      "Add the two 'only' regions and divide by 50.",
    ],
    steps: [
      "Exactly one course means economics only or programming only, two disjoint Venn regions.",
      "Economics only: 24 - 7 = 17. Programming only: 19 - 7 = 12. Together: 17 + 12 = 29 students.",
      "P(exactly one course) = 29/50 = 0.58.",
    ],
    misconceptions: [
      {
        id: "union-instead-of-exactly-one",
        feedback:
          "24 + 19 - 7 = 36 counts students who take at least one course, including those who take both. For exactly one, remove the overlap from each group.",
        matchTerms: fractionTerms(36, 50),
      },
      {
        id: "one-group-only",
        feedback:
          "17 counts only the economics-only students. Exactly one course also includes the programming-only students.",
        matchTerms: fractionTerms(17, 50),
      },
    ],
  },
  // ---------------------------------------------------------------------
  // Axioms of Probability and Counting Methods
  // ---------------------------------------------------------------------
  {
    id: "product-outfits",
    concept: "multiplication principle across three stages",
    disposition: "publish",
    reserveSibling: "product-route-code",
    spec: countSpec,
    hints: [
      "An outfit is built in stages: choose a shirt, then pants, then shoes. Each stage is a separate choice.",
      "The multiplication principle says the number of outcomes is the product of the number of choices at each stage.",
      "Multiply 3 by 4 by 2.",
    ],
    steps: [
      "Multiplication principle: a sequence of choices with 3, 4, and 2 options has 3 * 4 * 2 outcomes.",
      "3 * 4 = 12 shirt-and-pants pairs, and each pair combines with 2 shoe options.",
      "12 * 2 = 24 outfits.",
    ],
    misconceptions: [
      {
        id: "stages-added",
        feedback:
          "Adding 3 + 4 + 2 counts individual items, not outfits. Each shirt combines with every pair of pants and every pair of shoes, so multiply.",
        matchTerms: countTerms(3 + 4 + 2),
      },
      {
        id: "stage-dropped",
        feedback:
          "12 counts shirt-and-pants pairs only. Each pair still combines with 2 shoe options.",
        matchTerms: countTerms(3 * 4),
      },
    ],
  },
  {
    id: "permutation-presentations",
    concept: "permutation of k from n (ordered positions)",
    disposition: "publish",
    reserveSibling: "permutation-awards",
    spec: countSpec,
    hints: [
      "First, second, and third presenter are different positions, so the same three students in a different order is a different outcome.",
      "Fill the positions in sequence: 7 choices for first, then fewer for second, then fewer for third, because nobody presents twice.",
      "Multiply the three descending counts; that product is P(7,3) = 7!/4!.",
    ],
    steps: [
      "Order matters and repetition is not allowed, so this is a permutation of 3 students chosen from 7: P(7,3).",
      "P(7,3) = 7 * 6 * 5.",
      "7 * 6 * 5 = 210 ordered choices.",
    ],
    misconceptions: [
      {
        id: "combination-instead-of-permutation",
        feedback:
          "C(7,3) = 35 treats the three presenters as an unordered group. The presentation order matters, so use P(7,3), which is 3! times larger.",
        matchTerms: countTerms(35),
      },
      {
        id: "repetition-allowed",
        feedback:
          "7 * 7 * 7 lets the same student present more than once, but no student presents twice. The choices decrease at each position.",
        matchTerms: countTerms(7 * 7 * 7),
      },
    ],
  },
  {
    id: "permutation-photo-row",
    concept: "full arrangement of n distinct objects (n!)",
    disposition: "publish",
    spec: countSpec,
    hints: [
      "Arranging all six posters in a row is an ordering problem: every rearrangement of the same posters is a different arrangement.",
      "Fill the six positions from left to right: 6 choices for the first spot, 5 for the next, and so on down to 1.",
      "Multiply 6 * 5 * 4 * 3 * 2 * 1, which is 6!.",
    ],
    steps: [
      "All 6 distinct posters are arranged, so the count is the number of permutations of 6 objects, 6!.",
      "6! = 6 * 5 * 4 * 3 * 2 * 1.",
      "6! = 720 arrangements.",
    ],
    misconceptions: [
      {
        id: "repetition-allowed",
        feedback:
          "6^6 = 46656 would let one poster occupy several spots. Each poster is used exactly once, so the number of choices drops by one at every position.",
        matchTerms: countTerms(6 ** 6),
      },
    ],
  },
  {
    id: "combination-books",
    concept: "combination of k from n (unordered selection)",
    disposition: "publish",
    reserveSibling: "combination-partners",
    spec: countSpec,
    hints: [
      "A set of borrowed books has no order: taking the same four books in a different sequence is the same set.",
      "Count ordered selections with P(10,4), then remove the 4! orderings of each set; that quotient is C(10,4).",
      "Compute C(10,4) = 10!/(4! 6!), or 10 * 9 * 8 * 7 divided by 4 * 3 * 2 * 1.",
    ],
    steps: [
      "The books form an unordered set, so use combinations: C(10,4) = 10!/(4! 6!).",
      "C(10,4) = (10 * 9 * 8 * 7)/(4 * 3 * 2 * 1) = 5040/24.",
      "C(10,4) = 210 sets of books.",
    ],
    misconceptions: [
      {
        id: "permutation-instead-of-combination",
        feedback:
          "P(10,4) = 5040 counts every order of the same four books separately. A set of books is unordered, so divide by 4! = 24.",
        matchTerms: countTerms(10 * 9 * 8 * 7),
      },
      // A "stages-multiplied-directly" misconception (10 * 4 = 40) is
      // deliberately absent: its only spelling, "40", also fires inside
      // "5040" and "840" under the substring matcher, and no safe spelling
      // exists.
    ],
  },
  {
    id: "addition-calendar",
    concept: "addition rule with overlap",
    disposition: "publish",
    spec: probabilitySpec,
    hints: [
      "P(A ∪ B), A union B, is the event 'A or B'. The intersection A ∩ B, 'A and B', lies inside both A and B, so adding P(A) and P(B) counts it twice.",
      "Addition rule: P(A or B) = P(A) + P(B) - P(A and B).",
      "Compute 0.45 + 0.38 - 0.20.",
    ],
    steps: [
      "Addition rule, with A ∪ B read as 'A or B' and A ∩ B as 'A and B': P(A or B) = P(A) + P(B) - P(A and B).",
      "Substitute: 0.45 + 0.38 - 0.20.",
      "P(A or B) = 0.63.",
    ],
    misconceptions: [
      {
        id: "overlap-not-subtracted",
        feedback:
          "0.45 + 0.38 counts the intersection twice. Subtract P(A and B) = 0.20 once.",
        matchTerms: decimalTerms(0.45 + 0.38),
      },
    ],
  },
  {
    id: "addition-disjoint-checks",
    concept: "addition rule for disjoint events",
    disposition: "publish",
    // A single addition with disjointness given in the prompt is foundational
    // work; the original's "intermediate" label overstated it.
    difficulty: "foundational",
    spec: probabilitySpec,
    hints: [
      "Disjoint events cannot happen together, so P(A ∩ B), the probability of 'A and B', is 0 and nothing is double counted.",
      "For disjoint events the addition rule simplifies to P(A ∪ B) = P(A or B) = P(A) + P(B).",
      "Add 0.27 and 0.31.",
    ],
    steps: [
      "A and B are disjoint, so P(A and B) = 0 and P(A ∪ B), the probability of 'A or B', is P(A) + P(B).",
      "Substitute: 0.27 + 0.31.",
      "P(A or B) = 0.58.",
    ],
    misconceptions: [
      {
        id: "probabilities-multiplied",
        feedback:
          "Multiplying gives P(A and B) only for independent events. Disjoint events have P(A and B) = 0, and the probability of the union is the sum.",
        matchTerms: decimalTerms(0.27 * 0.31),
      },
    ],
  },
  {
    id: "role-volunteers",
    concept: "distinguished role followed by an unordered group",
    disposition: "publish",
    reserveSibling: "role-editors",
    // The prompt spells out both stages, so this is intermediate work; the
    // original's "challenge" label overstated it.
    difficulty: "intermediate",
    spec: countSpec,
    hints: [
      "The coordinator is a distinguished role, but the two assistants are an unordered pair. Count the team in two stages.",
      "Stage 1: choose the coordinator from 8. Stage 2: choose 2 assistants from the 7 remaining volunteers with a combination.",
      "Multiply 8 by C(7,2).",
    ],
    steps: [
      "Two stages: pick the coordinator, then an unordered pair of assistants from the remaining volunteers.",
      "Coordinator: 8 ways. Assistants: C(7,2) = 21 ways.",
      "8 * 21 = 168 teams.",
    ],
    misconceptions: [
      {
        id: "roles-not-distinguished",
        feedback:
          "C(8,3) = 56 treats all three roles as interchangeable. The coordinator is a distinct role, so choose it separately and then choose the assistants.",
        matchTerms: countTerms(56),
      },
      {
        id: "coordinator-reused-as-assistant",
        feedback:
          "Choosing the assistants from all 8 lets the coordinator also serve as an assistant. Choose the 2 assistants from the remaining 7.",
        matchTerms: countTerms(8 * 28),
      },
    ],
  },
  {
    id: "product-route-code",
    concept: "multiplication principle across two stages",
    disposition: "reserve",
    publishSibling: "product-outfits",
    prompt:
      "A route code uses one letter chosen from 6 options followed by one digit chosen from 10 options. How many different route codes are possible?",
    spec: countSpec,
    hints: [
      "A route code is built in two stages: choose the letter, then choose the digit.",
      "The multiplication principle says the number of codes is the product of the number of choices at each stage.",
      "Multiply 6 by 10.",
    ],
    steps: [
      "Multiplication principle: a letter choice with 6 options followed by a digit choice with 10 options gives 6 * 10 codes.",
      "Each of the 6 letters can be followed by any of the 10 digits.",
      "6 * 10 = 60 route codes.",
    ],
    misconceptions: [
      {
        id: "stages-added",
        feedback:
          "Adding 6 + 10 counts symbols, not codes. Every letter pairs with every digit, so multiply.",
        matchTerms: countTerms(6 + 10),
      },
    ],
  },
  {
    id: "permutation-awards",
    concept: "permutation of k from n (ordered positions)",
    disposition: "reserve",
    publishSibling: "permutation-presentations",
    spec: countSpec,
    hints: [
      "First, second, and third place are different positions, so the same three finalists in a different order is a different outcome.",
      "Fill the places in sequence: 9 choices for first, then fewer for second and third, because a finalist cannot take two places.",
      "Multiply the three descending counts; that product is P(9,3) = 9!/6!.",
    ],
    steps: [
      "Order matters and no finalist repeats, so this is a permutation of 3 finalists chosen from 9: P(9,3).",
      "P(9,3) = 9 * 8 * 7.",
      "9 * 8 * 7 = 504 award outcomes.",
    ],
    misconceptions: [
      {
        id: "combination-instead-of-permutation",
        feedback:
          "C(9,3) = 84 treats the three placed finalists as an unordered group. The places are ordered, so use P(9,3), which is 3! times larger.",
        matchTerms: countTerms(84),
      },
      {
        id: "repetition-allowed",
        feedback:
          "9 * 9 * 9 lets one finalist take more than one place. With no ties, the choices decrease at each place.",
        matchTerms: countTerms(9 ** 3),
      },
    ],
  },
  {
    id: "combination-partners",
    concept: "combination of 2 from n (unordered pairs)",
    disposition: "reserve",
    publishSibling: "combination-books",
    spec: countSpec,
    hints: [
      "A pair of partners has no order: the pair made of two particular students is the same pair either way round.",
      "Count ordered pairs with 12 * 11, then remove the 2 orderings of each pair; that quotient is C(12,2).",
      "Compute C(12,2) = 12!/(2! 10!), or (12 * 11)/2.",
    ],
    steps: [
      "Partners form an unordered pair, so use combinations: C(12,2) = 12!/(2! 10!).",
      "C(12,2) = (12 * 11)/(2 * 1) = 132/2.",
      "C(12,2) = 66 pairs.",
    ],
    misconceptions: [
      {
        id: "permutation-instead-of-combination",
        feedback:
          "12 * 11 = 132 counts each pair twice, once in each order. A pair of partners is unordered, so divide by 2.",
        matchTerms: countTerms(12 * 11),
      },
    ],
  },
  {
    id: "role-editors",
    concept: "distinguished role followed by an unordered group",
    disposition: "reserve",
    publishSibling: "role-volunteers",
    // Same reasoning as role-volunteers: both stages are given in the prompt.
    difficulty: "intermediate",
    spec: countSpec,
    hints: [
      "The lead editor is a distinguished role, but the three reviewers are an unordered group. Count the team in two stages.",
      "Stage 1: choose the lead editor from 7. Stage 2: choose 3 reviewers from the 6 remaining editors with a combination.",
      "Multiply 7 by C(6,3).",
    ],
    steps: [
      "Two stages: pick the lead editor, then an unordered group of reviewers from the remaining editors.",
      "Lead editor: 7 ways. Reviewers: C(6,3) = 20 ways.",
      "7 * 20 = 140 teams.",
    ],
    misconceptions: [
      {
        id: "roles-not-distinguished",
        feedback:
          "C(7,4) = 35 treats all four roles as interchangeable. The lead editor is a distinct role, so choose it separately and then choose the reviewers.",
        matchTerms: countTerms(35),
      },
      {
        id: "lead-reused-as-reviewer",
        feedback:
          "Choosing the reviewers from all 7 lets the lead editor also serve as a reviewer. Choose the 3 reviewers from the remaining 6.",
        matchTerms: countTerms(7 * 35),
      },
    ],
  },
];

function originalId(suffix) {
  return `generated-syllabus-${suffix}`;
}

function remediatedId(suffix) {
  return `${originalId(suffix)}${REMEDIATED_ID_SUFFIX}`;
}

function reviewNotes(remediation, original) {
  const sibling =
    remediation.disposition === "publish"
      ? remediation.reserveSibling
        ? ` Suggested Reserve sibling for similar practice: ${remediatedId(remediation.reserveSibling)}.`
        : ""
      : ` Suggested as the Reserve similar-practice sibling of ${remediatedId(remediation.publishSibling)}.`;
  const wording =
    remediation.prompt && remediation.prompt !== original.prompt
      ? " The prompt wording was clarified; the answer is unchanged."
      : " The prompt and answer are unchanged.";
  const relabel =
    remediation.difficulty && remediation.difficulty !== original.difficulty
      ? ` Difficulty relabeled from ${original.difficulty} to ${remediation.difficulty}.`
      : "";
  return (
    `Remediation batch 1 (2026-09-10), version 2 of ${original.id}: ` +
    `${remediation.disposition === "publish" ? "publish candidate" : "Reserve candidate"} for ${remediation.concept}.` +
    wording +
    relabel +
    " Hints, solution steps, misconception match terms, and a typed answer spec were rewritten." +
    sibling
  );
}

export function buildRemediatedCandidates(originals) {
  const byId = new Map(originals.map((entry) => [entry.id, entry]));
  const candidates = REMEDIATIONS.map((remediation) => {
    const original = byId.get(originalId(remediation.id));
    if (!original) {
      throw new Error(`Missing original candidate for ${remediation.id}.`);
    }
    if (remediation.hints.length !== 3) {
      throw new Error(`${remediation.id} must carry exactly three hints.`);
    }
    return {
      id: remediatedId(remediation.id),
      topicId: original.topicId,
      topic: original.topic,
      title: original.title.replace(/ Draft$/, " Draft v2"),
      prompt: remediation.prompt ?? original.prompt,
      patternSource: original.patternSource,
      difficulty: remediation.difficulty ?? original.difficulty,
      answer: {
        acceptedAnswers: [...original.answer.acceptedAnswers],
        numericValue: original.answer.numericValue,
        tolerance: original.answer.tolerance,
        explanation: remediation.steps.at(-1),
        spec: remediation.spec(original),
      },
      hints: [...remediation.hints],
      solutionSteps: [...remediation.steps],
      // Sorted by id: the database snapshot orders a question's
      // misconceptions by id, and the importer's idempotent re-import compares
      // the stored snapshot with this fixture order.
      misconceptions: remediation.misconceptions
        .map((misconception) => ({
          id: `misconception-${remediation.id}-${misconception.id}`,
          matchTerms: [...misconception.matchTerms],
          feedback: misconception.feedback,
        }))
        .sort((left, right) => (left.id < right.id ? -1 : 1)),
      source: {
        sourceType: "generated_original",
        trustLevel: "generated_unverified",
        visibility: "public",
        originalityNote: `${ORIGINALITY_NOTE} Version 2 of ${original.id} with rewritten hints, misconception match terms, and a typed answer spec; the wording and answer stay original.`,
      },
      // Review priority is deliberately not pre-set: marking a draft as
      // priority is the professor's own gate before approval.
      review: {
        status: "needs_review",
        notes: reviewNotes(remediation, original),
      },
    };
  });

  validateCandidates(candidates);
  return candidates;
}

function validateCandidates(candidates) {
  const ids = new Set();
  for (const item of candidates) {
    if (ids.has(item.id)) {
      throw new Error(`Duplicate remediated question id: ${item.id}`);
    }
    ids.add(item.id);
    if (
      item.review.status !== "needs_review" ||
      item.source.trustLevel !== "generated_unverified"
    ) {
      throw new Error(`Unsafe student visibility metadata on ${item.id}.`);
    }
    for (const misconception of item.misconceptions) {
      if (misconception.matchTerms.length === 0) {
        throw new Error(
          `${item.id} misconception ${misconception.id} has no match terms.`,
        );
      }
    }
  }
  const siblings = new Map(
    REMEDIATIONS.map((remediation) => [remediation.id, remediation]),
  );
  for (const remediation of REMEDIATIONS) {
    const partner = remediation.reserveSibling ?? remediation.publishSibling;
    if (partner && !siblings.has(partner)) {
      throw new Error(`${remediation.id} names an unknown sibling ${partner}.`);
    }
  }
}

async function main() {
  const originals = JSON.parse(await readFile(originalsPath, "utf8"));
  const output = `${JSON.stringify(buildRemediatedCandidates(originals), null, 2)}\n`;

  if (checkOnly) {
    const existing = await readFile(outputPath, "utf8");
    if (existing !== output) {
      throw new Error(
        "Remediated syllabus review candidates are stale. Run npm run prepare:remediated-syllabus-questions.",
      );
    }
    console.log("Remediated syllabus review candidates are current.");
    return;
  }

  await writeFile(outputPath, output);
  console.log(
    `Generated ${REMEDIATIONS.length} remediated syllabus review candidates.`,
  );
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
