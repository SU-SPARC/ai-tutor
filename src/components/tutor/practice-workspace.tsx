"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  ChartNoAxesColumn,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  Info,
  Lightbulb,
  Loader2,
  PartyPopper,
  RotateCcw,
  Search,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";

import { MathText } from "@/components/math/math-renderer";
import { QuestionFeedbackForm } from "@/components/tutor/question-feedback-form";
import { PracticeSimilarProblemAction } from "@/components/tutor/practice-similar-problem-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { anonymousTutorSessionStorageKey } from "@/lib/auth/anonymous-student";
import { signInPath } from "@/lib/auth/return-path";
import type { TutorSessionDto } from "@/lib/api/tutor-session-dto";
import type {
  CourseTopic,
  SimilarPracticeSessionDto,
  StudentPracticeQuestion,
  TutorMode,
  TutorResponse,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type PracticeWorkspaceProps = {
  aiHelpEnabled?: boolean;
  initialQuestionId?: string;
  initialSessionId?: string;
  initialTopicId?: string;
  questions: StudentPracticeQuestion[];
  topics: CourseTopic[];
};

export type ChatMessageTone =
  | "correct"
  | "incorrect"
  | "guidance"
  | "notice"
  | "neutral";

export type ChatMessage = {
  id: string;
  label?: string;
  note?: string;
  role: "student" | "tutor";
  stepLabel?: string;
  text: string;
  tone?: ChatMessageTone;
};

type SessionErrorState = {
  code?: string;
  message: string;
  signInHref?: string;
};

type TutorSessionPayload = {
  code?: string;
  error?: string;
  session?: TutorSessionDto;
};

type TutorErrorPayload = {
  code?: string;
  error?: string;
};

const SAFE_TUTOR_ERROR_CODES = new Set([
  "MALFORMED_TUTOR_REQUEST",
  "MALFORMED_TUTOR_SESSION_REQUEST",
  "QUESTION_UNAVAILABLE",
  "TUTOR_AI_IN_PROGRESS",
  "TUTOR_ENDPOINT_RETIRED",
  "TUTOR_RATE_LIMITED",
  "TUTOR_REQUEST_INTERRUPTED",
  "TUTOR_REQUEST_TOO_LARGE",
  "TUTOR_SESSION_COMPLETE",
  "TUTOR_SESSION_STALE",
  "TUTOR_SESSION_UNAVAILABLE",
]);

export const SIGN_IN_REQUIRED_CODE = "SIGN_IN_REQUIRED";
export const SIGN_IN_REQUIRED_MESSAGE =
  "Sign in to start practicing. Your progress is saved to your account.";
const UNREADABLE_MESSAGE_PREFIX = "I could not read";

export class TutorClientRequestError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly status: number;

  constructor(
    message: string,
    options: { code?: string; requestId?: string; status: number },
  ) {
    super(message);
    this.name = "TutorClientRequestError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

/**
 * Picks the question a student should move to after finishing the current
 * one: the next unsolved question later in the topic list, then any earlier
 * unsolved question, otherwise nothing (the topic is complete).
 */
export function nextQuestionAfter<
  Question extends Pick<StudentPracticeQuestion, "id">,
>(
  currentQuestionId: string | undefined,
  topicQuestions: Question[],
  solvedQuestionIds: ReadonlySet<string>,
): Question | undefined {
  const index = topicQuestions.findIndex(
    (question) => question.id === currentQuestionId,
  );
  const later = topicQuestions
    .slice(index + 1)
    .find((question) => !solvedQuestionIds.has(question.id));
  if (later) {
    return later;
  }
  return topicQuestions.find(
    (question, position) =>
      position !== index && !solvedQuestionIds.has(question.id),
  );
}

/**
 * Translates a tutor response into the transcript entry the student sees.
 * Format guidance ("I could not read that…") and blocked help are shown as
 * notices, never as wrong attempts, matching the engine, which does not count
 * them as incorrect.
 */
export function chatMessageForResponse(
  response: Pick<TutorResponse, "message" | "misconceptions" | "verdict">,
): Omit<ChatMessage, "id"> {
  if (response.verdict === "correct") {
    return {
      label: "Correct",
      role: "tutor",
      text: response.message,
      tone: "correct",
    };
  }

  if (response.verdict === "incorrect") {
    return {
      label: "Not quite",
      note: response.misconceptions[0],
      role: "tutor",
      text: stripNotQuitePrefix(response.message),
      tone: "incorrect",
    };
  }

  if (response.verdict === "blocked") {
    return {
      label: "Extra help is unavailable right now",
      role: "tutor",
      text: response.message,
      tone: "notice",
    };
  }

  const unreadable = response.message.startsWith(UNREADABLE_MESSAGE_PREFIX);
  return {
    label: unreadable ? "Couldn't read that answer" : undefined,
    note: unreadable
      ? "This was not marked wrong. Retype it in a readable form and check again."
      : undefined,
    role: "tutor",
    text: response.message,
    tone: "guidance",
  };
}

function stripNotQuitePrefix(message: string) {
  const stripped = message.replace(/^not quite[.!]?\s*/i, "").trim();
  return stripped.length > 0 ? stripped : "Give it another try.";
}

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
  // Topic-first entry (arriving from the Topics page via ?topicId=…): the user
  // already picked a topic there, so the sidebar shows just that topic's
  // problems as a flat list — no need to re-navigate the whole topic tree.
  const isTopicFirstEntry =
    !initialQuestion &&
    Boolean(initialTopicId) &&
    topics.some((topic) => topic.id === initialTopicId);
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
  const [session, setSession] = useState<TutorSessionDto | null>(null);
  const [sessionError, setSessionError] = useState<SessionErrorState | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [disclosedHints, setDisclosedHints] = useState<string[]>([]);
  const [hintCount, setHintCount] = useState(0);
  const [hintViewIndex, setHintViewIndex] = useState(0);
  const [solutionSteps, setSolutionSteps] = useState<string[]>([]);
  const [solvedQuestionIds, setSolvedQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showTopicComplete, setShowTopicComplete] = useState(false);
  const [search, setSearch] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const answerInputRef = useRef<HTMLTextAreaElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const answerInputId = useId();
  const answerFormatHintId = useId();

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
  const hintsRemaining = selectedQuestion
    ? Math.max(0, selectedQuestion.hintCount - hintCount)
    : 0;
  const solutionFullyRevealed = Boolean(
    selectedQuestion &&
      selectedQuestion.stepCount > 0 &&
      session &&
      session.revealedSteps >= selectedQuestion.stepCount,
  );
  const lastVerdict = latestResponse?.verdict;
  const searchQuery = search.trim().toLowerCase();
  const isSearching = searchQuery.length > 0;
  const visibleTopics = isSearching
    ? topics.filter(
        (topic) =>
          topic.title.toLowerCase().includes(searchQuery) ||
          questions.some(
            (question) =>
              question.topicId === topic.id &&
              question.title.toLowerCase().includes(searchQuery),
          ),
      )
    : topics;
  const topicFirstProblems = isSearching
    ? topicQuestions.filter((question) =>
        question.title.toLowerCase().includes(searchQuery),
      )
    : topicQuestions;
  const questionPosition = topicQuestions.findIndex(
    (question) => question.id === selectedQuestion?.id,
  );
  const solvedInTopic = topicQuestions.filter((question) =>
    solvedQuestionIds.has(question.id),
  ).length;
  const nextQuestion = useMemo(
    () =>
      nextQuestionAfter(selectedQuestion?.id, topicQuestions, solvedQuestionIds),
    [selectedQuestion?.id, solvedQuestionIds, topicQuestions],
  );
  const isReservePractice = session?.practiceContext === "reserve_practice";

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
    window.setTimeout(() => answerInputRef.current?.focus(), 0);
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

  function toggleTopic(topicId: string) {
    setExpandedTopicIds((previous) => {
      const next = new Set(previous);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
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

  async function syncHintsFromSession(sessionId: string, question: StudentPracticeQuestion) {
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
    if (response.misconceptions.length > 0 || response.hints.length < revealed) {
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

  async function requestLimitedAiHelp() {
    const trimmed = answer.trim() || "I'm stuck and not sure how to proceed.";

    if (!selectedQuestion || !session || activeMode) {
      return;
    }

    setActiveMode("ai");
    setSessionError(null);
    pushMessage({ role: "student", text: "Asked for AI help." });

    try {
      const tutorResponse = await requestTutorResponse({
        allowLlmFallback: true,
        answer: trimmed,
        mode: "check",
        questionId: selectedQuestion.id,
        sessionId: session.id,
        topicId: selectedQuestion.topicId,
      });

      setLatestResponse(tutorResponse);
      setSession((current) => sessionWithProgress(current, tutorResponse));
      const message = chatMessageForResponse(tutorResponse);
      pushMessage({
        ...message,
        text:
          tutorResponse.source === "retrieval" && tutorResponse.hints[0]
            ? `${tutorResponse.message} ${tutorResponse.hints[0]}`
            : message.text,
      });
      if (tutorResponse.verdict === "correct") {
        setSolutionSteps(tutorResponse.steps);
        setSolvedQuestionIds((ids) => new Set(ids).add(selectedQuestion.id));
      }
    } catch (error) {
      await handleTutorRequestFailure(error);
    } finally {
      setActiveMode(null);
    }
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
      setSession(nextSession);
      resetChat();
      focusAnswerInput();
    } catch (error) {
      setSessionError(sessionErrorFor(error));
    } finally {
      setIsSessionLoading(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendAnswer();
    }
  }

  const navigationLinks = (
    <div className="flex flex-wrap items-center gap-1 text-sm">
      <Button asChild variant="ghost" size="sm">
        <Link href="/topics">
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          All topics
        </Link>
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href="/dashboard">
          <ChartNoAxesColumn className="h-4 w-4" aria-hidden="true" />
          Your progress
        </Link>
      </Button>
    </div>
  );

  return (
    <main className="min-h-svh bg-background lg:h-[calc(100svh-3.5rem)] lg:min-h-0 lg:overflow-hidden">
      <section className="mx-auto grid w-full max-w-[90rem] gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:h-full lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6 lg:overflow-hidden">
        <aside className="order-2 flex flex-col gap-3 lg:order-1 lg:h-[calc(100svh-6.5rem)] lg:min-h-0">
          <div className="hidden lg:block">{navigationLinks}</div>

          <Card className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base">
                {isTopicFirstEntry
                  ? "Problems in this topic"
                  : "Topics and problems"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
              <div className="relative mb-2">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={
                    isTopicFirstEntry
                      ? "Search problems…"
                      : "Search topics or problems…"
                  }
                  aria-label={
                    isTopicFirstEntry
                      ? "Search problems"
                      : "Search topics or problems"
                  }
                  className="h-9 px-8"
                />
                {search ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch("")}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
              <div className="flex max-h-[45vh] flex-col gap-1 overflow-y-auto pr-1 lg:max-h-none lg:min-h-0 lg:flex-1">
                {isTopicFirstEntry ? (
                  topicFirstProblems.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      {isSearching
                        ? `No matches for “${search.trim()}”.`
                        : "No practice questions are available for this topic yet."}
                    </p>
                  ) : (
                    topicFirstProblems.map((problem) => (
                      <ProblemButton
                        key={problem.id}
                        active={problem.id === selectedQuestionId}
                        disabled={isTutorBusy}
                        onClick={() =>
                          selectQuestion(problem.id, selectedTopicId)
                        }
                        solved={solvedQuestionIds.has(problem.id)}
                        title={problem.title}
                      />
                    ))
                  )
                ) : visibleTopics.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    No matches for “{search.trim()}”.
                  </p>
                ) : (
                  visibleTopics.map((topic) => {
                    const topicMatches = topic.title
                      .toLowerCase()
                      .includes(searchQuery);
                    const topicProblems = questions.filter(
                      (question) => question.topicId === topic.id,
                    );
                    const problems =
                      isSearching && !topicMatches
                        ? topicProblems.filter((question) =>
                            question.title.toLowerCase().includes(searchQuery),
                          )
                        : topicProblems;
                    const isOpen = isSearching
                      ? true
                      : expandedTopicIds.has(topic.id);
                    return (
                      <div key={topic.id}>
                        <Button
                          type="button"
                          variant={isOpen ? "secondary" : "ghost"}
                          className="h-auto w-full justify-start gap-2 py-2.5 text-left whitespace-normal"
                          aria-expanded={isOpen}
                          onClick={() => toggleTopic(topic.id)}
                        >
                          {isOpen ? (
                            <ChevronDown
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          ) : (
                            <ChevronRight
                              className="h-4 w-4 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          )}
                          <span className="min-w-0 flex-1">{topic.title}</span>
                          <span className="shrink-0 text-xs font-normal text-muted-foreground">
                            {topicProblems.length}
                          </span>
                        </Button>
                        {isOpen ? (
                          <div className="mt-1 ml-4 flex flex-col gap-1 border-l pl-2">
                            {problems.length > 0 ? (
                              problems.map((problem) => (
                                <ProblemButton
                                  key={problem.id}
                                  active={problem.id === selectedQuestionId}
                                  disabled={isTutorBusy}
                                  onClick={() =>
                                    selectQuestion(problem.id, topic.id)
                                  }
                                  solved={solvedQuestionIds.has(problem.id)}
                                  title={problem.title}
                                />
                              ))
                            ) : (
                              <p className="px-2 py-1 text-xs text-muted-foreground">
                                No practice questions yet.
                              </p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </aside>

        <div className="order-1 flex min-w-0 flex-col gap-3 lg:order-2 lg:h-[calc(100svh-6.5rem)]">
          <div className="lg:hidden">{navigationLinks}</div>

          {selectedQuestion ? (
            <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card lg:overflow-hidden">
              <div className="border-b px-4 py-4 sm:px-5 lg:max-h-[45svh] lg:overflow-y-auto">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {selectedTopic?.title}
                  </span>
                  {isReservePractice ? (
                    <Badge variant="success">Extra practice</Badge>
                  ) : questionPosition >= 0 ? (
                    <span className="tabular-nums">
                      Question {questionPosition + 1} of {topicQuestions.length}
                      {solvedInTopic > 0 ? ` · ${solvedInTopic} solved` : ""}
                    </span>
                  ) : null}
                  <Badge variant="outline">{selectedQuestion.difficultyLabel}</Badge>
                  <div className="ml-auto flex items-center gap-1">
                    <QuestionFeedbackForm
                      key={session?.id ?? selectedQuestion.id}
                      questionTitle={selectedQuestion.title}
                      sessionId={session?.id}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title="Start this question over"
                      aria-label="Start this question over"
                      disabled={isTutorBusy || !session || isReservePractice}
                      onClick={() => {
                        void restartTutorSession();
                      }}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Start over</span>
                    </Button>
                  </div>
                </div>
                <h1 className="mt-3 text-lg leading-7 font-semibold sm:text-xl">
                  {selectedQuestion.title}
                </h1>
                <div className="mt-2 text-base leading-7">
                  <MathText>{selectedQuestion.prompt}</MathText>
                </div>
              </div>

              {isReservePractice ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-success/5 px-4 py-2 text-sm sm:px-5">
                  <span>
                    Extra practice. This problem does not count toward your
                    assigned practice.
                  </span>
                  <Button asChild size="sm" variant="ghost">
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

              <div
                className="flex max-h-[55svh] min-h-32 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-5 lg:max-h-none lg:min-h-0 lg:flex-1"
                role="log"
                aria-live="polite"
                aria-label="Tutor conversation"
              >
                {isSessionLoading ? (
                  <p className="m-auto flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                    Getting this question ready…
                  </p>
                ) : messages.length === 0 ? (
                  <p className="m-auto max-w-sm text-center text-sm leading-6 text-muted-foreground">
                    Work out your answer and type it below. You can ask for a
                    hint at any time.
                  </p>
                ) : (
                  messages.map((message) => (
                    <ChatBubble key={message.id} message={message} />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {!session?.solved && hintCount > 0 && disclosedHints[hintViewIndex] ? (
                <div className="border-t px-4 py-3 sm:px-5">
                  <div className="flex gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
                    <Lightbulb
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          Hint {hintViewIndex + 1} of {selectedQuestion.hintCount}
                          {hintsRemaining > 0
                            ? ` · ${hintsRemaining} more available`
                            : ""}
                        </span>
                        {hintCount > 1 ? (
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Previous hint"
                              disabled={hintViewIndex === 0}
                              onClick={() =>
                                setHintViewIndex((index) =>
                                  Math.max(0, index - 1),
                                )
                              }
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-label="Next hint"
                              disabled={hintViewIndex >= hintCount - 1}
                              onClick={() =>
                                setHintViewIndex((index) =>
                                  Math.min(hintCount - 1, index + 1),
                                )
                              }
                            >
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      <div className="leading-6">
                        <MathText>{disclosedHints[hintViewIndex] ?? ""}</MathText>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {sessionError ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 border-t bg-warning/5 px-4 py-3 text-sm sm:px-5"
                >
                  <span className="flex min-w-0 items-start gap-2">
                    <Info
                      className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                    <span>{sessionError.message}</span>
                  </span>
                  {sessionError.signInHref ? (
                    <Button asChild size="sm">
                      <Link href={sessionError.signInHref}>Sign in</Link>
                    </Button>
                  ) : !session && !isSessionLoading ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void restartTutorSession();
                      }}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Start a new attempt
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {showTopicComplete ? (
                <TopicCompletePanel
                  onPracticeAgain={() => setShowTopicComplete(false)}
                  solvedCount={solvedInTopic}
                  topicTitle={selectedTopic?.title ?? "this topic"}
                  totalCount={topicQuestions.length}
                />
              ) : session?.solved ? (
                <div
                  className="border-t bg-success/5 px-4 py-4 sm:px-5"
                  role="status"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="flex items-center gap-2 font-medium">
                      <CheckCircle2
                        className="h-5 w-5 text-success"
                        aria-hidden="true"
                      />
                      Solved. Nice work.
                    </p>
                    <Button
                      ref={continueButtonRef}
                      type="button"
                      variant="cta"
                      disabled={isTutorBusy}
                      onClick={continueToNextQuestion}
                    >
                      {nextQuestion ? "Continue" : "Finish topic"}
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                  {solutionSteps.length > 0 ? (
                    <details className="mt-3 rounded-md border bg-card text-sm">
                      <summary className="cursor-pointer px-3 py-2 font-medium">
                        Show the worked solution
                      </summary>
                      <ol className="max-h-56 list-decimal space-y-2 overflow-y-auto px-3 pb-3 pl-8 leading-6">
                        {solutionSteps.map((step, index) => (
                          <li key={index}>
                            <MathText>{step}</MathText>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                  <div className="mt-3 border-t pt-3">
                    <PracticeSimilarProblemAction
                      key={session.id}
                      disabled={isTutorBusy}
                      sessionId={session.id}
                      onMatch={openSimilarQuestion}
                    />
                  </div>
                </div>
              ) : (
                <div className="border-t px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <label
                      htmlFor={answerInputId}
                      className="text-sm font-medium"
                    >
                      {lastVerdict === "incorrect"
                        ? "Try again"
                        : "Your answer"}
                    </label>
                    <p
                      id={answerFormatHintId}
                      className="text-xs leading-5 text-muted-foreground"
                    >
                      {selectedQuestion.inputFormatHint} Press Enter to check.
                    </p>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Textarea
                      id={answerInputId}
                      ref={answerInputRef}
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      onKeyDown={handleComposerKeyDown}
                      aria-describedby={answerFormatHintId}
                      placeholder="Type your answer…"
                      rows={2}
                      disabled={!session || isSessionLoading}
                      className="min-h-0 resize-none"
                    />
                    <Button
                      type="button"
                      variant="cta"
                      className="w-full sm:w-auto"
                      disabled={!canSend}
                      onClick={() => {
                        void sendAnswer();
                      }}
                    >
                      {activeMode === "check" ? (
                        <Loader2
                          className="h-4 w-4 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      )}
                      Check answer
                    </Button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {!hintsExhausted ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isTutorBusy || !session}
                        onClick={() => {
                          void getHint();
                        }}
                      >
                        {activeMode === "hint" ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Lightbulb className="h-4 w-4" aria-hidden="true" />
                        )}
                        Get a hint
                        {selectedQuestion.hintCount > 0 ? (
                          <span className="text-xs text-muted-foreground">
                            ({hintsRemaining} left)
                          </span>
                        ) : null}
                      </Button>
                    ) : selectedQuestion.stepCount > 0 && !solutionFullyRevealed ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isTutorBusy || !session}
                        onClick={() => {
                          void showAnswer();
                        }}
                      >
                        {activeMode === "full_solution" ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                        Show the worked solution
                      </Button>
                    ) : null}
                    {aiHelpEnabled && latestResponse?.usage.llmFallbackEligible ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isTutorBusy || !session}
                        onClick={() => {
                          void requestLimitedAiHelp();
                        }}
                      >
                        {activeMode === "ai" ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Sparkles className="h-4 w-4" aria-hidden="true" />
                        )}
                        Ask AI for help
                      </Button>
                    ) : null}
                    {solutionFullyRevealed ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        disabled={isTutorBusy}
                        onClick={continueToNextQuestion}
                      >
                        {nextQuestion ? "Next question" : "Finish topic"}
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyTopicState
              hasAnyQuestions={questions.length > 0}
              topicTitle={selectedTopic?.title}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function ProblemButton({
  active,
  disabled,
  onClick,
  solved,
  title,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  solved: boolean;
  title: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "ghost"}
      className="h-auto w-full justify-start gap-2 py-2 text-left whitespace-normal"
      aria-current={active ? "true" : undefined}
      aria-label={solved ? `${title} (solved)` : title}
      disabled={disabled}
      onClick={onClick}
    >
      {solved ? (
        <CheckCircle2
          className={cn(
            "h-4 w-4 shrink-0",
            active ? "text-primary-foreground" : "text-success",
          )}
          aria-hidden="true"
        />
      ) : null}
      <span className="min-w-0 flex-1">{title}</span>
    </Button>
  );
}

function EmptyTopicState({
  hasAnyQuestions,
  topicTitle,
}: {
  hasAnyQuestions: boolean;
  topicTitle?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CircleHelp className="h-5 w-5 text-primary" aria-hidden="true" />
          No practice questions are available for this topic yet.
        </CardTitle>
        <CardDescription className="leading-6">
          {topicTitle ? `${topicTitle} has ` : "This topic has "}
          nothing to practice right now. Questions appear here once your
          professor makes them available, so check back soon.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button asChild variant="cta">
          <Link href="/topics">
            {hasAnyQuestions ? "Choose another topic" : "Browse topics"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Return to dashboard</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function TopicCompletePanel({
  onPracticeAgain,
  solvedCount,
  topicTitle,
  totalCount,
}: {
  onPracticeAgain: () => void;
  solvedCount: number;
  topicTitle: string;
  totalCount: number;
}) {
  return (
    <div className="border-t bg-success/5 px-4 py-5 sm:px-5" role="status">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <PartyPopper className="h-5 w-5 text-success" aria-hidden="true" />
        Topic complete
      </h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        You worked through every available question in {topicTitle}
        {totalCount > 0
          ? ` (${solvedCount} of ${totalCount} solved this visit)`
          : ""}
        . Choose what to do next.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="cta">
          <Link href="/topics">
            Practice another topic
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Return to dashboard</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={onPracticeAgain}>
          Stay on this question
        </Button>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === "student") {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap">
        <span className="sr-only">You answered: </span>
        {message.text}
      </div>
    );
  }

  const tone = message.tone ?? "neutral";
  const Icon =
    tone === "correct"
      ? CheckCircle2
      : tone === "incorrect"
        ? XCircle
        : tone === "guidance" || tone === "notice"
          ? Info
          : undefined;

  return (
    <div
      className={cn(
        "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border bg-muted/40 px-4 py-2.5 text-sm",
        tone === "correct" && "border-success/50 bg-success/5",
        tone === "incorrect" && "border-destructive/40",
        tone === "guidance" && "border-primary/30 bg-primary/5",
        tone === "notice" && "border-warning/40 bg-warning/5",
      )}
    >
      {message.stepLabel ? (
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {message.stepLabel}
        </div>
      ) : null}
      {message.label ? (
        <div
          className={cn(
            "mb-1 inline-flex items-center gap-1 font-medium",
            tone === "correct" && "text-success",
            tone === "incorrect" && "text-destructive",
            tone === "guidance" && "text-primary",
            tone === "notice" && "text-warning",
          )}
        >
          {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
          {message.label}
        </div>
      ) : null}
      <div className="leading-6">
        <MathText>{message.text}</MathText>
      </div>
      {message.note ? (
        <div
          className={cn(
            "mt-2 rounded-md border p-2 text-xs leading-5 text-muted-foreground",
            tone === "incorrect" && "border-destructive/30 bg-destructive/5",
            tone !== "incorrect" && "border-primary/20 bg-primary/5",
          )}
        >
          <MathText>{message.note}</MathText>
        </div>
      ) : null}
    </div>
  );
}

export async function createOrResumeTutorSession(
  questionId: string,
  preferredSessionId?: string,
) {
  if (preferredSessionId) {
    try {
      const preferredSession = await fetchTutorSession(preferredSessionId);

      if (preferredSession.questionId === questionId) {
        storeTutorSessionId(questionId, preferredSession.id);
        return preferredSession;
      }
    } catch (error) {
      // The session may be expired, unpublished, or owned by someone else.
      // Fall back without revealing which condition applied.
      if (!canReplaceUnavailableSession(error)) {
        throw error;
      }
    }
  }

  const storedSessionId = readTutorSessionId(questionId);

  if (storedSessionId) {
    try {
      const session = await fetchTutorSession(storedSessionId);

      if (session.questionId === questionId) {
        return session;
      }
    } catch (error) {
      if (!canReplaceUnavailableSession(error)) {
        throw error;
      }
      clearTutorSessionId(questionId);
    }
  }

  const session = await createTutorSession(questionId);
  storeTutorSessionId(questionId, session.id);
  return session;
}

function readTutorSessionId(questionId: string) {
  try {
    return window.localStorage.getItem(
      anonymousTutorSessionStorageKey(questionId),
    );
  } catch {
    return null;
  }
}

function storeTutorSessionId(questionId: string, sessionId: string) {
  try {
    window.localStorage.setItem(
      anonymousTutorSessionStorageKey(questionId),
      sessionId,
    );
  } catch {
    // The server session remains usable even if browser continuity storage is
    // unavailable or full.
  }
}

function clearTutorSessionId(questionId: string) {
  try {
    window.localStorage.removeItem(anonymousTutorSessionStorageKey(questionId));
  } catch {
    // A stale local value is harmless because ownership is checked server-side.
  }
}

async function createTutorSession(
  questionId: string,
  options: { forceNew?: boolean } = {},
) {
  const idempotencyKey = pendingSessionCreationKey(
    questionId,
    options.forceNew,
  );
  const result = await retryTutorRequest(() =>
    fetch("/api/tutor/session", {
      body: JSON.stringify({
        idempotencyKey,
        questionId,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  const session = await readTutorSessionPayload(result);
  clearPendingSessionCreationKey(questionId, idempotencyKey);
  return session;
}

async function fetchTutorSession(sessionId: string) {
  const result = await retryTutorRequest(() =>
    fetch(`/api/tutor/session/${sessionId}`),
  );
  return readTutorSessionPayload(result);
}

export async function requestTutorResponse(input: {
  allowLlmFallback?: boolean;
  answer: string;
  mode: TutorMode;
  questionId: string;
  sessionId: string;
  topicId: string;
}) {
  const eventId = pendingTutorEventId(input);
  const result = await retryTutorRequest(() =>
    fetch("/api/tutor/respond", {
      body: JSON.stringify({ ...input, eventId }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    }),
  );
  const payload = (await result
    .json()
    .catch(() => ({}))) as Partial<TutorResponse> & TutorErrorPayload;

  if (!result.ok || !payload.verdict) {
    if (result.status < 500) {
      clearPendingTutorEventId(input.sessionId, eventId);
    }
    throw tutorClientError(
      result,
      payload,
      "The tutor could not complete this request. Please try again.",
    );
  }

  clearPendingTutorEventId(input.sessionId, eventId);
  return payload as TutorResponse;
}

async function retryTutorRequest(request: () => Promise<Response>) {
  let lastResponse: Response | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await request();
      if (response.status < 500 || attempt === 1) {
        return response;
      }
      lastResponse = response;
    } catch {
      if (attempt === 1) {
        throw new TutorClientRequestError(
          "The connection was interrupted. We could not confirm whether the request reached the tutor. Reopen this session before resubmitting so any saved progress can be recovered.",
          { code: "NETWORK_INTERRUPTED", status: 0 },
        );
      }
    }
  }

  return lastResponse!;
}

async function readTutorSessionPayload(result: Response) {
  const payload = (await result
    .json()
    .catch(() => ({}))) as TutorSessionPayload;

  if (!result.ok || !payload.session) {
    throw tutorClientError(
      result,
      payload,
      "The tutor session could not be loaded safely. Please try again.",
    );
  }

  return payload.session;
}

function tutorClientError(
  response: Response,
  payload: TutorErrorPayload,
  fallbackMessage: string,
) {
  if (response.status === 401) {
    return new TutorClientRequestError(SIGN_IN_REQUIRED_MESSAGE, {
      code: SIGN_IN_REQUIRED_CODE,
      requestId: response.headers.get("x-request-id") ?? undefined,
      status: response.status,
    });
  }
  const message =
    response.status >= 500
      ? "The tutor is temporarily unavailable. Nothing was saved from that request. Please try again shortly."
      : response.status >= 400 &&
          payload.code &&
          SAFE_TUTOR_ERROR_CODES.has(payload.code) &&
          typeof payload.error === "string"
        ? payload.error
        : fallbackMessage;
  return new TutorClientRequestError(message, {
    code: payload.code,
    requestId: response.headers.get("x-request-id") ?? undefined,
    status: response.status,
  });
}

function canReplaceUnavailableSession(error: unknown) {
  return (
    error instanceof TutorClientRequestError &&
    error.status === 404 &&
    (!error.code || error.code === "TUTOR_SESSION_UNAVAILABLE")
  );
}

function pendingSessionCreationKey(questionId: string, forceNew = false) {
  const storageKey = `ai-tutor:pending-session:${questionId}`;
  try {
    const existing = forceNew ? null : window.localStorage.getItem(storageKey);
    const idempotencyKey = existing || createClientId("session");
    window.localStorage.setItem(storageKey, idempotencyKey);
    return idempotencyKey;
  } catch {
    return createClientId("session");
  }
}

function clearPendingSessionCreationKey(
  questionId: string,
  idempotencyKey: string,
) {
  const storageKey = `ai-tutor:pending-session:${questionId}`;
  try {
    if (window.localStorage.getItem(storageKey) === idempotencyKey) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // A missing browser store does not affect the durable server session.
  }
}

function pendingTutorEventId(input: {
  allowLlmFallback?: boolean;
  answer: string;
  mode: TutorMode;
  questionId: string;
  sessionId: string;
}) {
  const storageKey = `ai-tutor:pending-event:${input.sessionId}`;
  const fingerprint = clientInputFingerprint(
    JSON.stringify({
      allowLlmFallback: Boolean(input.allowLlmFallback),
      answer: input.answer,
      mode: input.mode,
      questionId: input.questionId,
    }),
  );
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    ) as { eventId?: unknown; fingerprint?: unknown } | null;
    if (
      stored &&
      stored.fingerprint === fingerprint &&
      typeof stored.eventId === "string"
    ) {
      return stored.eventId;
    }
    const eventId = createClientId("event");
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ eventId, fingerprint }),
    );
    return eventId;
  } catch {
    return createClientId("event");
  }
}

function clearPendingTutorEventId(sessionId: string, eventId: string) {
  const storageKey = `ai-tutor:pending-event:${sessionId}`;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "null",
    ) as { eventId?: unknown } | null;
    if (stored?.eventId === eventId) {
      window.localStorage.removeItem(storageKey);
    }
  } catch {
    // A missing browser store does not affect server idempotency.
  }
}

function clientInputFingerprint(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function responseUsageStatusText(
  response: Pick<TutorResponse, "responseLabel" | "source">,
) {
  if (
    response.source === "llm" ||
    response.source === "cache" ||
    response.responseLabel === "general_ai_help"
  ) {
    return "Using AI fallback";
  }

  if (response.responseLabel === "generated_approved_content") {
    return "Using approved generated content";
  }

  if (response.responseLabel === "private_reference_grounded_explanation") {
    return "Using private reference grounded explanation";
  }

  if (response.responseLabel === "approved_course_content") {
    return "Using saved course content";
  }

  return undefined;
}

export function shouldShowRetrievedContext(
  response: Pick<TutorResponse, "responseLabel" | "retrievedContext">,
) {
  return (
    response.retrievedContext.length > 0 &&
    response.responseLabel !== "private_reference_grounded_explanation"
  );
}

function createClientId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

function currentPracticeSignInHref() {
  if (typeof window === "undefined") {
    return signInPath("/practice");
  }
  const { pathname, search } = window.location;
  return signInPath(
    pathname.startsWith("/practice") ? `${pathname}${search}` : "/practice",
  );
}

function sessionWithProgress(
  session: TutorSessionDto | null,
  response: TutorResponse,
) {
  if (!session || !response.progress) {
    return session;
  }

  return {
    ...session,
    aiFallbackUsed: response.progress.llmUsed,
    attemptCount: response.progress.attemptCount,
    currentState: response.progress.state,
    revealedHints: response.progress.hintsRevealed,
    revealedSteps: response.progress.stepsRevealed,
    solved: response.progress.solved,
    wrongAttemptCount: response.progress.wrongAttemptCount,
  };
}

export function recoveryMessages(
  session: Pick<
    TutorSessionDto,
    "attempts" | "disclosedAnswerExplanation" | "disclosedSolutionSteps"
  >,
  question: StudentPracticeQuestion | undefined,
): ChatMessage[] {
  if (!question) {
    return [];
  }

  return session.attempts.flatMap((attempt, attemptIndex) => {
    const messages: ChatMessage[] = [];
    if (attempt.submittedAnswer) {
      messages.push({
        id: `recovered-student-${attemptIndex}`,
        role: "student",
        text: attempt.submittedAnswer,
      });
    }

    if (attempt.mode === "full_solution") {
      (session.disclosedSolutionSteps ?? []).forEach(
        (step, stepIndex, steps) => {
          messages.push({
            id: `recovered-step-${attemptIndex}-${stepIndex}`,
            role: "tutor",
            stepLabel: `Step ${stepIndex + 1} of ${steps.length}`,
            text: step,
            tone: "neutral",
          });
        },
      );
    } else if (attempt.verdict === "correct") {
      messages.push({
        id: `recovered-tutor-${attemptIndex}`,
        label: "Correct",
        role: "tutor",
        text:
          session.disclosedAnswerExplanation ??
          "You already answered this question correctly.",
        tone: "correct",
      });
    } else if (attempt.verdict === "incorrect") {
      messages.push({
        id: `recovered-tutor-${attemptIndex}`,
        label: "Not quite",
        note: attempt.misconceptionFeedback[0],
        role: "tutor",
        text:
          attempt.misconceptionFeedback.length > 0
            ? "There is a likely misconception to check first."
            : "Give it another try.",
        tone: "incorrect",
      });
    }

    return messages;
  });
}

function sessionErrorFor(error: unknown): SessionErrorState {
  if (error instanceof TutorClientRequestError) {
    return {
      code: error.code,
      message: error.message,
      signInHref:
        error.code === SIGN_IN_REQUIRED_CODE
          ? currentPracticeSignInHref()
          : undefined,
    };
  }
  return {
    message:
      "The tutor could not be reached. Please check your connection and try again.",
  };
}
