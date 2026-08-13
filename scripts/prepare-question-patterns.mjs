#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  canonicalTopicMap,
  loadCanonicalSyllabusTopics,
} from "./lib/canonical-syllabus-topics.mjs"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const courseOutlinePath = path.join(
  repoRoot,
  "data/processed/course-outline.json",
)
const latexOutlinePath = path.join(
  repoRoot,
  "data/processed/latex-outline.json",
)
const outputPath = path.join(
  repoRoot,
  "data/private/generated/question-patterns.json",
)
const canonicalTopics = canonicalTopicMap(
  await loadCanonicalSyllabusTopics(repoRoot),
)

const patternCatalog = [
  {
    canonicalTopicIds: ["conditional-probability"],
    pattern: {
      id: "private-bayes-false-positive",
      topicId: "conditional-probability",
      title: "Bayes false-positive pattern",
      abstractTemplate:
        "Given a base rate and two conditional flag rates, compute the probability of the target group after a positive flag.",
      conceptTags: ["bayes", "conditional probability", "false positive"],
      formulaRefs: ["P(A | B) = P(B | A)P(A) / P(B)"],
      variables: [
        {
          name: "baseRate",
          role: "target group base rate",
          type: "percent",
          min: 1,
          max: 20,
        },
        {
          name: "targetFlagRate",
          role: "flag rate for target group",
          type: "percent",
          min: 70,
          max: 99,
        },
        {
          name: "otherFlagRate",
          role: "flag rate for non-target group",
          type: "percent",
          min: 1,
          max: 15,
        },
      ],
      reasoningPlan: [
        "Compute the joint probability for the target group and flag.",
        "Compute the joint probability for the non-target group and flag.",
        "Divide the target-and-flag probability by the total flag probability.",
      ],
      misconceptionTargets: [
        "Treating P(flagged | target) as P(target | flagged).",
        "Ignoring the target group's base rate.",
      ],
      forbiddenSimilarity: {
        sourceStoryFamilies: [],
        sourceNumberSets: [],
        privatePhraseHashes: [],
      },
    },
  },
  {
    canonicalTopicIds: ["binomial-models"],
    pattern: {
      id: "private-binomial-exact-count",
      topicId: "binomial-models",
      title: "Binomial exact-count pattern",
      abstractTemplate:
        "Given independent trials with a fixed success probability, compute the probability of exactly k successes.",
      conceptTags: ["binomial", "independent trials", "exact count"],
      formulaRefs: ["P(X = k) = C(n,k)p^k(1-p)^(n-k)"],
      variables: [
        {
          name: "n",
          role: "number of trials",
          type: "integer",
          min: 4,
          max: 12,
        },
        {
          name: "k",
          role: "desired successes",
          type: "integer",
          min: 1,
          max: 11,
          constraints: ["k < n"],
        },
        {
          name: "p",
          role: "success probability",
          type: "decimal",
          values: [0.2, 0.25, 0.3, 0.4, 0.6, 0.7, 0.75, 0.8],
        },
      ],
      reasoningPlan: [
        "Identify n, k, p, and 1-p.",
        "Use the binomial exact-count formula.",
        "Compute the combination term and probability product.",
      ],
      misconceptionTargets: [
        "Multiplying one exact order without C(n,k).",
        "Using p for both successes and failures.",
      ],
      forbiddenSimilarity: {
        sourceStoryFamilies: [],
        sourceNumberSets: [],
        privatePhraseHashes: [],
      },
    },
  },
  {
    canonicalTopicIds: ["normal-standardization"],
    pattern: {
      id: "private-normal-z-score",
      topicId: "normal-standardization",
      title: "Normal z-score pattern",
      abstractTemplate:
        "Given an observation, mean, and standard deviation, compute the standardized z-score.",
      conceptTags: ["normal", "standardization", "z-score"],
      formulaRefs: ["z = (x - mean) / standard deviation"],
      variables: [
        {
          name: "mean",
          role: "distribution mean",
          type: "integer",
          min: 40,
          max: 100,
        },
        {
          name: "standardDeviation",
          role: "distribution standard deviation",
          type: "integer",
          min: 4,
          max: 20,
        },
        {
          name: "z",
          role: "target z-score",
          type: "decimal",
          values: [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2],
        },
      ],
      reasoningPlan: [
        "Subtract the mean from the observation.",
        "Divide by the standard deviation.",
        "Interpret the sign of the z-score.",
      ],
      misconceptionTargets: [
        "Reversing the subtraction in the numerator.",
        "Forgetting to divide by the standard deviation.",
      ],
      forbiddenSimilarity: {
        sourceStoryFamilies: [],
        sourceNumberSets: [],
        privatePhraseHashes: [],
      },
    },
  },
]

for (const entry of patternCatalog) {
  if (
    !canonicalTopics.has(entry.pattern.topicId) ||
    entry.canonicalTopicIds.some((topicId) => !canonicalTopics.has(topicId))
  ) {
    throw new Error(
      `Private pattern ${entry.pattern.id} has a stale topic mapping.`,
    )
  }
}

async function main() {
  if (!assertIgnored("private question pattern output", outputPath)) {
    process.exitCode = 1
    return
  }

  const outlines = await Promise.all([
    readJsonIfExists(courseOutlinePath),
    readJsonIfExists(latexOutlinePath),
  ])
  const topicIds = detectCanonicalTopicIds(outlines)
  const patterns = patternCatalog
    .filter((entry) =>
      entry.canonicalTopicIds.some((topicId) => topicIds.has(topicId)),
    )
    .map((entry) => ({
      ...entry.pattern,
      allowedGeneratedUse: "pattern_only",
      mappingStatus: "mapped",
      source: {
        sourceType: "private_reference_pattern",
        trustLevel: "private_reference",
        visibility: "private",
      },
      sourceItemIds: [`topic:${entry.pattern.topicId}`],
    }))

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        visibility: "private",
        source:
          "Derived from public-safe course outline metadata. Keep private for audit and generation control.",
        patterns,
      },
      null,
      2,
    )}\n`,
  )

  console.log(
    `Wrote ${patterns.length} private question pattern(s) to ${relativeToRepo(
      outputPath,
    )}.`,
  )
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return undefined
      }
    }

    throw error
  }
}

function detectCanonicalTopicIds(outlines) {
  const text = outlines
    .filter(Boolean)
    .map((outline) => JSON.stringify(outline))
    .join(" ")
    .toLowerCase()
  const topicIds = new Set()

  if (/conditional|bayes|p\(a\|b\)|false positive/.test(text)) {
    topicIds.add("conditional-probability")
  }

  if (/binomial|independent trial|exact count|success probability/.test(text)) {
    topicIds.add("binomial-models")
  }

  if (/normal|z-score|standardiz|standard deviation/.test(text)) {
    topicIds.add("normal-standardization")
  }

  return topicIds
}

function assertIgnored(label, targetPath) {
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
      `WARNING: ${label} is not ignored by Git: ${relativePath}`,
      "Refusing to continue because private pattern data must stay out of Git.",
    ].join("\n"),
  )
  return false
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
