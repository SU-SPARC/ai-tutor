#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
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
const defaultInputPath = path.join(
  repoRoot,
  "data/processed/course-outline.json",
)
const defaultPrivateTextDir = path.join(repoRoot, "data/private/extracted")
const defaultOutputPath = path.join(
  repoRoot,
  "data/private/generated/suggested-patterns.json",
)
const args = parseArgs(process.argv.slice(2))
const inputPath = path.resolve(repoRoot, args.input ?? defaultInputPath)
const outputPath = path.resolve(repoRoot, args.output ?? defaultOutputPath)
const privateTextDir = path.resolve(
  repoRoot,
  args.privateTextDir ?? defaultPrivateTextDir,
)
const canonicalTopics = canonicalTopicMap(
  await loadCanonicalSyllabusTopics(repoRoot),
)

const patternCatalog = [
  {
    topicId: "introduction-probability-venn-diagrams",
    triggerTerms: ["basic probability", "sample space", "event", "complement"],
    pattern: {
      id: "suggested-basic-probability-complement",
      topicId: "introduction-probability-venn-diagrams",
      title: "Complement probability pattern",
      abstractTemplate:
        "A finite sample space has a target event and its complement. Compute the probability of the complement from counts or probabilities.",
      conceptTags: ["sample space", "complement", "favorable outcomes"],
      formulaRefs: ["P(not A) = 1 - P(A)"],
      variables: [
        {
          name: "totalCount",
          role: "number of outcomes in the sample space",
          type: "integer",
          min: 8,
          max: 40,
        },
        {
          name: "eventCount",
          role: "number of outcomes in the excluded event",
          type: "integer",
          min: 1,
          max: 20,
        },
      ],
      reasoningPlan: [
        "Identify the full sample space.",
        "Identify the event being excluded.",
        "Use total minus excluded outcomes or 1 minus the event probability.",
      ],
      misconceptionTargets: [
        "Using the excluded event as the numerator.",
        "Using a denominator that omits part of the sample space.",
      ],
    },
  },
  {
    topicId: "axioms-probability-counting-methods",
    triggerTerms: ["counting", "permutation", "combination", "factorial"],
    pattern: {
      id: "suggested-counting-order-decision",
      topicId: "axioms-probability-counting-methods",
      title: "Order matters decision pattern",
      abstractTemplate:
        "A selection task asks for either an ordered arrangement or an unordered group. Decide whether to use a permutation or combination before computing.",
      conceptTags: ["counting", "permutation", "combination"],
      formulaRefs: ["P(n,k) = n! / (n-k)!", "C(n,k) = n! / (k!(n-k)!)"],
      variables: [
        {
          name: "totalItems",
          role: "number of distinct available items",
          type: "integer",
          min: 5,
          max: 12,
        },
        {
          name: "selectedItems",
          role: "number of selected or arranged items",
          type: "integer",
          min: 2,
          max: 5,
        },
      ],
      reasoningPlan: [
        "Decide whether order creates a new outcome.",
        "Choose the appropriate counting formula.",
        "Compute with small hand-checkable values.",
      ],
      misconceptionTargets: [
        "Using permutations for unordered groups.",
        "Using combinations when positions or rank matter.",
      ],
    },
  },
  {
    topicId: "conditional-probability",
    triggerTerms: ["conditional", "given", "bayes", "p(a|b)", "p(a | b)"],
    pattern: {
      id: "suggested-conditional-restricted-sample-space",
      topicId: "conditional-probability",
      title: "Restricted sample-space pattern",
      abstractTemplate:
        "A condition restricts the sample space to a subgroup. Compute the probability of a target event within that subgroup.",
      conceptTags: ["conditional probability", "restricted sample space"],
      formulaRefs: ["P(A | B) = P(A and B) / P(B)"],
      variables: [
        {
          name: "conditionCount",
          role: "number of items satisfying the condition",
          type: "integer",
          min: 8,
          max: 60,
        },
        {
          name: "targetWithinCondition",
          role: "number of conditioned items satisfying the target event",
          type: "integer",
          min: 1,
          max: 30,
        },
      ],
      reasoningPlan: [
        "Restrict the denominator to the conditioned group.",
        "Count the target outcomes within that group.",
        "Compute target within condition divided by condition total.",
      ],
      misconceptionTargets: [
        "Using the original sample space after conditioning.",
        "Reversing the direction of the conditional probability.",
      ],
    },
  },
  {
    topicId: "random-variables",
    triggerTerms: ["expected value", "expectation", "weighted average", "e(x)"],
    pattern: {
      id: "suggested-expected-value-weighted-average",
      topicId: "random-variables",
      title: "Discrete weighted-average pattern",
      abstractTemplate:
        "A discrete random variable has several values and probabilities. Compute its expected value as a probability-weighted average.",
      conceptTags: [
        "expected value",
        "weighted average",
        "discrete distribution",
      ],
      formulaRefs: ["E(X) = sum x p(x)"],
      variables: [
        {
          name: "outcomeValues",
          role: "possible values of the random variable",
          type: "integer",
          min: 0,
          max: 20,
        },
        {
          name: "probabilities",
          role: "probabilities assigned to the values",
          type: "decimal",
          min: 0.1,
          max: 0.8,
        },
      ],
      reasoningPlan: [
        "Check that probabilities sum to one.",
        "Multiply each value by its probability.",
        "Add the weighted products.",
      ],
      misconceptionTargets: [
        "Averaging values without probability weights.",
        "Treating expected value as the most likely value.",
      ],
    },
  },
  {
    topicId: "binomial-models",
    triggerTerms: ["binomial", "independent trial", "success probability"],
    pattern: {
      id: "suggested-binomial-exact-count",
      topicId: "binomial-models",
      title: "Binomial exact-count pattern",
      abstractTemplate:
        "A fixed number of independent trials has a constant success probability. Compute the probability of exactly k successes.",
      conceptTags: ["binomial", "independent trials", "exact count"],
      formulaRefs: ["P(X = k) = C(n,k)p^k(1-p)^(n-k)"],
      variables: [
        {
          name: "n",
          role: "number of independent trials",
          type: "integer",
          min: 4,
          max: 12,
        },
        {
          name: "k",
          role: "exact number of successes",
          type: "integer",
          min: 1,
          max: 11,
          constraints: ["k < n"],
        },
        {
          name: "p",
          role: "success probability on each trial",
          type: "decimal",
          values: [0.2, 0.25, 0.3, 0.4, 0.5, 0.6],
        },
      ],
      reasoningPlan: [
        "Identify n, k, p, and 1-p.",
        "Use the binomial exact-count formula.",
        "Include the combination factor for success positions.",
      ],
      misconceptionTargets: [
        "Forgetting the combination factor.",
        "Using k as the number of failures.",
      ],
    },
  },
  {
    topicId: "random-variables",
    triggerTerms: ["random variable", "distribution", "variance", "var("],
    pattern: {
      id: "suggested-variance-discrete-random-variable",
      topicId: "random-variables",
      title: "Discrete variance pattern",
      abstractTemplate:
        "A discrete random variable has values and probabilities. Compute variance using the probability-weighted spread from the mean.",
      conceptTags: ["random variable", "variance", "discrete distribution"],
      formulaRefs: ["Var(X) = E(X^2) - [E(X)]^2"],
      variables: [
        {
          name: "outcomeValues",
          role: "possible values of the random variable",
          type: "integer",
          min: 0,
          max: 12,
        },
        {
          name: "probabilities",
          role: "probabilities assigned to the values",
          type: "decimal",
          min: 0.1,
          max: 0.8,
        },
      ],
      reasoningPlan: [
        "Compute the expected value.",
        "Compute the expected value of the squared variable.",
        "Subtract the square of the mean from the expected square.",
      ],
      misconceptionTargets: [
        "Reporting the mean instead of variance.",
        "Averaging squared deviations without probability weights.",
      ],
    },
  },
  {
    topicId: "normal-standardization",
    triggerTerms: ["normal", "z-score", "standardiz", "standard deviation"],
    pattern: {
      id: "suggested-normal-z-score",
      topicId: "normal-standardization",
      title: "Normal z-score pattern",
      abstractTemplate:
        "A normal observation, mean, and standard deviation are given. Compute the standardized z-score.",
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
          name: "observation",
          role: "observed value to standardize",
          type: "integer",
          min: 20,
          max: 130,
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
    },
  },
]

