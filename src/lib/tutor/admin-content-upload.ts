import "server-only"

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { ReviewStatus } from "@/lib/types"

export const ADMIN_CONTENT_UPLOAD_MAX_BYTES = 512_000

export type AdminUploadKind = "pdf" | "tex"

export type AdminUploadPreviewItem = {
  evidence: string[]
  label: string
  reviewStatus: ReviewStatus
}

export type AdminFormulaPreviewItem = AdminUploadPreviewItem & {
  symbolicFormula: string
}

export type AdminContentUploadPreview = {
  approved: false
  file: {
    name: string
    size: number
    type: string
  }
  formulas: AdminFormulaPreviewItem[]
  misconceptions: AdminUploadPreviewItem[]
  patterns: AdminUploadPreviewItem[]
  privateTextSaved?: boolean
  privateStorage?: string
  reviewStatus: "needs_review"
  sourceUse: "private_reference_only"
  topics: AdminUploadPreviewItem[]
  uploadKind: AdminUploadKind
  warnings: string[]
}

type UploadedFileInput = {
  bytes: Uint8Array
  name: string
  size: number
  type: string
}

type TopicCatalogItem = {
  id: string
  label: string
  terms: string[]
}

const PRIVATE_EXTRACTED_PREVIEW_DIR =
  "data/private/extracted/admin-upload-previews"

const topicCatalog = [
  {
    id: "basic-probability",
    label: "Basic probability",
    terms: ["probability", "sample space", "event", "outcome", "complement"],
  },
  {
    id: "counting",
    label: "Counting",
    terms: ["counting", "permutation", "combination", "factorial", "choose"],
  },
  {
    id: "conditional-probability",
    label: "Conditional probability",
    terms: ["conditional", "given", "independent", "bayes", "p(a|b)", "p(a | b)"],
  },
  {
    id: "random-variables",
    label: "Random variables",
    terms: ["random variable", "distribution", "pmf", "cdf", "variance"],
  },
  {
    id: "expected-value",
    label: "Expected value",
    terms: ["expected value", "expectation", "mean", "e(x)", "weighted"],
  },
  {
    id: "binomial-models",
    label: "Binomial models",
    terms: ["binomial", "bernoulli", "success", "failure", "trials"],
  },
  {
    id: "normal-standardization",
    label: "Normal standardization",
    terms: ["normal", "z-score", "standardize", "standard deviation"],
  },
] satisfies TopicCatalogItem[]

export async function buildAdminContentUploadPreview(
  file: UploadedFileInput,
): Promise<AdminContentUploadPreview> {
  const fileType = validateAdminContentUploadFile(file)

  if ("error" in fileType) {
    throw new AdminContentUploadError(fileType.error, fileType.status)
  }

  if (fileType.kind === "tex") {
    return buildTexPreview(file)
  }

  return buildPdfPreview(file)
}

export function validateAdminContentUploadFile(
  file: Pick<UploadedFileInput, "bytes" | "name" | "size" | "type">,
):
  | { kind: AdminUploadKind }
  | { error: string; status: 400 | 413 } {
  if (file.size <= 0) {
    return { error: "Upload must include a non-empty file.", status: 400 }
  }

  if (file.size > ADMIN_CONTENT_UPLOAD_MAX_BYTES) {
    return {
      error: "Admin content uploads must be smaller than 512KB.",
      status: 413,
    }
  }

  const extension = path.extname(file.name).toLowerCase()

  if (extension === ".tex") {
    if (
      file.type &&
      ![
        "application/octet-stream",
        "application/x-tex",
        "text/plain",
        "text/x-tex",
      ].includes(file.type)
    ) {
      return { error: "The .tex upload has an unsupported MIME type.", status: 400 }
    }

    return { kind: "tex" }
  }

  if (extension === ".pdf") {
    if (
      file.type &&
      !["application/octet-stream", "application/pdf"].includes(file.type)
    ) {
      return { error: "The .pdf upload has an unsupported MIME type.", status: 400 }
    }

    const header = Buffer.from(file.bytes.slice(0, 5)).toString("ascii")
    if (header !== "%PDF-") {
      return { error: "PDF uploads must start with a valid PDF header.", status: 400 }
    }

    return { kind: "pdf" }
  }

  return {
    error: "Only .tex and small .pdf files are supported by this prototype.",
    status: 400,
  }
}

export class AdminContentUploadError extends Error {
  status: 400 | 413 | 503

  constructor(message: string, status: 400 | 413 | 503) {
    super(message)
    this.status = status
  }
}

