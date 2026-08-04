import { NextResponse } from "next/server";

import { toProfessorAnalyticsDto } from "@/lib/api/professor-dtos";
import {
  getContentRepositoryMode,
  getProfessorPracticeAnalytics,
  getReviewQueue,
} from "@/lib/data/data-store";
import { authorizeApi, requireAnalyticsAccess } from "@/lib/auth/authorization";
import { buildProfessorAnalyticsDashboard } from "@/lib/tutor/professor-admin";

export async function GET() {
  const access = await authorizeApi(requireAnalyticsAccess);

  if (!access.ok) {
    return access.response;
  }

  try {
    const [reviewQueue, practice] = await Promise.all([
      getReviewQueue(access.authorization),
      getProfessorPracticeAnalytics(access.authorization),
    ]);

    return NextResponse.json({
      analytics: toProfessorAnalyticsDto(
        buildProfessorAnalyticsDashboard({
          mode: getContentRepositoryMode(),
          practice,
          reviewQueue,
        }),
      ),
    });
  } catch {
    return NextResponse.json(
      { error: "Professor analytics are unavailable right now." },
      { status: 503 },
    );
  }
}
