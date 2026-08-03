import { NextResponse } from "next/server";

import {
  getContentRepositoryMode,
  getProfessorPracticeAnalytics,
  getReviewQueue,
} from "@/lib/data/data-store";
import { authorizeApiRole } from "@/lib/auth/principal";
import { buildProfessorAnalyticsDashboard } from "@/lib/tutor/professor-admin";

export async function GET() {
  const authorization = await authorizeApiRole("professor");

  if (!authorization.ok) {
    return authorization.response;
  }

  try {
    const [reviewQueue, practice] = await Promise.all([
      getReviewQueue(),
      getProfessorPracticeAnalytics(),
    ]);

    return NextResponse.json({
      analytics: buildProfessorAnalyticsDashboard({
        mode: getContentRepositoryMode(),
        practice,
        reviewQueue,
      }),
    });
  } catch {
    return NextResponse.json(
      { error: "Professor analytics are unavailable right now." },
      { status: 503 },
    );
  }
}