function buildTexPreview(file: UploadedFileInput): AdminContentUploadPreview {
  const source = Buffer.from(file.bytes).toString("utf8")
  const stripped = stripTexComments(source)
  const sections = extractSectionTitles(stripped)
  const objectives = extractLearningObjectives(stripped)
  const formulas = extractLatexFormulas(stripped)
  const topics = topicItems(detectTopics([...sections, ...objectives, ...formulaText(formulas)]))
  const patterns = patternItems(topics, sections, formulas)
  const misconceptions = misconceptionItems(topics, formulas)

  return {
    approved: false,
    file: fileSummary(file),
    formulas: formulas.slice(0, 12).map((formula) => ({
      evidence: ["symbolic formula only"],
      label: formula.name,
      reviewStatus: "needs_review",
      symbolicFormula: formula.symbolicFormula,
    })),
    misconceptions,
    patterns,
    reviewStatus: "needs_review",
    sourceUse: "private_reference_only",
    topics,
    uploadKind: "tex",
    warnings: [
      "Preview only. Uploaded LaTeX is private reference material until professor review.",
      "Questions, examples, solutions, answer keys, and long prose are excluded from this preview.",
    ],
  }
}

async function buildPdfPreview(
  file: UploadedFileInput,
): Promise<AdminContentUploadPreview> {
  const extractedText = await extractPdfText(file)
  const privateStorage = await writePrivateExtractedText(file.name, extractedText)
  const safeText = normalizePlainText(extractedText)
  const formulas = extractPlainTextFormulas(safeText)
  const topics = topicItems(detectTopics([safeText, ...formulaText(formulas)]))
  const patterns = patternItems(topics, [], formulas)
  const misconceptions = misconceptionItems(topics, formulas)

  return {
    approved: false,
    file: fileSummary(file),
    formulas: formulas.slice(0, 12).map((formula) => ({
      evidence: ["symbolic formula only"],
      label: formula.name,
      reviewStatus: "needs_review",
      symbolicFormula: formula.symbolicFormula,
    })),
    misconceptions,
    patterns,
    privateTextSaved: true,
    privateStorage,
    reviewStatus: "needs_review",
    sourceUse: "private_reference_only",
    topics,
    uploadKind: "pdf",
    warnings: [
      "PDFs are private reference material only.",
      "Private text was saved only under ignored private storage.",
      "This preview contains topics, abstract patterns, formulas, and misconception ideas only; no public questions were created.",
    ],
  }
}

async function extractPdfText(file: UploadedFileInput) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "suffolk-admin-upload-"))
  const pdfPath = path.join(tempDir, "upload.pdf")
  const textPath = path.join(tempDir, "upload.txt")

  try {
    await writeFile(pdfPath, file.bytes)
    const result = spawnSync("pdftotext", ["-layout", pdfPath, textPath], {
      encoding: "utf8",
    })
    const literalText = extractPdfLiteralStrings(file.bytes)

    if (!result.error && result.status === 0) {
      const extracted = await readFile(textPath, "utf8")
      if (extracted.trim()) {
        return [extracted, literalText].filter((value) => value.trim()).join("\n")
      }
    }

    return literalText
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}

async function writePrivateExtractedText(fileName: string, text: string) {
  const repoRoot = process.cwd()
  const outputDir = path.join(repoRoot, PRIVATE_EXTRACTED_PREVIEW_DIR)
  const safeName = safeBaseName(fileName)
  const digest = createHash("sha256").update(text).digest("hex").slice(0, 10)
  const outputPath = path.join(outputDir, `${safeName}-${digest}.txt`)

  assertInsideDirectory(outputPath, outputDir)
  assertIgnoredPrivatePath(outputPath)

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, text.trim() ? `${text.trim()}\n` : "")

  return `${PRIVATE_EXTRACTED_PREVIEW_DIR}/`
}

function assertIgnoredPrivatePath(targetPath: string) {
  const repoRoot = process.cwd()
  const relativePath = path.relative(repoRoot, targetPath)
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", relativePath], {
    cwd: repoRoot,
  })

  if (result.status !== 0) {
    throw new AdminContentUploadError(
      "Private extraction output path is not ignored by Git.",
      503,
    )
  }
}

function assertInsideDirectory(targetPath: string, allowedDirectory: string) {
  const relativePath = path.relative(allowedDirectory, targetPath)
  const inside =
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)

  if (!inside) {
    throw new AdminContentUploadError(
      "Private extraction output path is invalid.",
      503,
    )
  }
}

function extractPdfLiteralStrings(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1")
  const values: string[] = []
  const literalPattern = /\(([^)]{2,240})\)/g

  for (const match of text.matchAll(literalPattern)) {
    const value = match[1]
      .replace(/\\([()\\])/g, "$1")
      .replace(/\\n/g, " ")
      .replace(/\s+/g, " ")
      .trim()

    if (value && /[a-zA-Z]/.test(value)) {
      values.push(value)
    }
  }

  return values.join("\n")
}