for (const entry of patternCatalog) {
  if (
    !canonicalTopics.has(entry.topicId) ||
    entry.pattern.topicId !== entry.topicId
  ) {
    throw new Error(
      `Suggested pattern ${entry.pattern.id} has a stale topic mapping.`,
    )
  }
}

async function main() {
  if (!assertPrivateOrTempOutput(outputPath)) {
    process.exitCode = 1
    return
  }

  const outlineResult = await readJsonIfExists(inputPath)
  const privateSignals = await collectPrivateTextSignals(privateTextDir)
  const suggestedPatterns = suggestPatterns(
    outlineResult.payload,
    privateSignals,
  )
  const payload = {
    schemaVersion: 1,
    visibility: "private",
    source: {
      type: "course_outline_metadata_pattern_suggestions",
      courseOutlinePath: relativeToRepo(inputPath),
      safeCourseOutlineRead: Boolean(outlineResult.payload),
      privateText: {
        inputDirectory: relativeToRepo(privateTextDir),
        fileCount: privateSignals.fileCount,
        usedForTopicSignalsOnly: privateSignals.fileCount > 0,
        matchedTopicIds: privateSignals.matchedTopicIds,
      },
    },
    safety: {
      outputsAbstractPatternsOnly: true,
      excludesCopiedQuestions: true,
      excludesCopiedExamples: true,
      excludesCopiedWorkedSteps: true,
      excludesAnswerKeys: true,
      storesOutputPrivately: true,
    },
    suggestedPatterns,
    humanReviewNotes: buildHumanReviewNotes({
      outlineMissing: !outlineResult.payload,
      privateSignals,
      suggestedPatterns,
    }),
  }
  const errors = validateSuggestedPatternPayload(payload)

  if (errors.length > 0) {
    console.error("Suggested pattern payload failed validation:")
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`)
  console.log(
    `Suggested ${suggestedPatterns.length} private abstract pattern(s) at ${relativeToRepo(
      outputPath,
    )}.`,
  )
}

function suggestPatterns(outline, privateSignals) {
  const safeText = outlineText(outline)
  const privateTopicIds = new Set(privateSignals.matchedTopicIds)

  return patternCatalog
    .filter((entry) => {
      const matchesOutline = entry.triggerTerms.some((term) =>
        safeText.includes(term),
      )
      return matchesOutline || privateTopicIds.has(entry.topicId)
    })
    .map((entry) => {
      const matchedOutline = entry.triggerTerms.some((term) =>
        safeText.includes(term),
      )
      const matchedPrivateText = privateTopicIds.has(entry.topicId)
      const suggestedBecause = []

      if (matchedOutline) {
        suggestedBecause.push("Matched safe course outline metadata.")
      }

      if (matchedPrivateText) {
        suggestedBecause.push(
          "Matched private extracted text by topic signal only; no private text is copied into this output.",
        )
      }

      return {
        ...entry.pattern,
        allowedGeneratedUse: "pattern_only",
        reviewStatus: "needs_review",
        suggestionStatus: "needs_human_review",
        source: {
          sourceType: "private_reference_pattern",
          trustLevel: "private_reference",
          visibility: "private",
        },
        suggestedBecause,
        humanReviewNotes: [
          "Confirm that this abstract pattern matches the professor's intended topic coverage.",
          "Check variable ranges before using the pattern for generated drafts.",
          "Generated items from this pattern must remain unapproved until professor review.",
        ],
      }
    })
}

function outlineText(outline) {
  if (!outline || typeof outline !== "object") {
    return ""
  }

  return [
    ...(outline.topics ?? []),
    ...(outline.sectionHeadings ?? []),
    ...(outline.learningObjectives ?? []),
    ...(outline.misconceptionCandidates ?? []),
    ...(outline.formulas ?? []).flatMap((formula) => [
      formula.name,
      formula.symbolicFormula,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

async function collectPrivateTextSignals(directoryPath) {
  let entries

  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return { fileCount: 0, matchedTopicIds: [] }
      }
    }

    throw error
  }

  const textFiles = entries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"),
    )
    .map((entry) => path.join(directoryPath, entry.name))
    .sort()
  const texts = await Promise.all(
    textFiles.map((filePath) => readFile(filePath, "utf8")),
  )
  const privateText = texts.join("\n").toLowerCase()
  const matchedTopicIds = patternCatalog
    .filter((entry) =>
      entry.triggerTerms.some((term) => privateText.includes(term)),
    )
    .map((entry) => entry.topicId)

  return {
    fileCount: textFiles.length,
    matchedTopicIds: [...new Set(matchedTopicIds)].sort(),
  }
}

function buildHumanReviewNotes({
  outlineMissing,
  privateSignals,
  suggestedPatterns,
}) {
  const notes = [
    "Review each suggested abstract pattern before using it for generation.",
    "Do not promote generated items from these suggestions until professor review is complete.",
  ]

  if (outlineMissing) {
    notes.push(
      "No safe course outline metadata file was found; run the course-outline preparation step after local extraction.",
    )
  }

  if (suggestedPatterns.length === 0) {
    notes.push(
      "No topic signals were detected, so no pattern suggestions were produced.",
    )
  }

  if (privateSignals.fileCount > 0) {
    notes.push(
      "Private extracted text was used only for topic-level signals; no phrases, examples, or item text were copied into this output.",
    )
  }

  return notes
}

function validateSuggestedPatternPayload(payload) {
  const errors = []

  if (payload.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.")
  }

  if (payload.visibility !== "private") {
    errors.push("visibility must be private.")
  }

  requireStringArray(payload.humanReviewNotes, "humanReviewNotes", errors)

  if (!Array.isArray(payload.suggestedPatterns)) {
    errors.push("suggestedPatterns must be an array.")
    return errors
  }

  const serialized = JSON.stringify(payload)

  if (/source page|answer key|worked example|copied from/i.test(serialized)) {
    errors.push("payload contains copied-source warning text.")
  }

  if (/"prompt"|"questionText"|"solutionSteps"/.test(serialized)) {
    errors.push(
      "payload must not include generated item prompts or worked steps.",
    )
  }

  for (const [index, pattern] of payload.suggestedPatterns.entries()) {
    validateSuggestedPattern(pattern, index, errors)
  }

  return errors
}

function validateSuggestedPattern(pattern, index, errors) {
  const label = `suggestedPatterns[${index}]`

  for (const key of [
    "id",
    "topicId",
    "title",
    "abstractTemplate",
    "reviewStatus",
    "suggestionStatus",
    "allowedGeneratedUse",
  ]) {
    if (typeof pattern[key] !== "string" || pattern[key].trim() === "") {
      errors.push(`${label}.${key} must be a non-empty string.`)
    }
  }

  if (pattern.reviewStatus !== "needs_review") {
    errors.push(`${label}.reviewStatus must be needs_review.`)
  }

  if (pattern.suggestionStatus !== "needs_human_review") {
    errors.push(`${label}.suggestionStatus must be needs_human_review.`)
  }

  if (pattern.allowedGeneratedUse !== "pattern_only") {
    errors.push(`${label}.allowedGeneratedUse must be pattern_only.`)
  }

  if (String(pattern.abstractTemplate ?? "").includes("?")) {
    errors.push(`${label}.abstractTemplate must not be a question.`)
  }

  requireStringArray(pattern.conceptTags, `${label}.conceptTags`, errors)
  requireStringArray(pattern.formulaRefs, `${label}.formulaRefs`, errors)
  requireStringArray(pattern.reasoningPlan, `${label}.reasoningPlan`, errors)
  requireStringArray(
    pattern.misconceptionTargets,
    `${label}.misconceptionTargets`,
    errors,
  )
  requireStringArray(
    pattern.suggestedBecause,
    `${label}.suggestedBecause`,
    errors,
  )
  requireStringArray(
    pattern.humanReviewNotes,
    `${label}.humanReviewNotes`,
    errors,
  )

  if (!Array.isArray(pattern.variables) || pattern.variables.length === 0) {
    errors.push(`${label}.variables must be a non-empty array.`)
  }
}

async function readJsonIfExists(filePath) {
  try {
    return { payload: JSON.parse(await readFile(filePath, "utf8")) }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return { payload: undefined }
      }
    }

    throw error
  }
}

function requireStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty string array.`)
    return
  }

  if (value.some((item) => typeof item !== "string" || item.trim() === "")) {
    errors.push(`${label} must contain only non-empty strings.`)
  }
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
      `WARNING: suggested pattern output must stay under data/private by default: ${relativeToRepo(
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
      `WARNING: suggested pattern output is not ignored by Git: ${relativePath}`,
      "Refusing to continue because suggested private patterns must stay private.",
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
    } else if (arg === "--private-text-dir") {
      parsed.privateTextDir = rawArgs[index + 1]
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
