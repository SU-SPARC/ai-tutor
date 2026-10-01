/**
 * What a student in a course section may see and do, decided from the
 * section's releases alone. Pure and data-store free: the server pages, the
 * question API, session creation, the tutor route and the practice UI all
 * read the same rules, so a question the page lists is the question the
 * tutor serves, and a control the UI hides is one the server refuses.
 *
 * A student without a section never reaches these helpers; they see the
 * global published list exactly as before.
 */

import { formatJoinCode } from "@/lib/courses/format";
import type {
  DeliverySettings,
  SolutionRevealPolicy,
} from "@/lib/courses/types";
import type { SectionReleaseDto } from "@/lib/data/courses-repository";
import type { TutorMode } from "@/lib/types";

export type { DeliverySettings, SectionReleaseDto, SolutionRevealPolicy };

/* ------------------------------------------------------------------ */
/* Join codes                                                          */
/* ------------------------------------------------------------------ */

/** Generous bound on a pasted code before it is even read. */
const MAX_RAW_JOIN_CODE_LENGTH = 32;
const JOIN_CODE_SHAPE = /^[A-Z0-9]{3}-[A-Z0-9]{2}$/;

export const SECTION_CODE_MALFORMED_MESSAGE =
  "Enter the code from your professor, like K7Q-2M.";
export const SECTION_CODE_UNKNOWN_MESSAGE =
  "We don't recognise that code. Check it with your professor.";

/**
 * Anything typed or pasted → the printed `XXX-XX` shape, or `undefined`
 * when it is not exactly five letters or digits (any case, any hyphens or
 * spaces). The browser and the server use this same rule.
 */
export function parseJoinCode(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > MAX_RAW_JOIN_CODE_LENGTH) {
    return undefined;
  }
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 5) {
    return undefined;
  }
  const code = formatJoinCode(cleaned);
  return JOIN_CODE_SHAPE.test(code) ? code : undefined;
}

/* ------------------------------------------------------------------ */
/* Released content                                                    */
/* ------------------------------------------------------------------ */

type ReleaseVisibility = Pick<SectionReleaseDto, "opensAt" | "topicState">;

/**
 * A released question is visible while its topic is open, or scheduled with
 * an opening time already past. A closed topic hides everything in it.
 */
export function isSectionReleaseVisible(
  release: ReleaseVisibility,
  now: Date = new Date(),
) {
  if (release.topicState === "open") {
    return true;
  }
  if (release.topicState === "scheduled" && release.opensAt) {
    const opensAt = Date.parse(release.opensAt);
    return Number.isFinite(opensAt) && opensAt <= now.getTime();
  }
  return false;
}

/** Visible releases in course order: topic position, then question position. */
export function visibleSectionReleases<T extends SectionReleaseDto>(
  releases: readonly T[],
  now: Date = new Date(),
): T[] {
  return releases
    .filter((release) => isSectionReleaseVisible(release, now))
    .sort(
      (left, right) =>
        left.topicPosition - right.topicPosition ||
        left.position - right.position ||
        left.questionId.localeCompare(right.questionId),
    );
}

/**
 * The section's questions, in the section's order, drawn from the published
 * list the caller already read. A release whose question is not in that list
 * (unpublished since) is skipped rather than invented.
 */
export function selectSectionQuestions<Q extends { id: string }>(
  questions: readonly Q[],
  releases: readonly SectionReleaseDto[],
  now: Date = new Date(),
): Q[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const selected: Q[] = [];
  const seen = new Set<string>();
  for (const release of visibleSectionReleases(releases, now)) {
    const question = byId.get(release.questionId);
    if (question && !seen.has(question.id)) {
      seen.add(question.id);
      selected.push(question);
    }
  }
  return selected;
}

/**
 * The question list with each question replaced by the content of the
 * version the section pinned (`pinned`, keyed by question id: the visible
 * releases read by `readStudentSectionContent(owner, { pinnedContent: true })`).
 * Use it on the list handed to `selectSectionQuestions`. A question without
 * pinned content is dropped: either the section does not offer it now, or its
 * pinned content could not be read, and it is never shown at a version the
 * tutor would not grade. Without `pinned` the list is returned as is. Ids
 * stay the question ids.
 */
export function withPinnedQuestions<Q extends { id: string }>(
  questions: readonly Q[],
  pinned: Readonly<Record<string, Q>> | undefined,
): Q[] {
  if (!pinned) {
    return [...questions];
  }
  return questions.flatMap((question) =>
    Object.hasOwn(pinned, question.id) ? [pinned[question.id]] : [],
  );
}

/**
 * The section's topics in course order (the first release's topic position),
 * limited to topics that have something visible right now.
 */
export function selectSectionTopics<T extends { id: string }>(
  topics: readonly T[],
  releases: readonly SectionReleaseDto[],
  now: Date = new Date(),
): T[] {
  const positions = new Map<string, number>();
  for (const release of visibleSectionReleases(releases, now)) {
    if (!positions.has(release.topicId)) {
      positions.set(release.topicId, release.topicPosition);
    }
  }
  return topics
    .filter((topic) => positions.has(topic.id))
    .sort(
      (left, right) =>
        (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0),
    );
}

