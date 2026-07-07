import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it, vi } from "vitest"

import {
  createOpenAIEmbeddingProvider,
  retrievalContentHash,
} from "@/lib/ai/embeddings"

describe("server-side embedding provider", () => {
  it("fails gracefully without OPENAI_API_KEY and does not call fetch", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "",
      fetchImpl,
    })

    const result = await provider.embed("binomial exact count")

    expect(provider.isConfigured()).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      skipped: true,
    })
    expect(retrievalContentHash(" binomial exact count ")).toBe(
      retrievalContentHash("binomial exact count"),
    )
  })

  it("retries retriable embedding provider failures with backoff", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("retry", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
            model: "text-embedding-3-small",
          }),
          { status: 200 },
        ),
      )
    const sleep = vi.fn(async () => undefined)
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "test-key",
      baseDelayMs: 5,
      fetchImpl,
      maxRetries: 2,
      model: "text-embedding-3-small",
      sleep,
    })

    const result = await provider.embed("conditional probability")

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(5)
    expect(result).toEqual({
      ok: true,
      embedding: [0.1, 0.2, 0.3],
      model: "text-embedding-3-small",
    })
  })

  it("does not retry non-retriable embedding provider failures", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad request", { status: 400 }))
    const sleep = vi.fn(async () => undefined)
    const provider = createOpenAIEmbeddingProvider({
      apiKey: "test-key",
      fetchImpl,
      maxRetries: 2,
      sleep,
    })

    const result = await provider.embed("bad input")

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: false,
      retriable: false,
      skipped: false,
    })
  })
})

describe("embedding chunk script", () => {
  it("writes a private skipped manifest when OPENAI_API_KEY is missing", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "embed-chunks-"))
    const demoChunksPath = path.join(tempDir, "demo-question-chunks.json")
    const privateQuestionChunksPath = path.join(tempDir, "question-chunks.json")
    const outputPath = path.join(tempDir, "chunk-embeddings.json")

    mkdirSync(tempDir, { recursive: true })
    writeFileSync(
      demoChunksPath,
      `${JSON.stringify({
        chunks: [
          {
            id: "demo-chunk",
            body: "A binomial exact-count chunk.",
            chunkType: "question",
            questionId: "demo-question",
            topic: "binomial models",
            topicId: "binomial-models",
            sourceType: "original_demo",
            trustLevel: "public_original",
            reviewStatus: "approved",
            visibility: "public",
          },
        ],
      })}\n`,
    )
    writeFileSync(
      privateQuestionChunksPath,
      `${JSON.stringify({ chunks: [] })}\n`,
    )

    const result = spawnSync(
      "node",
      [
        "scripts/embed-chunks.mjs",
        "--demo-chunks",
        demoChunksPath,
        "--private-question-chunks",
        privateQuestionChunksPath,
        "--output",
        outputPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          OPENAI_API_KEY: "",
        },
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Skipped embedding generation")

    const payload = JSON.parse(readFileSync(outputPath, "utf8"))

    expect(payload).toMatchObject({
      schemaVersion: 1,
      visibility: "private",
      status: "skipped_missing_api_key",
      safety: {
        storesChunkText: false,
        publicEndpointExposed: false,
      },
      source: {
        chunkCount: 1,
      },
      embeddings: [],
    })
    expect(JSON.stringify(payload)).not.toContain("A binomial exact-count chunk")
  })
})
