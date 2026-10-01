"use client";

/**
 * The practice workspace's controller: which question is shown, its tutor
 * session, the transcript, the hint and step ladders, and the layout toggles.
 *
 * Everything the student can do on `/practice` is an action here; the
 * components under `components/tutor` only render what this hook returns.
 * Every request goes through ONE helper (`runTutorRequest`) and every question
 * change through ONE reset (`clearAttempt`), so the four tutor actions (check,
 * hint, worked steps, AI help) cannot drift apart again.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AI_HELP_REQUEST_TEXT,
  aiHelpMessageFor,
  aiHelpStateKey,
  appendAiHelpReply,
  createAiHelpGate,
  withoutEntry,
  type AiHelpGate,
} from "@/components/tutor/ai-help-request";
import { practiceWeekLabel } from "@/components/tutor/practice-rail";
import {
  chatMessageForResponse,
  clearTutorSessionId,
  createClientId,
  createOrResumeTutorSession,
  createTutorSession,
  fetchTutorSession,
  nextQuestionAfter,
  recoveryMessages,
  requestTutorResponse,
  sessionErrorFor,
  sessionWithProgress,
  storeTutorSessionId,
  stripNotQuitePrefix,
  TutorClientRequestError,
  UNREADABLE_MESSAGE_PREFIX,
  type ChatMessage,
  type SessionErrorState,
} from "@/components/tutor/tutor-client";
import type { TutorSessionDto } from "@/lib/api/tutor-session-dto";
import type { DeliverySettings } from "@/lib/courses/types";
import { studentQuestionTitle } from "@/lib/labels";
import {
  attemptsRemaining,
  solutionRevealAllowed,
  solutionRevealDescription,
} from "@/lib/tutor/section-content";
import type {
  CourseTopic,
  SimilarPracticeSessionDto,
  StudentPracticeQuestion,
  TutorMode,
  TutorResponse,
} from "@/lib/types";

/**
 * The tutor drawer's open/closed choice survives the next question and the
 * next visit. Read after mount only: the server render must not depend on it.
 */
export const TUTOR_DRAWER_STORAGE_KEY = "ai-tutor-tutor-drawer";

/**
 * The half-typed answer survives a reload: kept per session in
 * `sessionStorage` (this tab only), restored while the question is unsolved,
 * cleared by a correct check.
 */
export function draftStorageKey(sessionId: string) {
  return `ai-tutor:draft:${sessionId}`;
}

