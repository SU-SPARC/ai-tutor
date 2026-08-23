import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import { getProfessorQuestionFeedbackDashboard } from "@/lib/data/question-feedback-repository";

export async function GET() {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;

  try {
    const dashboard = await getProfessorQuestionFeedbackDashboard(
      access.authorization,
    );
    return NextResponse.json(
      { dashboard },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return dataServiceUnavailableResponse();
  }
}
