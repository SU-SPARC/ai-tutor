"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Sparkles,
  X,
} from "lucide-react";

import { ProfessorReviewReasonFields } from "@/components/professor/professor-review-reason-fields";
import {
  professorDifficultyLabel,
  ProfessorTime,
} from "@/components/professor/professor-question-labels";
import { QuestionSheet } from "@/components/sheet/question-sheet";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { questionCode, studentDifficultyLabel } from "@/lib/labels";
import { professorReviewQueuePath } from "@/lib/tutor/professor-review-mode";
import { professorReviewReasonRequiresNote } from "@/lib/tutor/professor-review-reasons";
import { cn } from "@/lib/utils";
import type {
  Difficulty,
  ProfessorQuestionReviewCandidateDto,
  ProfessorQuestionReviewDashboard,
  QuestionRevisionMethod,
} from "@/lib/types";

type ReviewAction =
  | "approve"
  | "reject"
  | "request_edit"
  | "request_regeneration";

/** The decisions that need a reason before they can be sent. */
type ReasonedAction = Exclude<ReviewAction, "approve">;

type TopicSummary = ProfessorQuestionReviewDashboard["topics"][number];

const ADD_QUESTION_HREF = "/professor/questions?tab=intake";
const GENERIC_ERROR =
  "That didn't work and nothing changed. Try again, or reload the page.";
const LOAD_ERROR =
  "The questions for this topic didn't load. Nothing changed. Try again, or reload the page.";

/** What each decision button does, in one plain sentence. */
const CONSEQUENCES: Record<ReviewAction, string> = {
  approve:
    "It moves to your approved questions. Students won't see it until you show it to them.",
  request_edit: "It goes back to drafts so it can be edited, then returns here.",
  request_regeneration:
    "A new draft is written for you and comes back here for review.",
  reject: "It is set aside and never shown to students.",
};

/** The reason error for each decision that needs one. */
const MISSING_REASON: Record<ReasonedAction, string> = {
  request_edit: "Choose why you're sending this back.",
  request_regeneration: "Choose why this should be rewritten.",
  reject: "Choose why you're rejecting this question.",
};

const MISSING_NOTE = "Please add a short note when you choose Something else.";

/** The confirm button under the reason fields restates the action. */
const CONFIRM_LABELS: Record<ReasonedAction, string> = {
  request_edit: "Send back",
  request_regeneration: "Rewrite with AI",
  reject: "Reject question",
};

/**
 * How the answer is checked, as one header word. The spec is optional on older
 * records, and "short answer" is what an unspecified one behaves like.
 */
function answerTypeLabel(candidate: ProfessorQuestionReviewCandidateDto) {
  switch (candidate.answer.spec?.kind) {
    case "numeric":
      return "numeric";
    case "categorical":
      return "categorical";
    case "number_list":
      return "number list";
    default:
      return "short answer";
  }
}

const DIFFICULTIES = [
  "foundational",
  "intermediate",
  "challenge",
] as const satisfies readonly Difficulty[];

/**
 * A date worth printing: missing, unreadable and epoch-0 values (which
 * would read as Dec 31 1969 / Jan 1 1970) render nothing.
 */
function knownDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1970) {
    return undefined;
  }
  return value;
}

function bySyllabusOrder(topics: TopicSummary[]) {
  return [...topics].sort((left, right) => left.order - right.order);
}

function waitingLabel(count: number) {
  return count === 0 ? "none waiting" : `${count} waiting`;
}

/**
 * The review queue for one syllabus topic, opened straight on its first
 * question: the list on the left, the question as a student meets it on the
 * right, with the decision underneath. Choosing a topic loads it at once.
 * Each decision is a server-authorized transition; approving never shows a
 * question to students.
 */
