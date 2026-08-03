import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalKeywordRetrievalResult } from "@/lib/ai/retrieval";

const searchLocalRetrievalMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/retrieval", () => ({
  searchLocalRetrieval: searchLocalRetrievalMock,
}));

import { POST as postRetrievalSearch } from "@/app/api/retrieval/search/route";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_ADMIN,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

describe("retrieval search API", () => {
  beforeEach(() => {
    mockPrincipal(TEST_PROFESSOR);
  });

  afterEach(() => {
    searchLocalRetrievalMock.mockReset();
    vi.unstubAllEnvs();
    resetAuthMocks();
  });

  it("requires the professor role", async () => {
    mockPrincipal(undefined);

    const response = await postRetrievalSearch(
      jsonRequest({ query: "binomial exact count" }),
    );

    expect(response.status).toBe(401);
    expect(searchLocalRetrievalMock).not.toHaveBeenCalled();
  });

  it("validates the search body before retrieving chunks", async () => {
    const response = await postRetrievalSearch(
      jsonRequest({ limit: 99, query: "binomial" }, "review-secret"),
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("limit must be between 1 and 10.");
    expect(searchLocalRetrievalMock).not.toHaveBeenCalled();
  });

  it("returns ranked chunks, scores, source metadata, and retrieval mode", async () => {
    searchLocalRetrievalMock.mockResolvedValue([
      retrievalResult({
        score: 91,
        text: "A binomial exact count question asks for exactly k successes.",
      }),
    ]);

    const response = await postRetrievalSearch(
      jsonRequest(
        {
          limit: 2,
          mode: "student",
          query: " binomial exact count ",
          questionId: "demo-binomial",
          topic: "Binomial models",
        },
        "review-secret",
      ),
    );
    const payload = (await response.json()) as {
      chunks: Array<Record<string, unknown>>;
      count: number;
      mode: string;
      retrievalMode: string;
    };

    expect(response.status).toBe(200);
    expect(searchLocalRetrievalMock).toHaveBeenCalledWith(
      "binomial exact count",
      expect.objectContaining({
        audience: "student",
        filters: {
          questionId: "demo-binomial",
        },
        maxChunkCharacters: 520,
        maxContextCharacters: 1040,
        maxResults: 2,
        topic: "Binomial models",
      }),
    );
    expect(payload).toMatchObject({
      count: 1,
      mode: "student",
      retrievalMode: "keyword",
      chunks: [
        {
          id: "public-binomial",
          retrievalMode: "keyword",
          score: 91,
          serverOnly: false,
          sourceLabel: "demo_question_chunks",
        },
      ],
    });
    expect(payload.chunks[0].metadata).toMatchObject({
      chunkId: "public-binomial",
      questionId: "demo-binomial",
      sourceType: "original_demo",
      trustLevel: "public_original",
      visibility: "public",
    });
  });

  it("redacts private reference text from API responses", async () => {
    mockPrincipal(TEST_ADMIN);
    searchLocalRetrievalMock.mockResolvedValue([
      retrievalResult({
        metadata: {
          chunkId: "private-reference-bayes",
          chunkType: "concept",
          reviewStatus: "approved",
          sourceType: "private_reference_pattern",
          topic: "conditional probability",
          topicId: "conditional-probability",
          trustLevel: "private_reference",
          visibility: "private",
        },
        retrievalMode: "keyword",
        score: 41,
        serverOnly: true,
        sourceLabel: "private_reference_chunks",
        text: "Raw private textbook page text that should never leave.",
      }),
    ]);

    const response = await postRetrievalSearch(
      jsonRequest(
        {
          mode: "admin",
          query: "bayes flagged cases",
        },
        "review-secret",
      ),
    );
    const payload = (await response.json()) as {
      chunks: Array<{ metadata: Record<string, unknown>; text: string }>;
      mode: string;
      retrievalMode: string;
    };

    expect(response.status).toBe(200);
    expect(searchLocalRetrievalMock).toHaveBeenCalledWith(
      "bayes flagged cases",
      expect.objectContaining({
        audience: "admin_dev",
      }),
    );
    expect(payload.mode).toBe("admin_dev");
    expect(payload.retrievalMode).toBe("keyword");
    expect(payload.chunks[0].metadata).toMatchObject({
      sourceType: "private_reference_pattern",
      trustLevel: "private_reference",
      visibility: "private",
    });
    expect(payload.chunks[0].text).not.toContain("textbook page");
    expect(payload.chunks[0].text).toContain("Private reference match");
  });

  it("reports malformed JSON without searching", async () => {
    const response = await postRetrievalSearch(
      new Request("http://localhost/api/retrieval/search", {
        body: "{not-json",
        headers: {
          "Content-Type": "application/json",
          "x-professor-token": "review-secret",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    expect(searchLocalRetrievalMock).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown, token?: string) {
  return new Request("http://localhost/api/retrieval/search", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "x-professor-token": token } : {}),
    },
    method: "POST",
  });
}

function retrievalResult(
  overrides: Partial<LocalKeywordRetrievalResult> = {},
): LocalKeywordRetrievalResult {
  return {
    metadata: {
      chunkId: "public-binomial",
      chunkType: "question",
      difficulty: "foundational",
      questionId: "demo-binomial",
      reviewStatus: "approved",
      sourceType: "original_demo",
      topic: "binomial models",
      topicId: "binomial-models",
      trustLevel: "public_original",
      visibility: "public",
      ...overrides.metadata,
    },
    retrievalMode: "keyword",
    score: 25,
    serverOnly: false,
    sourceLabel: "demo_question_chunks",
    text: "A public demo retrieval chunk.",
    ...overrides,
  };
}
