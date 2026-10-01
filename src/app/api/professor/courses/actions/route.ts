import { NextResponse } from "next/server";

import { parseCoursesAction } from "@/app/api/professor/courses/actions/parse-action";
import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import { authorizeApi, requireProfessor } from "@/lib/auth/authorization";
import {
  CoursesConflictError,
  CoursesNotFoundError,
  CoursesValidationError,
} from "@/lib/data/courses-repository";
import { applyProfessorCoursesAction } from "@/lib/data/data-store";

/**
 * Applies one course action for the signed-in professor and returns the fresh
 * state. The body is `{ action }`; the action is rebuilt field by field from a
 * per-type whitelist before it reaches the repository, which runs the same
 * pure reducer the client ran optimistically.
 */
export async function POST(request: Request) {
  const access = await authorizeApi(requireProfessor);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = parseCoursesAction(body, new Date().toISOString());
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const state = await applyProfessorCoursesAction(
      access.authorization,
      parsed.action,
      optionalString(request.headers.get("Idempotency-Key")) ??
        optionalString(request.headers.get("X-Request-Id")),
    );
    return privateJson({ state });
  } catch (cause) {
    if (cause instanceof CoursesValidationError) {
      return NextResponse.json({ error: cause.message }, { status: 400 });
    }
    if (cause instanceof CoursesNotFoundError) {
      return NextResponse.json({ error: cause.message }, { status: 404 });
    }
    if (cause instanceof CoursesConflictError) {
      return NextResponse.json({ error: cause.message }, { status: 409 });
    }
    return dataServiceUnavailableResponse({
      cause,
      request,
      route: "/api/professor/courses/actions",
    });
  }
}

function privateJson(value: unknown) {
  return NextResponse.json(value, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 200)
    : undefined;
}