function readDraft(sessionId: string) {
  try {
    return window.sessionStorage.getItem(draftStorageKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(sessionId: string, value: string) {
  try {
    if (value.length > 0) {
      window.sessionStorage.setItem(draftStorageKey(sessionId), value);
    } else {
      window.sessionStorage.removeItem(draftStorageKey(sessionId));
    }
  } catch {
    // The draft just does not survive a reload.
  }
}

export type PracticeWorkspaceProps = {
  aiHelpEnabled?: boolean;
  /**
   * A course-section student's delivery settings per question id (hints on
   * or off, Check answers allowed, when worked steps open), read on the
   * server from the section's releases. Absent outside a section: practice
   * is then unrestricted, as before. The tutor route enforces the same rules.
   */
  deliveryByQuestionId?: Readonly<Record<string, DeliverySettings>>;
  initialQuestionId?: string;
  initialSessionId?: string;
  /**
   * Questions this student has already solved, read on the server from the
   * same progress `/learn` shows (guests from their stored sessions), so the
   * rail, the pips and "Next question" agree with the syllabus on first paint.
   */
  initialSolvedQuestionIds?: readonly string[];
  initialTopicId?: string;
  questions: StudentPracticeQuestion[];
  topics: CourseTopic[];
};

export type ActiveTutorMode = TutorMode | "ai" | null;

/** Where "Next topic" goes once a topic is finished. */
export type NextTopicTarget = {
  href: string;
  label: string;
  topicId: string;
};

/**
 * The next topic in syllabus order (the order `topics` arrives in) that still
 * has an unsolved question: later topics first, then earlier ones. `undefined`
 * when every question on the syllabus is solved.
 */
export function nextTopicWithWork({
  currentTopicId,
  questions,
  solvedQuestionIds,
  topics,
}: {
  currentTopicId: string | undefined;
  questions: Pick<StudentPracticeQuestion, "id" | "topicId">[];
  solvedQuestionIds: ReadonlySet<string>;
  topics: Pick<CourseTopic, "id" | "title" | "weekNumber">[];
}): NextTopicTarget | undefined {
  const index = topics.findIndex((topic) => topic.id === currentTopicId);
  const ordered =
    index >= 0
      ? [...topics.slice(index + 1), ...topics.slice(0, index)]
      : topics;
  const topic = ordered.find((candidate) =>
    questions.some(
      (question) =>
        question.topicId === candidate.id &&
        !solvedQuestionIds.has(question.id),
    ),
  );
  if (!topic) {
    return undefined;
  }
  return {
    href: `/practice?topicId=${encodeURIComponent(topic.id)}`,
    label: `Next topic: ${weekTopicLabel(topic.weekNumber, topic.title)}`,
    topicId: topic.id,
  };
}

/** "Week 3 · Conditional probability" (just the title without a week). */
export function weekTopicLabel(weekNumber: number | undefined, title: string) {
  return typeof weekNumber === "number" && weekNumber > 0
    ? `Week ${weekNumber} · ${title}`
    : title;
}

type ResumeSession = { questionId: string; sessionId: string };

/**
 * The question shown first. A specific question wins; a topic the student
 * chose deliberately stays inside that topic even when it has nothing to
 * practice yet (never silently swap to another topic); otherwise the first
 * available question, preferring the first listed topic. The selected topic
 * always matches the displayed question, so progress counts, Continue, and
 * topic completion never mix two topics.
 */
export function resolveStartingSelection({
  initialQuestionId,
  initialTopicId,
  questions,
  topics,
}: Pick<
  PracticeWorkspaceProps,
  "initialQuestionId" | "initialTopicId" | "questions" | "topics"
>) {
  const initialQuestion = questions.find(
    (question) => question.id === initialQuestionId,
  );
  const requestedTopicId =
    initialTopicId && topics.some((topic) => topic.id === initialTopicId)
      ? initialTopicId
      : undefined;
  const startingQuestion =
    initialQuestion ??
    (requestedTopicId
      ? questions.find((question) => question.topicId === requestedTopicId)
      : (questions.find((question) => question.topicId === topics[0]?.id) ??
        questions[0]));

  return {
    questionId: startingQuestion?.id ?? "",
    topicId:
      startingQuestion?.topicId ?? requestedTopicId ?? topics[0]?.id ?? "",
  };
}

/**
 * Which stored session a question resumes: a similar problem's own session,
 * then a session recovered from `?sessionId=`, then the one the page was
 * opened with. `undefined` lets the client fall back to the per-question
 * session in browser storage, or create one.
 */
export function preferredSessionIdFor(
  questionId: string,
  {
    initialQuestionId,
    initialSessionId,
    reservePractice,
    resumeSession,
  }: {
    initialQuestionId?: string;
    initialSessionId?: string;
    reservePractice: SimilarPracticeSessionDto | null;
    resumeSession: ResumeSession | null;
  },
) {
  if (reservePractice?.question.id === questionId) {
    return reservePractice.sessionId;
  }
  if (resumeSession?.questionId === questionId) {
    return resumeSession.sessionId;
  }
  return questionId === initialQuestionId ? initialSessionId : undefined;
}

/** The transcript entries a worked-solution reply adds: each step, then the summary. */
export function solutionStepMessages(
  response: Pick<TutorResponse, "message" | "steps">,
): ChatMessage[] {
  const total = response.steps.length;
  return [
    ...response.steps.map((step, index) => ({
      id: createClientId("tutor"),
      role: "tutor" as const,
      stepLabel: `Step ${index + 1} of ${total}`,
      text: step,
      tone: "neutral" as const,
    })),
    {
      id: createClientId("tutor"),
      label: "Worked solution",
      role: "tutor" as const,
      text: response.message,
      tone: "neutral" as const,
    },
  ];
}

/** The verdict band under the answer field. */
export type SheetVerdict = {
  verdict: "correct" | "incorrect" | "unreadable";
  /** One plain sentence (the band renders text, not KaTeX). */
  message: string;
};

/** The first sentence of `text` when it is short plain prose (no KaTeX). */
function plainFirstSentence(text: string | undefined) {
  const trimmed = text?.trim();
  if (!trimmed || /[$\\]/.test(trimmed)) {
    return undefined;
  }
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(trimmed)?.[1] ?? trimmed;
  return sentence.length <= 160 ? sentence : undefined;
}

/**
 * What the band under the answer field says after a check: a label the Sheet
 * owns ("Correct", "Not quite", "Couldn't read that answer") and one sentence.
 * The full explanation stays in the tutor transcript. Hints, worked steps and
 * blocked help never produce a band.
 */
export function sheetVerdictFor(
  response: Pick<TutorResponse, "message" | "misconceptions" | "verdict">,
): SheetVerdict | null {
  if (response.verdict === "correct") {
    return {
      verdict: "correct",
      message:
        plainFirstSentence(response.message) ??
        "Open Why? to see the reasoning.",
    };
  }
  if (response.verdict === "incorrect") {
    return {
      verdict: "incorrect",
      message:
        plainFirstSentence(response.misconceptions[0]) ??
        plainFirstSentence(stripNotQuitePrefix(response.message)) ??
        "Change your answer and check again.",
    };
  }
  if (
    response.verdict === "guidance" &&
    response.message.startsWith(UNREADABLE_MESSAGE_PREFIX)
  ) {
    return {
      verdict: "unreadable",
      message:
        "This was not counted as an attempt. Use the format shown above.",
    };
  }
  return null;
}

/** Tailwind's lg and xl breakpoints (64rem, 80rem), for handlers only. */
const LG_QUERY = "(min-width: 64rem)";
const XL_QUERY = "(min-width: 80rem)";
/** Where the math keypad docks over the page (see `useKeypadLayout`). */
const DOCKED_KEYPAD_QUERY = "(pointer: coarse), (max-width: 1023.98px)";

/**
 * Keys typed here belong to the field, not to the page's shortcuts: text
 * inputs, the math field, the keypad, and any open dialog.
 */
function isTypingTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], math-field, [data-slot="math-keypad"], [data-slot="math-keypad-dock"], [role="dialog"]',
      ),
    )
  );
}

function viewportMatches(query: string) {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Keeps the address bar on the question being practised, without navigating. */
function replacePracticeUrl(path: string) {
  try {
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.replaceState(null, "", path);
    }
  } catch {
    // The page still works; only refresh-and-share lands elsewhere.
  }
}

function afterPaint(callback: () => void) {
  window.setTimeout(callback, 0);
}

