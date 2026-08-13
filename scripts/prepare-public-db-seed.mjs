#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadCanonicalSyllabusTopics } from "./lib/canonical-syllabus-topics.mjs"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

const defaultOutputPath = path.join(tmpdir(), "pf-xj-public-db-seed.sql")
const defaultDemoQuestionsPath = path.join(repoRoot, "data/demo/questions.json")
const defaultApprovedGeneratedPath = path.join(
  repoRoot,
  "data/processed/approved-generated-questions.json",
)
const args = parseArgs(process.argv.slice(2))
const outputPath = args.output
  ? path.resolve(repoRoot, args.output)
  : defaultOutputPath
const demoQuestionsPath = args.demoQuestions
  ? path.resolve(repoRoot, args.demoQuestions)
  : defaultDemoQuestionsPath
const approvedGeneratedPath = args.approvedGenerated
  ? path.resolve(repoRoot, args.approvedGenerated)
  : defaultApprovedGeneratedPath
const includeApprovedGenerated = Boolean(args.includeApprovedGenerated)

const forbiddenKeys = [
  "locator",
  "sourceItemIds",
  "privatePhraseHashes",
  "sourceNumberSets",
  "sourceStoryFamilies",
  "page",
]
const forbiddenText =
  /source page|answer key|worked example|copied from|verbatim|raw extracted|private chunk|embedding/i

async function main() {
  assertPublicProcessedOutput(outputPath)

  const [demoQuestions, topics] = await Promise.all([
    readJson(demoQuestionsPath),
    loadCanonicalSyllabusTopics(repoRoot),
  ])
  const approvedGenerated = includeApprovedGenerated
    ? await readJson(approvedGeneratedPath)
    : { questions: [], visibility: "public" }

  const payload = {
    approvedGenerated,
    demoQuestions,
    topics,
  }
  const errors = validatePublicSeedPayload(payload, {
    includeApprovedGenerated,
  })

  if (errors.length > 0) {
    console.error("Public database seed preparation failed:")
    for (const error of errors) {
      console.error(`- ${error}`)
    }
    process.exitCode = 1
    return
  }

  const sql = buildSeedSql({
    approvedGenerated: approvedGenerated.questions ?? [],
    demoQuestions,
    topics,
  })

  await writeFile(outputPath, sql)
  console.log(
    `Prepared public database seed SQL at ${relativeToRepo(outputPath)}.`,
  )
}

export function validatePublicSeedPayload(payload, options = {}) {
  const errors = []
  const serialized = JSON.stringify(payload)

  for (const key of forbiddenKeys) {
    if (serialized.includes(`"${key}"`)) {
      errors.push(`public seed payload must not include private key ${key}.`)
    }
  }

  if (forbiddenText.test(serialized)) {
    errors.push(
      "public seed payload contains copied-source or private-data text.",
    )
  }

  const topicIds = validateTopics(payload.topics, errors)
  validateDemoQuestions(payload.demoQuestions, topicIds, errors)

  if (options.includeApprovedGenerated) {
    validateApprovedGenerated(payload.approvedGenerated, topicIds, errors)
  }

  return errors
}

function buildSeedSql({ approvedGenerated, demoQuestions, topics }) {
  const topicOrders = new Map(topics.map((topic) => [topic.id, topic.order]))
  const compareQuestions = (left, right) =>
    (topicOrders.get(left.topicId) ?? Number.MAX_SAFE_INTEGER) -
      (topicOrders.get(right.topicId) ?? Number.MAX_SAFE_INTEGER) ||
    String(left.id).localeCompare(String(right.id))
  const lines = [
    "-- Public-safe seed data generated from committed demo/processed fixtures.",
    "-- Review this SQL before applying it to Postgres.",
    "begin;",
    "",
  ]

  for (const topic of topics) {
    lines.push(
      `insert into topics (id, title, description, sort_order, week_number, module_ref, is_active) values (${sqlString(
        topic.id,
      )}, ${sqlString(topic.title)}, ${sqlString(topic.description)}, ${sqlNumber(
        topic.order,
      )}, ${sqlNumber(topic.weekNumber)}, ${sqlString(
        topic.moduleRef,
      )}, ${sqlBoolean(topic.active)}) on conflict (id) do update set title = excluded.title, description = excluded.description, sort_order = excluded.sort_order, week_number = excluded.week_number, module_ref = excluded.module_ref, is_active = excluded.is_active, updated_at = now();`,
    )
  }

  lines.push("")

  for (const question of [...demoQuestions].sort(compareQuestions)) {
    lines.push(...seedQuestionSql(normalizeDemoQuestion(question)))
  }

  for (const question of [...approvedGenerated].sort(compareQuestions)) {
    lines.push(...seedQuestionSql(normalizeApprovedGeneratedQuestion(question)))
  }

  lines.push("", "commit;", "")
  return lines.join("\n")
}

