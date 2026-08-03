import { NextResponse } from "next/server";

import { dataServiceUnavailableResponse } from "@/lib/api/service-unavailable";
import {
  getProfessorTopicReviewProgress,
  getReviewQueue,
  listTopics,
  updateReviewCandidates,
} from "@/lib/data/data-store";
import type {
  ReviewAction,
  ReviewCandidateUpdate,
  ReviewQueueFilters,
} from "@/lib/data/repository";
import { authorizeApiRole } from "@/lib/auth/principal";
import {
  isValidReviewDifficulty,
  isValidReviewPriority,
  isValidReviewStatus,
  safeTopics,
} from "@/lib/tutor/professor-admin";
import type { Difficulty, ReviewPriority } from "@/lib/types";

const REVIEW_ACTIONS = [
  "approve",
  "needs_edit",
  "reject",
  "request_regeneration",
] satisfies ReviewAction[];

export async function GET(request: Request) {
  const authorization = await authorizeApiRole("professor");

  if (!authorization.ok) {
    return authorization.response;
  }

  const parsed = parseReviewFilters(new URL(request.url).searchParams);

  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const [candidates, topics, topicProgress] = await Promise.all([
      getReviewQueue(parsed.filters),
      listTopics(),
      parsed.filters.topicId
        ? getProfessorTopicReviewProgress(parsed.filters.topicId)
        : Promise.resolve(undefined),
    ]);

    return NextResponse.json({
      candidates,
      count: candidates.length,
      filters: parsed.filters,
      topicProgress,
      topics: safeTopics(topics),
    });
  } catch {
    return dataServiceUnavailableResponse();
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeApiRole("professor");

  if (!authorization.ok) {
    return authorization.response;
  }

  const parsed = await parseReviewUpdate(request);

  if ("error" in parsed) {
    return NextResponse.json(
      { error: parsed.error },
      { status: parsed.status },
    );
  }

  try {
    if (parsed.update.action === "approve") {
      const queue = await getReviewQueue();
      const queuedById = new Map(
        queue.map((candidate) => [candidate.id, candidate]),
      );
      const nonPriority = parsed.update.candidateIds.filter((candidateId) => {
        const candidate = queuedById.get(candidateId);
        return (
          !candidate ||
          (parsed.update.reviewPriority ??
            candidate.review.reviewPriority ??
            "normal") !== "priority"
        );
      });

      if (nonPriority.length > 0) {
        return NextResponse.json(
          {
            error:
              "Only priority review candidates can be approved. Mark selected items as priority first.",
          },
          { status: 400 },
        );
      }
    }

    const candidates = await updateReviewCandidates({
      ...parsed.update,
      reviewedBy: authorization.principal.displayName,
      reviewedByUserId: authorization.principal.userId,
    });

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "Review candidate was not found or is no longer editable." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      candidates,
      candidate: candidates[0],
    });
  } catch {
    return dataServiceUnavailableResponse();
  }
}

export async function POST(request: Request) {
  return PATCH(request);
}

function parseReviewFilters(
  searchParams: URLSearchParams,
): { filters: ReviewQueueFilters } | { error: string } {
  const status = searchParams.get("status")?.trim() || undefined;
  const difficulty = searchParams.get("difficulty")?.trim() || undefined;
  const reviewPriority =
    searchParams.get("reviewPriority")?.trim() ||
    searchParams.get("priority")?.trim() ||
    undefined;
  const topicId =
    searchParams.get("topicId")?.trim() ||
    searchParams.get("topic")?.trim() ||
    undefined;

  if (status && !isValidReviewStatus(status)) {
    return { error: `Invalid review status: ${status}` };
  }

  if (difficulty && !isValidReviewDifficulty(difficulty)) {
    return { error: `Invalid difficulty: ${difficulty}` };
  }

  if (reviewPriority && !isValidReviewPriority(reviewPriority)) {
    return { error: `Invalid review priority: ${reviewPriority}` };
  }

  return {
    filters: {
      difficulty: difficulty as Difficulty | undefined,
      reviewPriority: reviewPriority as ReviewPriority | undefined,
      status: status as ReviewQueueFilters["status"],
      topicId,
    },
  };
}

async function parseReviewUpdate(
  request: Request,
): Promise<
  { update: ReviewCandidateUpdate } | { error: string; status: 400 | 413 }
> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 16_384) {
    return {
      error: "Review update requests must be smaller than 16KB.",
      status: 413,
    };
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return { error: "Request body must be valid JSON.", status: 400 };
  }

  const candidateIds = parseCandidateIds(body);

  if (candidateIds.length === 0) {
    return { error: "candidateIds or candidateId is required.", status: 400 };
  }

  const action =
    typeof body.action === "string" &&
    (REVIEW_ACTIONS as readonly string[]).includes(body.action)
      ? (body.action as ReviewAction)
      : undefined;

  if (body.action && !action) {
    return { error: "Unsupported review action.", status: 400 };
  }

  const difficulty =
    typeof body.difficulty === "string" &&
    isValidReviewDifficulty(body.difficulty)
      ? body.difficulty
      : undefined;

  if (body.difficulty && !difficulty) {
    return { error: "Invalid difficulty.", status: 400 };
  }

  const reviewPriority =
    typeof body.reviewPriority === "string" &&
    isValidReviewPriority(body.reviewPriority)
      ? body.reviewPriority
      : undefined;

  if (body.reviewPriority && !reviewPriority) {
    return { error: "Invalid review priority.", status: 400 };
  }

  const topicId =
    typeof body.topicId === "string" && body.topicId.trim()
      ? body.topicId.trim()
      : undefined;
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim().slice(0, 500)
      : undefined;

  if (
    !action &&
    !difficulty &&
    !reviewPriority &&
    !topicId &&
    notes === undefined
  ) {
    return { error: "No review update was provided.", status: 400 };
  }

  return {
    update: {
      action,
      candidateIds,
      difficulty,
      notes,
      reviewPriority,
      topicId,
    },
  };
}

function parseCandidateIds(body: Record<string, unknown>) {
  if (Array.isArray(body.candidateIds)) {
    return body.candidateIds.filter(
      (candidateId): candidateId is string =>
        typeof candidateId === "string" && candidateId.trim().length > 0,
    );
  }

  return typeof body.candidateId === "string" && body.candidateId.trim()
    ? [body.candidateId.trim()]
    : [];
}
