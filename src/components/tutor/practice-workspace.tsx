"use client";

/**
 * `/practice`: the rail, the Sheet with its action strip, and the tutor, in
 * the shell's three columns. This file only composes; every piece of state,
 * every gate and every request lives in `usePracticeWorkspace`.
 *
 * Where the tutor lives at each width (mounted once per breakpoint):
 * - 1280 and up: the drawer column (collapsible; the right-edge tab reopens it).
 * - 1024–1279: the right-edge tab opens it as a right panel.
 * - below 1024: a handle above the action strip opens it as a bottom sheet.
 */

import Link from "next/link";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Info,
  RotateCcw,
  Shuffle,
} from "lucide-react";

import {
  QuestionSheetSkeleton,
  stepsPipLabel,
} from "@/components/sheet/question-sheet";
import { BackBar } from "@/components/shell/back-bar";
import { BOTTOM_BAR_PADDING } from "@/components/shell/bottom-bar";
import { ThreeColumn } from "@/components/shell/three-column";
import {
  NEXT_SHORTCUT,
  PracticeFooter,
  practicePositionText,
  PREVIOUS_SHORTCUT,
} from "@/components/tutor/practice-footer";
import { PracticeMobileSheet } from "@/components/tutor/practice-mobile-sheet";
import { PracticeRail } from "@/components/tutor/practice-rail";
import {
  PracticeActionStrip,
  PracticeSheet,
  TopicCompleteNotice,
} from "@/components/tutor/practice-sheet";
import { PracticeSimilarProblemAction } from "@/components/tutor/practice-similar-problem-action";
import { shouldOfferSimilarPractice } from "@/components/tutor/tutor-client";
import { promptFirstLine, TutorDrawer } from "@/components/tutor/tutor-drawer";
import {
  usePracticeWorkspace,
  type PracticeWorkspaceProps,
} from "@/components/tutor/use-practice-workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  questionCode,
  studentDifficultyLabel,
  studentQuestionTitle,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

export {
  TUTOR_DRAWER_STORAGE_KEY,
  usePracticeWorkspace,
} from "./use-practice-workspace";
export type { PracticeWorkspaceProps } from "./use-practice-workspace";

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

/** The Check answer label while a wrong answer sits unchanged in the field. */
export const EDIT_TO_CHECK_AGAIN = "Edit your answer to check again";

