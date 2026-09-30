"use client";

import {
  Fragment,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Pencil,
  Plus,
} from "lucide-react";

import {
  batchConfirmLabel,
  ProfessorQuestionBatchConfirmation,
} from "@/components/professor/professor-question-batch-confirmation";
import {
  professorQuestionNextStep,
  ProfessorQuestionStatusChips,
  ProfessorQuestionStudentView,
  ProfessorQuestionTechnicalDetails,
} from "@/components/professor/professor-question-detail-summary";
import {
  formatProfessorDate,
  plainActionError,
  professorDifficultyLabel,
  ProfessorTime,
  QuestionStateChip,
  questionStateLabel,
  replaceSearchParam,
  SavedForLaterChip,
  type QuestionDisplayState,
  olderVisibleVersion,
} from "@/components/professor/professor-question-labels";
import { ProfessorQuestionReserveControls } from "@/components/professor/professor-question-reserve-controls";
import { ProfessorQuestionVersionHistory } from "@/components/professor/professor-question-version-history";
import { ProfessorReviewReasonFields } from "@/components/professor/professor-review-reason-fields";
import {
  canEditQuestionVersion,
  ProfessorQuestionRevisionEditor,
  revisionActionLabel,
} from "@/components/professor/professor-question-revision-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
  professorQuestionPath,
  professorReviewQueuePagePath,
} from "@/lib/professor/question-paths";
import type {
  QuestionLifecycleAction,
  QuestionLifecycleBatchAction,
  QuestionLifecycleBatchResult,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionVersionDto,
  QuestionVersionState,
} from "@/lib/types";
import { lifecycleActionRequiresReason } from "@/lib/tutor/question-lifecycle";
import { professorReviewReasonRequiresNote } from "@/lib/tutor/professor-review-reasons";
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";
import { cn } from "@/lib/utils";

// The version history lives in its own module; it is re-exported here because
// callers and tests import it from the lifecycle panel.
export { ProfessorQuestionVersionHistory };

/** Every button on these screens is at least 44px tall. */
const TARGET = "h-11";
/** A secondary button that takes something away from students. */
const DESTRUCTIVE_OUTLINE = "border-red-300 text-red-700 hover:bg-red-100";

type LifecycleFilter =
  | QuestionVersionState
  | "all"
  | "archived"
  | "practice_allowed"
  | "reserve";

/** The four views most professors need, as chips. */
const FILTERS: Array<{ label: string; value: LifecycleFilter }> = [
  { label: "All", value: "all" },
  { label: "Students can see", value: "published" },
  { label: "Waiting for your review", value: "needs_review" },
  { label: "Hidden from students", value: "unpublished" },
];

/** Everything else, behind "More filters". */
const MORE_FILTERS: Array<{ label: string; value: LifecycleFilter }> = [
  { label: "Being written", value: "draft" },
  { label: "Sent back for changes", value: "revision_requested" },
  { label: "Approved, not yet shown", value: "approved" },
  { label: "Saved for later", value: "reserve" },
  { label: "Offered as extra practice", value: "practice_allowed" },
  { label: "Rejected", value: "rejected" },
  { label: "Removed", value: "archived" },
];

const ALL_FILTERS = [...FILTERS, ...MORE_FILTERS];

/** Actions that ask first, with the reason inside the dialog. */
type ReasonAction = "unpublish" | "reject" | "request_revision" | "archive";

/** The reason each action starts on, so most professors never change it. */
const DEFAULT_REASONS: Record<ReasonAction | "rollback", string> = {
  archive: "duplicate_repetition",
  reject: "duplicate_repetition",
  request_revision: "poor_wording",
  rollback: "restore_previous_release",
  unpublish: "content_correction",
};

export type PendingQuestionAction =
  | {
      action: ReasonAction;
      expectedState: QuestionVersionState;
      kind: "transition";
      question: QuestionLifecycleDto;
      versionId: number;
    }
  | { kind: "regenerate"; question: QuestionLifecycleDto }
  | { kind: "provenance"; question: QuestionLifecycleDto };

type PublicationPreviewState = {
  action: "publish" | "rollback";
  expectedState: QuestionVersionState;
  question: QuestionLifecycleDto;
  /** After an edit: send for review, approve, then show, in one go. */
  sequence?: boolean;
  versionId: number;
};

type TransitionOptions = {
  expectedState?: QuestionVersionState;
  note?: string;
  reasonCode?: string;
  versionId?: number;
};

function filterFromView(view?: string): LifecycleFilter {
  return ALL_FILTERS.find((item) => item.value === view)?.value ?? "all";
}

function matchesFilter(
  question: QuestionLifecycleDto,
  filter: LifecycleFilter,
) {
  if (filter === "all") return true;
  if (filter === "archived") return question.recordState === "archived";
  if (filter === "reserve") return Boolean(question.reserve);
  if (filter === "practice_allowed") {
    return Boolean(question.reserve?.practiceAllowed);
  }
  if (filter === "published") {
    return (
      question.recordState === "active" && Boolean(question.publishedVersion)
    );
  }
  return (
    question.recordState === "active" &&
    question.workingVersion.state === filter
  );
}

/** The version to hide when students can see this question, if any. */
function hideTarget(
  question: QuestionLifecycleDto,
): QuestionVersionDto | undefined {
  if (question.recordState !== "active") return undefined;
  const working = question.workingVersion;
  if (
    working.state === "published" &&
    question.allowedActions.includes("unpublish")
  ) {
    return working;
  }
  const published = question.publishedVersion;
  return published?.allowedActions?.includes("unpublish")
    ? published
    : undefined;
}

function canReserveQuestion(question: QuestionLifecycleDto) {
  return (
    !question.reserve &&
    question.recordState === "active" &&
    !question.publishedVersion &&
    ["approved", "unpublished"].includes(question.workingVersion.state)
  );
}

function canRewriteWithAi(question: QuestionLifecycleDto) {
  return (
    !question.reserve &&
    question.regenerationAllowed &&
    !question.provenanceCorrectionAllowed
  );
}

/** Why a row's checkbox is off, printed under the title (never hover-only). */
function selectBlockedReason(question: QuestionLifecycleDto) {
  if (isBatchSelectableQuestion(question)) return undefined;
  if (question.recordState === "archived") return "Put it back to select it.";
  if (question.reserve) {
    return "Take it out of Saved for later to select it.";
  }
  switch (question.workingVersion.state) {
    case "published":
      return "Students can already see it.";
    case "rejected":
      return "Rejected questions can't be selected.";
    default:
      return "Approve this first to select it.";
  }
}

