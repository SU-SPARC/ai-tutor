import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireProfessor } from "@/lib/auth/authorization";
import {
  coursesDemoMode,
  getProfessorCoursesState,
} from "@/lib/data/data-store";

/**
 * Every course the signed-in professor owns, as the client store's state.
 * Students only ever appear as hashed keys. `demo` tells the screens whether
 * the in-memory demo store is behind this (it decides the Reset button).
 */
export async function GET(request: Request) {
  const access = await authorizeApi(requireProfessor);
  if (!access.ok) return access.response;

  try {
    const state = await getProfessorCoursesState(access.authorization);
    return NextResponse.json(
      { state, demo: coursesDemoMode() },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (cause) {
    return dataServiceUnavailableResponse({
      cause,
      request,
      route: "/api/professor/courses",
    });
  }
}
