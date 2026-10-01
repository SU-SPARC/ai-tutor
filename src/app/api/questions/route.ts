import { NextResponse } from "next/server";

import {
  isValidDifficulty,
  isValidSourceType,
  matchesSearch,
  normalizeSummary,
} from "@/lib/api/question-serialization";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { isPublishedContent } from "@/lib/auth/authorization";
import {
  getApprovedQuestions,
  listQuestionsByTopic,
} from "@/lib/data/data-store";
import { pilotRequestId } from "@/lib/observability/pilot-operations";
import { readStudentSectionContent } from "@/lib/tutor/section-access";
import {
  selectSectionQuestions,
  withPinnedQuestions,
} from "@/lib/tutor/section-content";

const QUESTIONS_ROUTE = "/api/questions";

export async function GET(request: Request) {
  const requestId = pilotRequestId(request);
  const { searchParams } = new URL(request.url);

  const topic = searchParams.get("topic")?.trim() || undefined;
  const difficulty = searchParams.get("difficulty")?.trim() || undefined;
  const sourceType = searchParams.get("sourceType")?.trim() || undefined;
  const query = searchParams.get("q")?.trim() || undefined;

  if (difficulty && !isValidDifficulty(difficulty)) {
    return NextResponse.json(
      { error: `Invalid difficulty: ${difficulty}` },
      { status: 400 },
    );
  }

  if (sourceType && !isValidSourceType(sourceType)) {
    return NextResponse.json(
      { error: `Invalid sourceType: ${sourceType}` },
      { status: 400 },
    );
  }

  try {
    // Both reads return only approved, public, student-facing questions. A
    // student in a course section is narrowed further to the section's
    // visible released questions, in the section's order, each at the
    // version the section pinned.
    const [base, section] = await Promise.all([
      topic ? listQuestionsByTopic(topic) : getApprovedQuestions(),
      readStudentSectionContent(undefined, { pinnedContent: true }),
    ]);
    const published = base.filter(isPublishedContent);
    const scoped = section
      ? selectSectionQuestions(
          withPinnedQuestions(published, section.pinnedQuestions),
          section.releases,
        )
      : published;

    const questions = scoped
      .filter((question) =>
        difficulty ? question.difficulty === difficulty : true,
      )
      .filter((question) =>
        sourceType ? question.source.sourceType === sourceType : true,
      )
      .filter((question) => (query ? matchesSearch(question, query) : true))
      .map(normalizeSummary);

    return NextResponse.json(
      {
        count: questions.length,
        filters: { topic, difficulty, sourceType, q: query },
        questions,
      },
      // A section student's list is their own; never share it from a cache.
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      requestId,
      route: QUESTIONS_ROUTE,
      subsystem: "content",
    });
  }
}
