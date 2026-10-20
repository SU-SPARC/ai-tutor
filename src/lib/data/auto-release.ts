import "server-only";

import { randomUUID } from "node:crypto";

import {
  autoReleaseActions,
  planAutoRelease,
  type AutoReleasePlan,
} from "@/lib/courses/auto-release";
import type { CoursesRepository } from "@/lib/data/courses-repository";

/** Prefix of the course_events request id written by an automatic release. */
export const AUTO_RELEASE_REQUEST_PREFIX = "auto-release:";

/**
 * Releases just-published questions to the professor's only active section
 * (the rules are in `planAutoRelease`). Runs after the publish has committed,
 * as the professor, through the same repository actions the section builder
 * sends, so every step is validated by the reducer and lands in course_events
 * with the request id `auto-release:<publish request id>`. Returns the plan
 * that was applied, or undefined when there was nothing to do.
 */
export async function autoReleasePublishedQuestions(
  repository: CoursesRepository,
  professorUserId: string,
  questionIds: readonly string[],
  requestId?: string,
): Promise<AutoReleasePlan | undefined> {
  if (questionIds.length === 0) {
    return undefined;
  }
  const state = await repository.loadProfessorState(professorUserId);
  const plan = planAutoRelease(state, questionIds);
  if (!plan) {
    return undefined;
  }
  const request = `${AUTO_RELEASE_REQUEST_PREFIX}${
    requestId?.trim() || randomUUID()
  }`;
  for (const action of autoReleaseActions(plan, new Date().toISOString())) {
    await repository.applyProfessorAction(professorUserId, action, request);
  }
  return plan;
}
