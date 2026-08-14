import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import {
  authorizeApi,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import {
  ContentAvailabilityNotFoundError,
  ContentAvailabilityValidationError,
} from "@/lib/data/content-availability-repository";
import {
  getContentAvailabilityDashboard,
  updateContentAvailability,
} from "@/lib/data/data-store";
import type { StudentContentReleaseState } from "@/lib/types";

type AvailabilityBody = {
  availableFrom?: unknown;
  availableUntil?: unknown;
  reason?: unknown;
  releaseState?: unknown;
  targetId?: unknown;
  targetType?: unknown;
};

export async function GET() {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;

  try {
    const dashboard = await getContentAvailabilityDashboard(
      access.authorization,
    );
    return privateJson({ dashboard });
  } catch {
    return dataServiceUnavailableResponse();
  }
}

export async function PATCH(request: Request) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;

  let body: AvailabilityBody;
  try {
    body = (await request.json()) as AvailabilityBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const targetType =
    body.targetType === "topic" || body.targetType === "question"
      ? body.targetType
      : undefined;
  const releaseState = releaseStateValue(body.releaseState);
  const targetId = optionalString(body.targetId);
  if (!targetType || !releaseState || !targetId) {
    return NextResponse.json(
      {
        error:
          "targetType, targetId, and releaseState are required availability fields.",
      },
      { status: 400 },
    );
  }

  try {
    const dashboard = await updateContentAvailability(access.authorization, {
      availableFrom: optionalString(body.availableFrom),
      availableUntil: optionalString(body.availableUntil),
      reason: optionalString(body.reason),
      releaseState,
      requestId:
        optionalString(request.headers.get("Idempotency-Key")) ??
        optionalString(request.headers.get("X-Request-Id")),
      targetId,
      targetType,
    });
    return privateJson({ dashboard });
  } catch (cause) {
    if (cause instanceof ContentAvailabilityValidationError) {
      return NextResponse.json({ error: cause.message }, { status: 400 });
    }
    if (cause instanceof ContentAvailabilityNotFoundError) {
      return NextResponse.json({ error: cause.message }, { status: 404 });
    }
    return dataServiceUnavailableResponse();
  }
}

function privateJson(value: unknown) {
  return NextResponse.json(value, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function releaseStateValue(
  value: unknown,
): StudentContentReleaseState | undefined {
  return value === "published" ||
    value === "unpublished" ||
    value === "archived"
    ? value
    : undefined;
}
