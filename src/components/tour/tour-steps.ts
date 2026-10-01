/**
 * The onboarding guide's content and rules, as plain data so node tests can
 * check the words and the auto-start decision without a browser.
 *
 * Two tours, one per signed-in role. Each has a welcome card (no anchor) and
 * six steps anchored to `data-tour="…"` attributes on real elements. The
 * binding copy lives in the UX contract; see docs/professor-vocabulary.md and
 * docs/student-vocabulary.md for the words.
 */

export type TourRole = "professor" | "student";

/**
 * Where a step lives. `home` is the role's home page, `practice` is any
 * practice page, `any` is whatever page the tour is on (the account menu is
 * in the header everywhere).
 */
export type TourPage = "home" | "practice" | "any";

export type TourStep = {
  /** The `data-tour` value of the element the card points at. */
  anchor: string;
  /** Used when the anchor is missing or hidden at this width. */
  fallback?: string;
  page: TourPage;
  /** At most five words. */
  headline: string;
  /** One sentence, at most twenty words. */
  sentence: string;
};

export type TourWelcome = {
  headline: string;
  sentence: string;
  /** In DOM order: the safe option first. */
  buttons: readonly [string, string];
};

export const TOUR_EVENT = "probstat:start-guide";
export const TOUR_QUERY_PARAM = "guide";
export const TOUR_SESSION_KEY = "ai-tutor:guide:active";

export const TOUR_MENU_LABEL = "Onboarding guide";
export const TOUR_MENU_HELPER = "Tooltips that show you around";

export const TOUR_BUTTONS = {
  skip: "Skip tour",
  back: "Back",
  next: "Next",
  done: "Done",
} as const;

export const TOUR_WELCOME: TourWelcome = {
  headline: "Welcome to AI Tutor",
  sentence:
    "Six quick tips, about a minute. You can reopen this any time from the Account menu.",
  buttons: ["Not now", "Take the tour"],
};

const COME_BACK: TourStep = {
  anchor: "account-menu",
  page: "any",
  headline: "Come back any time",
  sentence: "Open Account, then Onboarding guide, to see these tips again.",
};

export const PROFESSOR_TOUR: readonly TourStep[] = [
  {
    anchor: "professor-next-step",
    fallback: "professor-home-title",
    page: "home",
    headline: "Start here",
    sentence: "This card always shows the one thing that needs you now.",
  },
  {
    anchor: "rail-review",
    fallback: "professor-menu",
    page: "home",
    headline: "Approve or send back",
    sentence:
      "Read each drafted question, then approve it or send it back with a reason.",
  },
  {
    anchor: "rail-question-bank",
    fallback: "professor-menu",
    page: "home",
    headline: "Show to students",
    sentence:
      "Every question lives here. Show it to students or hide it from any row.",
  },
  {
    anchor: "rail-courses",
    fallback: "professor-menu",
    page: "home",
    headline: "Sections and join codes",
    sentence:
      "Each section has a join code; read it to your class so students can join.",
  },
  {
    anchor: "rail-students-group",
    fallback: "professor-menu",
    page: "home",
    headline: "How your class is doing",
    sentence: "Students, Class progress and Reports from students live here.",
  },
  COME_BACK,
];

export const STUDENT_TOUR: readonly TourStep[] = [
  {
    anchor: "learn-continue",
    fallback: "learn-syllabus",
    page: "home",
    headline: "Pick up here",
    sentence: "This card always points to your next question.",
  },
  {
    anchor: "learn-syllabus",
    page: "home",
    headline: "Your course, week by week",
    sentence:
      "Each week shows how many you've solved; “Up next” marks where to go.",
  },
  {
    anchor: "practice-answer",
    page: "practice",
    headline: "Type your answer",
    sentence:
      "Type it, or open the keypad for fractions, powers and roots, then press Enter.",
  },
  {
    anchor: "practice-hints",
    page: "practice",
    headline: "Hints before answers",
    sentence:
      "Open hints one at a time; the worked steps unlock after the last hint.",
  },
  {
    anchor: "practice-tutor",
    fallback: "practice-nav",
    page: "practice",
    headline: "Ask the tutor",
    sentence:
      "After you check an answer, the tutor can nudge you. It never sees your name.",
  },
  COME_BACK,
];

export const TOUR_HOME: Record<TourRole, string> = {
  professor: "/professor",
  student: "/learn",
};

export function stepsForRole(role: TourRole): readonly TourStep[] {
  return role === "professor" ? PROFESSOR_TOUR : STUDENT_TOUR;
}

/** "Step 2 of 6": the number never changes when a step is skipped. */
export function stepLabel(index: number, total: number) {
  return `Step ${index + 1} of ${total}`;
}

export function tourStorageKey(role: TourRole) {
  return `ai-tutor:guide:${role}`;
}

export function anchorSelector(id: string) {
  return `[data-tour="${id}"]`;
}

/** Does this step belong on the page at `pathname`? */
export function stepMatchesPath(
  step: TourStep,
  role: TourRole,
  pathname: string,
) {
  if (step.page === "any") {
    return true;
  }
  if (step.page === "home") {
    return pathname === TOUR_HOME[role];
  }
  return pathname === "/practice" || pathname.startsWith("/practice/");
}

/**
 * Auto-start: once per role, only on the role's home page (/professor or
 * /learn), never for signed-out visitors, never on the landing page or on
 * /onboarding, and never once the tour has been seen.
 */
export function shouldAutoStart({
  role,
  pathname,
  seen,
  signedIn,
}: {
  role: TourRole | null | undefined;
  pathname: string | null | undefined;
  seen: boolean;
  signedIn: boolean;
}) {
  if (!signedIn || !role || seen || !pathname) {
    return false;
  }
  return pathname === TOUR_HOME[role];
}

export type TourRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Where the card must sit so it stays on screen: `margin` px from every edge
 * of a `viewport`-sized window. A card larger than the room left pins to the
 * top-left margin.
 */
export function clampPopover(
  rect: TourRect,
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  const clamp = (start: number, size: number, room: number) =>
    Math.max(margin, Math.min(start, room - margin - size));
  return {
    left: clamp(rect.left, rect.width, viewport.width),
    top: clamp(rect.top, rect.height, viewport.height),
  };
}