export function PracticeWorkspace(props: PracticeWorkspaceProps) {
  const { view, gates, layout, actions, refs } = usePracticeWorkspace(props);
  const {
    activeMode,
    disclosedHints,
    isTutorBusy: busy,
    navQuestions,
    selectedQuestion,
    selectedTopic,
    session,
    sessionError,
  } = view;

  const topicHref = selectedTopic
    ? `/learn/${encodeURIComponent(selectedTopic.id)}`
    : "/learn";
  const solved = Boolean(session?.solved);
  const retired = view.tombstone !== undefined;
  const hintTotal = selectedQuestion?.hintCount ?? 0;
  const hintsShown = disclosedHints.length;
  const showStrip = Boolean(selectedQuestion);
  const topicSelectId = selectedTopic?.id ?? view.selectedTopicId;
  const nextHintNumber = Math.min(hintsShown + 1, hintTotal);
  // The next step when the topic has nothing left: the next topic with work
  // in it, or back to the syllabus.
  const nextTopicAction = view.nextQuestion
    ? undefined
    : (view.nextTopic ?? { href: "/learn", label: "Back to Learn" });

  const topicCompleteNotice = view.showTopicComplete ? (
    <TopicCompleteNotice
      courseComplete={view.courseComplete}
      headingRef={refs.topicCompleteRef}
      topicTitle={selectedTopic?.title}
      total={view.topicQuestions.length}
      actions={
        <>
          <Button
            asChild
            variant="secondary"
            size="sm"
            className="pointer-coarse:h-11"
          >
            <Link href={topicHref}>Topic overview</Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="pointer-coarse:h-11"
            onClick={actions.dismissTopicComplete}
          >
            Stay here
          </Button>
        </>
      }
    />
  ) : null;

  const drawerProps = {
    activeMode,
    aiHelpAlreadyGiven: view.aiHelpAlreadyGiven,
    aiHelpEnabled: view.aiHelpEnabled,
    aiHelpOffered: view.aiHelpOffered,
    busy,
    canHint: gates.canRevealHint,
    canStep: gates.canRevealStep,
    context: selectedQuestion
      ? {
          answer: view.answer.trim() || view.lastSubmittedAnswer,
          hintTotal,
          hintsRevealed: hintsShown,
          promptLine: promptFirstLine(selectedQuestion.prompt),
        }
      : undefined,
    hasSession: Boolean(session),
    loading: view.isLoadingQuestion,
    messages: view.messages,
    notice: view.showTopicComplete ? (
      <TopicCompleteNotice
        courseComplete={view.courseComplete}
        headingLevel={3}
        topicTitle={selectedTopic?.title}
        total={view.topicQuestions.length}
      />
    ) : null,
    onAskAi: actions.requestLimitedAiHelp,
    onHint: actions.getHint,
    onPromptChange: actions.setTutorPrompt,
    onSendPrompt: actions.sendTutorPrompt,
    onStep: actions.showAnswer,
    prompt: view.tutorPrompt,
  };

  const rail = (
    <PracticeRail
      collapsed={layout.railCollapsed}
      disabled={busy}
      nextQuestionId={view.nextQuestion?.id}
      onNextUnsolved={actions.continueToNextQuestion}
      onSearchChange={actions.setSearch}
      onSelectQuestion={(questionId) =>
        actions.selectQuestion(questionId, view.selectedTopicId)
      }
      onSelectTopic={actions.selectTopic}
      onToggleCollapsed={actions.toggleRail}
      questions={navQuestions}
      search={view.search}
      selectedQuestionId={view.selectedQuestionId}
      selectedTopicId={topicSelectId}
      solvedQuestionIds={view.solvedQuestionIds}
      topicHref={topicHref}
      topicTitle={selectedTopic?.title}
      topics={view.topics}
      weekLabel={view.weekLabel}
    />
  );

  const previousQuestion =
    view.questionPosition > 0
      ? navQuestions[view.questionPosition - 1]
      : undefined;
  const followingQuestion =
    view.questionPosition >= 0
      ? navQuestions[view.questionPosition + 1]
      : undefined;
  const chevronClass =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink transition-colors duration-fast hover:bg-hover focus-ring disabled:text-ink-muted disabled:opacity-50";

  // Phones: "‹ Question 1 of 6 ›". The chevrons step to the adjacent
  // question; the label itself opens the jump list (a native select laid
  // over it, so the phone's own picker opens).
  const mobileTop = (
    <BackBar
      href={topicHref}
      label={selectedTopic?.title ?? "Learn"}
      end={
        view.questionPosition >= 0 && navQuestions.length > 0 ? (
          <nav
            aria-label="Question position"
            className="flex items-center"
            data-slot="practice-position"
          >
            <button
              type="button"
              className={chevronClass}
              disabled={busy || !previousQuestion}
              aria-label={
                previousQuestion
                  ? `Previous question: ${previousQuestion.title}`
                  : "Previous question"
              }
              aria-keyshortcuts={PREVIOUS_SHORTCUT}
              onClick={() =>
                previousQuestion &&
                actions.selectQuestion(
                  previousQuestion.id,
                  view.selectedTopicId,
                )
              }
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
            <span className="relative inline-flex h-11 items-center rounded-control px-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-azure-500">
              <span
                aria-hidden="true"
                className="type-body-strong whitespace-nowrap text-ink tabular"
              >
                {practicePositionText(
                  view.questionPosition,
                  navQuestions.length,
                )}
              </span>
              <select
                aria-label={`${practicePositionText(
                  view.questionPosition,
                  navQuestions.length,
                )}. Jump to question`}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
                value={view.selectedQuestionId}
                disabled={busy}
                onChange={(event) =>
                  actions.selectQuestion(
                    event.target.value,
                    view.selectedTopicId,
                  )
                }
              >
                {navQuestions.map((question, index) => (
                  <option key={question.id} value={question.id}>
                    {`${index + 1}. ${question.title}${
                      view.solvedQuestionIds.has(question.id) ? " (solved)" : ""
                    }`}
                  </option>
                ))}
              </select>
            </span>
            <button
              type="button"
              className={chevronClass}
              disabled={busy || !followingQuestion}
              aria-label={
                followingQuestion
                  ? `Next question: ${followingQuestion.title}`
                  : "Next question"
              }
              aria-keyshortcuts={NEXT_SHORTCUT}
              onClick={() =>
                followingQuestion &&
                actions.selectQuestion(
                  followingQuestion.id,
                  view.selectedTopicId,
                )
              }
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          </nav>
        ) : undefined
      }
    />
  );

  const hintControl =
    selectedQuestion && hintTotal > 0
      ? {
          disabled: !gates.canRevealHint || busy,
          // Once every hint is open the slot belongs to Show steps.
          hideOnPhone: hintsShown >= hintTotal,
          label:
            hintsShown >= hintTotal
              ? `All ${hintTotal} hints shown`
              : `Show hint ${nextHintNumber} of ${hintTotal}`,
          loading: activeMode === "hint",
          onReveal: actions.getHint,
          shortLabel: `Hint ${nextHintNumber}/${hintTotal}`,
        }
      : null;

  const stepControl =
    selectedQuestion &&
    selectedQuestion.stepCount > 0 &&
    !view.solutionFullyRevealed &&
    view.solutionSteps.length === 0
      ? {
          disabled: !gates.canRevealStep || busy,
          label: "Show steps",
          loading: activeMode === "full_solution",
          onReveal: actions.showAnswer,
          reason: gates.hintsExhausted
            ? undefined
            : stepsPipLabel(hintsShown, hintTotal),
        }
      : null;

  // The band's next move after a wrong answer: the next hint, or the steps
  // once the hints are used up. Never a second mint.
  const wrongAnswer = view.sheetVerdict?.verdict === "incorrect" && !solved;
  const verdictAction = wrongAnswer ? (
    gates.canRevealHint && hintTotal > 0 ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="pointer-coarse:h-11"
        disabled={busy}
        loading={activeMode === "hint"}
        onClick={actions.getHint}
      >
        {`Show hint ${nextHintNumber} of ${hintTotal}`}
      </Button>
    ) : gates.canRevealStep && view.solutionSteps.length === 0 ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="pointer-coarse:h-11"
        disabled={busy}
        loading={activeMode === "full_solution"}
        onClick={actions.showAnswer}
      >
        Show steps
      </Button>
    ) : null
  ) : null;

  const extraPractice =
    session &&
    shouldOfferSimilarPractice(session) &&
    (solved || view.solutionFullyRevealed) ? (
      <section
        aria-labelledby="practice-extra-heading"
        className="flex flex-col gap-2"
      >
        <h2 id="practice-extra-heading" className="type-label">
          Extra practice
        </h2>
        <PracticeSimilarProblemAction
          key={session.id}
          disabled={busy}
          sessionId={session.id}
          onMatch={actions.openSimilarQuestion}
        />
      </section>
    ) : null;

  return (
    <>
      {/* While the tutor overlay is open, everything behind it is inert. */}
      <div inert={layout.mobileSheetOpen || undefined}>
        <ThreeColumn
          rail={rail}
          railCollapsed={layout.railCollapsed}
          railLabel="Questions"
          drawer={
            <div className="-my-6 flex h-[calc(100svh-var(--header-h))] flex-col py-6">
              <TutorDrawer
                {...drawerProps}
                collapseButtonRef={refs.drawerToggleRef}
                headingRef={refs.drawerHeadingRef}
                onCollapse={actions.toggleDrawer}
                variant="column"
              />
            </div>
          }
          drawerOpen={layout.drawerOpen}
          drawerLabel="Tutor"
          onDrawerToggle={() => actions.openTutor()}
          drawerTabLabel="Open tutor"
          drawerTabRef={refs.drawerTabRef}
          mobileTop={mobileTop}
          mainClassName={cn(
            BOTTOM_BAR_PADDING,
            "lg:flex lg:min-h-[calc(100svh-var(--header-h))] lg:flex-col",
          )}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 lg:flex-1">
            {sessionError && !retired ? (
              <Alert role="alert">
                <Info aria-hidden="true" />
                <AlertDescription className="gap-2 text-ink">
                  <p>{sessionError.message}</p>
                  {sessionError.signInHref ? (
                    <Button asChild size="sm">
                      <Link href={sessionError.signInHref}>Sign in</Link>
                    </Button>
                  ) : !session && !view.isSessionLoading ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={actions.restartTutorSession}
                    >
                      <RotateCcw aria-hidden="true" />
                      Start a new attempt
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {view.isReservePractice ? (
              <Alert variant="info" role="note">
                <Shuffle aria-hidden="true" />
                <AlertDescription className="gap-2 text-ink">
                  <p>
                    Extra practice: one more problem like the one you just did,
                    checked by your professor. Your professor decides if it
                    counts.
                  </p>
                  <Button asChild variant="link" size="sm">
                    <Link
                      href={
                        session?.originSessionId
                          ? `/practice?sessionId=${encodeURIComponent(session.originSessionId)}`
                          : topicHref
                      }
                    >
                      {session?.originSessionId
                        ? "Back to your question"
                        : "Topic overview"}
                    </Link>
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}

            {view.isLoadingQuestion ? (
              <QuestionSheetSkeleton />
            ) : selectedQuestion ? (
              <PracticeSheet
                answer={view.answer}
                answerDisabled={!session || view.isSessionLoading || solved}
                // The in-flight check is `activeMode`; `isSessionLoading`
                // covers loading a question, not checking one.
                checking={activeMode === "check"}
                containerRef={refs.answerInputRef}
                difficultyLabel={studentDifficultyLabel(
                  selectedQuestion.difficulty,
                )}
                disclosedHints={disclosedHints}
                extraPractice={extraPractice}
                feedbackKey={session?.id ?? selectedQuestion.id}
                figure={selectedQuestion.figure}
                footer={
                  <PracticeFooter
                    disabled={busy}
                    onSelect={(questionId) =>
                      actions.selectQuestion(questionId, view.selectedTopicId)
                    }
                    questions={navQuestions}
                    selectedQuestionId={view.selectedQuestionId}
                    solvedQuestionIds={view.solvedQuestionIds}
                  />
                }
                helper={selectedQuestion.inputFormatHint}
                hintTotal={hintTotal}
                notice={topicCompleteNotice}
                onAnswerChange={actions.setAnswer}
                onCheck={actions.sendAnswer}
                onStartOver={actions.restartTutorSession}
                positionLabel={view.positionLabel}
                prompt={selectedQuestion.prompt}
                questionCode={questionCode(selectedQuestion.id)}
                questionTitle={studentQuestionTitle(selectedQuestion.title)}
                sessionId={session?.id}
                solutionSteps={view.solutionSteps}
                startOverDisabled={busy || !session || view.isReservePractice}
                stepCount={selectedQuestion.stepCount}
                tombstone={view.tombstone}
                topicLabel={view.topicLabel}
                verdict={view.sheetVerdict}
                verdictAction={verdictAction}
              />
            ) : (
              <EmptyTopicState
                hasAnyQuestions={view.hasAnyQuestions}
                topicTitle={selectedTopic?.title}
              />
            )}

            {/* Room for the tutor handle that sits above the phone strip. */}
            <div aria-hidden="true" className="h-11 lg:hidden" />
          </div>

          {showStrip ? (
            <PracticeActionStrip
              canCheck={gates.canSend}
              checkLabel={
                // A graded answer sits unchanged in the field (wrong or
                // unreadable): say what re-enables the check.
                view.lastCheckVerdict !== null &&
                view.lastCheckVerdict !== "correct" &&
                !gates.canSend
                  ? EDIT_TO_CHECK_AGAIN
                  : "Check answer"
              }
              checking={activeMode === "check"}
              continueButtonRef={refs.continueButtonRef}
              continueDisabled={busy}
              continueLabel="Next question"
              continueAriaLabel={
                view.nextQuestion
                  ? `Next unsolved question: ${studentQuestionTitle(view.nextQuestion.title)}`
                  : undefined
              }
              hint={hintControl}
              nextTopic={nextTopicAction}
              onCheck={actions.sendAnswer}
              onContinue={actions.continueToNextQuestion}
              onWhy={() => actions.openTutor({ focusHeading: true })}
              retired={retired}
              solved={solved}
              step={stepControl}
            />
          ) : null}
        </ThreeColumn>

        <PracticeMobileSheet
          docked={showStrip}
          newCount={layout.unseenTutorMessages}
          onOpenChange={actions.setMobileSheet}
          onToggleHeight={actions.toggleMobileSheetHeight}
          open={layout.mobileSheetOpen}
          side={layout.mobileSheetSide}
          tall={layout.mobileSheetTall}
        >
          <TutorDrawer {...drawerProps} variant="sheet" />
        </PracticeMobileSheet>
      </div>
    </>
  );
}

/**
 * A topic with nothing published yet. It stands where the Sheet would, so it
 * carries the page heading.
 */
function EmptyTopicState({
  hasAnyQuestions,
  topicTitle,
}: {
  hasAnyQuestions: boolean;
  topicTitle?: string;
}) {
  return (
    <section
      aria-labelledby="practice-empty-heading"
      className="sheet-shadow flex flex-col gap-4 rounded-panel bg-sheet p-6 text-ink sm:p-8"
    >
      <h1 id="practice-empty-heading" className="type-h2 text-ink">
        No practice questions are available for this topic yet.
      </h1>
      <p className="type-body max-w-prose text-ink-muted">
        {topicTitle ? `${topicTitle} has ` : "This topic has "}
        nothing to practice right now. Questions appear here once your professor
        makes them available.
      </p>
      <div>
        <Button asChild>
          <Link href="/learn">
            {hasAnyQuestions ? "Choose another topic" : "Browse topics"}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