function extractSectionTitles(source: string) {
  const titles: string[] = []
  const sectionPattern =
    /\\(?:chapter|section|subsection|subsubsection|paragraph)\*?\{([^{}]{1,120})\}/g

  for (const match of source.matchAll(sectionPattern)) {
    const title = cleanLatexText(match[1])
    if (title && isPublicSafeTitle(title)) {
      titles.push(title)
    }
  }

  return uniqueStrings(titles).slice(0, 30)
}

function extractLatexFormulas(source: string) {
  const formulas: Array<{ name: string; symbolicFormula: string }> = []
  const patterns = [
    /\\\[((?:.|\n)*?)\\\]/g,
    /\$\$((?:.|\n)*?)\$\$/g,
    /\\begin\{(?:equation|align|gather|multline)\*?\}((?:.|\n)*?)\\end\{(?:equation|align|gather|multline)\*?\}/g,
  ]

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const symbolicFormula = cleanFormula(match[1])
      if (!symbolicFormula || !isPublicSafeFormula(symbolicFormula)) {
        continue
      }

      formulas.push({
        name: formulaName(symbolicFormula),
        symbolicFormula,
      })
    }
  }

  return uniqueByFormula(formulas).slice(0, 30)
}

function extractPlainTextFormulas(source: string) {
  const formulas: Array<{ name: string; symbolicFormula: string }> = []
  const candidates = source
    .split(/\r?\n|[.;]/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    const symbolicFormula = formulaSnippet(candidate)
    if (!symbolicFormula || !isPublicSafeFormula(symbolicFormula)) {
      continue
    }

    formulas.push({
      name: formulaName(symbolicFormula),
      symbolicFormula,
    })
  }

  return uniqueByFormula(formulas).slice(0, 30)
}

function extractLearningObjectives(source: string) {
  const objectives: string[] = []
  const lines = source.split(/\r?\n/).map((line) => cleanLatexText(line))

  for (const line of lines) {
    const objective = normalizeObjectiveLine(line)
    if (!objective || !isPublicSafeObjective(objective)) {
      continue
    }

    objectives.push(objective)
  }

  return uniqueStrings(objectives).slice(0, 30)
}

function patternItems(
  topics: AdminUploadPreviewItem[],
  sectionTitles: string[],
  formulas: Array<{ name: string; symbolicFormula: string }>,
) {
  const labels = new Set<string>()

  for (const topic of topics) {
    if (/conditional|bayes/i.test(topic.label)) {
      labels.add("Conditional probability with a restricted sample space")
    }
    if (/counting/i.test(topic.label)) {
      labels.add("Counting outcomes before applying a probability rule")
    }
    if (/expected value/i.test(topic.label)) {
      labels.add("Expected value from weighted outcomes")
    }
    if (/binomial/i.test(topic.label)) {
      labels.add("Exact-count binomial probability")
    }
    if (/normal/i.test(topic.label)) {
      labels.add("Normal standardization with a z-score")
    }
  }

  if (formulas.some((formula) => /\\binom|choose|binomial/i.test(formula.symbolicFormula))) {
    labels.add("Exact-count binomial probability")
  }

  if (labels.size === 0) {
    for (const title of sectionTitles.slice(0, 3)) {
      labels.add(`Abstract practice pattern from topic: ${title}`)
    }
  }

  return [...labels].slice(0, 8).map((label) => ({
    evidence: ["abstract pattern only"],
    label,
    reviewStatus: "needs_review" as const,
  }))
}

function misconceptionItems(
  topics: AdminUploadPreviewItem[],
  formulas: Array<{ name: string; symbolicFormula: string }>,
) {
  const labels = new Set<string>()
  const topicText = topics.map((topic) => topic.label).join(" ")

  if (/conditional|bayes/i.test(topicText)) {
    labels.add("Confusing P(A|B) with P(B|A)")
    labels.add("Using the full sample space after conditioning")
  }

  if (/counting|binomial/i.test(topicText)) {
    labels.add("Counting favorable outcomes but not total outcomes")
  }

  if (/expected value/i.test(topicText)) {
    labels.add("Averaging outcomes without probability weights")
  }

  if (/normal/i.test(topicText)) {
    labels.add("Using raw values before standardizing")
  }

  if (formulas.length > 0 && labels.size === 0) {
    labels.add("Substituting values before identifying formula variables")
  }

  return [...labels].slice(0, 8).map((label) => ({
    evidence: ["misconception idea only"],
    label,
    reviewStatus: "needs_review" as const,
  }))
}

