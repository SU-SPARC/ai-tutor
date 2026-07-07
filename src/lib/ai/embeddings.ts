import { createHash } from "node:crypto"

type FetchLike = typeof fetch

export type EmbeddingProviderOptions = {
  apiKey?: string
  baseDelayMs?: number
  fetchImpl?: FetchLike
  maxRetries?: number
  model?: string
  sleep?: (ms: number) => Promise<void>
}

export type EmbeddingResult =
  | {
      embedding: number[]
      model: string
      ok: true
    }
  | {
      ok: false
      reason: string
      retriable?: boolean
      skipped: boolean
    }

export type EmbeddingProvider = {
  embed(input: string): Promise<EmbeddingResult>
  isConfigured(): boolean
  model: string
}

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small"
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BASE_DELAY_MS = 400

assertServerSide()

export function createOpenAIEmbeddingProvider(
  options: EmbeddingProviderOptions = {},
): EmbeddingProvider {
  const apiKey = options.apiKey ?? optionalString(process.env.OPENAI_API_KEY)
  const model =
    options.model ??
    optionalString(process.env.OPENAI_EMBEDDING_MODEL) ??
    DEFAULT_EMBEDDING_MODEL
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? delay
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS

  return {
    model,

    isConfigured() {
      return Boolean(apiKey)
    },

    async embed(input: string) {
      const text = input.trim()

      if (!apiKey) {
        return {
          ok: false,
          skipped: true,
          reason:
            "Embedding generation skipped because OPENAI_API_KEY is not configured.",
        }
      }

      if (!text) {
        return {
          ok: false,
          skipped: true,
          reason: "Embedding input must not be empty.",
        }
      }

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const result = await tryCreateEmbedding({
          apiKey,
          fetchImpl,
          input: text,
          model,
        })

        if (result.ok || !result.retriable || attempt === maxRetries) {
          return result
        }

        await sleep(backoffDelay(baseDelayMs, attempt))
      }

      return {
        ok: false,
        skipped: false,
        retriable: true,
        reason: "Embedding generation failed after retries.",
      }
    },
  }
}

export function retrievalContentHash(input: string) {
  return createHash("sha256").update(input.trim()).digest("hex")
}

async function tryCreateEmbedding(input: {
  apiKey: string
  fetchImpl: FetchLike
  input: string
  model: string
}): Promise<EmbeddingResult> {
  try {
    const result = await input.fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: input.input,
        model: input.model,
        encoding_format: "float",
      }),
    })

    if (!result.ok) {
      return {
        ok: false,
        skipped: false,
        retriable: isRetriableStatus(result.status),
        reason: `The configured embedding provider rejected the request with status ${result.status}.`,
      }
    }

    const payload = (await result.json()) as {
      data?: Array<{ embedding?: unknown; index?: number }>
      model?: string
    }
    const embedding = payload.data?.find((item) => item.index === 0)
      ?.embedding

    if (!isNumberArray(embedding)) {
      return {
        ok: false,
        skipped: false,
        retriable: false,
        reason: "The configured embedding provider returned no vector.",
      }
    }

    return {
      ok: true,
      embedding,
      model: payload.model ?? input.model,
    }
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      retriable: true,
      reason: error instanceof Error ? error.message : "Embedding request failed.",
    }
  }
}

function isRetriableStatus(status: number) {
  return status === 429 || status >= 500
}

function backoffDelay(baseDelayMs: number, attempt: number) {
  return baseDelayMs * 2 ** attempt
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function optionalString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
}

function assertServerSide() {
  if (typeof window !== "undefined") {
    throw new Error("Embedding generation must run server-side only.")
  }
}