function seedQuestionSql(question) {
  const lines = [
    "select set_config('app.current_user_id', 'system:schema-migration', true);",
    "select set_config('app.current_creation_method', 'imported', true);",
    "select set_config('app.suppress_question_version', 'true', true);",
    `insert into questions (id, topic_id, pattern_id, title, prompt, difficulty, accepted_answers_json, numeric_value, tolerance, answer_explanation, source_type, trust_level, visibility, review_status, originality_note, reviewed_by, reviewed_by_user_id, reviewed_at) values (${sqlString(
      question.id,
    )}, ${sqlString(question.topicId)}, ${sqlString(question.patternId)}, ${sqlString(
      question.title,
    )}, ${sqlString(question.prompt)}, ${sqlString(question.difficulty)}, ${sqlJson(
      question.acceptedAnswers,
    )}, ${sqlNumber(question.numericValue)}, ${sqlNumber(
      question.tolerance,
    )}, ${sqlString(question.answerExplanation)}, ${sqlString(question.sourceType)}, ${sqlString(
      question.trustLevel,
    )}, ${sqlString(question.visibility)}, ${sqlString(
      question.reviewStatus,
    )}, ${sqlString(question.originalityNote)}, 'development seed', 'system:schema-migration', now()) on conflict (id) do update set topic_id = excluded.topic_id, pattern_id = excluded.pattern_id, title = excluded.title, prompt = excluded.prompt, difficulty = excluded.difficulty, accepted_answers_json = excluded.accepted_answers_json, numeric_value = excluded.numeric_value, tolerance = excluded.tolerance, answer_explanation = excluded.answer_explanation, source_type = excluded.source_type, trust_level = excluded.trust_level, visibility = excluded.visibility, review_status = excluded.review_status, originality_note = excluded.originality_note, reviewed_by = excluded.reviewed_by, reviewed_by_user_id = excluded.reviewed_by_user_id, reviewed_at = excluded.reviewed_at, updated_at = now();`,
  ]

  question.hints.forEach((hint, index) => {
    lines.push(
      `insert into hints (question_id, hint_order, body) values (${sqlString(
        question.id,
      )}, ${index + 1}, ${sqlString(hint)}) on conflict (question_id, hint_order) do update set body = excluded.body;`,
    )
  })

  question.solutionSteps.forEach((step, index) => {
    lines.push(
      `insert into solution_steps (question_id, step_order, body) values (${sqlString(
        question.id,
      )}, ${index + 1}, ${sqlString(step)}) on conflict (question_id, step_order) do update set body = excluded.body;`,
    )
  })

  question.misconceptions.forEach((misconception) => {
    lines.push(
      `insert into misconceptions (question_id, id, feedback, match_terms_json) values (${sqlString(
        question.id,
      )}, ${sqlString(misconception.id)}, ${sqlString(
        misconception.feedback,
      )}, ${sqlJson(
        misconception.matchTerms,
      )}) on conflict (question_id, id) do update set feedback = excluded.feedback, match_terms_json = excluded.match_terms_json;`,
    )
  })

  lines.push(
    "select set_config('app.suppress_question_version', 'false', true);",
    `select app_record_question_version(${sqlString(question.id)});`,
    `insert into question_approval_history (question_id, question_version_id, decision, reviewer_user_id, reviewer_label, decided_at) select q.id, q.working_version_id, 'approved', 'system:schema-migration', 'development seed', q.reviewed_at from questions q where q.id = ${sqlString(question.id)} and not exists (select 1 from question_approval_history qah where qah.question_id = q.id and qah.question_version_id = q.working_version_id and qah.decision = 'approved');`,
  )

  return lines
}

