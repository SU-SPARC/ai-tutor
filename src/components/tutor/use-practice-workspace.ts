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
import { studentQuestionTitle } from "@/lib/labels";
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

export type PracticeWorkspaceProps = {
  aiHelpEnabled?: boolean;
  initialQuestionId?: string;
  initialSessionId?: string;
  initialTopicId?: string;
  questions: StudentPracticeQuestion[];
  topics: CourseTopic[];
};

export type ActiveTutorMode = TutorMode | "ai" | null;

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
        "Change your answer and check again, or reveal a hint.",
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
  initialQuestionId,
  initialSessionId,
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
    () => new Set(),
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
  const [showTopicComplete, setShowTopicComplete] = useState(false);
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
  const continueButtonRef = useRef<HTMLButtonElement>(null);
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

  // Gates.
  const isTutorBusy = activeMode !== null || isSessionLoading;
  const canSend =
    Boolean(session) &&
    !session?.solved &&
    !isTutorBusy &&
    answer.trim().length > 0 &&
    // The answer on screen was just graded; checking it again unchanged
    // would only spend an attempt.
    lastCheck === null;
  const hintsExhausted = Boolean(
    selectedQuestion && hintCount >= selectedQuestion.hintCount,
  );
  const solutionFullyRevealed = Boolean(
    selectedQuestion &&
    selectedQuestion.stepCount > 0 &&
    session &&
    session.revealedSteps >= selectedQuestion.stepCount,
  );
  const canRevealHint = Boolean(session) && !session?.solved && !hintsExhausted;
  const canRevealStep = Boolean(
    session &&
    hintsExhausted &&
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
    setShowTopicComplete(false);
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

  function focusAnswerInput() {
    window.setTimeout(
      () => answerInputRef.current?.querySelector("input")?.focus(),
      0,
    );
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
            ? "The connection recovered and your saved progress was restored."
            : error.code === "TUTOR_SESSION_STALE"
              ? "Your saved progress was refreshed. Please check your answer again."
              : "The connection recovered, but no saved change is visible yet. Please wait a moment, then check your answer again.",
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
    if (revealed === 0) {
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
          window.setTimeout(() => continueButtonRef.current?.focus(), 0);
        } else {
          focusAnswerInput();
        }
      },
      afterError: focusAnswerInput,
    });
  }

  function getHint() {
    if (hintsExhausted) {
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
    if (!hintsExhausted) {
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
                response.progress?.hintsRevealed ??
                activeSession.revealedHints,
              questionId: question.id,
              sessionId: activeSession.id,
              solved: response.progress?.solved ?? activeSession.solved,
              stepsRevealed:
                response.progress?.stepsRevealed ??
                activeSession.revealedSteps,
            }),
          );
          if (response.verdict === "correct") {
            setSolutionSteps(response.steps);
            markSolved(question.id);
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
    setShowTopicComplete(true);
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
  }

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
  const topicLabel = selectedTopic
    ? `Wk ${selectedTopic.weekNumber}`
    : "Practice";
  const positionLabel =
    questionPosition >= 0
      ? `${questionPosition + 1} of ${topicQuestions.length}`
      : undefined;
  const navQuestions = topicQuestions.map((question) => ({
    id: question.id,
    title: studentQuestionTitle(question.title),
  }));
  // A retired question keeps its attempts and loses its prompt and its input.
  const tombstone =
    sessionError &&
    (sessionError.code === "QUESTION_UNAVAILABLE" ||
      sessionError.code === "content_unpublished")
      ? sessionError.message
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
      disclosedHints,
      hasAnyQuestions: questions.length > 0,
      isLoadingQuestion,
      isReservePractice,
      isSessionLoading,
      isTutorBusy,
      lastSubmittedAnswer,
      messages,
      navQuestions,
      nextQuestion,
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
      dismissTopicComplete: () => setShowTopicComplete(false),
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
