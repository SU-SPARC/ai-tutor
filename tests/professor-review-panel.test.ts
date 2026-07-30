import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import topicData from "../data/demo/topics.json"
import { ProfessorFriendlyReviewPanel } from "@/components/admin/professor-friendly-review-panel"

describe("professor-friendly review panel", () => {
  it("renders syllabus topic choices in fixture order before enabling queue load", () => {
    const topics = topicData.map(({ id, title }) => ({ id, title }))
    const markup = renderToStaticMarkup(
      createElement(ProfessorFriendlyReviewPanel, { topics }),
    )

    let previousIndex = -1
    for (const topic of topics) {
      const topicIndex = markup.indexOf(`value="${topic.id}"`)
      expect(topicIndex).toBeGreaterThan(previousIndex)
      previousIndex = topicIndex
    }

    expect(markup).toContain("Choose a topic")
    expect(markup).toMatch(
      /<button[^>]*disabled=""[^>]*>.*Load review queue<\/button>/,
    )
    expect(markup).toContain(
      "Select one syllabus topic, then load its review queue.",
    )
  })
})