function normalizeDemoQuestion(question) {
  return {
    id: question.id,
    topicId: question.topicId,
    patternId: null,
    title: question.title ?? titleCase(question.topic),
    prompt: question.questionText,
    difficulty: question.difficulty,
    acceptedAnswers: question.acceptedAnswers ?? [question.finalAnswer],
    numericValue: question.numericValue ?? null,
    tolerance: question.tolerance ?? null,
    answerExplanation:
      question.answerExplanation ??
      question.solutionSteps.at(-1) ??
      question.finalAnswer,
    hints: question.hints,
    solutionSteps: question.solutionSteps,
    misconceptions: normalizeMisconceptions(question.misconceptions ?? []),
    sourceType: "original_demo",
    trustLevel: "public_original",
    visibility: "public",
    reviewStatus: "approved",
    originalityNote: question.sourceMetadata?.originalityNote,
  }
}

function normalizeApprovedGeneratedQuestion(question) {
  return {
    id: question.id,
    topicId: question.topicId,
    patternId: question.patternId,
    title: question.title ?? titleCase(question.topic),
    prompt: question.questionText,
    difficulty: question.difficulty,
    acceptedAnswers: [question.finalAnswer],
    numericValue: null,
    tolerance: null,
    answerExplanation: question.finalAnswer,
    hints: question.hints,
    solutionSteps: question.solutionSteps,
    misconceptions: normalizeMisconceptions(question.misconceptions),
    sourceType: question.sourceMetadata.sourceType,
    trustLevel: question.trustLevel,
    visibility: question.sourceMetadata.visibility,
    reviewStatus: question.reviewStatus,
    originalityNote: question.originalityNote,
  }
}

function normalizeMisconceptions(misconceptions) {
  if (!Array.isArray(misconceptions)) {
    return []
  }

  return misconceptions.map((misconception) => ({
    feedback: misconception.feedback,
    id: misconception.id,
    matchTerms: Array.isArray(misconception.matchTerms)
      ? misconception.matchTerms
      : misconception.hook
        ? [misconception.hook]
        : [],
  }))
}

function validateTopics(topics, errors) {
  if (!Array.isArray(topics) || topics.length === 0) {
    errors.push(
      "the canonical syllabus topic catalog must be a non-empty array.",
    )
    return new Set()
  }

  const ids = new Set()
  const orders = new Set()
  let previousOrder = 0

  for (const [index, topic] of topics.entries()) {
    const label = `topics[${index}]`
    requireString(topic.id, `${label}.id`, errors)
    requireString(topic.title, `${label}.title`, errors)
    requireString(topic.description, `${label}.description`, errors)
    requireString(topic.moduleRef, `${label}.moduleRef`, errors)

    if (!Number.isInteger(topic.order) || topic.order < 1) {
      errors.push(`${label}.order must be a positive integer.`)
    } else if (topic.order <= previousOrder) {
      errors.push(
        "topics must be stored in strictly increasing syllabus order.",
      )
    } else {
      previousOrder = topic.order
    }

    if (!Number.isInteger(topic.weekNumber) || topic.weekNumber < 1) {
      errors.push(`${label}.weekNumber must be a positive integer.`)
    }

    if (typeof topic.active !== "boolean") {
      errors.push(`${label}.active must be a boolean.`)
    }

    if (ids.has(topic.id)) {
      errors.push(`${label}.id must be unique.`)
    }
    if (orders.has(topic.order)) {
      errors.push(`${label}.order must be unique.`)
    }

    ids.add(topic.id)
    orders.add(topic.order)
  }

  return ids
}

