"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronLeft,
  CircleHelp,
  Info,
  RotateCcw,
} from "lucide-react";

import {
  AI_HELP_REQUEST_TEXT,
  aiHelpMessageFor,
  aiHelpStateKey,
  appendAiHelpReply,
  createAiHelpGate,
  withoutEntry,
  type AiHelpGate,
} from "@/components/tutor/ai-help-request";
import { PracticeFooter } from "@/components/tutor/practice-footer";
import { PracticeMobileSheet } from "@/components/tutor/practice-mobile-sheet";
import {
  PracticeRail,
  practiceWeekLabel,
} from "@/components/tutor/practice-rail";
import { PracticeSheet } from "@/components/tutor/practice-sheet";
import { PracticeSimilarProblemAction } from "@/components/tutor/practice-similar-problem-action";
import { TutorDrawer } from "@/components/tutor/tutor-drawer";
import { QuestionSheetSkeleton } from "@/components/sheet/question-sheet";
import { ThreeColumn } from "@/components/shell/three-column";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
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
  shouldOfferSimilarPractice,
  storeTutorSessionId,
  TutorClientRequestError,
  type ChatMessage,
  type SessionErrorState,
} from "@/components/tutor/tutor-client";
import type { TutorSessionDto } from "@/lib/api/tutor-session-dto";
import {
  questionCode,
  studentDifficultyLabel,
  studentQuestionTitle,
} from "@/lib/labels";
import type {
  CourseTopic,
  SimilarPracticeSessionDto,
  StudentPracticeQuestion,
  TutorMode,
  TutorResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The tutor drawer's open/closed choice survives the next question and the
 * next visit. Read after mount only: the server render must not depend on it.
 */
export const TUTOR_DRAWER_STORAGE_KEY = "ai-tutor-tutor-drawer";

type PracticeWorkspaceProps = {
  aiHelpEnabled?: boolean;
  initialQuestionId?: string;
  initialSessionId?: string;
  initialTopicId?: string;
  questions: StudentPracticeQuestion[];
  topics: CourseTopic[];
};

// The tutor API client lives in ./tutor-client so the lightweight sheet hook
// can share it. Every name this module used to export is re-exported below so
// existing importers keep resolving.
export {
  chatMessageForResponse,
  createOrResumeTutorSession,
  nextQuestionAfter,
  recoveryMessages,
  requestTutorResponse,
  responseUsageStatusText,
  shouldOfferSimilarPractice,
  shouldShowRetrievedContext,
  SIGN_IN_REQUIRED_CODE,
  SIGN_IN_REQUIRED_MESSAGE,
  TutorClientRequestError,
} from "./tutor-client";
export type { ChatMessage, ChatMessageTone } from "./tutor-client";

export function PracticeWorkspace({
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
  const requestedTopicId =
    initialTopicId && topics.some((topic) => topic.id === initialTopicId)
      ? initialTopicId
      : undefined;
  // The question shown first. A specific question wins; a topic the student
  // chose deliberately stays inside that topic even when it has nothing to
  // practice yet (never silently swap to another topic); otherwise the first
  // available question, preferring the first listed topic.
  const startingQuestion =
    initialQuestion ??
    (requestedTopicId
      ? questions.find((question) => question.topicId === requestedTopicId)
      : (questions.find((question) => question.topicId === topics[0]?.id) ??
        questions[0]));
  // The selected topic always matches the displayed question, so progress
  // counts, Continue, and topic completion never mix two topics.
  const resolvedTopicId =
    startingQuestion?.topicId ?? requestedTopicId ?? topics[0]?.id ?? "";
  const [selectedTopicId, setSelectedTopicId] = useState(resolvedTopicId);
  // Which topics are expanded in the sidebar (VS Code-style tree — each topic
  // expands/collapses independently, decoupled from what's loaded in the chat).
  const [expandedTopicIds, setExpandedTopicIds] = useState<Set<string>>(
    () => new Set(resolvedTopicId ? [resolvedTopicId] : []),
  );
  const topicQuestions = useMemo(
    () => questions.filter((question) => question.topicId === selectedTopicId),
    [questions, selectedTopicId],
  );
  const [selectedQuestionId, setSelectedQuestionId] = useState(
    startingQuestion?.id ?? "",
  );
  const [reservePractice, setReservePractice] =
    useState<SimilarPracticeSessionDto | null>(null);
  const [resumeSession, setResumeSession] = useState<{
    questionId: string;
    sessionId: string;
  } | null>(null);
  const [isInitialSessionResolving, setIsInitialSessionResolving] = useState(
    Boolean(initialSessionId && !initialQuestion),
  );
  const [initialSessionFailed, setInitialSessionFailed] = useState(false);
  const selectedQuestion =
    (reservePractice?.question.id === selectedQuestionId
      ? reservePractice.question
      : undefined) ??
    questions.find((question) => question.id === selectedQuestionId);
  const selectedTopic =
    topics.find((topic) => topic.id === selectedQuestion?.topicId) ??
    topics.find((topic) => topic.id === selectedTopicId) ??
    topics[0];
  const [answer, setAnswer] = useState("");
  const [activeMode, setActiveMode] = useState<TutorMode | "ai" | null>(null);
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
  // The hint ladder shows every revealed hint at once, so nothing reads this
  // cursor today; the recovery and reveal handlers still maintain it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hintViewIndex, setHintViewIndex] = useState(0);
  const [solutionSteps, setSolutionSteps] = useState<string[]>([]);
  const [solvedQuestionIds, setSolvedQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showTopicComplete, setShowTopicComplete] = useState(false);
  const [search, setSearch] = useState("");
  // Layout state. The rail and the drawer collapse independently (NeetCode's
  // collapsed menu on the left, the Codecademy assistant panel on the right),
  // and the phone gets the same transcript as a bottom sheet.
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [tutorPrompt, setTutorPrompt] = useState("");
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mobileSheetTall, setMobileSheetTall] = useState(false);
  const [seenTutorMessageCount, setSeenTutorMessageCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // The Sheet owns the answer input, so the workspace holds the Sheet's
  // container and focuses the field inside it.
  const answerInputRef = useRef<HTMLDivElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  const selectedQuestionIdForSession = selectedQuestion?.id;
  const isTutorBusy = activeMode !== null || isSessionLoading;
  const canSend =
    Boolean(session) &&
    !session?.solved &&
    !isTutorBusy &&
    answer.trim().length > 0;
  const hintsExhausted = Boolean(
    selectedQuestion && hintCount >= selectedQuestion.hintCount,
  );
  const solutionFullyRevealed = Boolean(
    selectedQuestion &&
    selectedQuestion.stepCount > 0 &&
    session &&
    session.revealedSteps >= selectedQuestion.stepCount,
  );
  const lastVerdict = latestResponse?.verdict;
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
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages]);

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

  const applySessionSnapshot = useCallback(
    (snapshot: TutorSessionDto, question: StudentPracticeQuestion) => {
      const revealed = Math.min(snapshot.revealedHints, question.hintCount);
      setSession(snapshot);
      setMessages(recoveryMessages(snapshot, question));
      setDisclosedHints((snapshot.disclosedHints ?? []).slice(0, revealed));
      setHintCount(revealed);
      setHintViewIndex(Math.max(0, revealed - 1));
      setSolutionSteps(snapshot.disclosedSolutionSteps ?? []);
      if (snapshot.solved) {
        setSolvedQuestionIds((ids) => new Set(ids).add(question.id));
      }
    },
    [],
  );

  useEffect(() => {
    let isStale = false;

    async function loadSession() {
      setAnswer("");
      setLatestResponse(null);
      setLastAiHelpKey(null);
      setSession(null);
      setMessages([]);
      setDisclosedHints([]);
      setHintCount(0);
      setHintViewIndex(0);
      setSolutionSteps([]);
      setShowTopicComplete(false);

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
          reservePractice?.question.id === selectedQuestionIdForSession
            ? reservePractice.sessionId
            : resumeSession?.questionId === selectedQuestionIdForSession
              ? resumeSession.sessionId
              : selectedQuestionIdForSession === initialQuestionId
                ? initialSessionId
                : undefined,
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
    initialQuestionId,
    initialSessionId,
    initialSessionFailed,
    isInitialSessionResolving,
    reservePractice,
    resumeSession,
    selectedQuestion,
    selectedQuestionIdForSession,
  ]);

  function resetChat() {
    setMessages([]);
    setSeenTutorMessageCount(0);
    setDisclosedHints([]);
    setHintCount(0);
    setHintViewIndex(0);
    setSolutionSteps([]);
    setShowTopicComplete(false);
  }

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

  function selectQuestion(questionId: string, topicId: string) {
    setInitialSessionFailed(false);
    setReservePractice(null);
    setSelectedTopicId(topicId);
    setExpandedTopicIds((previous) => new Set(previous).add(topicId));
    setSelectedQuestionId(questionId);
    setAnswer("");
    setLatestResponse(null);
    resetChat();
  }

  /** The rail's topic switcher: land on the topic's first question, or on the
   * topic itself when it has nothing published yet (the empty-topic state). */
  function selectTopic(topicId: string) {
    const first = questions.find((question) => question.topicId === topicId);
    if (first) {
      selectQuestion(first.id, topicId);
      return;
    }
    setInitialSessionFailed(false);
    setReservePractice(null);
    setSelectedTopicId(topicId);
    setExpandedTopicIds((previous) => new Set(previous).add(topicId));
    setSelectedQuestionId("");
    setAnswer("");
    setLatestResponse(null);
    resetChat();
  }

  function toggleRail() {
    setRailCollapsed((collapsed) => !collapsed);
  }

  function toggleDrawer() {
    const next = !drawerOpen;
    setDrawerOpen(next);
    try {
      window.localStorage.setItem(
        TUTOR_DRAWER_STORAGE_KEY,
        next ? "open" : "closed",
      );
    } catch {
      // The choice simply does not survive the visit.
    }
  }

  function toggleMobileSheet() {
    const next = !mobileSheetOpen;
    setMobileSheetOpen(next);
    if (next) {
      setSeenTutorMessageCount(
        messages.filter((message) => message.role === "tutor").length,
      );
    }
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

  function openSimilarQuestion(practice: SimilarPracticeSessionDto) {
    setInitialSessionFailed(false);
    setReservePractice(practice);
    setSelectedTopicId(practice.question.topicId);
    setSelectedQuestionId(practice.question.id);
    setAnswer("");
    setLatestResponse(null);
    resetChat();
  }

  function continueToNextQuestion() {
    if (nextQuestion) {
      selectQuestion(nextQuestion.id, nextQuestion.topicId);
      return;
    }
    setShowTopicComplete(true);
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
      setHintViewIndex(Math.max(0, revealed - 1));
    } catch {
      // The transcript already shows the feedback; the hint panel refreshes on
      // the next hint request or page reload.
    }
  }

  function applyHintsFromResponse(
    response: TutorResponse,
    question: StudentPracticeQuestion,
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
      if (session) {
        void syncHintsFromSession(session.id, question);
      }
      return;
    }
    setDisclosedHints(response.hints.slice(0, revealed));
    setHintCount(revealed);
    setHintViewIndex(Math.max(0, revealed - 1));
  }

  async function sendAnswer() {
    const trimmed = answer.trim();

    if (!selectedQuestion || !session || activeMode || !trimmed) {
      return;
    }

    setActiveMode("check");
    setSessionError(null);
    pushMessage({ role: "student", text: trimmed });
    setAnswer("");

    try {
      const tutorResponse = await requestTutorResponse({
        answer: trimmed,
        mode: "check",
        questionId: selectedQuestion.id,
        sessionId: session.id,
        topicId: selectedQuestion.topicId,
      });

      setLatestResponse(tutorResponse);
      setSession((current) => sessionWithProgress(current, tutorResponse));
      applyHintsFromResponse(tutorResponse, selectedQuestion);
      pushMessage(chatMessageForResponse(tutorResponse));
      if (tutorResponse.verdict === "correct") {
        setSolutionSteps(tutorResponse.steps);
        setSolvedQuestionIds((ids) => new Set(ids).add(selectedQuestion.id));
        window.setTimeout(() => continueButtonRef.current?.focus(), 0);
      } else {
        focusAnswerInput();
      }
    } catch (error) {
      await handleTutorRequestFailure(error, trimmed);
      focusAnswerInput();
    } finally {
      setActiveMode(null);
    }
  }

  async function getHint() {
    if (!selectedQuestion || !session || hintsExhausted) {
      return;
    }

    setActiveMode("hint");
    setSessionError(null);

    try {
      const response = await requestTutorResponse({
        answer,
        mode: "hint",
        questionId: selectedQuestion.id,
        sessionId: session.id,
        topicId: selectedQuestion.topicId,
      });
      const next = Math.min(
        selectedQuestion.hintCount,
        response.progress?.hintsRevealed ?? hintCount + 1,
      );
      setDisclosedHints(response.hints.slice(0, next));
      setHintCount(next);
      setHintViewIndex(Math.max(0, next - 1));
      setLatestResponse(response);
      setSession((current) => sessionWithProgress(current, response));
      focusAnswerInput();
    } catch (error) {
      await handleTutorRequestFailure(error);
    } finally {
      setActiveMode(null);
    }
  }

  async function showAnswer() {
    if (!selectedQuestion || !session || activeMode || !hintsExhausted) {
      return;
    }

    setActiveMode("full_solution");
    setSessionError(null);

    try {
      const tutorResponse = await requestTutorResponse({
        answer,
        mode: "full_solution",
        questionId: selectedQuestion.id,
        sessionId: session.id,
        topicId: selectedQuestion.topicId,
      });

      setLatestResponse(tutorResponse);
      setSession((current) => sessionWithProgress(current, tutorResponse));
      setSolutionSteps(tutorResponse.steps);

      const total = tutorResponse.steps.length;
      setMessages((items) => [
        ...items,
        ...tutorResponse.steps.map((step, index) => ({
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
          text: tutorResponse.message,
          tone: "neutral" as const,
        },
      ]);
    } catch (error) {
      await handleTutorRequestFailure(error);
    } finally {
      setActiveMode(null);
    }
  }

  async function requestLimitedAiHelp(message?: string) {
    if (!selectedQuestion || !session || activeMode || aiHelpAlreadyGiven) {
      return;
    }

    const question = selectedQuestion;
    const activeSession = session;
    // The drawer's free-text field sends what the student typed there; the
    // chip sends their draft answer, exactly as before.
    const helpMessage = aiHelpMessageFor(message ?? answer);
    const gate = (aiHelpGateRef.current ??= createAiHelpGate());

    // The gate closes synchronously, so a second click that lands before
    // React re-renders the disabled button cannot start a second request.
    await gate.run(async () => {
      setActiveMode("ai");
      setSessionError(null);
      const requestId = createClientId("student");
      setMessages((items) => [
        ...items,
        { id: requestId, role: "student", text: AI_HELP_REQUEST_TEXT },
      ]);

      try {
        const tutorResponse = await requestTutorResponse({
          // The draft is context for the help, never a submission: the
          // server does not grade an aiHelp request.
          aiHelp: true,
          allowLlmFallback: true,
          answer: helpMessage,
          mode: "check",
          questionId: question.id,
          sessionId: activeSession.id,
          topicId: question.topicId,
        });

        setLatestResponse(tutorResponse);
        setSession((current) => sessionWithProgress(current, tutorResponse));
        setMessages((items) =>
          appendAiHelpReply(items, requestId, {
            ...chatMessageForResponse(tutorResponse),
            id: createClientId("tutor"),
          }),
        );
        setLastAiHelpKey(
          aiHelpStateKey({
            answer: helpMessage,
            attemptCount:
              tutorResponse.progress?.attemptCount ??
              activeSession.attemptCount + 1,
            hintsRevealed:
              tutorResponse.progress?.hintsRevealed ??
              activeSession.revealedHints,
            questionId: question.id,
            sessionId: activeSession.id,
            solved: tutorResponse.progress?.solved ?? activeSession.solved,
            stepsRevealed:
              tutorResponse.progress?.stepsRevealed ??
              activeSession.revealedSteps,
          }),
        );
        if (tutorResponse.verdict === "correct") {
          setSolutionSteps(tutorResponse.steps);
          setSolvedQuestionIds((ids) => new Set(ids).add(question.id));
        }
      } catch (error) {
        // Withdraw the pending request bubble so a retry never shows two
        // "Asked for AI help." entries for one reply.
        setMessages((items) => withoutEntry(items, requestId));
        await handleTutorRequestFailure(error);
      } finally {
        setActiveMode(null);
      }
    });
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
      setAnswer("");
      setLatestResponse(null);
      setLastAiHelpKey(null);
      setSession(nextSession);
      resetChat();
      focusAnswerInput();
    } catch (error) {
      setSessionError(sessionErrorFor(error));
    } finally {
      setIsSessionLoading(false);
    }
  }

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
  const canRevealHint = Boolean(session) && !session?.solved && !hintsExhausted;
  const canRevealStep = Boolean(
    session &&
    hintsExhausted &&
    selectedQuestion &&
    selectedQuestion.stepCount > 0 &&
    !solutionFullyRevealed,
  );

  const topicCompleteNotice = showTopicComplete ? (
    <div
      className="mr-auto w-full rounded-r-[6px] border-l-2 border-success bg-sheet px-3 py-3 text-sm text-sheet-foreground"
      role="status"
    >
      <p className="font-medium text-success">Topic complete</p>
      <p className="mt-1 leading-6 text-muted-foreground">
        You worked through every available question in{" "}
        {selectedTopic?.title ?? "this topic"}
        {topicQuestions.length > 0
          ? ` (${solvedInTopic} of ${topicQuestions.length} solved this visit)`
          : ""}
        . Choose what to do next.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="cta" className="rounded-[6px]">
          <Link href="/learn">
            Practice another topic
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline" className="rounded-[6px]">
          <Link href="/learn">Back to Learn</Link>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="rounded-[6px]"
          onClick={() => setShowTopicComplete(false)}
        >
          Stay on this question
        </Button>
      </div>
    </div>
  ) : null;

  const drawerProps = {
    activeMode,
    aiHelpAlreadyGiven,
    aiHelpEnabled,
    aiHelpOffered,
    busy: isTutorBusy,
    canCheck: canSend,
    canHint: canRevealHint,
    canStep: canRevealStep,
    hasSession: Boolean(session),
    loading: isLoadingQuestion,
    messages,
    notice: topicCompleteNotice,
    onAskAi: () => {
      void requestLimitedAiHelp();
    },
    onCheck: () => {
      void sendAnswer();
    },
    onHint: () => {
      void getHint();
    },
    onPromptChange: setTutorPrompt,
    onSendPrompt: sendTutorPrompt,
    onStep: () => {
      void showAnswer();
    },
    prompt: tutorPrompt,
  };

  const rail = (
    <PracticeRail
      collapsed={railCollapsed}
      disabled={isTutorBusy}
      nextQuestionId={nextQuestion?.id}
      onNextNew={continueToNextQuestion}
      onSearchChange={setSearch}
      onSelectQuestion={(questionId) =>
        selectQuestion(questionId, selectedTopicId)
      }
      onSelectTopic={selectTopic}
      onToggleCollapsed={toggleRail}
      openTopicCount={expandedTopicIds.size}
      questions={navQuestions}
      search={search}
      selectedQuestionId={selectedQuestionId}
      selectedTopicId={selectedTopic?.id ?? selectedTopicId}
      solvedQuestionIds={solvedQuestionIds}
      topics={topics}
      weekLabel={weekLabel}
    />
  );

  return (
    <>
      <ThreeColumn
        className="min-h-[calc(100svh-3.5rem)]"
        rail={rail}
        railCollapsed={railCollapsed}
        drawer={
          <TutorDrawer
            {...drawerProps}
            messagesEndRef={messagesEndRef}
            onCollapse={toggleDrawer}
          />
        }
        drawerOpen={drawerOpen}
      >
        <div
          className={cn(
            "flex flex-col gap-4 pb-20 xl:pb-0",
            drawerOpen ? undefined : "xl:pr-12",
          )}
        >
          <div className="flex items-center gap-2 lg:hidden">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="rounded-[6px] px-2"
            >
              <Link
                href={selectedTopic ? `/learn/${selectedTopic.id}` : "/learn"}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                <span className="font-mono text-xs">{topicLabel}</span>
              </Link>
            </Button>
            {questionPosition >= 0 ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {questionPosition + 1}/{topicQuestions.length}
              </span>
            ) : null}
            {navQuestions.length > 0 ? (
              <div className="ml-auto min-w-0">
                <label className="sr-only" htmlFor="practice-jump-to-question">
                  Jump to question
                </label>
                <NativeSelect
                  id="practice-jump-to-question"
                  className="h-8 max-w-44 rounded-[6px] text-xs"
                  value={selectedQuestionId}
                  disabled={isTutorBusy}
                  onChange={(event) =>
                    selectQuestion(event.target.value, selectedTopicId)
                  }
                >
                  {navQuestions.map((question, index) => (
                    <option key={question.id} value={question.id}>
                      {index + 1}. {question.title}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
          </div>

          {sessionError && !tombstone ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sheet px-4 py-3 text-sm text-sheet-foreground"
            >
              <span className="flex min-w-0 items-start gap-2">
                <Info
                  className="mt-0.5 size-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
                <span>{sessionError.message}</span>
              </span>
              {sessionError.signInHref ? (
                <Button asChild size="sm" className="rounded-[6px]">
                  <Link href={sessionError.signInHref}>Sign in</Link>
                </Button>
              ) : !session && !isSessionLoading ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-[6px]"
                  onClick={() => {
                    void restartTutorSession();
                  }}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Start a new attempt
                </Button>
              ) : null}
            </div>
          ) : null}

          {isReservePractice ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sheet px-4 py-3 text-sm text-sheet-foreground">
              <span>
                Extra practice. Solving this similar problem can count toward
                partial practice credit under your instructor&apos;s policy.
              </span>
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="rounded-[6px]"
              >
                <Link
                  href={
                    session?.originSessionId
                      ? `/practice?sessionId=${encodeURIComponent(session.originSessionId)}`
                      : "/practice"
                  }
                >
                  Back to course problems
                </Link>
              </Button>
            </div>
          ) : null}

          {isLoadingQuestion ? (
            <QuestionSheetSkeleton />
          ) : selectedQuestion ? (
            <PracticeSheet
              answer={answer}
              answerDisabled={
                !session || isSessionLoading || Boolean(session?.solved)
              }
              answerPlaceholder={selectedQuestion.inputFormatHint}
              // `sendAnswer` tracks the in-flight check in `activeMode`;
              // `isSessionLoading` covers loading a question, not checking one.
              checking={activeMode === "check"}
              containerRef={answerInputRef}
              continueButtonRef={continueButtonRef}
              continueDisabled={isTutorBusy}
              continueLabel={nextQuestion ? "Continue" : "Finish topic"}
              difficultyLabel={studentDifficultyLabel(
                selectedQuestion.difficulty,
              )}
              disclosedHints={disclosedHints}
              extraPractice={
                session && shouldOfferSimilarPractice(session) ? (
                  <PracticeSimilarProblemAction
                    key={session.id}
                    disabled={isTutorBusy}
                    sessionId={session.id}
                    onMatch={openSimilarQuestion}
                  />
                ) : null
              }
              feedbackKey={session?.id ?? selectedQuestion.id}
              footer={
                <PracticeFooter
                  disabled={isTutorBusy}
                  onSelect={(questionId) =>
                    selectQuestion(questionId, selectedTopicId)
                  }
                  questions={navQuestions}
                  selectedQuestionId={selectedQuestionId}
                  solvedQuestionIds={solvedQuestionIds}
                />
              }
              helper={selectedQuestion.inputFormatHint}
              hintCount={selectedQuestion.hintCount}
              hintRevealing={activeMode === "hint"}
              onAnswerChange={setAnswer}
              onCheck={() => {
                void sendAnswer();
              }}
              onContinue={continueToNextQuestion}
              onRevealHint={
                canRevealHint
                  ? () => {
                      void getHint();
                    }
                  : undefined
              }
              onRevealStep={
                canRevealStep
                  ? () => {
                      void showAnswer();
                    }
                  : undefined
              }
              onStartOver={() => {
                void restartTutorSession();
              }}
              positionLabel={positionLabel}
              prompt={selectedQuestion.prompt}
              questionCode={questionCode(selectedQuestion.id)}
              questionTitle={studentQuestionTitle(selectedQuestion.title)}
              sessionId={session?.id}
              solutionSteps={solutionSteps}
              solved={Boolean(session?.solved)}
              startOverDisabled={isTutorBusy || !session || isReservePractice}
              stepCount={selectedQuestion.stepCount}
              tombstone={tombstone}
              topicLabel={topicLabel}
              verdict={
                lastVerdict === "correct"
                  ? "correct"
                  : lastVerdict === "incorrect"
                    ? "incorrect"
                    : null
              }
            />
          ) : (
            <EmptyTopicState
              hasAnyQuestions={questions.length > 0}
              topicTitle={selectedTopic?.title}
            />
          )}
        </div>
      </ThreeColumn>

      {drawerOpen ? null : (
        <button
          type="button"
          aria-expanded={false}
          aria-label="Open the tutor"
          onClick={toggleDrawer}
          className="fixed top-14 right-0 z-30 hidden h-[calc(100svh-3.5rem)] w-12 items-center justify-center border-l border-border bg-sheet text-sheet-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 xl:flex"
        >
          <span className="font-mono text-xs tracking-wide [writing-mode:vertical-rl]">
            Tutor
          </span>
        </button>
      )}

      <PracticeMobileSheet
        newCount={unseenTutorMessages}
        onToggleHeight={toggleMobileSheetHeight}
        onToggleOpen={toggleMobileSheet}
        open={mobileSheetOpen}
        tall={mobileSheetTall}
      >
        <TutorDrawer {...drawerProps} />
      </PracticeMobileSheet>
    </>
  );
}

/**
 * A topic with nothing published yet. The copy is unchanged from the first
 * build — it already said the right thing — and it now sits on a sheet.
 */
function EmptyTopicState({
  hasAnyQuestions,
  topicTitle,
}: {
  hasAnyQuestions: boolean;
  topicTitle?: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg bg-sheet p-6 text-sheet-foreground sm:p-8">
      <h1 className="flex items-center gap-2 font-display text-xl leading-8 font-normal">
        <CircleHelp
          className="size-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        No practice questions are available for this topic yet.
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        {topicTitle ? `${topicTitle} has ` : "This topic has "}
        nothing to practice right now. Questions appear here once your professor
        makes them available, so check back soon.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="cta" className="rounded-[6px]">
          <Link href="/learn">
            {hasAnyQuestions ? "Choose another topic" : "Browse topics"}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="rounded-[6px]">
          <Link href="/learn">Back to Learn</Link>
        </Button>
      </div>
    </div>
  );
}