function topicItems(topics: TopicCatalogItem[]) {
  return topics.slice(0, 8).map((topic) => ({
    evidence: ["topic label only"],
    label: topic.label,
    reviewStatus: "needs_review" as const,
  }))
}

function detectTopics(values: string[]) {
  const text = values.join(" ").toLowerCase()
  return topicCatalog.filter((topic) =>
    topic.terms.some((term) => text.includes(term)),
  )
}

function stripTexComments(source: string) {
  return source
    .split(/\r?\n/)
    .map((line) => line.replace(/(?<!\\)%.*/, ""))
    .join("\n")
}

function normalizeObjectiveLine(line: string) {
  const withoutItem = line.replace(/^\\?item\s*/i, "").trim()
  const objectiveMatch = withoutItem.match(
    /^(?:objective|learning objective|learning goal|students will|student will|outcome)\s*:?\s*(.+)$/i,
  )

  return objectiveMatch ? objectiveMatch[1].trim() : undefined
}

function isPublicSafeTitle(title: string) {
  return title.length <= 90 && wordCount(title) <= 12 && !unsafeReason(title)
}

function isPublicSafeObjective(objective: string) {
  return (
    objective.length <= 140 &&
    wordCount(objective) <= 18 &&
    !unsafeReason(objective)
  )
}

function isPublicSafeFormula(formula: string) {
  return (
    formula.length <= 160 &&
    wordCount(formula) <= 18 &&
    containsFormulaSignal(formula) &&
    !unsafeReason(formula)
  )
}

function unsafeReason(value: string) {
  if (value.includes("?")) {
    return "possible copied question"
  }

  if (
    /\b(example|exercise|problem|question|solution|answer|answer key|answers|worked example|homework|quiz|exam)\b/i.test(
      value,
    )
  ) {
    return "possible copied example, problem, solution, or answer key"
  }

  if (value.length > 220 || wordCount(value) > 28) {
    return "long prose kept private for review"
  }

  return undefined
}

function cleanLatexText(value: string) {
  return value
    .replace(/\\(?:begin|end)\{[^{}]+\}/g, " ")
    .replace(/\\(?:textbf|textit|emph|underline)\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " ")
    .replace(/[{}$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanFormula(value: string) {
  return value
    .replace(/\\label\{[^{}]*\}/g, "")
    .replace(/\\tag\{[^{}]*\}/g, "")
    .replace(/\\notag/g, "")
    .replace(/\\\\/g, "; ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizePlainText(value: string) {
  return value
    .replace(/[^\S\r\n]+/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !unsafeReason(line))
    .join("\n")
}

function containsFormulaSignal(value: string) {
  return /[=∑Σμσ√]|\bP\s*\(|\bE\s*\(|\bVar\s*\(|\\(?:sum|frac|sqrt|binom)\b/.test(
    value,
  )
}

function formulaSnippet(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim()
  const patterns = [
    /\bP\s*\([^)]*\)\s*=\s*[^.;,\n]{1,120}/,
    /\bE\s*\([^)]*\)\s*=\s*[^.;,\n]{1,120}/,
    /\bVar\s*\([^)]*\)\s*=\s*[^.;,\n]{1,120}/,
    /[A-Za-z][A-Za-z0-9_]*\s*=\s*[^.;,\n]{1,120}/,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    if (match?.[0]) {
      return match[0].trim()
    }
  }

  return undefined
}

function formulaName(formula: string) {
  if (/\bP\s*\([^)]*\|[^)]*\)|\\mid/.test(formula)) {
    return "Conditional probability"
  }

  if (/\bE\s*\(|\\mathbb\{E\}/.test(formula)) {
    return "Expected value"
  }

  if (/\\binom|\\choose|!|\bchoose\b/i.test(formula)) {
    return "Counting formula"
  }

  if (/\\sum|∑|Σ/.test(formula)) {
    return "Summation formula"
  }

  if (/\bVar\s*\(|σ|\\sigma/.test(formula)) {
    return "Variance or standard deviation"
  }

  return "Formula"
}

function formulaText(formulas: Array<{ symbolicFormula: string }>) {
  return formulas.map((formula) => formula.symbolicFormula)
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))]
}

function uniqueByFormula(
  formulas: Array<{ name: string; symbolicFormula: string }>,
) {
  const seen = new Set<string>()
  const unique: Array<{ name: string; symbolicFormula: string }> = []

  for (const formula of formulas) {
    const key = `${formula.name}:${formula.symbolicFormula}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    unique.push(formula)
  }

  return unique
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length
}

function fileSummary(file: UploadedFileInput) {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
  }
}

function safeBaseName(fileName: string) {
  return (
    path
      .basename(fileName, path.extname(fileName))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "upload"
  )
}
