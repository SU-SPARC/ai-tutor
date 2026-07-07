#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  createOpenAIEmbeddingProvider,
  retrievalContentHash,
} from "../src/lib/ai/embeddings.ts"

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

const defaultOutputPath = path.join(
  repoRoot,
  "data/private/generated/chunk-embeddings.json",
)
const defaultSources = [
  {
    label: "demo_question_chunks",
    path: path.join(repoRoot, "data/processed/demo-question-chunks.json"),
    serverOnly: false,
  },
  {
    label: "private_question_chunks",
    path: path.join(repoRoot, "data/private/generated/question-chunks.json"),
    serverOnly: true,
  },
  {
    label: "private_reference_chunks",
    path: path.join(repoRoot, "data/private/generated/reference-chunks.json"),
    serverOnly: true,
  },
  {
    label: "private_reference_chunks",
    path: path.join(repoRoot, "data/private/generated/book-reference-chunks.json"),
    serverOnly: true,
  },
]

const args = parseArgs(process.argv.slice(2))
const outputPath = path.resolve(repoRoot, args.output ?? defaultOutputPath)
const maxChunks =
  typeof args.maxChunks === "number" && args.maxChunks >= 0
    ? args.maxChunks
    : undefined
const sources = sourceConfigsFromArgs(args)

async function main() {
  if (!assertPrivateOrTempOutput(outputPath)) {
    process.exitCode = 1
    return
  }

  const chunks = await loadEmbeddingChunks(sources)
  const selectedChunks =
    typeof maxChunks === "number" ? chunks.slice(0, maxChunks) : chunks
  const provider = createOpenAIEmbeddingProvider()

  if (!provider.isConfigured()) {
    await writeEmbeddingPayload(outputPath, {
      schemaVersion: 1,
      visibility: "private",
      status: "skipped_missing_api_key",
      generatedAt: new Date().toISOString(),
      storage: {
        type: "private_file",
        path: relativeToRepo(outputPath),
        pgvectorAvailable: false,
      },
      provider: {
        type: "openai",
        model: provider.model,
      },
      source: {
        inputs: sources.map((source) => relativeToRepo(source.path)),
        chunkCount: selectedChunks.length,
      },
      safety: {
        storesChunkText: false,
        outputIsPrivate: true,
        publicEndpointExposed: false,
      },
      embeddings: [],
      failures: [
        {
          reason:
            "OPENAI_API_KEY is not configured. No embedding requests were made.",
          skipped: true,
        },
      ],
    })
    console.log(
      `Skipped embedding generation because OPENAI_API_KEY is missing. Wrote private manifest at ${relativeToRepo(
        outputPath,
      )}.`,
    )
    return
  }

  const embeddings = []
  const failures = []

  for (const chunk of selectedChunks) {
    const result = await provider.embed(chunk.text)

    if (result.ok) {
      embeddings.push({
        chunkId: chunk.id,
        contentHash: chunk.contentHash,
        embedding: result.embedding,
        metadata: chunk.metadata,
        model: result.model,
        sourceLabel: chunk.sourceLabel,
      })
    } else {
      failures.push({
        chunkId: chunk.id,
        contentHash: chunk.contentHash,
        reason: result.reason,
        retriable: result.retriable ?? false,
        skipped: result.skipped,
        sourceLabel: chunk.sourceLabel,
      })
    }
  }

  await writeEmbeddingPayload(outputPath, {
    schemaVersion: 1,
    visibility: "private",
    status: failures.length > 0 ? "completed_with_failures" : "completed",
    generatedAt: new Date().toISOString(),
    storage: {
      type: "private_file",
      path: relativeToRepo(outputPath),
      pgvectorAvailable: false,
    },
    provider: {
      type: "openai",
      model: provider.model,
    },
    source: {
      inputs: sources.map((source) => relativeToRepo(source.path)),
      chunkCount: selectedChunks.length,
    },
    safety: {
      storesChunkText: false,
      outputIsPrivate: true,
      publicEndpointExposed: false,
    },
    embeddings,
    failures,
  })
  console.log(
    `Embedded ${embeddings.length} chunk(s) with ${failures.length} failure(s) at ${relativeToRepo(
      outputPath,
    )}.`,
  )
}