async function postTransition(
  question: QuestionLifecycleDto,
  action: QuestionLifecycleAction,
  options: TransitionOptions = {},
): Promise<{ error?: string; question?: QuestionLifecycleDto }> {
  const versionId = options.versionId ?? question.workingVersion.versionId;
  const expectedState = options.expectedState ?? question.workingVersion.state;
  try {
    const response = await fetch(
      `/api/professor/questions/${encodeURIComponent(question.questionId)}/transitions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          action,
          expectedState,
          note: options.note?.trim() || undefined,
          reasonCode: lifecycleActionRequiresReason(action)
            ? options.reasonCode?.trim() || undefined
            : undefined,
          revisionMethod: action === "request_revision" ? "manual" : undefined,
          versionId,
        }),
      },
    );
    const payload = (await response.json()) as {
      error?: string;
      question?: QuestionLifecycleDto;
    };
    if (!response.ok || !payload.question) {
      return { error: plainActionError(response.status, payload.error) };
    }
    return { question: payload.question };
  } catch {
    return { error: plainActionError() };
  }
}

/** What happened, in the professor's words, for the toast. */
function doneMessage(
  action: QuestionLifecycleAction,
  title: string,
  versionNumber?: number,
) {
  switch (action) {
    case "approve":
      return `Approved “${title}”. Students can't see it until you show it to them.`;
    case "publish":
      return `“${title}” is now shown to students.`;
    case "unpublish":
      return `“${title}” is hidden from students.`;
    case "reject":
      return `“${title}” was rejected. Students won't see it.`;
    case "request_revision":
      return `“${title}” was sent back for changes.`;
    case "archive":
      return `“${title}” was removed from the question bank.`;
    case "restore":
      return `“${title}” is back in the question bank.`;
    case "rollback":
      return `Students now see version ${versionNumber ?? ""} of “${title}”.`;
    case "submit":
      return `“${title}” is waiting for your review.`;
  }
}

/**
 * The question bank (every question grouped by topic, four views, one
 * labelled action per row and a bar for several at once) and, with
 * `hideBulkControls`, one question's page: where it stands, at most three
 * buttons, and everything rarer under "More options and history".
 */
export function ProfessorQuestionLifecyclePanel({
  focusQuestionId,
  hideBulkControls = false,
  initialDashboard,
  initialEditing = false,
  initialView,
  moreOptions,
}: {
  /** Marks this question's row in the table. */
  focusQuestionId?: string;
  /** The single-question page: no views, no table, no selection. */
  hideBulkControls?: boolean;
  initialDashboard: QuestionLifecycleDashboard;
  /** Opens the editor straight away (`?edit=1` on the question page). */
  initialEditing?: boolean;
  /** A view to open on (`?view=approved`); anything unknown shows All. */
  initialView?: string;
  /**
   * Extra panels for the question page's "More options and history" block
   * (extra practice), rendered by the page because they need server data.
   */
  moreOptions?: ReactNode;
}) {
  const [activeKey, setActiveKey] = useState<string>();
  const [batchAction, setBatchAction] =
    useState<QuestionLifecycleBatchAction>();
  const [dashboard, setDashboard] = useState(initialDashboard);
  // A server refresh (for example after the intake panel saves a draft) hands
  // this component a new dashboard; adopt it instead of keeping stale rows.
  const [syncedDashboard, setSyncedDashboard] = useState(initialDashboard);
  if (initialDashboard !== syncedDashboard) {
    setSyncedDashboard(initialDashboard);
    setDashboard(initialDashboard);
  }
  const [editingId, setEditingId] = useState<string | undefined>(() =>
    hideBulkControls && initialEditing
      ? initialDashboard.questions[0]?.questionId
      : undefined,
  );
  const [filter, setFilter] = useState<LifecycleFilter>(() =>
    hideBulkControls ? "all" : filterFromView(initialView),
  );
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [bulkMessage, setBulkMessage] = useState<string>();
  const [pending, setPending] = useState<PendingQuestionAction>();
  const [pendingError, setPendingError] = useState<string>();
  const [publicationPreview, setPublicationPreview] =
    useState<PublicationPreviewState>();
  const [previewError, setPreviewError] = useState<string>();
  const [savedChanges, setSavedChanges] = useState<string>();
  const [selectedVersionIds, setSelectedVersionIds] = useState<number[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreDetailsRef = useRef<HTMLDetailsElement>(null);
  const whatHeadingId = useId();

  const questions = useMemo(
    () =>
      dashboard.questions.filter((question) => matchesFilter(question, filter)),
    [dashboard.questions, filter],
  );
  const filterCounts = useMemo(
    () =>
      new Map(
        ALL_FILTERS.map((item) => [
          item.value,
          dashboard.questions.filter((question) =>
            matchesFilter(question, item.value),
          ).length,
        ]),
      ),
    [dashboard.questions],
  );
  const groups = useMemo(() => {
    const byTopic = new Map<string, QuestionLifecycleDto[]>();
    for (const question of questions) {
      const topicId = question.workingVersion.topicId;
      byTopic.set(topicId, [...(byTopic.get(topicId) ?? []), question]);
    }
    const known = dashboard.topics
      .filter((topic) => byTopic.has(topic.id))
      .map((topic) => ({
        id: topic.id,
        questions: byTopic.get(topic.id) ?? [],
        title: topic.title,
      }));
    const knownIds = new Set(dashboard.topics.map((topic) => topic.id));
    const unknown = [...byTopic]
      .filter(([topicId]) => !knownIds.has(topicId))
      .map(([topicId, items]) => ({
        id: topicId,
        questions: items,
        title: topicId,
      }));
    return [...known, ...unknown];
  }, [dashboard.topics, questions]);
  const inspectionByVersionId = useMemo(
    () =>
      new Map(
        dashboard.inspections.map((inspection) => [
          inspection.versionId,
          inspection,
        ]),
      ),
    [dashboard.inspections],
  );
  const selectedQuestions = useMemo(
    () =>
      dashboard.questions.filter((question) =>
        selectedVersionIds.includes(question.workingVersion.versionId),
      ),
    [dashboard.questions, selectedVersionIds],
  );
  const topicTitles = useMemo(
    () => new Map(dashboard.topics.map((topic) => [topic.id, topic.title])),
    [dashboard.topics],
  );
  const busy = dashboard.readOnly || Boolean(activeKey) || Boolean(batchAction);
  const selectableInView = questions.filter(
    (question) => isBatchSelectableQuestion(question) && !dashboard.readOnly,
  );
  const selectedInView = selectableInView.filter((question) =>
    selectedVersionIds.includes(question.workingVersion.versionId),
  ).length;
  const viewLabel =
    ALL_FILTERS.find((item) => item.value === filter)?.label ?? "All";
  const moreFilterActive = MORE_FILTERS.some((item) => item.value === filter);

  function replaceQuestion(updated: QuestionLifecycleDto) {
    setDashboard((current) => ({
      ...current,
      questions: current.questions.map((candidate) =>
        candidate.questionId === updated.questionId ? updated : candidate,
      ),
    }));
  }

  function dropSelection(versionId: number) {
    setSelectedVersionIds((current) =>
      current.filter((candidate) => candidate !== versionId),
    );
  }

  function changeFilter(next: LifecycleFilter) {
    setFilter(next);
    replaceSearchParam("view", next === "all" ? undefined : next);
  }

  /**
   * Runs one lifecycle action and says what happened. Returns the error in
   * plain words (for a dialog to show) or undefined on success.
   */
  async function runTransition(
    question: QuestionLifecycleDto,
    action: QuestionLifecycleAction,
    options: TransitionOptions = {},
  ): Promise<string | undefined> {
    const versionId = options.versionId ?? question.workingVersion.versionId;
    const version =
      question.versions.find(
        (candidate) => candidate.versionId === versionId,
      ) ?? question.workingVersion;
    setActiveKey(`${question.questionId}:${versionId}:${action}`);
    setMessage(undefined);
    try {
      const result = await postTransition(question, action, options);
      if (!result.question) return result.error ?? plainActionError();
      const updated = result.question;
      replaceQuestion(updated);
      dropSelection(versionId);
      const title = question.workingVersion.title;
      toast({
        title: doneMessage(action, title, version.versionNumber),
        tone: "success",
        action:
          action === "unpublish"
            ? {
                label: "Undo",
                onClick: () =>
                  void runDirect(updated, "publish", {
                    expectedState: "unpublished",
                    versionId,
                  }),
              }
            : action === "archive"
              ? {
                  label: "Undo",
                  onClick: () => void runDirect(updated, "restore"),
                }
              : undefined,
      });
      return undefined;
    } finally {
      setActiveKey(undefined);
    }
  }

  /** An action that needs no dialog: a failure is said inline and in a toast. */
  async function runDirect(
    question: QuestionLifecycleDto,
    action: QuestionLifecycleAction,
    options: TransitionOptions = {},
  ) {
    const error = await runTransition(question, action, options);
    if (error) {
      setMessage(error);
      toast({ title: error, tone: "error" });
    }
  }

  async function regenerate(question: QuestionLifecycleDto, note: string) {
    setActiveKey(`${question.questionId}:regenerate`);
    try {
      const response = await fetch(
        `/api/professor/questions/${encodeURIComponent(question.questionId)}/regenerate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            keepPattern: true,
            mode: "deterministic",
            supersedeReason: note.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        return plainActionError(response.status, payload.error);
      }
      const detailResponse = await fetch(
        `/api/professor/questions/${encodeURIComponent(question.questionId)}`,
      );
      const detail = (await detailResponse.json()) as {
        question?: QuestionLifecycleDto;
      };
      if (!detailResponse.ok || !detail.question) {
        toast({
          title: "The AI wrote a new version. Reload the page to see it.",
          tone: "success",
        });
        return undefined;
      }
      replaceQuestion(detail.question);
      dropSelection(question.workingVersion.versionId);
      toast({
        title: `The AI rewrote “${question.workingVersion.title}”. The new version is waiting for your review.`,
        tone: "success",
      });
      return undefined;
    } catch {
      return plainActionError();
    } finally {
      setActiveKey(undefined);
    }
  }

  async function correctProvenance(question: QuestionLifecycleDto) {
    setActiveKey(`${question.questionId}:correct-provenance`);
    try {
      const response = await fetch(
        `/api/professor/questions/${encodeURIComponent(question.questionId)}/versions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            baseVersionId: question.workingVersion.versionId,
            correction: "unlinked_pattern_provenance",
            expectedWorkingVersionId: question.workingVersion.versionId,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        question?: QuestionLifecycleDto;
      };
      if (!response.ok || !payload.question) {
        return plainActionError(response.status);
      }
      replaceQuestion(payload.question);
      dropSelection(question.workingVersion.versionId);
      toast({
        title: `The source record of “${question.workingVersion.title}” is fixed. Approve it again before students can see it.`,
        tone: "success",
      });
      return undefined;
    } catch {
      return plainActionError();
    } finally {
      setActiveKey(undefined);
    }
  }

  async function markInspected(question: QuestionLifecycleDto) {
    const version = question.workingVersion;
    setActiveKey(`${question.questionId}:${version.versionId}:inspect`);
    setMessage(undefined);
    try {
      const response = await fetch("/api/professor/questions/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedState: version.state,
          questionId: question.questionId,
          versionId: version.versionId,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        inspection?: QuestionLifecycleDashboard["inspections"][number];
      };
      if (!response.ok || !payload.inspection) {
        setMessage(plainActionError(response.status));
        return;
      }
      setDashboard((current) => ({
        ...current,
        inspections: [
          ...current.inspections.filter(
            (inspection) =>
              inspection.versionId !== payload.inspection?.versionId,
          ),
          payload.inspection!,
        ],
      }));
      toast({
        title: `Marked “${version.title}” as checked.`,
        description: "You can now show it to students together with others.",
        tone: "success",
      });
    } catch {
      setMessage(plainActionError());
    } finally {
      setActiveKey(undefined);
    }
  }

  /**
   * After an edit, "Show my changes to students": send for review, approve,
   * then show, stopping at the first step that fails.
   */
  async function showChanges(question: QuestionLifecycleDto) {
    let current = question;
    setActiveKey(`${question.questionId}:show-changes`);
    try {
      for (let step = 0; step < 3; step += 1) {
        const state = current.workingVersion.state;
        const next: QuestionLifecycleAction | undefined =
          state === "draft"
            ? "submit"
            : state === "needs_review"
              ? "approve"
              : state === "approved" || state === "unpublished"
                ? "publish"
                : undefined;
        if (!next) break;
        const result = await postTransition(current, next);
        if (!result.question) {
          return step === 0
            ? (result.error ?? plainActionError())
            : `Your changes are saved, but students still see the old wording. ${result.error ?? plainActionError()}`;
        }
        current = result.question;
        replaceQuestion(current);
        if (next === "publish") {
          setSavedChanges(undefined);
          toast({
            title: `Students now see your changes to “${current.workingVersion.title}”.`,
            tone: "success",
          });
          return undefined;
        }
      }
      return plainActionError();
    } finally {
      setActiveKey(undefined);
    }
  }

  function openPublish(
    question: QuestionLifecycleDto,
    version?: QuestionVersionDto,
  ) {
    const target = version ?? question.workingVersion;
    setPreviewError(undefined);
    setPublicationPreview({
      action: "publish",
      expectedState: target.state,
      question,
      versionId: target.versionId,
    });
  }

  function openReasonAction(
    question: QuestionLifecycleDto,
    action: ReasonAction,
    version: QuestionVersionDto = question.workingVersion,
  ) {
    setPendingError(undefined);
    setPending({
      action,
      expectedState: version.state,
      kind: "transition",
      question,
      versionId: version.versionId,
    });
  }

  function openPending(next: PendingQuestionAction) {
    setPendingError(undefined);
    setPending(next);
  }

  function openBatchConfirmation(action: QuestionLifecycleBatchAction) {
    setBulkMessage(undefined);
    if (selectedQuestions.length === 1) {
      // The server groups 2 to 25; one question takes the single-question
      // path, which asks the same way.
      const [only] = selectedQuestions;
      if (!only.allowedActions.includes(action)) {
        setBulkMessage(
          action === "publish"
            ? "This question can't be shown to students yet. Approve it first."
            : "This question can't be changed that way right now.",
        );
        return;
      }
      if (action === "publish") openPublish(only);
      else openReasonAction(only, action);
      return;
    }
    if (
      !selectedQuestions.every((question) =>
        question.workingVersion.allowedActions.includes(action),
      )
    ) {
      setBulkMessage(
        action === "publish"
          ? "Some ticked questions can't be shown to students yet. Untick them, or approve them first."
          : "Some ticked questions can't be changed that way. Untick them and try again.",
      );
      return;
    }
    setBatchAction(action);
  }

  function toggleBatchSelection(versionId: number, selected: boolean) {
    setBulkMessage(undefined);
    if (
      selected &&
      !selectedVersionIds.includes(versionId) &&
      selectedVersionIds.length >= 25
    ) {
      setBulkMessage("You can tick up to 25 questions at a time.");
      return;
    }
    setSelectedVersionIds((current) =>
      selected
        ? [...current, versionId]
        : current.filter((candidate) => candidate !== versionId),
    );
  }

  function toggleViewSelection(selected: boolean) {
    const viewIds = selectableInView.map(
      (question) => question.workingVersion.versionId,
    );
    if (!selected) {
      setSelectedVersionIds((current) =>
        current.filter((versionId) => !viewIds.includes(versionId)),
      );
      return;
    }
    const next = [
      ...selectedVersionIds,
      ...viewIds.filter((versionId) => !selectedVersionIds.includes(versionId)),
    ];
    if (next.length > 25) {
      setBulkMessage(
        "You can tick up to 25 questions at a time, so only the first 25 are ticked.",
      );
    }
    setSelectedVersionIds(next.slice(0, 25));
  }

  function completeBatch(result: QuestionLifecycleBatchResult) {
    const updatedById = new Map(
      result.questions.map((question) => [question.questionId, question]),
    );
    setDashboard((current) => ({
      ...current,
      questions: current.questions.map(
        (question) => updatedById.get(question.questionId) ?? question,
      ),
    }));
    setBatchAction(undefined);
    setSelectedVersionIds([]);
    const count = result.questions.length;
    const titles = result.questions
      .map((question) => `“${question.workingVersion.title}”`)
      .join(", ");
    toast({
      title:
        result.action === "publish"
          ? `${count} questions are now shown to students.`
          : result.action === "reject"
            ? `Rejected ${count} questions. Students won't see them.`
            : `Sent ${count} questions back for changes.`,
      description: titles,
      tone: "success",
    });
  }

  function toggleTopic(topicId: string) {
    setCollapsedTopicIds((current) =>
      current.includes(topicId)
        ? current.filter((candidate) => candidate !== topicId)
        : [...current, topicId],
    );
  }

  /** Opens "More options and history" and brings one panel into view. */
  function jumpTo(anchorId: string) {
    setMoreOpen(true);
    if (moreDetailsRef.current) moreDetailsRef.current.open = true;
    window.requestAnimationFrame(() => {
      const target = document.getElementById(anchorId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      target?.focus({ preventScroll: true });
    });
  }

  const messageLine = (
    <div role="status" aria-live="polite">
      {message ? (
        <p className="type-body max-w-prose border-l-2 border-red-500 py-1 pl-4 text-ink">
          {message}
        </p>
      ) : null}
    </div>
  );

  async function confirmPending(reasonCode: string, note: string) {
    if (!pending) return;
    const error =
      pending.kind === "transition"
        ? await runTransition(pending.question, pending.action, {
            expectedState: pending.expectedState,
            note,
            reasonCode,
            versionId: pending.versionId,
          })
        : pending.kind === "regenerate"
          ? await regenerate(pending.question, note)
          : await correctProvenance(pending.question);
    if (error) setPendingError(error);
    else setPending(undefined);
  }

  const dialogs = (
    <>
      <Dialog
        open={Boolean(batchAction)}
        onOpenChange={(open) => {
          if (!open) setBatchAction(undefined);
        }}
      >
        {batchAction ? (
          <DialogContent size="lg">
            <ProfessorQuestionBatchConfirmation
              action={batchAction}
              disabled={dashboard.readOnly || Boolean(activeKey)}
              inDialog
              questions={selectedQuestions}
              revisionMethod="manual"
              topics={dashboard.topics}
              onCancel={() => setBatchAction(undefined)}
              onCompleted={completeBatch}
              onRemoveQuestion={(versionId) =>
                toggleBatchSelection(versionId, false)
              }
            />
          </DialogContent>
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !activeKey) setPending(undefined);
        }}
      >
        {pending ? (
          <DialogContent size="md">
            <ProfessorQuestionActionConfirmation
              active={Boolean(activeKey)}
              error={pendingError}
              inDialog
              pending={pending}
              onCancel={() => setPending(undefined)}
              onConfirm={confirmPending}
            />
          </DialogContent>
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(publicationPreview)}
        onOpenChange={(open) => {
          if (!open && !activeKey) setPublicationPreview(undefined);
        }}
      >
        {publicationPreview ? (
          <PublicationPreview
            active={Boolean(activeKey)}
            error={previewError}
            preview={publicationPreview}
            topicTitles={topicTitles}
            onCancel={() => setPublicationPreview(undefined)}
            onConfirm={async (reasonCode, note) => {
              const preview = publicationPreview;
              const error = preview.sequence
                ? await showChanges(preview.question)
                : await runTransition(preview.question, preview.action, {
                    expectedState: preview.expectedState,
                    note,
                    reasonCode,
                    versionId: preview.versionId,
                  });
              if (error) setPreviewError(error);
              else setPublicationPreview(undefined);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );

  if (hideBulkControls) {
    return (
      <div className="flex flex-col gap-8">
        {questions.map((question) => (
          <Fragment key={question.questionId}>{detailView(question)}</Fragment>
        ))}
        {dialogs}
      </div>
    );
  }

  function detailView(question: QuestionLifecycleDto) {
    const working = question.workingVersion;
    const title = working.title;
    const hide = hideTarget(question);
    const canEdit = !question.reserve && canEditQuestionVersion(question);
    const editing = editingId === question.questionId;
    const inReviewQueue =
      working.state === "needs_review" && question.recordState === "active";
    const showFixSourceButton =
      !question.reserve && question.provenanceCorrectionAllowed && !hide;
    const rollbackVersions = question.versions.filter(
      (version) =>
        version.versionId !== working.versionId &&
        version.allowedActions.includes("rollback"),
    );

    let primary: ReactNode = null;
    let editIsPrimary = false;
    // One mint button at a time: the saved-changes alert brings its own.
    const primaryVariant =
      savedChanges === question.questionId ? "secondary" : "cta";
    if (question.recordState === "archived") {
      if (question.allowedActions.includes("restore")) {
        primary = (
          <Button
            type="button"
            variant={primaryVariant}
            className={TARGET}
            disabled={busy}
            loading={
              activeKey ===
              `${question.questionId}:${working.versionId}:restore`
            }
            onClick={() => void runDirect(question, "restore")}
          >
            Put back
          </Button>
        );
      }
    } else if (
      !question.reserve &&
      question.allowedActions.includes("publish")
    ) {
      primary = (
        <Button
          type="button"
          variant={primaryVariant}
          className={TARGET}
          disabled={busy}
          onClick={() => openPublish(question)}
        >
          <Eye aria-hidden="true" />
          Show to students
        </Button>
      );
    } else if (question.allowedActions.includes("approve")) {
      primary = (
        <Button
          type="button"
          variant={primaryVariant}
          className={TARGET}
          disabled={busy}
          loading={
            activeKey === `${question.questionId}:${working.versionId}:approve`
          }
          onClick={() => void runDirect(question, "approve")}
        >
          Approve
        </Button>
      );
    } else if (question.allowedActions.includes("submit")) {
      primary = (
        <Button
          type="button"
          variant={primaryVariant}
          className={TARGET}
          disabled={busy}
          loading={
            activeKey === `${question.questionId}:${working.versionId}:submit`
          }
          onClick={() => void runDirect(question, "submit")}
        >
          Send for review
        </Button>
      );
    } else if (working.state === "revision_requested" && canEdit && !editing) {
      editIsPrimary = true;
      primary = (
        <Button
          type="button"
          variant={primaryVariant}
          className={TARGET}
          disabled={busy}
          onClick={() => setEditingId(question.questionId)}
        >
          <Pencil aria-hidden="true" />
          {revisionActionLabel(question)}
        </Button>
      );
    }

    const menuItems: ReactNode[] = [];
    if (question.allowedActions.includes("request_revision")) {
      menuItems.push(
        <DropdownMenuItem
          key="request_revision"
          disabled={busy}
          onSelect={() => openReasonAction(question, "request_revision")}
        >
          Send back for changes
        </DropdownMenuItem>,
      );
    }
    if (question.allowedActions.includes("reject")) {
      menuItems.push(
        <DropdownMenuItem
          key="reject"
          variant="destructive"
          disabled={busy}
          onSelect={() => openReasonAction(question, "reject")}
        >
          Reject
        </DropdownMenuItem>,
      );
    }
    if (canReserveQuestion(question)) {
      menuItems.push(
        <DropdownMenuItem
          key="reserve"
          onSelect={() => jumpTo("saved-for-later")}
        >
          Save for later
        </DropdownMenuItem>,
      );
    }
    if (moreOptions && (question.publishedVersion || question.reserve)) {
      menuItems.push(
        <DropdownMenuItem
          key="practice"
          onSelect={() => jumpTo("extra-practice")}
        >
          Extra practice settings
        </DropdownMenuItem>,
      );
    }
    if (rollbackVersions.length > 0) {
      menuItems.push(
        <DropdownMenuItem key="rollback" onSelect={() => jumpTo("all-changes")}>
          Go back to an earlier version
        </DropdownMenuItem>,
      );
    }
    if (canRewriteWithAi(question)) {
      menuItems.push(
        <DropdownMenuItem
          key="regenerate"
          disabled={busy}
          onSelect={() => openPending({ kind: "regenerate", question })}
        >
          Rewrite with AI
        </DropdownMenuItem>,
      );
    }
    if (
      !question.reserve &&
      question.provenanceCorrectionAllowed &&
      !showFixSourceButton
    ) {
      menuItems.push(
        <DropdownMenuItem
          key="provenance"
          disabled={busy}
          onSelect={() => openPending({ kind: "provenance", question })}
        >
          Fix source record
        </DropdownMenuItem>,
      );
    }
    if (question.allowedActions.includes("archive")) {
      menuItems.push(
        <DropdownMenuItem
          key="archive"
          variant="destructive"
          disabled={busy}
          onSelect={() => openReasonAction(question, "archive")}
        >
          Remove from question bank
        </DropdownMenuItem>,
      );
    }

    return (
      <>
        <section
          aria-labelledby={whatHeadingId}
          className="flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5"
        >
          <h2 id={whatHeadingId} className="type-h2 text-ink">
            What you can do
          </h2>
          <ProfessorQuestionStatusChips question={question} />
          <p className="type-body max-w-prose text-ink">
            {professorQuestionNextStep(question)}
          </p>
          {inReviewQueue ? (
            <p className="type-body max-w-prose text-ink">
              You can also review it with the other waiting questions in{" "}
              <Link
                className="text-azure-700 underline underline-offset-4 focus-ring"
                href={professorReviewQueuePagePath(
                  working.topicId,
                  question.questionId,
                )}
              >
                Review questions
              </Link>
              .
            </p>
          ) : null}
          {question.provenanceCorrectionAllowed && !question.reserve ? (
            <p className="type-body max-w-prose text-ink">
              The record of where this question came from needs fixing before
              students can see it. Choose Fix source record.
            </p>
          ) : null}
          <div
            role="group"
            aria-label={`Actions for ${title}`}
            className="flex flex-wrap gap-2"
          >
            {primary}
            {canEdit && !editIsPrimary && !editing ? (
              <Button
                type="button"
                variant="secondary"
                className={TARGET}
                disabled={busy}
                onClick={() => {
                  setSavedChanges(undefined);
                  setEditingId(question.questionId);
                }}
              >
                <Pencil aria-hidden="true" />
                {revisionActionLabel(question)}
              </Button>
            ) : null}
            {hide ? (
              <Button
                type="button"
                variant="outline"
                className={cn(TARGET, DESTRUCTIVE_OUTLINE)}
                disabled={busy}
                onClick={() => openReasonAction(question, "unpublish", hide)}
              >
                <EyeOff aria-hidden="true" />
                Hide from students
              </Button>
            ) : null}
            {showFixSourceButton ? (
              <Button
                type="button"
                variant="secondary"
                className={TARGET}
                disabled={busy}
                onClick={() => openPending({ kind: "provenance", question })}
              >
                Fix source record
              </Button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className={TARGET}>
                  More options
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-64">
                {menuItems}
                {menuItems.length > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onSelect={() => jumpTo("all-changes")}>
                  See all changes
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {messageLine}
          {savedChanges === question.questionId ? (
            <Alert variant="success">
              <AlertTitle>
                Your changes are saved. Students still see the old wording.
              </AlertTitle>
              <AlertDescription>
                <Button
                  type="button"
                  variant="cta"
                  className={cn(TARGET, "mt-2")}
                  disabled={busy}
                  onClick={() => {
                    setPreviewError(undefined);
                    setPublicationPreview({
                      action: "publish",
                      expectedState: working.state,
                      question,
                      sequence: true,
                      versionId: working.versionId,
                    });
                  }}
                >
                  Show my changes to students
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </section>

        {editing ? (
          <ProfessorQuestionRevisionEditor
            key={working.versionId}
            disabled={busy}
            question={question}
            topics={dashboard.topics}
            onCancel={() => setEditingId(undefined)}
            onSaved={(updated) => {
              replaceQuestion(updated);
              setEditingId(undefined);
              dropSelection(working.versionId);
              if (updated.publishedVersion) {
                setSavedChanges(updated.questionId);
              } else {
                toast({
                  title: `Your changes to “${updated.workingVersion.title}” are saved.`,
                  description: "Students can't see this question yet.",
                  tone: "success",
                });
              }
            }}
          />
        ) : null}

        {question.reserve ? (
          <ProfessorQuestionReserveControls
            disabled={busy}
            question={question}
            onMessage={(text) => toast({ title: text, tone: "success" })}
            onUpdated={(updated) => {
              replaceQuestion(updated);
              dropSelection(working.versionId);
            }}
          />
        ) : null}

        <ProfessorQuestionStudentView
          question={question}
          topicTitle={topicTitles.get(working.topicId)}
        />

        <details
          ref={moreDetailsRef}
          open={moreOpen}
          onToggle={(event) => setMoreOpen(event.currentTarget.open)}
          className="group/more rounded-panel bg-surface-tint"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-panel px-4 py-3 type-h3 text-ink focus-ring sm:px-5 [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden="true"
              className="size-5 text-ink-muted transition-transform duration-fast group-open/more:rotate-90"
            />
            More options and history
          </summary>
          <div className="flex flex-col gap-6 px-4 pb-5 sm:px-5">
            {moreOptions}
            {question.reserve ? null : (
              <ProfessorQuestionReserveControls
                disabled={busy}
                question={question}
                onMessage={(text) => toast({ title: text, tone: "success" })}
                onUpdated={(updated) => {
                  replaceQuestion(updated);
                  dropSelection(working.versionId);
                }}
              />
            )}
            <WorkingVersionInspection
              active={
                activeKey ===
                `${question.questionId}:${working.versionId}:inspect`
              }
              disabled={busy || !isBatchSelectableQuestion(question)}
              approvedByYouAt={ownApprovalTimestamp(
                question,
                dashboard.professorUserId,
              )}
              inspection={inspectionByVersionId.get(working.versionId)}
              question={question}
              onInspect={() => void markInspected(question)}
            />
            <ProfessorQuestionVersionHistory
              activeKey={activeKey}
              dashboardReadOnly={dashboard.readOnly || Boolean(batchAction)}
              question={question}
              topics={dashboard.topics}
              onTransition={(action, versionId, expectedState) => {
                const version = question.versions.find(
                  (candidate) => candidate.versionId === versionId,
                );
                if (!version) return;
                if (action === "rollback") {
                  setPreviewError(undefined);
                  setPublicationPreview({
                    action,
                    expectedState,
                    question,
                    versionId,
                  });
                  return;
                }
                openReasonAction(question, "unpublish", version);
              }}
            />
            <details className="group/tech rounded-panel bg-sheet">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-panel px-4 py-3 type-body-strong text-ink focus-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 text-ink-muted transition-transform duration-fast group-open/tech:rotate-90"
                />
                Technical details
              </summary>
              <div className="px-4 pb-4">
                <ProfessorQuestionTechnicalDetails
                  question={question}
                  topicTitle={topicTitles.get(working.topicId)}
                />
              </div>
            </details>
          </div>
        </details>
      </>
    );
  }

  /** The one labelled action a row offers, matching where it stands. */
  function rowPrimary(question: QuestionLifecycleDto) {
    const working = question.workingVersion;
    const hide = hideTarget(question);
    if (question.recordState === "archived") {
      return question.allowedActions.includes("restore") ? (
        <Button
          type="button"
          variant="secondary"
          className={TARGET}
          disabled={busy}
          loading={
            activeKey === `${question.questionId}:${working.versionId}:restore`
          }
          onClick={() => void runDirect(question, "restore")}
        >
          Put back
        </Button>
      ) : null;
    }
    if (!question.reserve && question.allowedActions.includes("publish")) {
      return (
        <Button
          type="button"
          variant="secondary"
          className={TARGET}
          disabled={busy}
          onClick={() => openPublish(question)}
        >
          <Eye aria-hidden="true" />
          Show to students
        </Button>
      );
    }
    if (working.state === "needs_review") {
      return (
        <Button asChild variant="secondary" className={TARGET}>
          <Link
            href={professorReviewQueuePagePath(
              working.topicId,
              question.questionId,
            )}
          >
            Review
          </Link>
        </Button>
      );
    }
    if (hide) {
      return (
        <Button
          type="button"
          variant="outline"
          className={cn(TARGET, DESTRUCTIVE_OUTLINE)}
          disabled={busy}
          onClick={() => openReasonAction(question, "unpublish", hide)}
        >
          <EyeOff aria-hidden="true" />
          Hide from students
        </Button>
      );
    }
    if (question.allowedActions.includes("submit")) {
      return (
        <Button
          type="button"
          variant="secondary"
          className={TARGET}
          disabled={busy}
          loading={
            activeKey === `${question.questionId}:${working.versionId}:submit`
          }
          onClick={() => void runDirect(question, "submit")}
        >
          Send for review
        </Button>
      );
    }
    if (!question.reserve && canEditQuestionVersion(question)) {
      return (
        <Button asChild variant="secondary" className={TARGET}>
          <Link href={`${professorQuestionPath(question.questionId)}?edit=1`}>
            <Pencil aria-hidden="true" />
            {revisionActionLabel(question)}
          </Link>
        </Button>
      );
    }
    return (
      <Button asChild variant="secondary" className={TARGET}>
        <Link href={professorQuestionPath(question.questionId)}>Open</Link>
      </Button>
    );
  }

  function rowMenu(question: QuestionLifecycleDto) {
    const working = question.workingVersion;
    const hide = hideTarget(question);
    const primaryIsHide =
      !question.allowedActions.includes("publish") &&
      working.state !== "needs_review" &&
      Boolean(hide);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" className={TARGET}>
            More
            <span className="sr-only"> actions for {working.title}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          <DropdownMenuItem asChild>
            <Link href={professorQuestionPath(question.questionId)}>
              Open question
            </Link>
          </DropdownMenuItem>
          {question.allowedActions.includes("approve") ? (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => void runDirect(question, "approve")}
            >
              Approve
            </DropdownMenuItem>
          ) : null}
          {hide && !primaryIsHide ? (
            <DropdownMenuItem
              disabled={busy}
              variant="destructive"
              onSelect={() => openReasonAction(question, "unpublish", hide)}
            >
              Hide from students
            </DropdownMenuItem>
          ) : null}
          {question.allowedActions.includes("request_revision") ? (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => openReasonAction(question, "request_revision")}
            >
              Send back for changes
            </DropdownMenuItem>
          ) : null}
          {canRewriteWithAi(question) ? (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => openPending({ kind: "regenerate", question })}
            >
              Rewrite with AI
            </DropdownMenuItem>
          ) : null}
          {!question.reserve && question.provenanceCorrectionAllowed ? (
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => openPending({ kind: "provenance", question })}
            >
              Fix source record
            </DropdownMenuItem>
          ) : null}
          {question.allowedActions.includes("reject") ? (
            <DropdownMenuItem
              disabled={busy}
              variant="destructive"
              onSelect={() => openReasonAction(question, "reject")}
            >
              Reject
            </DropdownMenuItem>
          ) : null}
          {question.allowedActions.includes("archive") ? (
            <DropdownMenuItem
              disabled={busy}
              variant="destructive"
              onSelect={() => openReasonAction(question, "archive")}
            >
              Remove from question bank
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const selectedCount = selectedQuestions.length;

  return (
    <div className="flex flex-col gap-5">
      <div
        role="group"
        aria-label="Which questions to list"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
      >
        {FILTERS.map((item) => {
          const selected = filter === item.value;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={selected}
              onClick={() => changeFilter(item.value)}
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-chip px-4 type-body whitespace-nowrap transition-colors duration-fast focus-ring",
                selected
                  ? "bg-azure-100 font-medium text-azure-700"
                  : "bg-surface-tint text-ink hover:bg-hover",
              )}
            >
              {item.label} · {filterCounts.get(item.value) ?? 0}
            </button>
          );
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-chip px-4 type-body whitespace-nowrap transition-colors duration-fast focus-ring",
                moreFilterActive
                  ? "bg-azure-100 font-medium text-azure-700"
                  : "bg-surface-tint text-ink hover:bg-hover",
              )}
            >
              {moreFilterActive
                ? `${viewLabel} · ${filterCounts.get(filter) ?? 0}`
                : "More filters"}
              <ChevronDown aria-hidden="true" className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-64">
            <DropdownMenuRadioGroup
              value={moreFilterActive ? filter : ""}
              onValueChange={(value) => changeFilter(value as LifecycleFilter)}
            >
              {MORE_FILTERS.map((item) => (
                <DropdownMenuRadioItem key={item.value} value={item.value}>
                  {item.label} · {filterCounts.get(item.value) ?? 0}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {dashboard.readOnly ? null : (
        <p className="type-body max-w-prose text-ink">
          Tick questions to show several to students at once.
        </p>
      )}

      {messageLine}

      {questions.length === 0 ? (
        <EmptyState
          className="rounded-panel bg-sheet px-5"
          action={
            filter !== "all" ? (
              <Button
                type="button"
                variant="secondary"
                className={TARGET}
                onClick={() => changeFilter("all")}
              >
                Show all questions
              </Button>
            ) : (
              <Button asChild variant="cta" className={TARGET}>
                <Link href="/professor/questions?tab=intake">
                  <Plus aria-hidden="true" />
                  Add a question
                </Link>
              </Button>
            )
          }
        >
          {filter === "all"
            ? "Your questions will be listed here."
            : `No questions match “${viewLabel}”.`}
        </EmptyState>
      ) : (
        <div className="rounded-panel bg-sheet">
          <Table>
            <TableCaption className="sr-only">
              {`Questions in the ${viewLabel} list, grouped by topic`}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    aria-label="Tick every question in this list that can be ticked"
                    checked={
                      selectedInView === 0
                        ? false
                        : selectedInView === selectableInView.length
                          ? true
                          : "indeterminate"
                    }
                    disabled={
                      selectableInView.length === 0 || Boolean(batchAction)
                    }
                    onCheckedChange={(checked) =>
                      toggleViewSelection(checked === true)
                    }
                  />
                </TableHead>
                <TableHead className="type-body-strong text-ink">
                  Question
                </TableHead>
                <TableHead className="type-body-strong text-ink">
                  Students
                </TableHead>
                <TableHead className="text-right type-body-strong text-ink">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            {groups.map((group) => {
              const collapsed = collapsedTopicIds.includes(group.id);
              return (
                <TableBody key={group.id}>
                  <TableRow className="bg-surface-tint hover:bg-surface-tint">
                    <th colSpan={4} scope="rowgroup" className="p-0 text-left">
                      <button
                        type="button"
                        aria-expanded={!collapsed}
                        onClick={() => toggleTopic(group.id)}
                        className="flex min-h-11 w-full items-center gap-2 px-3 text-left focus-ring"
                      >
                        <ChevronDown
                          aria-hidden="true"
                          className={cn(
                            "size-4 shrink-0 text-ink-muted transition-transform duration-fast",
                            collapsed && "-rotate-90",
                          )}
                        />
                        <span className="type-body-strong text-ink">
                          {group.title}
                        </span>
                        <span className="type-body tabular text-ink">
                          · {group.questions.length}{" "}
                          {group.questions.length === 1
                            ? "question"
                            : "questions"}
                        </span>
                      </button>
                    </th>
                  </TableRow>
                  {collapsed
                    ? null
                    : group.questions.map((question) => {
                        const working = question.workingVersion;
                        const canSelect = isBatchSelectableQuestion(question);
                        const focused = question.questionId === focusQuestionId;
                        const selected = selectedVersionIds.includes(
                          working.versionId,
                        );
                        const blockedReason = dashboard.readOnly
                          ? undefined
                          : selectBlockedReason(question);
                        return (
                          <TableRow
                            key={question.questionId}
                            id={`question-${question.questionId}`}
                            data-focused={focused ? "true" : undefined}
                            data-state={selected ? "selected" : undefined}
                            className={cn(
                              "align-top",
                              focused && !selected && "bg-surface-tint",
                            )}
                          >
                            <TableCell className="pt-4">
                              <Checkbox
                                aria-label={`Select “${working.title}”`}
                                checked={selected}
                                disabled={
                                  !canSelect ||
                                  dashboard.readOnly ||
                                  Boolean(batchAction)
                                }
                                onCheckedChange={(checked) =>
                                  toggleBatchSelection(
                                    working.versionId,
                                    checked === true,
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="min-w-60 whitespace-normal">
                              <div className="flex max-w-xl flex-col gap-0.5 py-1">
                                <Link
                                  href={professorQuestionPath(
                                    question.questionId,
                                  )}
                                  className="type-body-strong text-ink underline-offset-4 hover:underline focus-ring"
                                >
                                  {working.title}
                                </Link>
                                <span className="type-body text-ink">
                                  {professorDifficultyLabel(working.difficulty)}
                                </span>
                                {question.provenanceCorrectionAllowed &&
                                !question.reserve ? (
                                  <span className="type-body text-ink">
                                    The source record needs fixing before
                                    students can see it.
                                  </span>
                                ) : null}
                                {blockedReason ? (
                                  <span className="type-small text-ink-muted">
                                    {blockedReason}
                                  </span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="pt-3 whitespace-normal">
                              <StudentsCell question={question} />
                            </TableCell>
                            <TableCell className="min-w-64">
                              <div className="flex flex-wrap justify-end gap-2">
                                {rowPrimary(question)}
                                {rowMenu(question)}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                </TableBody>
              );
            })}
          </Table>
        </div>
      )}

      {selectedCount > 0 ? (
        <div
          role="region"
          aria-label="Ticked questions"
          className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-panel border border-azure-300 bg-azure-100 p-3 sm:px-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="type-body-strong text-ink">
              {selectedCount} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="cta"
                className={TARGET}
                disabled={busy}
                onClick={() => openBatchConfirmation("publish")}
              >
                Show {selectedCount} to students
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={TARGET}
                disabled={Boolean(batchAction)}
                onClick={() => {
                  setBulkMessage(undefined);
                  setSelectedVersionIds([]);
                }}
              >
                Clear selection
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={TARGET}
                    disabled={busy}
                  >
                    More
                    <span className="sr-only">
                      {" "}
                      actions for the ticked questions
                    </span>
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuItem
                    onSelect={() => openBatchConfirmation("request_revision")}
                  >
                    {batchConfirmLabel("request_revision", selectedCount)}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => openBatchConfirmation("reject")}
                  >
                    {batchConfirmLabel("reject", selectedCount)}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div role="status" aria-live="polite">
            {bulkMessage ? (
              <p className="type-body text-ink">{bulkMessage}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {dialogs}
    </div>
  );
}

/** The "Students" column: can they see it, in words, with the mint chip. */
function StudentsCell({ question }: { question: QuestionLifecycleDto }) {
  const working = question.workingVersion;
  if (question.recordState === "archived") {
    return <QuestionStateChip state="archived" />;
  }
  if (question.reserve) {
    return (
      <SavedForLaterChip practiceAllowed={question.reserve.practiceAllowed} />
    );
  }
  const published = question.publishedVersion;
  if (published) {
    const older = olderVisibleVersion(question);
    return (
      <div className="flex flex-col items-start gap-1">
        <StatusChip
          label={`Can see it (version ${published.versionNumber})`}
          tone="released"
        />
        {older ? (
          <span className="type-small text-ink">
            Your newer version: {questionStateLabel(working.state)}
          </span>
        ) : null}
      </div>
    );
  }
  if (working.state === "unpublished") {
    return <StatusChip icon={EyeOff} label="Hidden" tone="neutral" />;
  }
  return <QuestionStateChip state={working.state} />;
}

/**
 * The confirmation for an action that changes what students see or needs a
 * reason: a question as the title, one sentence naming the question, the
 * reason and note inside, and a button that restates the action. Without
 * `inDialog` it renders as a plain section (tests, previews).
 */
export function ProfessorQuestionActionConfirmation({
  active,
  error,
  inDialog = false,
  onCancel,
  onConfirm,
  pending,
}: {
  active: boolean;
  error?: string;
  inDialog?: boolean;
  onCancel: () => void;
  onConfirm: (reasonCode: string, note: string) => void | Promise<void>;
  pending: PendingQuestionAction;
}) {
  const title = pending.question.workingVersion.title;
  const needsReason = pending.kind === "transition";
  const [reasonCode, setReasonCode] = useState(
    pending.kind === "transition" ? DEFAULT_REASONS[pending.action] : "",
  );
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const headingId = useId();
  const noteId = useId();

  let heading: string;
  let sentence: string;
  let confirmLabel: string;
  let destructive = false;
  switch (pending.kind) {
    case "regenerate":
      heading = "Rewrite this question with AI?";
      sentence = `The AI will write a new version of “${title}”. The current version is kept in its history, and the new one waits for your review before students see it.`;
      confirmLabel = "Rewrite with AI";
      break;
    case "provenance":
      heading = "Fix where this question came from?";
      sentence = `We'll correct the source record of “${title}” without changing the question. You'll need to approve it again before students can see it.`;
      confirmLabel = "Fix source record";
      break;
    case "transition":
      switch (pending.action) {
        case "unpublish":
          heading = "Hide this question from students?";
          sentence = `Students will stop seeing “${title}” right away. Their past answers are kept. Hide it?`;
          confirmLabel = "Hide from students";
          destructive = true;
          break;
        case "reject":
          heading = "Reject this question?";
          sentence = `“${title}” will not be shown to students. It stays in your question bank, marked Rejected.`;
          confirmLabel = "Reject question";
          destructive = true;
          break;
        case "request_revision":
          heading = "Send this question back for changes?";
          sentence = `“${title}” goes back to being written. Nothing changes for students.`;
          confirmLabel = "Send back for changes";
          break;
        case "archive":
          heading = "Remove this question from the question bank?";
          sentence = `“${title}” will be moved out of your question bank. Students can't see it. You can put it back later.`;
          confirmLabel = "Remove from question bank";
          destructive = true;
          break;
      }
      break;
  }

  function submit() {
    if (needsReason && !reasonCode) {
      setReasonError("Please choose a reason.");
      return;
    }
    if (
      needsReason &&
      professorReviewReasonRequiresNote(reasonCode) &&
      !note.trim()
    ) {
      setNoteError(
        "Please explain in a few words why you chose Something else.",
      );
      return;
    }
    setReasonError(undefined);
    setNoteError(undefined);
    void onConfirm(reasonCode, note);
  }

  const body = (
    <>
      {needsReason ? (
        <ProfessorReviewReasonFields
          disabled={active}
          includeLifecycleReasons
          note={note}
          noteError={noteError}
          reasonCode={reasonCode}
          reasonError={reasonError}
          onNoteChange={(next) => {
            setNote(next);
            setNoteError(undefined);
          }}
          onReasonCodeChange={(next) => {
            setReasonCode(next);
            setReasonError(undefined);
          }}
        />
      ) : pending.kind === "regenerate" ? (
        <Field
          id={noteId}
          label="Note (optional)"
          description="What should change? Only instructors see this."
        >
          <Textarea
            className="min-h-11"
            disabled={active}
            maxLength={1000}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      ) : null}
      <div role="status" aria-live="polite">
        {error ? (
          <p className="type-body border-l-2 border-red-500 py-1 pl-4 text-ink">
            {error}
          </p>
        ) : null}
      </div>
    </>
  );

  const buttons = (
    <>
      <Button
        type="button"
        variant="secondary"
        className={TARGET}
        disabled={active}
        onClick={onCancel}
      >
        Cancel
      </Button>
      <Button
        type="button"
        variant={destructive ? "destructive" : "primary"}
        className={TARGET}
        loading={active}
        onClick={submit}
      >
        {confirmLabel}
      </Button>
    </>
  );

  if (inDialog) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription className="type-body text-ink">
            {sentence}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">{body}</DialogBody>
        <DialogFooter>{buttons}</DialogFooter>
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-6"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={headingId} className="type-h2 text-ink">
          {heading}
        </h2>
        <p className="type-body max-w-prose text-ink">{sentence}</p>
      </div>
      {body}
      <div className="flex flex-wrap justify-end gap-3">{buttons}</div>
    </section>
  );
}

function WorkingVersionInspection({
  active,
  approvedByYouAt,
  disabled,
  inspection,
  onInspect,
  question,
}: {
  active: boolean;
  /** When the signed-in professor approved this exact version themselves. */
  approvedByYouAt?: string;
  disabled: boolean;
  inspection?: QuestionLifecycleDashboard["inspections"][number];
  onInspect: () => void;
  question: QuestionLifecycleDto;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-prose flex-col gap-1">
          <h3 id={headingId} className="type-h3 text-ink">
            Your check of this version
          </h3>
          <p className="type-body text-ink">
            To show it to students together with other questions, you need to
            have approved this exact version, or marked it as checked after
            reading it.
          </p>
        </div>
        {inspection ? (
          <StatusChip label="Checked by you" tone="approved" />
        ) : approvedByYouAt ? (
          <StatusChip label="Approved by you" tone="approved" />
        ) : (
          <StatusChip
            icon={false}
            label="Not checked by you yet"
            tone="neutral"
          />
        )}
      </div>
      {inspection ? (
        <p className="type-body text-ink">
          Checked by {inspection.professorDisplayName} on{" "}
          <ProfessorTime value={inspection.inspectedAt} />.
        </p>
      ) : approvedByYouAt ? (
        <p className="type-body max-w-prose text-ink">
          You approved this exact version on{" "}
          {formatProfessorDate(approvedByYouAt)}. That counts as your review, so
          you can show it together with other questions.
        </p>
      ) : isBatchSelectableQuestion(question) ? (
        <Button
          type="button"
          variant="outline"
          className={cn(TARGET, "w-fit")}
          disabled={disabled}
          loading={active}
          onClick={onInspect}
        >
          Mark as checked
        </Button>
      ) : (
        <p className="type-body text-ink">
          Questions in this state can&apos;t be shown together with others.
        </p>
      )}
    </section>
  );
}

/** The signed-in professor's own approval of the current working version. */
function ownApprovalTimestamp(
  question: QuestionLifecycleDto,
  professorUserId?: string,
) {
  if (!professorUserId) return undefined;
  return question.events.find(
    (event) =>
      event.action === "approve" &&
      event.actorRole === "professor" &&
      event.versionId === question.workingVersion.versionId &&
      event.actor.userId === professorUserId,
  )?.actor.occurredAt;
}

function isBatchSelectableQuestion(question: QuestionLifecycleDto) {
  return (
    question.recordState === "active" &&
    !question.reserve &&
    ["needs_review", "approved", "unpublished"].includes(
      question.workingVersion.state,
    )
  );
}

/**
 * "Show this to students?" (or "Go back to version 2?"): the exact version
 * students will get next to what they see now, what changed, and for going
 * back, the reason. Also used after an edit to show the changes in one go.
 */
function PublicationPreview({
  active,
  error,
  onCancel,
  onConfirm,
  preview,
  topicTitles,
}: {
  active: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (reasonCode: string, note: string) => Promise<void>;
  preview: PublicationPreviewState;
  topicTitles: Map<string, string>;
}) {
  const [reasonCode, setReasonCode] = useState(DEFAULT_REASONS.rollback);
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const target = preview.question.versions.find(
    (version) => version.versionId === preview.versionId,
  );
  if (!target) return null;
  const base =
    preview.question.publishedVersion?.versionId !== target.versionId
      ? preview.question.publishedVersion
      : preview.question.versions.find(
          (version) => version.versionId === target.parentVersionId,
        );
  const changed = base
    ? changedQuestionVersionFields(base, target)
    : ["First time students see it"];
  const rollback = preview.action === "rollback";
  const title = preview.question.workingVersion.title;

  const heading = rollback
    ? `Go back to version ${target.versionNumber}?`
    : preview.sequence
      ? "Show your changes to students?"
      : "Show this to students?";
  const sentence = rollback
    ? `Students will see version ${target.versionNumber} of “${title}” starting now.`
    : preview.sequence
      ? `Students will see your new wording of “${title}” starting now.`
      : `Students will see “${title}” starting now.`;
  const confirmLabel = rollback
    ? `Go back to version ${target.versionNumber}`
    : preview.sequence
      ? "Show my changes to students"
      : "Show to students";

  function submit() {
    if (rollback && !reasonCode) {
      setReasonError("Please choose a reason.");
      return;
    }
    if (
      rollback &&
      professorReviewReasonRequiresNote(reasonCode) &&
      !note.trim()
    ) {
      setNoteError(
        "Please explain in a few words why you chose Something else.",
      );
      return;
    }
    setReasonError(undefined);
    setNoteError(undefined);
    void onConfirm(reasonCode, note);
  }

  return (
    <DialogContent size="lg">
      <DialogHeader>
        <DialogTitle>{heading}</DialogTitle>
        <DialogDescription className="type-body text-ink">
          {sentence}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <PublicationSummary
            label="What students see now"
            topicTitles={topicTitles}
            version={base && base.state === "published" ? base : undefined}
          />
          <PublicationSummary
            label="What they will see"
            topicTitles={topicTitles}
            version={target}
          />
        </div>
        <div className="flex flex-col gap-1 border-l-2 border-azure-500 pl-4">
          <p className="type-body-strong text-ink">What changed</p>
          <p className="type-body text-ink">
            {changed.join(", ") || "Nothing"}
          </p>
        </div>
        {rollback ? (
          <ProfessorReviewReasonFields
            disabled={active}
            includeLifecycleReasons
            note={note}
            noteError={noteError}
            reasonCode={reasonCode}
            reasonError={reasonError}
            onNoteChange={(next) => {
              setNote(next);
              setNoteError(undefined);
            }}
            onReasonCodeChange={(next) => {
              setReasonCode(next);
              setReasonError(undefined);
            }}
          />
        ) : null}
        <div role="status" aria-live="polite">
          {error ? (
            <p className="type-body border-l-2 border-red-500 py-1 pl-4 text-ink">
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          className={TARGET}
          disabled={active}
          onClick={onCancel}
        >
          {rollback ? "Cancel" : "Keep hidden"}
        </Button>
        <Button
          type="button"
          variant="cta"
          className={TARGET}
          loading={active}
          onClick={submit}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function PublicationSummary({
  label,
  topicTitles,
  version,
}: {
  label: string;
  topicTitles: Map<string, string>;
  version?: QuestionVersionDto;
}) {
  if (!version) {
    return (
      <div className="flex flex-col gap-2 rounded-panel bg-surface-tint p-4">
        <p className="type-body-strong text-ink">{label}</p>
        <p className="type-body text-ink">Nothing yet.</p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-panel bg-surface-tint p-4">
      <p className="type-body-strong text-ink">{label}</p>
      <p className="type-body-strong text-ink">{version.title}</p>
      <p className="type-body line-clamp-4 text-ink">{version.prompt}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 type-body">
        <dt className="text-ink-muted">Topic</dt>
        <dd className="text-ink">
          {topicTitles.get(version.topicId) ?? version.topicId}
        </dd>
        <dt className="text-ink-muted">Difficulty</dt>
        <dd className="text-ink">
          {professorDifficultyLabel(version.difficulty)}
        </dd>
        <dt className="text-ink-muted">Correct answer</dt>
        <dd className="font-mono text-ink">
          {version.answer.acceptedAnswers.join(", ")}
        </dd>
        <dt className="text-ink-muted">Steps and hints</dt>
        <dd className="text-ink">
          {version.solutionSteps.length} steps, {version.hints.length} hints
        </dd>
      </dl>
    </div>
  );
}

/**
 * Kept for callers that still import the badge by this name; it is the
 * shared lifecycle StatusChip.
 */
export function LifecycleBadge({ state }: { state: QuestionDisplayState }) {
  return <QuestionStateChip state={state} />;
}
