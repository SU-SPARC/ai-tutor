#!/usr/bin/env node

import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const inputDir = path.join(repoRoot, "data/private/course-materials")
const outputDir = path.join(repoRoot, "data/private/extracted")
const dryRun = process.argv.includes("--dry-run")

async function main() {
  const pdfFiles = await listPdfFiles()

  if (pdfFiles.length === 0) {
    console.log(
      `No PDFs found in ${relativeToRepo(inputDir)}. Nothing to extract.`,
    )
    return
  }

  const plannedOutputs = pdfFiles.map((pdfPath) => ({
    input: pdfPath,
    output: path.join(
      outputDir,
      `${path.basename(pdfPath, path.extname(pdfPath))}.txt`,
    ),
  }))

  const pathsAreSafe = plannedOutputs.every(({ input, output }) => {
    return (
      assertIgnored("input PDF", input) &&
      assertIgnored("extracted text output", output) &&
      assertPrivatePath("input PDF", input, inputDir) &&
      assertPrivatePath("extracted text output", output, outputDir)
    )
  })

  if (!pathsAreSafe) {
    process.exitCode = 1
    return
  }

  if (dryRun) {
    console.log(`Dry run: ${plannedOutputs.length} PDF(s) ready for extraction.`)
    for (const { input, output } of plannedOutputs) {
      console.log(`- ${relativeToRepo(input)} -> ${relativeToRepo(output)}`)
    }
    return
  }

  if (!hasPdftotext()) {
    console.error(
      [
        "Cannot extract PDFs because the `pdftotext` command is not available.",
        "Install Poppler locally, then rerun `npm run extract:pdf`.",
        "No extracted text was written.",
      ].join("\n"),
    )
    process.exitCode = 1
    return
  }

  await mkdir(outputDir, { recursive: true })

  for (const { input, output } of plannedOutputs) {
    const result = spawnSync("pdftotext", ["-layout", input, output], {
      cwd: repoRoot,
      encoding: "utf8",
    })

    if (result.error || result.status !== 0) {
      console.error(`Failed to extract ${relativeToRepo(input)}.`)
      if (result.error) {
        console.error(result.error.message)
      }
      if (result.stderr) {
        console.error(result.stderr.trim())
      }
      process.exitCode = 1
      return
    }

    console.log(`Extracted ${relativeToRepo(output)}`)
  }
}

async function listPdfFiles() {
  let entries

  try {
    entries = await readdir(inputDir, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return []
      }
    }

    throw error
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"))
    .map((entry) => path.join(inputDir, entry.name))
    .sort()
}

function assertIgnored(label, targetPath) {
  const relativePath = relativeToRepo(targetPath)
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", relativePath], {
    cwd: repoRoot,
  })

  if (result.status === 0) {
    return true
  }

  console.warn(
    [
      `WARNING: ${label} is not ignored by Git: ${relativePath}`,
      "Refusing to continue because private course material must stay out of Git.",
    ].join("\n"),
  )
  return false
}

function assertPrivatePath(label, targetPath, allowedRoot) {
  const relativePath = path.relative(allowedRoot, targetPath)
  const isInsideAllowedRoot =
    relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)

  if (isInsideAllowedRoot) {
    return true
  }

  console.warn(
    [
      `WARNING: ${label} is outside the allowed private path: ${relativeToRepo(
        targetPath,
      )}`,
      `Allowed path: ${relativeToRepo(allowedRoot)}`,
    ].join("\n"),
  )
  return false
}

function hasPdftotext() {
  const result = spawnSync("pdftotext", ["-v"], {
    cwd: repoRoot,
    encoding: "utf8",
  })

  return !result.error
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