async function loadEmbeddingChunks(sources) {
  const loadedSources = await Promise.all(
    sources.map(async (source) => {
      const payload = await readJsonOptional(source.path)

      if (!payload) {
        return []
      }

      const chunks = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && Array.isArray(payload.chunks)
          ? payload.chunks
          : []

      return chunks
        .map((chunk) => embeddingChunkFromValue(chunk, source))
        .filter((chunk) => Boolean(chunk))
    }),
  )

  return loadedSources.flat()
}

function embeddingChunkFromValue(value, source) {
  if (!value || typeof value !== "object") {
    return undefined
  }

  const text =
    stringValue(value.body) ||
    stringValue(value.text) ||
    stringValue(value.content) ||
    stringValue(value.llmSafeSummary) ||
    stringValue(value.publicSafeSummary)

  if (!text) {
    return undefined
  }

  const sourceObject =
    value.source && typeof value.source === "object" ? value.source : {}
  const reviewObject =
    value.review && typeof value.review === "object" ? value.review : {}
  const id = stringValue(value.id) || retrievalContentHash(text)

  return {
    id,
    contentHash: retrievalContentHash(text),
    metadata: {
      chunkType: stringValue(value.chunkType),
      difficulty: stringValue(value.difficulty),
      questionId: stringValue(value.questionId),
      reviewStatus: stringValue(value.reviewStatus ?? reviewObject.status),
      sourceType: stringValue(value.sourceType ?? sourceObject.sourceType),
      topic: stringValue(value.topic),
      topicId: stringValue(value.topicId),
      trustLevel: stringValue(value.trustLevel ?? sourceObject.trustLevel),
      visibility: stringValue(value.visibility ?? sourceObject.visibility),
    },
    sourceLabel: source.label,
    text,
  }
}

async function readJsonOptional(inputPath) {
  try {
    return JSON.parse(await readFile(inputPath, "utf8"))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return undefined
      }
    }

    throw error
  }
}

async function writeEmbeddingPayload(targetPath, payload) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`)
}

function sourceConfigsFromArgs(parsedArgs) {
  const sources = [...defaultSources]

  if (parsedArgs.demoChunks) {
    sources[0] = {
      ...sources[0],
      path: path.resolve(repoRoot, parsedArgs.demoChunks),
    }
  }

  if (parsedArgs.privateQuestionChunks) {
    sources[1] = {
      ...sources[1],
      path: path.resolve(repoRoot, parsedArgs.privateQuestionChunks),
    }
  }

  if (parsedArgs.privateReferenceChunks.length > 0) {
    return [
      sources[0],
      sources[1],
      ...parsedArgs.privateReferenceChunks.map((inputPath) => ({
        label: "private_reference_chunks",
        path: path.resolve(repoRoot, inputPath),
        serverOnly: true,
      })),
    ]
  }

  return sources
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
      `WARNING: embedding output must stay under data/private: ${relativeToRepo(
        targetPath,
      )}`,
    )
    return false
  }

  const relativePath = relativeToRepo(targetPath)
  const result = spawnSync("git", ["check-ignore", "--quiet", "--", relativePath], {
    cwd: repoRoot,
  })

  if (result.status === 0) {
    return true
  }

  console.warn(
    [
      `WARNING: embedding output is not ignored by Git: ${relativePath}`,
      "Refusing to continue because embeddings must stay private.",
    ].join("\n"),
  )
  return false
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : ""
}

function isInside(childPath, parentPath) {
  const relativePath = path.relative(parentPath, childPath)
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  )
}

function relativeToRepo(targetPath) {
  return path.relative(repoRoot, targetPath) || "."
}

function parseArgs(rawArgs) {
  const parsed = {
    privateReferenceChunks: [],
  }

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index]
    const value = rawArgs[index + 1]

    if (arg === "--output") {
      parsed.output = value
      index += 1
    } else if (arg === "--demo-chunks") {
      parsed.demoChunks = value
      index += 1
    } else if (arg === "--private-question-chunks") {
      parsed.privateQuestionChunks = value
      index += 1
    } else if (arg === "--private-reference-chunks") {
      parsed.privateReferenceChunks.push(value)
      index += 1
    } else if (arg === "--max-chunks") {
      const parsedValue = Number(value)
      parsed.maxChunks = Number.isInteger(parsedValue) ? parsedValue : undefined
      index += 1
    }
  }

  return parsed
}

await main()
