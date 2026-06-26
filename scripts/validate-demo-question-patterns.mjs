#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const patternsPath = path.join(repoRoot, "data/demo/question-patterns.json")
const requiredTopics = new Set([
  "basic probability",
  "counting",
  "conditional probability",
  "independence",
  "expected value",
  "permutations",
  "combinations",
  "Bayes rule",
  "binomial distribution",
  "hypergeometric distribution",
  "variance",
  "normal approximation",
])
const allowedDifficulties = new Set(["foundational", "intermediate", "challenge"])
const allowedVariableTypes = new Set([
  "category",
  "count",
  "decimal",
  "integer",
  "money",
  "percent",
])
const forbiddenKeys = new Set([
  "locator",
  "sourceItemIds",
  "privatePhraseHashes",
  "sourceNumberSets",
  "sourceStoryFamilies",
  "patternIds",
])
const forbiddenText = [
  /textbook/i,
  /source page/i,
  /answer key/i,
  /worked example/i,
]

async function main() {
  const payload = JSON.parse(await readFile(patternsPath, "utf8"))
  const errors = validatePatternPayload(payload)

  if (errors.length > 0) {
    console.error(`Invalid demo question patterns in ${relativeToRepo(patternsPath)}:`)
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  console.log(`Validated ${payload.patterns.length} demo question pattern(s).`)
}

export function validatePatternPayload(payload) {
  const errors = []

  if (payload.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1.")
  }

  if (payload.visibility !== "public") {
    errors.push("visibility must be public.")
  }

  if (!Array.isArray(payload.patterns)) {
    errors.push("patterns must be an array.")
    return errors
  }

  const seenIds = new Set()
  const topics = new Set()
  const serialized = JSON.stringify(payload)

  for (const key of forbiddenKeys) {
    if (serialized.includes(`"${key}"`)) {
      errors.push(`public patterns must not include private key ${key}.`)
    }
  }

  for (const pattern of forbiddenText) {
    if (pattern.test(serialized)) {
      errors.push(`public patterns contain forbidden text pattern ${pattern}.`)
    }
  }

  for (const [index, pattern] of payload.patterns.entries()) {
    validatePattern(pattern, index, errors)

    if (typeof pattern.id === "string") {
      if (seenIds.has(pattern.id)) {
        errors.push(`patterns[${index}].id is duplicated: ${pattern.id}.`)
      }
      seenIds.add(pattern.id)
    }

    if (typeof pattern.topic === "string") {
      topics.add(pattern.topic)
    }
  }

  for (const requiredTopic of requiredTopics) {
    if (!topics.has(requiredTopic)) {
      errors.push(`missing required topic: ${requiredTopic}.`)
    }
  }

  return errors
}

function validatePattern(pattern, index, errors) {
  const label = `patterns[${index}]`

  requireString(pattern.id, `${label}.id`, errors)
  requireString(pattern.topic, `${label}.topic`, errors)
  requireString(pattern.template, `${label}.template`, errors)

  if (!allowedDifficulties.has(pattern.difficulty)) {
    errors.push(`${label}.difficulty must be a known difficulty.`)
  }

  if (!Array.isArray(pattern.variables) || pattern.variables.length === 0) {
    errors.push(`${label}.variables must be a non-empty array.`)
  } else {
    pattern.variables.forEach((variable, variableIndex) =>
      validateVariable(variable, `${label}.variables[${variableIndex}]`, errors),
    )
  }

  requireStringArray(pattern.constraints, `${label}.constraints`, errors)
  requireStringArray(pattern.generationNotes, `${label}.generationNotes`, errors)
  requireStringArray(
    pattern.misconceptionHooks,
    `${label}.misconceptionHooks`,
    errors,
  )

  if (String(pattern.template ?? "").includes("?")) {
    errors.push(`${label}.template must be a generic task shape, not a question.`)
  }
}

function validateVariable(variable, label, errors) {
  requireString(variable.name, `${label}.name`, errors)
  requireString(variable.role, `${label}.role`, errors)

  if (!allowedVariableTypes.has(variable.type)) {
    errors.push(`${label}.type must be a known variable type.`)
  }

  if (!Array.isArray(variable.values) || variable.values.length === 0) {
    errors.push(`${label}.values must be a non-empty array.`)
  }
}

function requireString(value, label, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${label} must be a non-empty string.`)
  }
}

function requireStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty string array.`)
    return
  }

  if (value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    errors.push(`${label} must contain only non-empty strings.`)
  }
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