function validateDemoQuestions(questions, topicIds, errors) {
  if (!Array.isArray(questions)) {
    errors.push("data/demo/questions.json must be an array.")
    return
  }

  for (const [index, question] of questions.entries()) {
    const label = `demoQuestions[${index}]`
    requireString(question.id, `${label}.id`, errors)
    requireString(question.topicId, `${label}.topicId`, errors)
    requireString(question.topic, `${label}.topic`, errors)
    requireString(question.questionText, `${label}.questionText`, errors)
    requireString(question.finalAnswer, `${label}.finalAnswer`, errors)
    requireStringArray(question.hints, `${label}.hints`, errors)
    requireStringArray(question.solutionSteps, `${label}.solutionSteps`, errors)

    if (question.reviewStatus !== "approved") {
      errors.push(`${label}.reviewStatus must be approved.`)
    }

    if (!topicIds.has(question.topicId)) {
      errors.push(`${label}.topicId must reference a syllabus topic.`)
    }
  }
}

function validateApprovedGenerated(payload, topicIds, errors) {
  if (payload?.visibility !== "public") {
    errors.push(
      "approved generated question payload visibility must be public.",
    )
  }

  if (!Array.isArray(payload?.questions)) {
    errors.push(
      "approved generated question payload questions must be an array.",
    )
    return
  }

  for (const [index, question] of payload.questions.entries()) {
    const label = `approvedGenerated.questions[${index}]`

    requireString(question.id, `${label}.id`, errors)
    const topicId = question.topicId
    requireString(question.topicId, `${label}.topicId`, errors)
    requireString(question.topic, `${label}.topic`, errors)
    requireString(question.questionText, `${label}.questionText`, errors)
    requireString(question.finalAnswer, `${label}.finalAnswer`, errors)
    requireStringArray(question.hints, `${label}.hints`, errors)
    requireStringArray(question.solutionSteps, `${label}.solutionSteps`, errors)

    if (question.reviewStatus !== "approved") {
      errors.push(`${label}.reviewStatus must be approved.`)
    }

    if (question.trustLevel !== "professor_approved") {
      errors.push(`${label}.trustLevel must be professor_approved.`)
    }

    if (question.sourceMetadata?.sourceType !== "generated_original") {
      errors.push(
        `${label}.sourceMetadata.sourceType must be generated_original.`,
      )
    }

    if (question.sourceMetadata?.visibility !== "public") {
      errors.push(`${label}.sourceMetadata.visibility must be public.`)
    }

    if (!topicIds.has(topicId)) {
      errors.push(`${label}.topicId must reference a syllabus topic.`)
    }
  }
}

function requireString(value, label, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string.`)
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

async function readJson(inputPath) {
  const filePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(repoRoot, inputPath)

  return JSON.parse(await readFile(filePath, "utf8"))
}

function assertPublicProcessedOutput(targetPath) {
  const processedRelative = path.relative(
    path.join(repoRoot, "data/processed"),
    targetPath,
  )

  if (
    processedRelative &&
    !processedRelative.startsWith("..") &&
    !path.isAbsolute(processedRelative)
  ) {
    return
  }

  if (
    isInside(targetPath, tmpdir()) ||
    isInside(targetPath, "/tmp") ||
    isInside(targetPath, "/private/tmp")
  ) {
    return
  }

  throw new Error(
    "Seed SQL output must stay under data/processed or a temp directory.",
  )
}

function isInside(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath)

  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  )
}

function sqlString(value) {
  if (value === null || value === undefined) {
    return "null"
  }

  return `'${String(value).replaceAll("'", "''")}'`
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value ?? []))}::jsonb`
}

function sqlNumber(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "null"
}

function sqlBoolean(value) {
  return value ? "true" : "false"
}

function titleCase(value) {
  return String(value)
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ")
}

function parseArgs(rawArgs) {
  const parsed = {}

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]

    if (arg === "--output") {
      parsed.output = rawArgs[index + 1]
      index += 1
    } else if (arg === "--demo-questions") {
      parsed.demoQuestions = rawArgs[index + 1]
      index += 1
    } else if (
      arg === "--approved-generated" ||
      arg === "--approved-generated-input"
    ) {
      parsed.approvedGenerated = rawArgs[index + 1]
      index += 1
    } else if (arg === "--include-approved-generated") {
      parsed.includeApprovedGenerated = true
    }
  }

  return parsed
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
