import "server-only"

import { getRetrievalChunks } from "@/lib/data/data-store"

export function retrieveCourseContext(query: string, topicId?: string) {
  const normalizedQuery = query.toLowerCase()
  const queryTerms = new Set(
    normalizedQuery
      .split(/[^a-z0-9.%-]+/)
      .map((term) => term.trim())
      .filter(Boolean),
  )

  return getRetrievalChunks()
    .map((chunk) => {
      const topicBoost = topicId && chunk.topicId === topicId ? 2 : 0
      const keywordScore = chunk.keywords.reduce(
        (score, keyword) =>
          queryTerms.has(keyword.toLowerCase()) ||
          normalizedQuery.includes(keyword.toLowerCase())
            ? score + 1
            : score,
        0,
      )

      return {
        chunk,
        score: topicBoost + keywordScore,
      }
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((result) => result.chunk)
}