type TutorRequestPlan = {
  /** What `activeMode` reads while the request is in flight. */
  mode: Exclude<ActiveTutorMode, null>;
  request: {
    aiHelp?: boolean;
    allowLlmFallback?: boolean;
    answer: string;
    mode: TutorMode;
  };
  /** Runs once the request is committed to (after the busy flag is set). */
  before?: () => void;
  onSuccess: (
    response: TutorResponse,
    question: StudentPracticeQuestion,
    session: TutorSessionDto,
  ) => void;
  /** Runs before the shared failure handling (withdraw a pending bubble). */
  onError?: () => void;
  /** Runs after the shared failure handling (return focus to the field). */
  afterError?: () => void;
  /** A typed answer to put back in the field if nothing was saved. */
  unsavedAnswer?: string;
};

export function usePracticeWorkspace({
  aiHelpEnabled = false,
  deliveryByQuestionId,
  initialQuestionId,
  initialSessionId,
  initialSolvedQuestionIds,
  initialTopicId,
  questions,
  topics,
}: PracticeWorkspaceProps) {
  const initialQuestion = questions.find(
    (question) => question.id === initialQuestionId,
  );
  const [starting] = useState(() =>
    resolveStartingSelection({
      initialQuestionId,
      initialTopicId,
      questions,
      topics,
    }),
  );

  // Selection.
  const [selectedTopicId, setSelectedTopicId] = useState(starting.topicId);
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    starting.questionId,
  );
  const [reservePractice, setReservePractice] =
    useState<SimilarPracticeSessionDto | null>(null);
  const [resumeSession, setResumeSession] = useState<ResumeSession | null>(
    null,
  );
  const [isInitialSessionResolving, setIsInitialSessionResolving] = useState(
    Boolean(initialSessionId && !initialQuestion),
  );
  const [initialSessionFailed, setInitialSessionFailed] = useState(false);
  const [solvedQuestionIds, setSolvedQuestionIds] = useState<Set<string>>(
    () => new Set(initialSolvedQuestionIds ?? []),
  );

  // The attempt on the displayed question.
  const [answer, setAnswer] = useState("");
  const [activeMode, setActiveMode] = useState<ActiveTutorMode>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [latestResponse, setLatestResponse] = useState<TutorResponse | null>(
    null,
  );
  // Tutoring state the last AI-help reply answered; a repeat for the same
  // state is a no-op (the reply is already in the transcript).
  const [lastAiHelpKey, setLastAiHelpKey] = useState<string | null>(null);
  const aiHelpGateRef = useRef<AiHelpGate | null>(null);
  const [session, setSession] = useState<TutorSessionDto | null>(null);
  const [sessionError, setSessionError] = useState<SessionErrorState | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [disclosedHints, setDisclosedHints] = useState<string[]>([]);
  const [hintCount, setHintCount] = useState(0);
  const [solutionSteps, setSolutionSteps] = useState<string[]>([]);
  // The topic-complete notice shows by itself once the topic is finished;
  // "Stay here" hides it for this question.
  const [topicCompleteDismissed, setTopicCompleteDismissed] = useState(false);
  // The last graded check, shown as the band under the field until the
  // student edits the answer.
  const [lastCheck, setLastCheck] = useState<
    (SheetVerdict & { answer: string }) | null
  >(null);
  // The last answer the tutor graded (this visit or a recovered session),
  // shown as a context chip in the tutor.
  const [lastSubmittedAnswer, setLastSubmittedAnswer] = useState<string>();

  // Layout. The rail and the drawer collapse independently, and the phone
  // gets the same transcript as a bottom sheet.
  const [search, setSearch] = useState("");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [tutorPrompt, setTutorPrompt] = useState("");
  // Below 1280 the tutor is an overlay: a bottom sheet on phones, a right
  // panel from 1024. `side` is decided when it opens.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mobileSheetSide, setMobileSheetSide] = useState<"bottom" | "right">(
    "bottom",
  );
  const [mobileSheetTall, setMobileSheetTall] = useState(false);
  const [seenTutorMessageCount, setSeenTutorMessageCount] = useState(0);

  // The Sheet owns the answer input, so the workspace holds the Sheet's
  // container and focuses the field inside it.
  const answerInputRef = useRef<HTMLDivElement>(null);
  // The solved-state primary: the Next question button or the Next topic link.
  const continueButtonRef = useRef<HTMLElement>(null);
  const drawerToggleRef = useRef<HTMLButtonElement>(null);
  const drawerTabRef = useRef<HTMLButtonElement>(null);
  const drawerHeadingRef = useRef<HTMLHeadingElement>(null);
  const topicCompleteRef = useRef<HTMLHeadingElement>(null);

  const topicQuestions = useMemo(
    () => questions.filter((question) => question.topicId === selectedTopicId),
    [questions, selectedTopicId],
  );
  const selectedQuestion =
    (reservePractice?.question.id === selectedQuestionId
      ? reservePractice.question
      : undefined) ??
    questions.find((question) => question.id === selectedQuestionId);
  const selectedTopic =
    topics.find((topic) => topic.id === selectedQuestion?.topicId) ??
    topics.find((topic) => topic.id === selectedTopicId) ??
    topics[0];
  const selectedQuestionIdForSession = selectedQuestion?.id;

  // Section delivery for the displayed question (never for a similar
  // problem, which belongs to no section release).
  const delivery =
    selectedQuestion && session?.practiceContext !== "reserve_practice"
      ? deliveryByQuestionId?.[selectedQuestion.id]
      : undefined;
  const deliveryProgress = {
    solved: Boolean(session?.solved),
    wrongAttemptCount: session?.wrongAttemptCount ?? 0,
  };
  const hintsDisabled = delivery?.hintsEnabled === false;
  const attemptsLeft = delivery
    ? attemptsRemaining(delivery, deliveryProgress)
    : undefined;
  const outOfAttempts = attemptsLeft === 0 && !session?.solved;
  const stepsAllowedByDelivery =
    !delivery ||
    solutionRevealAllowed(delivery.solutionReveal, deliveryProgress);
  const stepsNeverAvailable = delivery?.solutionReveal === "never";
  const stepsLockedReason =
    delivery && !stepsAllowedByDelivery
      ? solutionRevealDescription(delivery.solutionReveal)
      : undefined;

  // Gates.
  const isTutorBusy = activeMode !== null || isSessionLoading;
  const canSend =
    Boolean(session) &&
    !session?.solved &&
    !isTutorBusy &&
    !outOfAttempts &&
    answer.trim().length > 0 &&
    // The answer on screen was just graded; checking it again unchanged
    // would only spend an attempt.
    lastCheck === null;
  // With hints turned off there is nothing to work through first, so the
  // steps wait only on the section's reveal rule.
  const hintsExhausted = Boolean(
    selectedQuestion &&
    (hintsDisabled || hintCount >= selectedQuestion.hintCount),
  );
  const solutionFullyRevealed = Boolean(
    selectedQuestion &&
    selectedQuestion.stepCount > 0 &&
    session &&
    session.revealedSteps >= selectedQuestion.stepCount,
  );
  const canRevealHint =
    Boolean(session) && !session?.solved && !hintsExhausted && !hintsDisabled;
  const canRevealStep = Boolean(
    session &&
    hintsExhausted &&
    stepsAllowedByDelivery &&
    selectedQuestion &&
    selectedQuestion.stepCount > 0 &&
    !solutionFullyRevealed,
  );
  const questionPosition = topicQuestions.findIndex(
    (question) => question.id === selectedQuestion?.id,
  );
  const solvedInTopic = topicQuestions.filter((question) =>
    solvedQuestionIds.has(question.id),
  ).length;
  const nextQuestion = useMemo(
    () =>
      nextQuestionAfter(
        selectedQuestion?.id,
        topicQuestions,
        solvedQuestionIds,
      ),
    [selectedQuestion?.id, solvedQuestionIds, topicQuestions],
  );
  const isReservePractice = session?.practiceContext === "reserve_practice";
  const aiHelpKey =
    selectedQuestion && session
      ? aiHelpStateKey({
          answer,
          attemptCount: session.attemptCount,
          hintsRevealed: session.revealedHints,
          questionId: selectedQuestion.id,
          sessionId: session.id,
          solved: session.solved,
          stepsRevealed: session.revealedSteps,
        })
      : null;
  const aiHelpAlreadyGiven = aiHelpKey !== null && aiHelpKey === lastAiHelpKey;
  const aiHelpOffered =
    aiHelpEnabled && Boolean(latestResponse?.usage.llmFallbackEligible);

  useEffect(() => {
    // A one-shot read of the browser store, deferred past the first paint so
    // the hydrated tree still matches the server render.
    const timer = window.setTimeout(() => {
      try {
        if (
          window.localStorage.getItem(TUTOR_DRAWER_STORAGE_KEY) === "closed"
        ) {
          setDrawerOpen(false);
        }
      } catch {
        // A blocked or absent store just means the drawer opens, which is the
        // first-visit default anyway.
      }
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    // The overlay belongs to one breakpoint: crossing into the next one
    // (where the drawer is a column, or the sheet a side panel) closes it.
    if (!mobileSheetOpen) return;
    const queries = [LG_QUERY, XL_QUERY].map((query) =>
      window.matchMedia(query),
    );
    const close = () => setMobileSheetOpen(false);
    queries.forEach((query) => query.addEventListener("change", close));
    return () => {
      queries.forEach((query) => query.removeEventListener("change", close));
    };
  }, [mobileSheetOpen]);

  useEffect(() => {
    if (!initialSessionId || initialQuestion) return;
    let isStale = false;

    void fetchTutorSession(initialSessionId)
      .then((recovered) => {
        if (isStale) return;
        if (recovered.question) {
          setReservePractice({
            question: recovered.question,
            sessionId: recovered.id,
          });
          setSelectedTopicId(recovered.question.topicId);
          setSelectedQuestionId(recovered.question.id);
        } else if (questions.some(({ id }) => id === recovered.questionId)) {
          setSelectedQuestionId(recovered.questionId);
        }
        setResumeSession({
          questionId: recovered.questionId,
          sessionId: recovered.id,
        });
      })
      .catch((error) => {
        if (!isStale) {
          setInitialSessionFailed(true);
          setSessionError(sessionErrorFor(error));
        }
      })
      .finally(() => {
        if (!isStale) setIsInitialSessionResolving(false);
      });

    return () => {
      isStale = true;
    };
  }, [initialQuestion, initialSessionId, questions]);

  /** THE reset: everything that belongs to one attempt on one question. */
  const clearAttempt = useCallback(() => {
    setAnswer("");
    setLastCheck(null);
    setLastSubmittedAnswer(undefined);
    setLatestResponse(null);
    setLastAiHelpKey(null);
    setMessages([]);
    setSeenTutorMessageCount(0);
    setDisclosedHints([]);
    setHintCount(0);
    setSolutionSteps([]);
    setTopicCompleteDismissed(false);
  }, []);

  const applySessionSnapshot = useCallback(
    (snapshot: TutorSessionDto, question: StudentPracticeQuestion) => {
      const revealed = Math.min(snapshot.revealedHints, question.hintCount);
      setSession(snapshot);
      setMessages(recoveryMessages(snapshot, question));
      setDisclosedHints((snapshot.disclosedHints ?? []).slice(0, revealed));
      setHintCount(revealed);
      setSolutionSteps(snapshot.disclosedSolutionSteps ?? []);
      setLastSubmittedAnswer(
        snapshot.attempts.findLast((attempt) => attempt.submittedAnswer)
          ?.submittedAnswer,
      );
      if (snapshot.solved) {
        setSolvedQuestionIds((ids) => new Set(ids).add(question.id));
        writeDraft(snapshot.id, "");
      } else {
        // A half-typed answer from before a reload comes back.
        const draft = readDraft(snapshot.id);
        if (draft) {
          setAnswer(draft);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let isStale = false;

    async function loadSession() {
      clearAttempt();
      setSession(null);

      if (
        !selectedQuestionIdForSession ||
        !selectedQuestion ||
        isInitialSessionResolving ||
        initialSessionFailed
      ) {
        setIsSessionLoading(false);
        return;
      }

      setSessionError(null);
      setIsSessionLoading(true);

      try {
        const nextSession = await createOrResumeTutorSession(
          selectedQuestionIdForSession,
          preferredSessionIdFor(selectedQuestionIdForSession, {
            initialQuestionId,
            initialSessionId,
            reservePractice,
            resumeSession,
          }),
        );

        if (!isStale) {
          applySessionSnapshot(nextSession, selectedQuestion);
        }
      } catch (error) {
        if (!isStale) {
          setSessionError(sessionErrorFor(error));
        }
      } finally {
        if (!isStale) {
          setIsSessionLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      isStale = true;
    };
  }, [
    applySessionSnapshot,
    clearAttempt,
    initialQuestionId,
    initialSessionId,
    initialSessionFailed,
    isInitialSessionResolving,
    reservePractice,
    resumeSession,
    selectedQuestion,
    selectedQuestionIdForSession,
  ]);

  function pushMessage(message: Omit<ChatMessage, "id">) {
    setMessages((items) => [
      ...items,
      { ...message, id: createClientId(message.role) },
    ]);
  }

  /**
   * Returns focus to the answer field, except where the keypad docks over
   * the page (touch, narrow screens): there, focusing the field would raise
   * the keypad over the verdict band or the hint that just opened.
   */
  function focusAnswerInput() {
    window.setTimeout(() => {
      if (viewportMatches(DOCKED_KEYPAD_QUERY)) return;
      answerInputRef.current
        ?.querySelector<HTMLElement>('[data-slot="answer-input"]')
        ?.focus();
    }, 0);
  }

  /** After a check that was not correct: the band on touch, else the field. */
  function focusAfterCheck() {
    window.setTimeout(() => {
      const container = answerInputRef.current;
      if (viewportMatches(DOCKED_KEYPAD_QUERY)) {
        container
          ?.querySelector<HTMLElement>('[data-slot="verdict-band"]')
          ?.focus();
        return;
      }
      container
        ?.querySelector<HTMLElement>('[data-slot="answer-input"]')
        ?.focus();
    }, 0);
  }

  function markSolved(questionId: string) {
    setSolvedQuestionIds((ids) => new Set(ids).add(questionId));
  }

  async function handleTutorRequestFailure(
    error: unknown,
    unsavedAnswer?: string,
  ) {
    if (
      error instanceof TutorClientRequestError &&
      error.code === "TUTOR_SESSION_UNAVAILABLE"
    ) {
      if (selectedQuestion) {
        clearTutorSessionId(selectedQuestion.id);
      }
      setSession(null);
      setSessionError({ code: error.code, message: error.message });
      return;
    }

    if (
      session &&
      selectedQuestion &&
      error instanceof TutorClientRequestError &&
      ["NETWORK_INTERRUPTED", "TUTOR_SESSION_STALE"].includes(error.code ?? "")
    ) {
      try {
        const recovered = await fetchTutorSession(session.id);
        const writeWasRecovered = recovered.revision > session.revision;
        applySessionSnapshot(recovered, selectedQuestion);
        if (!writeWasRecovered && unsavedAnswer) {
          setAnswer(unsavedAnswer);
        }
        setSessionError({
          code: error.code,
          message: writeWasRecovered
            ? "Your connection is back, and your work was saved."
            : error.code === "TUTOR_SESSION_STALE"
              ? "Your work was refreshed from another tab. Check your answer again."
              : "Your connection is back. Check your answer again.",
        });
        return;
      } catch {
        // Keep the original, already-sanitized error. The existing session ID
        // remains stored so a later refresh can recover committed progress.
      }
    }

    if (unsavedAnswer) {
      setAnswer(unsavedAnswer);
    }
    setSessionError(sessionErrorFor(error));
  }

  /**
   * THE request helper. Check, hint, worked steps and AI help differ only in
   * what they send and what they do with the reply; the busy flag, the error
   * reset, the progress merge and the failure recovery are shared.
   */
  async function runTutorRequest(plan: TutorRequestPlan) {
    const question = selectedQuestion;
    const activeSession = session;
    if (!question || !activeSession || activeMode) {
      return;
    }

    setActiveMode(plan.mode);
    setSessionError(null);
    plan.before?.();

    try {
      const response = await requestTutorResponse({
        ...plan.request,
        questionId: question.id,
        sessionId: activeSession.id,
        topicId: question.topicId,
      });
      setLatestResponse(response);
      setSession((current) => sessionWithProgress(current, response));
      plan.onSuccess(response, question, activeSession);
    } catch (error) {
      plan.onError?.();
      await handleTutorRequestFailure(error, plan.unsavedAnswer);
      plan.afterError?.();
    } finally {
      setActiveMode(null);
    }
  }

  async function syncHintsFromSession(
    sessionId: string,
    question: StudentPracticeQuestion,
  ) {
    try {
      const snapshot = await fetchTutorSession(sessionId);
      const revealed = Math.min(snapshot.revealedHints, question.hintCount);
      setDisclosedHints((snapshot.disclosedHints ?? []).slice(0, revealed));
      setHintCount(revealed);
    } catch {
      // The transcript already shows the feedback; the hint panel refreshes on
      // the next hint request or page reload.
    }
  }

  function applyHintsFromResponse(
    response: TutorResponse,
    question: StudentPracticeQuestion,
    sessionId: string,
  ) {
    const revealed = Math.min(
      question.hintCount,
      response.progress?.hintsRevealed ?? response.hints.length,
    );
    if (revealed === 0 || hintsDisabled) {
      return;
    }
    if (
      response.misconceptions.length > 0 ||
      response.hints.length < revealed
    ) {
      // A misconception reply carries corrective guidance instead of the
      // question's own hints, so the hint panel is refreshed from the session
      // rather than from this reply.
      void syncHintsFromSession(sessionId, question);
      return;
    }
    setDisclosedHints(response.hints.slice(0, revealed));
    setHintCount(revealed);
  }

  function sendAnswer() {
    const typed = answer;
    const trimmed = typed.trim();
    if (!trimmed || lastCheck) {
      return;
    }

    void runTutorRequest({
      mode: "check",
      request: { answer: trimmed, mode: "check" },
      // The answer stays in the field: after "Not quite" the student edits
      // it rather than retyping it.
      before: () => {
        pushMessage({ role: "student", text: trimmed });
        setLastSubmittedAnswer(trimmed);
      },
      unsavedAnswer: trimmed,
      onSuccess: (response, question, activeSession) => {
        applyHintsFromResponse(response, question, activeSession.id);
        pushMessage(chatMessageForResponse(response));
        const band = sheetVerdictFor(response);
        setLastCheck(band ? { ...band, answer: typed } : null);
        if (response.verdict === "correct") {
          setSolutionSteps(response.steps);
          markSolved(question.id);
          writeDraft(activeSession.id, "");
          window.setTimeout(() => continueButtonRef.current?.focus(), 0);
        } else {
          focusAfterCheck();
        }
      },
      afterError: focusAnswerInput,
    });
  }

  function getHint() {
    if (hintsExhausted || hintsDisabled) {
      return;
    }

    void runTutorRequest({
      mode: "hint",
      request: { answer, mode: "hint" },
      onSuccess: (response, question) => {
        const next = Math.min(
          question.hintCount,
          response.progress?.hintsRevealed ?? hintCount + 1,
        );
        setDisclosedHints(response.hints.slice(0, next));
        setHintCount(next);
        focusAnswerInput();
      },
    });
  }

  function showAnswer() {
    if (!hintsExhausted || !stepsAllowedByDelivery) {
      return;
    }

    void runTutorRequest({
      mode: "full_solution",
      request: { answer, mode: "full_solution" },
      onSuccess: (response) => {
        setSolutionSteps(response.steps);
        setMessages((items) => [...items, ...solutionStepMessages(response)]);
      },
    });
  }

  async function requestLimitedAiHelp(message?: string) {
    if (!selectedQuestion || !session || activeMode || aiHelpAlreadyGiven) {
      return;
    }

    // The drawer's free-text field sends what the student typed there; the
    // chip sends their draft answer, exactly as before.
    const helpMessage = aiHelpMessageFor(message ?? answer);
    const gate = (aiHelpGateRef.current ??= createAiHelpGate());
    const requestId = createClientId("student");

    // The gate closes synchronously, so a second click that lands before
    // React re-renders the disabled button cannot start a second request.
    await gate.run(() =>
      runTutorRequest({
        mode: "ai",
        // The draft is context for the help, never a submission: the server
        // does not grade an aiHelp request.
        request: {
          aiHelp: true,
          allowLlmFallback: true,
          answer: helpMessage,
          mode: "check",
        },
        before: () => {
          setMessages((items) => [
            ...items,
            {
              id: requestId,
              role: "student",
              text: message ?? AI_HELP_REQUEST_TEXT,
            },
          ]);
        },
        onSuccess: (response, question, activeSession) => {
          setMessages((items) =>
            appendAiHelpReply(items, requestId, {
              ...chatMessageForResponse(response),
              id: createClientId("tutor"),
            }),
          );
          setLastAiHelpKey(
            aiHelpStateKey({
              answer: helpMessage,
              attemptCount:
                response.progress?.attemptCount ??
                activeSession.attemptCount + 1,
              hintsRevealed:
                response.progress?.hintsRevealed ?? activeSession.revealedHints,
              questionId: question.id,
              sessionId: activeSession.id,
              solved: response.progress?.solved ?? activeSession.solved,
              stepsRevealed:
                response.progress?.stepsRevealed ?? activeSession.revealedSteps,
            }),
          );
          if (response.verdict === "correct") {
            setSolutionSteps(response.steps);
            markSolved(question.id);
            writeDraft(activeSession.id, "");
          }
        },
        // Withdraw the pending request bubble so a retry never shows two
        // "Asked for AI help." entries for one reply.
        onError: () => {
          setMessages((items) => withoutEntry(items, requestId));
          if (message) {
            setTutorPrompt(message);
          }
        },
      }),
    );
  }

  async function restartTutorSession() {
    if (!selectedQuestion) {
      return;
    }

    setIsSessionLoading(true);
    setSessionError(null);

    try {
      const nextSession = await createTutorSession(selectedQuestion.id, {
        forceNew: true,
      });
      storeTutorSessionId(selectedQuestion.id, nextSession.id);
      if (session) {
        writeDraft(session.id, "");
      }
      clearAttempt();
      setSession(nextSession);
      focusAnswerInput();
    } catch (error) {
      setSessionError(sessionErrorFor(error));
    } finally {
      setIsSessionLoading(false);
    }
  }

  function selectQuestion(questionId: string, topicId: string) {
    // Re-selecting the question on screen keeps its session and transcript.
    if (
      questionId &&
      questionId === selectedQuestionId &&
      topicId === selectedTopicId &&
      !reservePractice
    ) {
      return;
    }
    setInitialSessionFailed(false);
    setReservePractice(null);
    setSelectedTopicId(topicId);
    setSelectedQuestionId(questionId);
    clearAttempt();
    replacePracticeUrl(
      questionId
        ? `/practice/${encodeURIComponent(questionId)}`
        : `/practice?topicId=${encodeURIComponent(topicId)}`,
    );
  }

  /** The rail's topic switcher: land on the topic's first question, or on the
   * topic itself when it has nothing published yet (the empty-topic state). */
  function selectTopic(topicId: string) {
    const first = questions.find((question) => question.topicId === topicId);
    selectQuestion(first?.id ?? "", topicId);
  }

  function openSimilarQuestion(practice: SimilarPracticeSessionDto) {
    setInitialSessionFailed(false);
    setReservePractice(practice);
    setSelectedTopicId(practice.question.topicId);
    setSelectedQuestionId(practice.question.id);
    clearAttempt();
    // A similar problem is not a published page of its own; its session is
    // what a refresh must come back to.
    replacePracticeUrl(
      `/practice?sessionId=${encodeURIComponent(practice.sessionId)}`,
    );
  }

  function continueToNextQuestion() {
    if (nextQuestion) {
      selectQuestion(nextQuestion.id, nextQuestion.topicId);
      return;
    }
    setTopicCompleteDismissed(false);
    afterPaint(() => topicCompleteRef.current?.focus());
  }

  function toggleRail() {
    setRailCollapsed((collapsed) => !collapsed);
  }

  function setDrawerColumnOpen(next: boolean) {
    setDrawerOpen(next);
    try {
      window.localStorage.setItem(
        TUTOR_DRAWER_STORAGE_KEY,
        next ? "open" : "closed",
      );
    } catch {
      // The choice simply does not survive the visit.
    }
    // The control that was pressed leaves the page, so focus follows the
    // tutor: into the drawer when it opens, onto the edge tab when it closes.
    afterPaint(() => {
      if (next) {
        drawerToggleRef.current?.focus();
      } else {
        drawerTabRef.current?.focus();
      }
    });
  }

  function toggleDrawer() {
    setDrawerColumnOpen(!drawerOpen);
  }

  function setMobileSheet(next: boolean) {
    setMobileSheetOpen(next);
    if (next) {
      setSeenTutorMessageCount(
        messages.filter((message) => message.role === "tutor").length,
      );
    }
  }

  function toggleMobileSheet() {
    if (!mobileSheetOpen) {
      setMobileSheetSide(viewportMatches(LG_QUERY) ? "right" : "bottom");
    }
    setMobileSheet(!mobileSheetOpen);
  }

  /**
   * Shows the tutor wherever it lives at this width: the drawer column from
   * 1280 (reopened if it was collapsed), otherwise the overlay. `Why?` and the
   * right-edge tab both land here.
   */
  function openTutor({ focusHeading = false } = {}) {
    if (viewportMatches(XL_QUERY)) {
      if (!drawerOpen) {
        setDrawerColumnOpen(true);
      } else if (focusHeading) {
        drawerHeadingRef.current?.focus();
      }
      return;
    }
    setMobileSheetSide(viewportMatches(LG_QUERY) ? "right" : "bottom");
    setMobileSheet(true);
  }

  function toggleMobileSheetHeight() {
    setMobileSheetTall((tall) => !tall);
  }

  function sendTutorPrompt() {
    const trimmed = tutorPrompt.trim();
    if (!trimmed) {
      return;
    }
    setTutorPrompt("");
    void requestLimitedAiHelp(trimmed);
  }

  function changeAnswer(value: string) {
    setAnswer(value);
    // Editing the answer retires the band: it described the old answer.
    setLastCheck(null);
    if (session && !session.solved) {
      writeDraft(session.id, value);
    }
  }

  // Alt + ← / → move to the adjacent question (the footer's Previous and
  // Next), from anywhere on the page except a text field, the keypad or a
  // dialog. The listener reads the latest state through a ref.
  const shortcutState = useRef({
    blocked: true,
    next: undefined as StudentPracticeQuestion | undefined,
    previous: undefined as StudentPracticeQuestion | undefined,
    select: (() => undefined) as (questionId: string, topicId: string) => void,
  });
  useEffect(() => {
    shortcutState.current = {
      blocked: isTutorBusy || mobileSheetOpen,
      next:
        questionPosition >= 0
          ? topicQuestions[questionPosition + 1]
          : undefined,
      previous:
        questionPosition > 0 ? topicQuestions[questionPosition - 1] : undefined,
      select: selectQuestion,
    };
  });
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight") ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      const { blocked, next, previous, select } = shortcutState.current;
      const target = event.key === "ArrowLeft" ? previous : next;
      if (blocked || !target) {
        return;
      }
      // Alt + ← is also the browser's Back; here it means the previous question.
      event.preventDefault();
      select(target.id, target.topicId);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Derived presentation values.
  const sheetVerdict: SheetVerdict | null =
    lastCheck ??
    (session?.solved
      ? {
          message: "You have already solved this question.",
          verdict: "correct",
        }
      : null);
  const weekLabel = practiceWeekLabel(selectedTopic?.weekNumber);
  // "Week 3 · Conditional probability" and "Question 1 of 6": where am I,
  // in words (no question code, no answer-type word).
  const topicLabel = selectedTopic
    ? weekTopicLabel(selectedTopic.weekNumber, selectedTopic.title)
    : "Practice";
  const positionLabel =
    questionPosition >= 0
      ? `Question ${questionPosition + 1} of ${topicQuestions.length}`
      : undefined;
  // Once the topic is finished (or the question was removed with nothing
  // left in the topic), "Next topic" takes over from "Next question".
  const nextTopic = nextQuestion
    ? undefined
    : nextTopicWithWork({
        currentTopicId: selectedTopic?.id,
        questions,
        solvedQuestionIds,
        topics,
      });
  const courseComplete =
    questions.length > 0 &&
    questions.every((question) => solvedQuestionIds.has(question.id));
  const topicComplete =
    Boolean(session?.solved) && !nextQuestion && topicQuestions.length > 0;
  const showTopicComplete = topicComplete && !topicCompleteDismissed;
  const navQuestions = topicQuestions.map((question) => ({
    id: question.id,
    title: studentQuestionTitle(question.title),
  }));
  // A removed question keeps its attempts and loses its prompt and its
  // input. The Sheet says so in its own words; the server's message (staff
  // wording) is not repeated.
  const tombstone =
    sessionError &&
    (sessionError.code === "QUESTION_UNAVAILABLE" ||
      sessionError.code === "content_unpublished")
      ? ""
      : undefined;
  const isLoadingQuestion =
    isInitialSessionResolving ||
    (isSessionLoading && !session && !sessionError);
  const tutorMessageCount = messages.filter(
    (message) => message.role === "tutor",
  ).length;
  const unseenTutorMessages = mobileSheetOpen
    ? 0
    : Math.max(0, tutorMessageCount - seenTutorMessageCount);

  return {
    view: {
      activeMode,
      aiHelpAlreadyGiven,
      aiHelpEnabled,
      aiHelpOffered,
      answer,
      attemptsLeft,
      courseComplete,
      // Hints turned off for the section are never shown, even ones an
      // earlier wrong answer revealed on the server.
      disclosedHints: hintsDisabled ? [] : disclosedHints,
      hasAnyQuestions: questions.length > 0,
      hintsDisabled,
      isLoadingQuestion,
      isReservePractice,
      isSessionLoading,
      isTutorBusy,
      lastCheckVerdict: lastCheck?.verdict ?? null,
      lastSubmittedAnswer,
      messages,
      navQuestions,
      nextQuestion,
      nextTopic,
      positionLabel,
      questionPosition,
      search,
      selectedQuestion,
      selectedQuestionId,
      selectedTopic,
      selectedTopicId,
      session,
      sessionError,
      showTopicComplete,
      solutionFullyRevealed,
      solutionSteps,
      solvedInTopic,
      solvedQuestionIds,
      tombstone,
      topicLabel,
      topicQuestions,
      topics,
      tutorPrompt,
      sheetVerdict,
      weekLabel,
    },
    gates: {
      canRevealHint,
      canRevealStep,
      canSend,
      hintsExhausted,
      outOfAttempts,
      stepsLockedReason,
      stepsNeverAvailable,
    },
    layout: {
      drawerOpen,
      mobileSheetOpen,
      mobileSheetSide,
      mobileSheetTall,
      railCollapsed,
      unseenTutorMessages,
    },
    actions: {
      continueToNextQuestion,
      dismissTopicComplete: () => setTopicCompleteDismissed(true),
      getHint,
      openSimilarQuestion,
      requestLimitedAiHelp: () => {
        void requestLimitedAiHelp();
      },
      restartTutorSession: () => {
        void restartTutorSession();
      },
      openTutor,
      selectQuestion,
      selectTopic,
      sendAnswer,
      sendTutorPrompt,
      setAnswer: changeAnswer,
      setMobileSheet,
      setSearch,
      setTutorPrompt,
      showAnswer,
      toggleDrawer,
      toggleMobileSheet,
      toggleMobileSheetHeight,
      toggleRail,
    },
    refs: {
      answerInputRef,
      continueButtonRef,
      drawerHeadingRef,
      drawerTabRef,
      drawerToggleRef,
      topicCompleteRef,
    },
  };
}

export type PracticeWorkspaceController = ReturnType<
  typeof usePracticeWorkspace
>;