/** The visible release for one question, if the section offers it now. */
export function findVisibleSectionRelease<T extends SectionReleaseDto>(
  releases: readonly T[],
  questionId: string,
  now: Date = new Date(),
): T | undefined {
  return releases.find(
    (release) =>
      release.questionId === questionId &&
      isSectionReleaseVisible(release, now),
  );
}

/** Delivery settings per visible question id, for the practice UI. */
export function sectionDeliveryByQuestionId(
  releases: readonly SectionReleaseDto[],
  now: Date = new Date(),
): Record<string, DeliverySettings> {
  const delivery: Record<string, DeliverySettings> = {};
  for (const release of visibleSectionReleases(releases, now)) {
    delivery[release.questionId] = {
      attemptsAllowed: release.delivery.attemptsAllowed,
      hintsEnabled: release.delivery.hintsEnabled,
      solutionReveal: release.delivery.solutionReveal,
    };
  }
  return delivery;
}

/* ------------------------------------------------------------------ */
/* Delivery                                                            */
/* ------------------------------------------------------------------ */

export type DeliveryProgress = {
  solved: boolean;
  /** Readable answers judged incorrect (unreadable input never counts). */
  wrongAttemptCount: number;
};

/** Wrong answers a policy waits for before the worked steps open. */
const WRONG_ANSWERS_BEFORE_STEPS: Partial<
  Record<SolutionRevealPolicy, number>
> = {
  after_2_wrong: 2,
  after_3_wrong: 3,
};

/** Whether the worked steps may be opened now under this policy. */
export function solutionRevealAllowed(
  policy: SolutionRevealPolicy,
  progress: DeliveryProgress,
) {
  switch (policy) {
    case "never":
      return false;
    case "after_correct":
      return progress.solved;
    default: {
      const needed = WRONG_ANSWERS_BEFORE_STEPS[policy];
      return (
        progress.solved ||
        (needed !== undefined && progress.wrongAttemptCount >= needed)
      );
    }
  }
}

/** Plain words for when the steps open ("Steps open after 2 wrong answers"). */
export function solutionRevealDescription(policy: SolutionRevealPolicy) {
  switch (policy) {
    case "never":
      return "Your professor has turned off worked steps for this question.";
    case "after_correct":
      return "Steps open once you solve it.";
    default: {
      const needed = WRONG_ANSWERS_BEFORE_STEPS[policy] ?? 2;
      return `Steps open after ${needed} wrong answers.`;
    }
  }
}

/** Check answers left before the section's limit; never negative. */
export function attemptsRemaining(
  delivery: Pick<DeliverySettings, "attemptsAllowed">,
  progress: DeliveryProgress,
) {
  if (progress.solved) {
    return delivery.attemptsAllowed;
  }
  return Math.max(0, delivery.attemptsAllowed - progress.wrongAttemptCount);
}

export const HINTS_DISABLED_MESSAGE =
  "Hints are turned off for this question in your section.";
export const NO_ATTEMPTS_LEFT_MESSAGE =
  "No attempts left on this question. Your professor set the limit for your section.";
export const STEPS_UNAVAILABLE_MESSAGE =
  "Worked steps are not available for this question yet.";

export type DeliveryRefusal = {
  code:
    | "SECTION_HINTS_DISABLED"
    | "SECTION_NO_ATTEMPTS_LEFT"
    | "SECTION_STEPS_UNAVAILABLE";
  error: string;
  status: 400 | 409;
};

/**
 * Why a tutor request is refused under the section's delivery settings, or
 * `undefined` when it may go ahead. Checked before the tutor engine runs, so
 * a refused request records nothing: no attempt, no hint, no reveal, and the
 * practice-credit evidence is untouched.
 *
 * - Hint with hints off → 400.
 * - Check answer (not AI help) once `attemptsAllowed` readable wrong
 *   answers are used and the question is unsolved → 409 "no attempts left".
 * - Worked steps (`solution` / `full_solution`) the policy has not opened
 *   yet → 409; `never` → 400 (it will never open).
 */
export function deliveryRefusal(input: {
  aiHelp?: boolean;
  delivery: DeliverySettings;
  mode: TutorMode | "full_solution";
  progress: DeliveryProgress;
}): DeliveryRefusal | undefined {
  const { delivery, mode, progress } = input;

  if (mode === "hint" && !delivery.hintsEnabled) {
    return {
      code: "SECTION_HINTS_DISABLED",
      error: HINTS_DISABLED_MESSAGE,
      status: 400,
    };
  }

  if (
    mode === "check" &&
    !input.aiHelp &&
    !progress.solved &&
    attemptsRemaining(delivery, progress) <= 0
  ) {
    return {
      code: "SECTION_NO_ATTEMPTS_LEFT",
      error: NO_ATTEMPTS_LEFT_MESSAGE,
      status: 409,
    };
  }

  if (
    (mode === "solution" || mode === "full_solution") &&
    !solutionRevealAllowed(delivery.solutionReveal, progress)
  ) {
    return {
      code: "SECTION_STEPS_UNAVAILABLE",
      error:
        delivery.solutionReveal === "never"
          ? solutionRevealDescription("never")
          : `${STEPS_UNAVAILABLE_MESSAGE} ${solutionRevealDescription(
              delivery.solutionReveal,
            )}`,
      status: delivery.solutionReveal === "never" ? 400 : 409,
    };
  }

  return undefined;
}