export function ProfessorFriendlyReviewPanel({
  initialDashboard,
  initialTopicId,
}: {
  initialDashboard: ProfessorQuestionReviewDashboard;
  /**
   * A topic the server already loaded candidates for (from `?topic=`, or the
   * first topic with questions waiting), so the page opens on its first
   * question instead of an empty form.
   */
  initialTopicId?: string;
}) {
  const preloadedTopicId =
    initialTopicId && initialDashboard.selectedTopicId === initialTopicId
      ? initialTopicId
      : "";
  const [activeAction, setActiveAction] = useState<ReviewAction | null>(null);
  const [chosenAction, setChosenAction] = useState<ReasonedAction | null>(
    null,
  );
  const [confirmRejectOpen, setConfirmRejectOpen] = useState(false);
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [decisionMessage, setDecisionMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedTopicId, setLoadedTopicId] = useState<string | null>(
    preloadedTopicId || null,
  );
  // The list keeps the order the queue loaded in; choosing a question only
  // moves it to the front of `candidates`, which is what the preview shows.
  const [listOrder, setListOrder] = useState<string[]>(() =>
    initialDashboard.candidates.map((candidate) => candidate.questionId),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  const [reasonCode, setReasonCode] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [reviewedCount, setReviewedCount] = useState(0);
  const [selectedTopicId, setSelectedTopicId] = useState(preloadedTopicId);
  const [selectedDifficulty, setSelectedDifficulty] = useState<Difficulty>(
    initialDashboard.candidates[0]?.difficulty ?? "foundational",
  );
  const previewHeadingRef = useRef<HTMLHeadingElement>(null);
  const reasonFieldsRef = useRef<HTMLDivElement>(null);
  const listHeadingId = useId();
  const previewHeadingId = useId();
  const decisionHeadingId = useId();
  const topicsHeadingId = useId();

  const current = dashboard.candidates[0];
  const topicsInOrder = useMemo(
    () => bySyllabusOrder(dashboard.topics),
    [dashboard.topics],
  );
  const selectedTopic = useMemo(
    () => dashboard.topics.find((topic) => topic.topicId === selectedTopicId),
    [dashboard.topics, selectedTopicId],
  );
  const orderedCandidates = useMemo(() => {
    const position = new Map(listOrder.map((id, index) => [id, index]));
    return [...dashboard.candidates].sort(
      (left, right) =>
        (position.get(left.questionId) ?? Number.MAX_SAFE_INTEGER) -
        (position.get(right.questionId) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [dashboard.candidates, listOrder]);
  const totalWaiting = dashboard.topics.reduce(
    (sum, topic) => sum + topic.needsReview,
    0,
  );
  const nextTopic = nextWaitingTopic(topicsInOrder, selectedTopicId);
  const currentIndex = current ? orderedCandidates.indexOf(current) : -1;

  function clearDecision() {
    setChosenAction(null);
    setConfirmRejectOpen(false);
    setDecisionMessage(null);
    setNote("");
    setNoteError(undefined);
    setReasonCode("");
    setReasonError(undefined);
  }

  function adoptDashboard(nextDashboard: ProfessorQuestionReviewDashboard) {
    setDashboard(nextDashboard);
    setListOrder(
      nextDashboard.candidates.map((candidate) => candidate.questionId),
    );
    setSelectedDifficulty(
      nextDashboard.candidates[0]?.difficulty ?? "foundational",
    );
  }

  async function requestTopicDashboard(topicId: string) {
    const result = await fetch(professorReviewQueuePath(topicId));
    const payload = (await result.json()) as {
      dashboard?: ProfessorQuestionReviewDashboard;
      error?: string;
    };
    if (!result.ok || !payload.dashboard) {
      throw new Error(payload.error ?? "The questions could not load.");
    }
    return payload.dashboard;
  }

  async function loadQueue(topicId = selectedTopicId) {
    if (!topicId) return;
    setIsLoading(true);
    setMessage(null);

    try {
      const nextDashboard = await requestTopicDashboard(topicId);
      adoptDashboard(nextDashboard);
      setLoadedTopicId(topicId);
      setReviewedCount(0);
      clearDecision();
      const topic = nextDashboard.topics.find(
        (item) => item.topicId === topicId,
      );
      const count = nextDashboard.candidates.length;
      // An empty topic speaks through its empty state instead.
      setMessage(
        count > 0
          ? `${count} ${count === 1 ? "question" : "questions"} to review in ${topic?.title ?? "this topic"}.`
          : null,
      );
    } catch {
      setMessage(LOAD_ERROR);
    } finally {
      setIsLoading(false);
    }
  }

  function focusReasonField(field: "reason" | "note" = "reason") {
    requestAnimationFrame(() => {
      reasonFieldsRef.current
        ?.querySelector<HTMLElement>(field === "note" ? "textarea" : "select")
        ?.focus();
    });
  }

  /** Checks the reason fields; says what to fix next to the field if not. */
  function reasonIsComplete(action: ReasonedAction) {
    if (!reasonCode) {
      setReasonError(MISSING_REASON[action]);
      setNoteError(undefined);
      setDecisionMessage(MISSING_REASON[action]);
      focusReasonField("reason");
      return false;
    }
    if (professorReviewReasonRequiresNote(reasonCode) && !note.trim()) {
      setReasonError(undefined);
      setNoteError(MISSING_NOTE);
      setDecisionMessage(MISSING_NOTE);
      focusReasonField("note");
      return false;
    }
    setReasonError(undefined);
    setNoteError(undefined);
    return true;
  }

  function chooseAction(action: ReasonedAction) {
    setChosenAction(action);
    setDecisionMessage(null);
    setReasonError(undefined);
    setNoteError(undefined);
    focusReasonField("reason");
  }

  function confirmChosenAction() {
    if (!chosenAction || !reasonIsComplete(chosenAction)) return;
    if (chosenAction === "reject") {
      // Rejection is final, so it always passes through one more question.
      setConfirmRejectOpen(true);
      return;
    }
    void reviewCurrent(chosenAction);
  }

  async function reviewCurrent(action: ReviewAction) {
    if (!current || !loadedTopicId) return;
    if (action !== "approve" && !reasonIsComplete(action)) {
      return;
    }

    const transition = transitionForAction(action);
    const approvedDifficulty = selectedDifficulty;
    const difficultyChanged =
      action === "approve" && approvedDifficulty !== current.difficulty;
    setActiveAction(action);
    setDecisionMessage(null);

    try {
      const result = await fetch(
        `/api/professor/questions/${encodeURIComponent(current.questionId)}/transitions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": globalThis.crypto.randomUUID(),
          },
          body: JSON.stringify({
            action: transition.action,
            expectedState: current.state,
            note: note.trim() || undefined,
            reasonCode: action === "approve" ? undefined : reasonCode,
            revisionMethod: transition.revisionMethod,
            versionId: current.versionId,
            ...(action === "approve" ? { difficulty: approvedDifficulty } : {}),
          }),
        },
      );
      if (!result.ok) {
        throw new DecisionError(result.status);
      }

      const done = decisionToastText({
        action,
        difficulty: difficultyChanged ? approvedDifficulty : undefined,
        title: current.title,
      });
      setReviewedCount((count) => count + 1);
      clearDecision();
      try {
        const nextDashboard = await requestTopicDashboard(loadedTopicId);
        adoptDashboard(nextDashboard);
        toast({ title: done, tone: "success" });
        // The next question replaces this one in place; bring its title into
        // view (and focus) so it is read from the top.
        if (nextDashboard.candidates.length > 0) {
          requestAnimationFrame(() => previewHeadingRef.current?.focus());
        }
      } catch {
        setDashboard((currentDashboard) =>
          advanceDashboardAfterDecision(
            currentDashboard,
            loadedTopicId,
            transition.action,
          ),
        );
        setLoadedTopicId(null);
        setMessage(
          `${done} The list didn't refresh; choose the topic again to see the next question.`,
        );
      }
    } catch (error) {
      setDecisionMessage(
        error instanceof DecisionError && error.status === 409
          ? "Someone already made a decision on this question, so nothing changed. Reload the page to see the latest."
          : GENERIC_ERROR,
      );
    } finally {
      setActiveAction(null);
    }
  }

  function selectTopic(topicId: string) {
    setSelectedTopicId(topicId);
    setLoadedTopicId(null);
    setDashboard((currentDashboard) => ({
      ...currentDashboard,
      candidates: [],
      selectedTopicId: undefined,
    }));
    setMessage(null);
    clearDecision();
    setSelectedDifficulty("foundational");
    setReviewedCount(0);
  }

  function openTopic(topicId: string) {
    selectTopic(topicId);
    void loadQueue(topicId);
  }

  function focusCandidate(questionId: string) {
    const next = dashboard.candidates.find(
      (candidate) => candidate.questionId === questionId,
    );
    if (!next || next === current) return;
    setDashboard((currentDashboard) => ({
      ...currentDashboard,
      candidates: [
        next,
        ...currentDashboard.candidates.filter(
          (candidate) => candidate.questionId !== questionId,
        ),
      ],
    }));
    setSelectedDifficulty(next.difficulty);
    clearDecision();
    setMessage(null);
  }

  function step(offset: -1 | 1) {
    const target = orderedCandidates[currentIndex + offset];
    if (!target) return;
    focusCandidate(target.questionId);
    requestAnimationFrame(() => previewHeadingRef.current?.focus());
  }

  const busy = dashboard.readOnly || Boolean(activeAction);
  const showSendBack = current?.allowedActions.includes("request_revision");

  return (
    <div className="flex flex-col gap-6">
      {dashboard.readOnly && dashboard.mode !== "demo" ? (
        <p className="type-body max-w-prose border-l-2 border-input pl-4 text-ink">
          You can read these questions, but decisions can&apos;t be saved right
          now.
        </p>
      ) : null}

      {totalWaiting === 0 && !current && !selectedTopicId ? (
        <EmptyState
          className="rounded-panel bg-sheet px-5"
          action={
            <Button asChild className="min-h-11">
              <Link href={ADD_QUESTION_HREF}>Add a question</Link>
            </Button>
          }
        >
          You&apos;re all caught up. No questions are waiting for you.
        </EmptyState>
      ) : (
        <>
          <Field label="Topic" className="min-w-0 sm:max-w-md">
            <NativeSelect
              className="min-h-11"
              value={selectedTopicId}
              disabled={isLoading}
              onChange={(event) => {
                const topicId = event.target.value;
                selectTopic(topicId);
                if (topicId) void loadQueue(topicId);
              }}
            >
              {selectedTopicId ? null : (
                <option value="">Choose a topic</option>
              )}
              {topicsInOrder.map((topic) => (
                <option key={topic.topicId} value={topic.topicId}>
                  {topic.title} ({waitingLabel(topic.needsReview)})
                </option>
              ))}
            </NativeSelect>
          </Field>

          <div role="status" aria-live="polite">
            {isLoading ? (
              <p className="type-body max-w-prose text-ink">
                Opening {selectedTopic?.title ?? "this topic"}…
              </p>
            ) : message ? (
              <p className="type-body max-w-prose border-l-2 border-azure-500 py-1 pl-4 text-ink">
                {message}
              </p>
            ) : null}
          </div>
        </>
      )}

      {current ? (
        <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
          <section
            aria-labelledby={listHeadingId}
            className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-[calc(var(--header-h)+1rem)] lg:col-span-2"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 id={listHeadingId} className="type-h3 text-ink">
                Waiting for you
              </h2>
              <p className="type-body text-ink">
                {dashboard.candidates.length} waiting
                {reviewedCount > 0 ? ` · ${reviewedCount} done` : ""}
              </p>
            </div>
            <ol className="flex flex-col overflow-y-auto rounded-panel bg-sheet lg:max-h-[calc(100svh-var(--header-h)-8rem)]">
              {orderedCandidates.map((candidate) => {
                const isCurrent = candidate === current;
                const added = knownDate(candidate.createdAt);
                return (
                  <li
                    key={candidate.questionId}
                    className="border-b border-rule last:border-b-0"
                  >
                    <button
                      type="button"
                      aria-current={isCurrent ? "true" : undefined}
                      disabled={Boolean(activeAction)}
                      onClick={() => focusCandidate(candidate.questionId)}
                      className="flex min-h-11 w-full flex-col gap-1.5 border-l-2 border-transparent px-4 py-3 text-left transition-colors duration-fast hover:bg-surface-tint focus-ring aria-[current=true]:border-azure-500 aria-[current=true]:bg-azure-100 disabled:cursor-not-allowed"
                    >
                      <span className="type-body-strong text-ink">
                        {candidate.title}
                      </span>
                      <span className="type-small text-ink-muted">
                        {professorDifficultyLabel(candidate.difficulty)}
                        {added ? (
                          <>
                            {" · added "}
                            <ProfessorTime dateOnly value={added} />
                          </>
                        ) : null}
                      </span>
                      {candidate.review.reviewPriority === "priority" ? (
                        <span className="flex flex-wrap gap-1.5">
                          <StatusChip
                            icon={false}
                            label="Flagged by a student"
                            tone="neutral"
                          />
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <article
            aria-labelledby={previewHeadingId}
            className="flex min-w-0 flex-col gap-6 lg:col-span-3"
          >
            <header className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="type-body text-ink">
                  Question {reviewedCount + currentIndex + 1} of{" "}
                  {reviewedCount + orderedCandidates.length} in{" "}
                  {selectedTopic?.title ?? "this topic"}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={currentIndex <= 0 || Boolean(activeAction)}
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={
                      currentIndex >= orderedCandidates.length - 1 ||
                      Boolean(activeAction)
                    }
                    onClick={() => step(1)}
                  >
                    Next
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <h2
                id={previewHeadingId}
                ref={previewHeadingRef}
                tabIndex={-1}
                className="type-h2 scroll-mt-[calc(var(--header-h)+1rem)] text-ink focus-ring"
              >
                {current.title}
              </h2>
              {current.publishedVersionId ? (
                <p className="type-body max-w-prose border-l-2 border-azure-500 pl-4 text-ink">
                  This is an edit. Students still see the earlier wording
                  until you approve this one and show it to them.
                </p>
              ) : null}
              <p className="type-small text-ink-muted">
                Added by {current.createdBy.displayName}
                {knownDate(current.createdAt) ? (
                  <>
                    {" · "}
                    <ProfessorTime value={current.createdAt} />
                  </>
                ) : null}
                {" · "}Question code {questionCode(current.questionId)}
              </p>
            </header>

            {/* The candidate as a student would meet it, with the whole hint
                and step ladder already down and the accepted answer in the
                field: what is being approved is the page, not a list of
                fields. */}
            <QuestionSheet
              answer={{
                value: current.answer.acceptedAnswers.join(", "),
                onChange: () => {},
                onCheck: () => {},
                disabled: true,
                helper:
                  "Students see an empty box. This is the correct answer.",
              }}
              header={{
                topicLabel: selectedTopic?.title ?? "",
                questionCode: questionCode(current.questionId),
                answerType: answerTypeLabel(current),
                difficultyLabel: studentDifficultyLabel(selectedDifficulty),
              }}
              headingLevel={3}
              hints={{ total: current.hints.length, revealed: current.hints }}
              prompt={current.prompt}
              steps={{ revealed: current.solutionSteps }}
            />

            <div className="flex flex-col gap-5">
              <ReviewBlock
                title="Answer explanation"
                values={[current.answer.explanation]}
              />
              <ReviewBlock
                title="Common student mistakes"
                values={current.misconceptions.map((item) => item.feedback)}
              />
              <ReviewBlock
                title="Where this question came from"
                empty="No source noted."
                values={[current.source.originalityNote ?? ""]}
              />
            </div>

            <section
              aria-labelledby={decisionHeadingId}
              className="flex flex-col gap-5 rounded-panel bg-surface-tint p-4 sm:p-5"
            >
              <h3 id={decisionHeadingId} className="type-h3 text-ink">
                Your decision
              </h3>
              <Field
                label="Difficulty"
                description="Change this if the suggested level is wrong. Your choice is saved when you approve."
                className="max-w-md"
              >
                <NativeSelect
                  className="min-h-11"
                  disabled={busy}
                  value={selectedDifficulty}
                  onChange={(event) =>
                    setSelectedDifficulty(event.target.value as Difficulty)
                  }
                >
                  {DIFFICULTIES.map((difficulty) => (
                    <option key={difficulty} value={difficulty}>
                      {professorDifficultyLabel(difficulty)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>

              <div className="flex flex-wrap items-start gap-x-4 gap-y-5">
                {current.allowedActions.includes("approve") ? (
                  <DecisionChoice consequence={CONSEQUENCES.approve}>
                    <Button
                      type="button"
                      variant="cta"
                      className="min-h-11"
                      disabled={busy}
                      loading={activeAction === "approve"}
                      onClick={() => void reviewCurrent("approve")}
                    >
                      <Check aria-hidden="true" />
                      Approve
                    </Button>
                  </DecisionChoice>
                ) : null}
                {showSendBack ? (
                  <>
                    <DecisionChoice consequence={CONSEQUENCES.request_edit}>
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11"
                        disabled={busy}
                        aria-expanded={chosenAction === "request_edit"}
                        onClick={() => chooseAction("request_edit")}
                      >
                        <Pencil aria-hidden="true" />
                        Send back for changes
                      </Button>
                    </DecisionChoice>
                    <DecisionChoice
                      consequence={CONSEQUENCES.request_regeneration}
                    >
                      <Button
                        type="button"
                        variant="secondary"
                        className="min-h-11"
                        disabled={busy}
                        aria-expanded={chosenAction === "request_regeneration"}
                        onClick={() => chooseAction("request_regeneration")}
                      >
                        <Sparkles aria-hidden="true" />
                        Rewrite with AI
                      </Button>
                    </DecisionChoice>
                  </>
                ) : null}
                {current.allowedActions.includes("reject") ? (
                  <DecisionChoice
                    className="ml-auto"
                    consequence={CONSEQUENCES.reject}
                  >
                    <Button
                      type="button"
                      variant="destructive"
                      className="min-h-11"
                      disabled={busy}
                      aria-expanded={chosenAction === "reject"}
                      onClick={() => chooseAction("reject")}
                    >
                      <X aria-hidden="true" />
                      Reject
                    </Button>
                  </DecisionChoice>
                ) : null}
              </div>

              {chosenAction ? (
                <div
                  ref={reasonFieldsRef}
                  className="flex flex-col gap-4 rounded-panel border border-rule bg-sheet p-4"
                >
                  <p className="type-body-strong text-ink">
                    {chosenActionHeading(chosenAction)}
                  </p>
                  <ProfessorReviewReasonFields
                    disabled={busy}
                    note={note}
                    noteError={noteError}
                    onNoteChange={(value) => {
                      setNote(value);
                      setNoteError(undefined);
                    }}
                    onReasonCodeChange={(value) => {
                      setReasonCode(value);
                      setReasonError(undefined);
                    }}
                    reasonCode={reasonCode}
                    reasonError={reasonError}
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant={
                        chosenAction === "reject" ? "destructive" : "primary"
                      }
                      className="min-h-11"
                      disabled={busy}
                      loading={activeAction === chosenAction}
                      onClick={confirmChosenAction}
                    >
                      {CONFIRM_LABELS[chosenAction]}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                      disabled={Boolean(activeAction)}
                      onClick={clearDecision}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Validation and server problems appear here, right under the
                  buttons that caused them, not at the top of the page. */}
              <div role="status" aria-live="polite">
                {decisionMessage ? (
                  <p className="type-body max-w-prose border-l-2 border-red-500 py-1 pl-4 text-ink">
                    {decisionMessage}
                  </p>
                ) : null}
              </div>
            </section>

            <Dialog
              open={confirmRejectOpen}
              onOpenChange={setConfirmRejectOpen}
            >
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>Reject “{current.title}”?</DialogTitle>
                  <DialogDescription className="text-ink">
                    It will be set aside and never shown to students.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11"
                    >
                      Keep reviewing
                    </Button>
                  </DialogClose>
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11"
                    onClick={() => {
                      setConfirmRejectOpen(false);
                      void reviewCurrent("reject");
                    }}
                  >
                    Reject question
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </article>
        </div>
      ) : totalWaiting === 0 && !selectedTopicId ? null : (
        <div className="flex flex-col gap-6">
          {selectedTopicId ? (
            <div role="status" aria-live="polite">
              <ReviewQueueEmptyState
                loaded={
                  loadedTopicId === selectedTopicId && Boolean(loadedTopicId)
                }
                nextTopic={nextTopic}
                onOpenTopic={openTopic}
                selectedTopic={selectedTopic}
              />
            </div>
          ) : null}
          <section
            aria-labelledby={topicsHeadingId}
            className="flex flex-col gap-3"
          >
            <h2 id={topicsHeadingId} className="type-h3 text-ink">
              {selectedTopicId ? "All topics" : "Choose a topic to review"}
            </h2>
            <div className="rounded-panel bg-sheet">
              <Table>
                <TableCaption className="sr-only">
                  How many questions wait for you in each topic, in syllabus
                  order.
                </TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Topic</TableHead>
                    <TableHead>Waiting for you</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topicsInOrder.map((topic) => (
                    <TableRow
                      key={topic.topicId}
                      data-state={
                        selectedTopicId === topic.topicId
                          ? "selected"
                          : undefined
                      }
                    >
                      <TableCell className="type-body min-w-56 text-ink">
                        {topic.title}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="type-body text-ink">
                            {topic.needsReview === 0
                              ? "Nothing waiting"
                              : `${topic.needsReview} waiting`}
                          </span>
                          {topic.needsReview > 0 ? (
                            <Button
                              asChild
                              variant="secondary"
                              className="min-h-11"
                            >
                              <Link
                                href={`/professor/review?topic=${encodeURIComponent(topic.topicId)}`}
                                aria-label={`Review ${topic.title}`}
                              >
                                Review
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/** A server refusal, kept apart so the message can stay in plain words. */
class DecisionError extends Error {
  constructor(readonly status: number) {
    super(`Decision failed with ${status}`);
  }
}

function chosenActionHeading(action: ReasonedAction) {
  switch (action) {
    case "request_edit":
      return "Why are you sending this back?";
    case "request_regeneration":
      return "What should the new draft fix?";
    case "reject":
      return "Why are you rejecting this question?";
  }
}

/** A decision button with its consequence printed underneath. */
function DecisionChoice({
  children,
  className,
  consequence,
}: {
  children: ReactNode;
  className?: string;
  consequence: string;
}) {
  return (
    <div
      className={cn(
        "flex max-w-[15rem] basis-56 flex-col items-start gap-2",
        className,
      )}
    >
      {children}
      <p className="type-body text-ink">{consequence}</p>
    </div>
  );
}

/** The first topic after `topicId` in syllabus order that has questions waiting. */
function nextWaitingTopic(
  topicsInOrder: TopicSummary[],
  topicId: string,
): TopicSummary | undefined {
  const start = topicsInOrder.findIndex((topic) => topic.topicId === topicId);
  const rotated = [
    ...topicsInOrder.slice(start + 1),
    ...topicsInOrder.slice(0, Math.max(start, 0)),
  ];
  return rotated.find(
    (topic) => topic.topicId !== topicId && topic.needsReview > 0,
  );
}

/** The toast after a decision: what happened, and what students see. */
export function decisionToastText({
  action,
  difficulty,
  title,
}: {
  action: ReviewAction;
  /** Set only when the professor changed the difficulty while approving. */
  difficulty?: Difficulty;
  title: string;
}) {
  switch (action) {
    case "approve":
      return `Approved “${title}”${difficulty ? `, marked ${professorDifficultyLabel(difficulty)}` : ""}. Students can't see it until you show it to them.`;
    case "request_edit":
      return `“${title}” was sent back for changes.`;
    case "request_regeneration":
      return `“${title}” will be rewritten and will come back here.`;
    case "reject":
      return `“${title}” was rejected.`;
  }
}

function advanceDashboardAfterDecision(
  dashboard: ProfessorQuestionReviewDashboard,
  topicId: string,
  action: "approve" | "reject" | "request_revision",
): ProfessorQuestionReviewDashboard {
  return {
    ...dashboard,
    candidates: [],
    topics: dashboard.topics.map((topic) =>
      topic.topicId === topicId
        ? {
            ...topic,
            approved: topic.approved + (action === "approve" ? 1 : 0),
            needsReview: Math.max(0, topic.needsReview - 1),
            rejectedOrRevisionRequested:
              topic.rejectedOrRevisionRequested +
              (action === "approve" ? 0 : 1),
            remaining:
              action === "request_revision"
                ? topic.remaining
                : Math.max(0, topic.remaining - 1),
          }
        : topic,
    ),
  };
}

function transitionForAction(action: ReviewAction): {
  action: "approve" | "reject" | "request_revision";
  revisionMethod?: QuestionRevisionMethod;
} {
  if (action === "approve") {
    return { action: "approve" };
  }
  if (action === "reject") {
    return { action: "reject" };
  }
  return {
    action: "request_revision",
    revisionMethod:
      action === "request_regeneration" ? "regeneration" : "manual",
  };
}

function ReviewQueueEmptyState({
  loaded,
  nextTopic,
  onOpenTopic,
  selectedTopic,
}: {
  loaded: boolean;
  nextTopic?: TopicSummary;
  onOpenTopic: (topicId: string) => void;
  selectedTopic?: TopicSummary;
}) {
  if (!loaded) return null;
  const text = professorReviewEmptyStateText({ loaded, selectedTopic });
  const noQuestionsYet = selectedTopic?.total === 0;

  return (
    <EmptyState
      className="rounded-panel bg-sheet px-5"
      action={
        noQuestionsYet ? (
          <Button asChild className="min-h-11">
            <Link href={ADD_QUESTION_HREF}>Add a question</Link>
          </Button>
        ) : nextTopic ? (
          <Button
            type="button"
            className="min-h-11"
            onClick={() => onOpenTopic(nextTopic.topicId)}
          >
            Review {nextTopic.title} ({nextTopic.needsReview} waiting)
          </Button>
        ) : (
          <Button asChild variant="secondary" className="min-h-11">
            <Link href={ADD_QUESTION_HREF}>Add a question</Link>
          </Button>
        )
      }
    >
      {text}
    </EmptyState>
  );
}

export function professorReviewEmptyStateText({
  loaded,
  selectedTopic,
}: {
  loaded: boolean;
  selectedTopic?: TopicSummary;
}) {
  if (!selectedTopic) {
    return "Choose a topic to start reviewing.";
  }
  if (!loaded) {
    return `Opening ${selectedTopic.title}…`;
  }
  if (selectedTopic.total === 0) {
    return `${selectedTopic.title} has no questions yet.`;
  }
  if (selectedTopic.remaining === 0) {
    return `All done with ${selectedTopic.title}.`;
  }
  const beingWritten = selectedTopic.remaining;
  return `Nothing to review in ${selectedTopic.title}. ${beingWritten} ${beingWritten === 1 ? "question is" : "questions are"} still being written.`;
}

function ReviewBlock({
  empty = "None written yet.",
  title,
  values,
}: {
  empty?: string;
  title: string;
  values: string[];
}) {
  const safeValues = values.filter(Boolean);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="type-h3 text-ink">{title}</h3>
      {safeValues.length > 1 ? (
        <ul className="flex max-w-prose list-disc flex-col gap-1.5 pl-5 type-body text-ink">
          {safeValues.map((value, index) => (
            <li key={`${title}-${index}`}>{value}</li>
          ))}
        </ul>
      ) : safeValues.length === 1 ? (
        <p className="type-body max-w-prose text-ink">{safeValues[0]}</p>
      ) : (
        <p className="type-body text-ink-muted">{empty}</p>
      )}
    </section>
  );
}
