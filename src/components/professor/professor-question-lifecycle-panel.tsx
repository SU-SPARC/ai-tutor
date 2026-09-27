"use client";

import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Eye, Pencil, RotateCcw, ShieldCheck } from "lucide-react";

import { ProfessorQuestionBatchConfirmation } from "@/components/professor/professor-question-batch-confirmation";
import {
  creationMethodLabel,
  professorDifficultyLabel,
  ProfessorTime,
  QuestionStateChip,
  REVISION_METHOD_LABELS,
  replaceSearchParam,
  SavedForLaterChip,
  formatProfessorDate,
  type QuestionDisplayState,
} from "@/components/professor/professor-question-labels";
import { ProfessorQuestionReserveControls } from "@/components/professor/professor-question-reserve-controls";
import { ProfessorQuestionVersionHistory } from "@/components/professor/professor-question-version-history";
import { ProfessorReviewReasonFields } from "@/components/professor/professor-review-reason-fields";
import {
  canEditQuestionVersion,
  ProfessorQuestionRevisionEditor,
  revisionActionLabel,
} from "@/components/professor/professor-question-revision-editor";
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
import { questionCode } from "@/lib/labels";
import { professorQuestionPath } from "@/lib/professor/question-paths";
import type {
  QuestionLifecycleAction,
  QuestionLifecycleBatchAction,
  QuestionLifecycleBatchResult,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionVersionDto,
  QuestionVersionState,
} from "@/lib/types";
import {
  questionIntakeProvenance,
  questionIntakeSourceLabel,
} from "@/lib/question-intake/provenance";
import { lifecycleActionRequiresReason } from "@/lib/tutor/question-lifecycle";
import {
  professorReviewReasonLabel,
  professorReviewReasonRequiresNote,
} from "@/lib/tutor/professor-review-reasons";
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";
import { cn } from "@/lib/utils";

// The version history lives in its own module; it is re-exported here because
// callers and tests import it from the lifecycle panel.
export { ProfessorQuestionVersionHistory };

type LifecycleFilter =
  | QuestionVersionState
  | "all"
  | "archived"
  | "practice_allowed"
  | "reserve";

type PublicationPreviewState = {
  action: "publish" | "rollback";
  expectedState: QuestionVersionState;
  question: QuestionLifecycleDto;
  versionId: number;
};

const FILTERS: Array<{ label: string; value: LifecycleFilter }> = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "draft" },
  { label: "Needs review", value: "needs_review" },
  { label: "Revision requested", value: "revision_requested" },
  { label: "Approved", value: "approved" },
  { label: "Saved for later", value: "reserve" },
  { label: "Practice allowed", value: "practice_allowed" },
  { label: "Published", value: "published" },
  { label: "Unpublished", value: "unpublished" },
  { label: "Rejected", value: "rejected" },
  { label: "Archived", value: "archived" },
];

const ACTION_LABELS: Record<QuestionLifecycleAction, string> = {
  approve: "Approve",
  archive: "Archive",
  publish: "Publish",
  reject: "Reject",
  request_revision: "Request revision",
  restore: "Restore",
  rollback: "Roll back",
  submit: "Submit for review",
  unpublish: "Unpublish",
};

/** The same actions once they have happened, for confirmations. */
const ACTION_DONE_LABELS: Record<QuestionLifecycleAction, string> = {
  approve: "approved (not published)",
  archive: "archived",
  publish: "published",
  reject: "rejected",
  request_revision: "sent back for revision",
  restore: "restored",
  rollback: "rolled back",
  submit: "submitted for review",
  unpublish: "unpublished",
};

const BATCH_DONE_LABELS: Record<QuestionLifecycleBatchAction, string> = {
  publish: "Published",
  reject: "Rejected",
  request_revision: "Sent back for revision",
};

function filterFromView(view?: string): LifecycleFilter {
  return FILTERS.find((item) => item.value === view)?.value ?? "all";
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
  return (
    question.recordState === "active" &&
    question.workingVersion.state === filter
  );
}

function displayState(question: QuestionLifecycleDto): QuestionDisplayState {
  return question.recordState === "archived"
    ? "archived"
    : question.workingVersion.state;
}

/**
 * The question bank (every question, grouped by syllabus topic, with views,
 * row actions and a sticky toolbar for batch actions) and, with
 * `hideBulkControls`, the single-question lifecycle on the detail page.
 */
export function ProfessorQuestionLifecyclePanel({
  focusQuestionId,
  hideBulkControls = false,
  initialDashboard,
  initialView,
}: {
  /** Opens this question's row immediately and marks it in the table. */
  focusQuestionId?: string;
  /** Single-question views have no use for lifecycle filters or batches. */
  hideBulkControls?: boolean;
  initialDashboard: QuestionLifecycleDashboard;
  /** A view to open on (`?view=approved`); anything unknown shows All. */
  initialView?: string;
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
  const [expandedId, setExpandedId] = useState<string | undefined>(
    focusQuestionId,
  );
  const [editingId, setEditingId] = useState<string>();
  const [filter, setFilter] = useState<LifecycleFilter>(() =>
    hideBulkControls ? "all" : filterFromView(initialView),
  );
  const [collapsedTopicIds, setCollapsedTopicIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string>();
  const [note, setNote] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [publicationPreview, setPublicationPreview] =
    useState<PublicationPreviewState>();
  const [selectedVersionIds, setSelectedVersionIds] = useState<number[]>([]);
  const [revisionMethod, setRevisionMethod] = useState<
    "manual" | "regeneration"
  >("manual");
  const decisionHeadingId = useId();

  const questions = useMemo(
    () =>
      dashboard.questions.filter((question) => matchesFilter(question, filter)),
    [dashboard.questions, filter],
  );
  const filterCounts = useMemo(
    () =>
      new Map(
        FILTERS.map((item) => [
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
  const busy =
    dashboard.readOnly || Boolean(activeKey) || Boolean(batchAction);
  const selectableInView = questions.filter(
    (question) =>
      isBatchSelectableQuestion(question) && !dashboard.readOnly,
  );
  const selectedInView = selectableInView.filter((question) =>
    selectedVersionIds.includes(question.workingVersion.versionId),
  ).length;
  const viewLabel =
    FILTERS.find((item) => item.value === filter)?.label ?? "All";

  function replaceQuestion(updated: QuestionLifecycleDto) {
    setDashboard((current) => ({
      ...current,
      questions: current.questions.map((candidate) =>
        candidate.questionId === updated.questionId ? updated : candidate,
      ),
    }));
  }

  function changeFilter(next: LifecycleFilter) {
    setFilter(next);
    replaceSearchParam("view", next === "all" ? undefined : next);
  }

  async function transition(
    question: QuestionLifecycleDto,
    action: QuestionLifecycleAction,
    versionId = question.workingVersion.versionId,
    expectedState = question.workingVersion.state,
  ) {
    if (lifecycleActionRequiresReason(action) && !reasonCode.trim()) {
      setMessage(`${ACTION_LABELS[action]} requires a reason.`);
      return false;
    }
    if (
      lifecycleActionRequiresReason(action) &&
      professorReviewReasonRequiresNote(reasonCode) &&
      !note.trim()
    ) {
      setMessage("Other requires an audit note.");
      return false;
    }

    const key = `${question.questionId}:${versionId}:${action}`;
    setActiveKey(key);
    setMessage(undefined);
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
            note: note.trim() || undefined,
            reasonCode: lifecycleActionRequiresReason(action)
              ? reasonCode.trim() || undefined
              : undefined,
            revisionMethod:
              action === "request_revision" ? revisionMethod : undefined,
            versionId,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        question?: QuestionLifecycleDto;
      };
      if (!response.ok || !payload.question) {
        setMessage(payload.error ?? "Lifecycle transition failed.");
        return false;
      }
      replaceQuestion(payload.question);
      setNote("");
      setReasonCode("");
      setSelectedVersionIds((current) =>
        current.filter((candidate) => candidate !== versionId),
      );
      toast({
        title: `“${question.workingVersion.title}” ${ACTION_DONE_LABELS[action]}.`,
        tone: "success",
      });
      return true;
    } catch {
      setMessage("Lifecycle transition failed.");
      return false;
    } finally {
      setActiveKey(undefined);
    }
  }

  async function regenerate(question: QuestionLifecycleDto) {
    const key = `${question.questionId}:regenerate`;
    setActiveKey(key);
    setMessage(undefined);
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
            supersedeReason:
              note.trim() ||
              (reasonCode ? professorReviewReasonLabel(reasonCode) : undefined),
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(payload.error ?? "Regeneration failed.");
        return;
      }
      const detailResponse = await fetch(
        `/api/professor/questions/${encodeURIComponent(question.questionId)}`,
      );
      const detail = (await detailResponse.json()) as {
        question?: QuestionLifecycleDto;
      };
      if (!detailResponse.ok || !detail.question) {
        setMessage(
          "Regeneration completed, but the lifecycle could not refresh.",
        );
        return;
      }
      replaceQuestion(detail.question);
      setSelectedVersionIds((current) =>
        current.filter(
          (versionId) => versionId !== question.workingVersion.versionId,
        ),
      );
      setNote("");
      setReasonCode("");
      toast({
        title: "A regenerated version was submitted for review.",
        tone: "success",
      });
    } catch {
      setMessage("Regeneration failed.");
    } finally {
      setActiveKey(undefined);
    }
  }

  async function correctProvenance(question: QuestionLifecycleDto) {
    const key = `${question.questionId}:correct-provenance`;
    setActiveKey(key);
    setMessage(undefined);
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
        setMessage(payload.error ?? "Provenance correction failed.");
        return;
      }
      replaceQuestion(payload.question);
      setSelectedVersionIds((current) =>
        current.filter(
          (versionId) => versionId !== question.workingVersion.versionId,
        ),
      );
      setMessage(
        "Provenance corrected without changing question content. Review and approve the new version before publishing.",
      );
    } catch {
      setMessage("Provenance correction failed.");
    } finally {
      setActiveKey(undefined);
    }
  }

  async function markInspected(question: QuestionLifecycleDto) {
    const version = question.workingVersion;
    const key = `${question.questionId}:${version.versionId}:inspect`;
    setActiveKey(key);
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
        setMessage(payload.error ?? "Inspection could not be recorded.");
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
        title: `Inspection recorded for v${version.versionNumber}.`,
        description: "You can now select it for a batch action.",
        tone: "success",
      });
    } catch {
      setMessage("Inspection could not be recorded.");
    } finally {
      setActiveKey(undefined);
    }
  }

  function openBatchConfirmation(action: QuestionLifecycleBatchAction) {
    if (selectedQuestions.length < 2) {
      setMessage("Select at least two versions for a batch action.");
      return;
    }
    if (
      action !== "publish" &&
      !selectedQuestions.every((question) =>
        question.workingVersion.allowedActions.includes(action),
      )
    ) {
      setMessage(
        `Every selected version must be eligible to ${ACTION_LABELS[action].toLowerCase()}.`,
      );
      return;
    }
    if (action !== "publish" && !reasonCode.trim()) {
      setMessage(`${ACTION_LABELS[action]} requires a reason.`);
      return;
    }
    if (
      action !== "publish" &&
      professorReviewReasonRequiresNote(reasonCode) &&
      !note.trim()
    ) {
      setMessage("Other requires an audit note.");
      return;
    }
    setMessage(undefined);
    setBatchAction(action);
  }

  function toggleBatchSelection(versionId: number, selected: boolean) {
    if (
      selected &&
      !selectedVersionIds.includes(versionId) &&
      selectedVersionIds.length >= 25
    ) {
      setMessage("A batch can contain at most 25 inspected versions.");
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
      setMessage(
        "A batch can contain at most 25 inspected versions, so only the first 25 were selected.",
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
    setNote("");
    setReasonCode("");
    const titles = result.questions
      .map((question) => question.workingVersion.title)
      .join(", ");
    setMessage(undefined);
    toast({
      title: `${BATCH_DONE_LABELS[result.action]} ${result.questions.length} questions.`,
      description: `${titles}${result.reviewedBy ? ` · ${result.reviewedBy.displayName}` : ""}`,
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

  function questionActions(question: QuestionLifecycleDto, inRow: boolean) {
    const working = question.workingVersion;
    return (
      <>
        {question.allowedActions.map((action) => {
          const key = `${question.questionId}:${working.versionId}:${action}`;
          const destructive = action === "reject" || action === "unpublish";
          const primary =
            !inRow && (action === "approve" || action === "publish");
          return (
            <Button
              key={action}
              type="button"
              size={inRow ? "sm" : "md"}
              variant={
                primary
                  ? "primary"
                  : destructive && !inRow
                    ? "destructive"
                    : "outline"
              }
              disabled={busy}
              loading={activeKey === key}
              onClick={() => {
                if (action === "publish") {
                  setMessage(undefined);
                  setPublicationPreview({
                    action,
                    expectedState: working.state,
                    question,
                    versionId: working.versionId,
                  });
                  return;
                }
                void transition(question, action);
              }}
            >
              {action === "publish" ? <Eye aria-hidden="true" /> : null}
              {action === "publish"
                ? "Review and publish"
                : ACTION_LABELS[action]}
            </Button>
          );
        })}
        {!question.reserve &&
        question.regenerationAllowed &&
        !question.provenanceCorrectionAllowed ? (
          <Button
            type="button"
            size={inRow ? "sm" : "md"}
            variant="outline"
            disabled={busy}
            loading={activeKey === `${question.questionId}:regenerate`}
            onClick={() => regenerate(question)}
          >
            <RotateCcw aria-hidden="true" />
            Regenerate
          </Button>
        ) : null}
        {!question.reserve && question.provenanceCorrectionAllowed ? (
          <Button
            type="button"
            size={inRow ? "sm" : "md"}
            variant="outline"
            disabled={busy}
            loading={
              activeKey === `${question.questionId}:correct-provenance`
            }
            onClick={() => correctProvenance(question)}
          >
            <ShieldCheck aria-hidden="true" />
            Correct provenance
          </Button>
        ) : null}
      </>
    );
  }

  function questionDetails(question: QuestionLifecycleDto) {
    const working = question.workingVersion;
    return (
      <div className="flex flex-col gap-6">
        <ProfessorQuestionReserveControls
          disabled={busy}
          question={question}
          onMessage={setMessage}
          onUpdated={(updated) => {
            replaceQuestion(updated);
            setSelectedVersionIds((current) =>
              current.filter((versionId) => versionId !== working.versionId),
            );
          }}
        />
        <WorkingVersionInspection
          active={
            activeKey === `${question.questionId}:${working.versionId}:inspect`
          }
          disabled={busy || !isBatchSelectableQuestion(question)}
          approvedByYouAt={ownApprovalTimestamp(
            question,
            dashboard.professorUserId,
          )}
          inspection={inspectionByVersionId.get(working.versionId)}
          question={question}
          showContent={!hideBulkControls}
          topicTitle={topicTitles.get(working.topicId)}
          onInspect={() => void markInspected(question)}
        />
        {!question.reserve && canEditQuestionVersion(question) ? (
          editingId === question.questionId ? (
            <ProfessorQuestionRevisionEditor
              key={question.workingVersion.versionId}
              disabled={busy}
              question={question}
              topics={dashboard.topics}
              onCancel={() => setEditingId(undefined)}
              onSaved={(updated) => {
                replaceQuestion(updated);
                setEditingId(undefined);
                setSelectedVersionIds((current) =>
                  current.filter(
                    (versionId) => versionId !== working.versionId,
                  ),
                );
                toast({
                  title: "Revision saved as a new draft.",
                  description: "Submit it for review when it is ready.",
                  tone: "success",
                });
              }}
            />
          ) : (
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              disabled={busy}
              onClick={() => setEditingId(question.questionId)}
            >
              <Pencil aria-hidden="true" />
              {revisionActionLabel(question)}
            </Button>
          )
        ) : null}
        <ProfessorQuestionVersionHistory
          activeKey={activeKey}
          dashboardReadOnly={dashboard.readOnly || Boolean(batchAction)}
          question={question}
          topics={dashboard.topics}
          onTransition={(action, versionId, expectedState) => {
            if (action === "rollback") {
              setMessage(undefined);
              setPublicationPreview({
                action,
                expectedState,
                question,
                versionId,
              });
              return;
            }
            void transition(question, action, versionId, expectedState);
          }}
        />
      </div>
    );
  }

  const decisionFields = (
    <div className="grid gap-4 lg:grid-cols-3">
      <ProfessorReviewReasonFields
        className="contents"
        disabled={dashboard.readOnly || Boolean(activeKey)}
        includeLifecycleReasons
        note={note}
        onNoteChange={setNote}
        onReasonCodeChange={setReasonCode}
        reasonCode={reasonCode}
      />
      <Field label="Revision method">
        <NativeSelect
          value={revisionMethod}
          onChange={(event) =>
            setRevisionMethod(
              event.target.value === "regeneration"
                ? "regeneration"
                : "manual",
            )
          }
        >
          <option value="manual">{REVISION_METHOD_LABELS.manual}</option>
          <option value="regeneration">
            {REVISION_METHOD_LABELS.regeneration}
          </option>
        </NativeSelect>
      </Field>
    </div>
  );

  const messageLine = (
    <div role="status" aria-live="polite">
      {message ? (
        <p className="type-small max-w-prose border-l-2 border-azure-500 py-1 pl-4 text-ink">
          {message}
        </p>
      ) : null}
    </div>
  );

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
              note={note}
              questions={selectedQuestions}
              reasonCode={reasonCode}
              revisionMethod={revisionMethod}
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
        open={Boolean(publicationPreview)}
        onOpenChange={(open) => {
          if (!open && !activeKey) setPublicationPreview(undefined);
        }}
      >
        {publicationPreview ? (
          <PublicationPreview
            active={Boolean(activeKey)}
            message={message}
            preview={publicationPreview}
            topicTitles={topicTitles}
            onCancel={() => setPublicationPreview(undefined)}
            onConfirm={async () => {
              const completed = await transition(
                publicationPreview.question,
                publicationPreview.action,
                publicationPreview.versionId,
                publicationPreview.expectedState,
              );
              if (completed) setPublicationPreview(undefined);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );

  if (hideBulkControls) {
    return (
      <div className="flex flex-col gap-6">
        {questions.map((question) => (
          <Fragment key={question.questionId}>
            <div className="flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5">
              {dashboard.readOnly ? (
                <p className="type-small text-ink-muted">
                  {dashboard.readOnlyReason ??
                    "This question is read-only in the current mode."}
                </p>
              ) : null}
              {decisionFields}
              <div
                role="group"
                aria-label={`Actions for ${question.workingVersion.title}`}
                className="flex flex-wrap gap-2"
              >
                {questionActions(question, false)}
              </div>
              {messageLine}
            </div>
            {questionDetails(question)}
          </Fragment>
        ))}
        {dialogs}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div
        role="group"
        aria-label="Question views"
        className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
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
                "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-chip px-3 type-small whitespace-nowrap transition-colors duration-fast focus-ring",
                "pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5",
                selected
                  ? "bg-azure-100 font-medium text-azure-700"
                  : "bg-surface-tint text-ink hover:bg-hover",
              )}
            >
              {item.label}
              <span
                className={cn(
                  "font-mono tabular",
                  selected ? "text-azure-700" : "text-ink-muted",
                )}
              >
                {filterCounts.get(item.value) ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby={decisionHeadingId}
        className="flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5"
      >
        <div className="flex flex-col gap-1">
          <p id={decisionHeadingId} className="type-body-strong text-ink">
            Reason for your next decision
          </p>
          <p className="type-small max-w-prose text-ink-muted">
            Reject, Request revision, Archive, Unpublish and Roll back need a
            reason, on one question or a batch.
            {dashboard.readOnly
              ? ` ${dashboard.readOnlyReason ?? "This question bank is read-only in the current mode."}`
              : ""}
          </p>
        </div>
        {decisionFields}
        {messageLine}
      </section>

      <p className="type-small max-w-prose text-ink-muted">
        {filter === "approved"
          ? "Select approved questions, then choose Publish selected. Each question is checked against the publication requirements before anything changes, and all of them publish together or none do."
          : "Choose the Approved view for bulk publication. Questions you approved or inspected yourself can be published together."}{" "}
        Batch approval is intentionally not available.
      </p>

      {questions.length === 0 ? (
        <EmptyState
          className="rounded-panel bg-sheet px-5"
          action={
            filter !== "all" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => changeFilter("all")}
              >
                Show all questions
              </Button>
            ) : undefined
          }
        >
          {filter === "all"
            ? "No questions yet. Add one from the Intake tab."
            : `No questions match the ${viewLabel} view.`}
        </EmptyState>
      ) : (
        <div className="rounded-panel bg-sheet">
          <Table>
            <TableCaption className="sr-only">
              {`Questions in the ${viewLabel} view, grouped by syllabus topic`}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    aria-label="Select every eligible question in this view"
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
                <TableHead>Question</TableHead>
                <TableHead>Working version</TableHead>
                <TableHead>Published</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            {groups.map((group) => {
              const collapsed = collapsedTopicIds.includes(group.id);
              return (
                <TableBody key={group.id}>
                  <TableRow className="bg-surface-tint hover:bg-surface-tint">
                    <th colSpan={6} scope="rowgroup" className="p-0 text-left">
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
                        <span className="type-small tabular text-ink-muted">
                          {group.questions.length}{" "}
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
                        const expanded = expandedId === question.questionId;
                        const selected = selectedVersionIds.includes(
                          working.versionId,
                        );
                        const intake = questionIntakeProvenance(question);
                        const detailsId = `question-details-${question.questionId}`;
                        return (
                          <Fragment key={question.questionId}>
                            <TableRow
                              id={`question-${question.questionId}`}
                              data-focused={focused ? "true" : undefined}
                              data-state={selected ? "selected" : undefined}
                              className={cn(
                                "align-top",
                                focused && !selected && "bg-surface-tint",
                              )}
                            >
                              <TableCell className="pt-3">
                                <Checkbox
                                  aria-label={`Select working version of ${working.title}`}
                                  checked={selected}
                                  disabled={
                                    !canSelect ||
                                    dashboard.readOnly ||
                                    Boolean(batchAction)
                                  }
                                  title={
                                    canSelect
                                      ? "Select this working version to publish, request revision, or reject it together with others"
                                      : "This working version is not eligible for batch review"
                                  }
                                  onCheckedChange={(checked) =>
                                    toggleBatchSelection(
                                      working.versionId,
                                      checked === true,
                                    )
                                  }
                                />
                              </TableCell>
                              <TableCell className="min-w-60">
                                <button
                                  type="button"
                                  className="flex max-w-xl items-start gap-2 rounded-control text-left focus-ring"
                                  aria-controls={expanded ? detailsId : undefined}
                                  aria-expanded={expanded}
                                  onClick={() =>
                                    setExpandedId((current) =>
                                      current === question.questionId
                                        ? undefined
                                        : question.questionId,
                                    )
                                  }
                                >
                                  <ChevronDown
                                    aria-hidden="true"
                                    className={cn(
                                      "mt-1 size-4 shrink-0 text-ink-muted transition-transform duration-fast",
                                      !expanded && "-rotate-90",
                                    )}
                                  />
                                  <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="type-body-strong text-ink">
                                      {working.title}
                                    </span>
                                    <span className="type-caption">
                                      <span className="font-mono">
                                        {questionCode(question.questionId)}
                                      </span>
                                      {" · "}
                                      {professorDifficultyLabel(
                                        working.difficulty,
                                      )}
                                    </span>
                                  </span>
                                </button>
                              </TableCell>
                              <TableCell className="pt-2.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <QuestionStateChip
                                    state={displayState(question)}
                                  />
                                  <span className="font-mono text-ink-muted">
                                    v{working.versionNumber}
                                  </span>
                                  {question.reserve ? (
                                    <SavedForLaterChip
                                      practiceAllowed={
                                        question.reserve.practiceAllowed
                                      }
                                    />
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="pt-3 font-mono">
                                {question.publishedVersion ? (
                                  `v${question.publishedVersion.versionNumber}`
                                ) : (
                                  <span className="text-ink-muted">
                                    <span aria-hidden="true">—</span>
                                    <span className="sr-only">
                                      Not published
                                    </span>
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="pt-3">
                                <span className="block text-ink">
                                  {working.createdBy.displayName}
                                </span>
                                <span className="type-caption">
                                  {creationMethodLabel(working.creationMethod)}
                                </span>
                                {intake ? (
                                  <StatusChip
                                    className="mt-1"
                                    icon={false}
                                    label={questionIntakeSourceLabel(intake)}
                                    tone="neutral"
                                  />
                                ) : null}
                              </TableCell>
                              <TableCell className="min-w-72">
                                <div className="flex flex-wrap justify-end gap-2">
                                  <Button asChild size="sm" variant="ghost">
                                    <Link
                                      href={professorQuestionPath(
                                        question.questionId,
                                      )}
                                      aria-label={`Open ${working.title}`}
                                    >
                                      Open
                                    </Link>
                                  </Button>
                                  {questionActions(question, true)}
                                </div>
                              </TableCell>
                            </TableRow>
                            {expanded ? (
                              <TableRow className="hover:bg-transparent">
                                <TableCell
                                  id={detailsId}
                                  colSpan={6}
                                  className="bg-surface p-4 whitespace-normal sm:p-6"
                                >
                                  {questionDetails(question)}
                                </TableCell>
                              </TableRow>
                            ) : null}
                          </Fragment>
                        );
                      })}
                </TableBody>
              );
            })}
          </Table>
        </div>
      )}

      {selectedQuestions.length > 0 ? (
        <div
          role="region"
          aria-label="Batch actions"
          className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-panel border border-azure-300 bg-azure-100 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
        >
          <p className="type-body-strong text-ink">
            {selectedQuestions.length}{" "}
            {selectedQuestions.length === 1 ? "question" : "questions"}{" "}
            selected
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => openBatchConfirmation("publish")}
            >
              Publish selected
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => openBatchConfirmation("request_revision")}
            >
              Batch request revision
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => openBatchConfirmation("reject")}
            >
              Batch reject
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={Boolean(batchAction)}
              onClick={() => setSelectedVersionIds([])}
            >
              Clear selection
            </Button>
          </div>
        </div>
      ) : null}

      {dialogs}
    </div>
  );
}

function WorkingVersionInspection({
  active,
  approvedByYouAt,
  disabled,
  inspection,
  onInspect,
  question,
  showContent,
  topicTitle,
}: {
  active: boolean;
  /** When the signed-in professor approved this exact version themselves. */
  approvedByYouAt?: string;
  disabled: boolean;
  inspection?: QuestionLifecycleDashboard["inspections"][number];
  onInspect: () => void;
  question: QuestionLifecycleDto;
  /** The full field list; the detail page already shows it above. */
  showContent: boolean;
  topicTitle?: string;
}) {
  const version = question.workingVersion;
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex max-w-prose flex-col gap-1">
          <h3 id={headingId} className="type-h3 text-ink">
            Your review of v{version.versionNumber}
          </h3>
          <p className="type-small text-ink-muted">
            To publish it with other questions, you must have approved this
            exact version or recorded an inspection after reading it in full.
          </p>
        </div>
        {inspection ? (
          <StatusChip label="Inspected" tone="approved" />
        ) : approvedByYouAt ? (
          <StatusChip label="Approved by you" tone="approved" />
        ) : (
          <StatusChip icon={false} label="Not reviewed by you" tone="neutral" />
        )}
      </div>
      {showContent ? (
        <dl className="grid gap-x-6 gap-y-2 type-small sm:grid-cols-[10rem_minmax(0,1fr)]">
          <InspectionTerm label="Topic">
            {topicTitle ?? version.topicId}
          </InspectionTerm>
          <InspectionTerm label="Difficulty">
            {professorDifficultyLabel(version.difficulty)}
          </InspectionTerm>
          <InspectionTerm label="Wording">
            <span className="max-w-prose">{version.prompt}</span>
          </InspectionTerm>
          <InspectionTerm label="Accepted answers">
            <span className="font-mono">
              {version.answer.acceptedAnswers.join(", ")}
            </span>
          </InspectionTerm>
          <InspectionTerm label="Answer explanation">
            {version.answer.explanation}
          </InspectionTerm>
          <InspectionTerm label="Solution steps">
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              {version.solutionSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </InspectionTerm>
          <InspectionTerm label="Hints">
            {version.hints.length > 0 ? (
              <ol className="flex list-decimal flex-col gap-1 pl-5">
                {version.hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ol>
            ) : (
              "None"
            )}
          </InspectionTerm>
          <InspectionTerm label="Misconception notes">
            {version.misconceptions.length > 0 ? (
              <ul className="flex list-disc flex-col gap-1 pl-5">
                {version.misconceptions.map((item) => (
                  <li key={item.id}>{item.feedback}</li>
                ))}
              </ul>
            ) : (
              "None"
            )}
          </InspectionTerm>
        </dl>
      ) : null}
      {inspection ? (
        <p className="type-small text-ink-muted">
          Inspected by {inspection.professorDisplayName} on{" "}
          <ProfessorTime value={inspection.inspectedAt} />.
        </p>
      ) : approvedByYouAt ? (
        <p className="type-small max-w-prose text-ink-muted">
          You approved this exact version on{" "}
          {formatProfessorDate(approvedByYouAt)}. That counts as your review,
          so it can be published together with other questions without a
          separate inspection.
        </p>
      ) : isBatchSelectableQuestion(question) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={disabled}
          loading={active}
          onClick={onInspect}
        >
          Mark this version inspected
        </Button>
      ) : (
        <p className="type-small text-ink-muted">
          Questions in this state cannot be selected for a batch.
        </p>
      )}
    </section>
  );
}

function InspectionTerm({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <>
      <dt className="type-body-strong text-ink">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
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
 * The publish (or roll-back) confirmation, as a dialog: the exact immutable
 * version students will receive, next to what it replaces, and the fields
 * that changed.
 */
function PublicationPreview({
  active,
  message,
  onCancel,
  onConfirm,
  preview,
  topicTitles,
}: {
  active: boolean;
  message?: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  preview: PublicationPreviewState;
  topicTitles: Map<string, string>;
}) {
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
    : ["Initial publication"];

  return (
    <DialogContent size="lg">
      <DialogHeader>
        <DialogTitle>Review before publishing</DialogTitle>
        <DialogDescription>
          This is the exact version students will receive. Confirm after
          reading what changed.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <PublicationSummary
            label={
              base
                ? `Current version v${base.versionNumber}`
                : "No current publication"
            }
            topicTitles={topicTitles}
            version={base}
          />
          <PublicationSummary
            label={`Version to publish v${target.versionNumber}`}
            topicTitles={topicTitles}
            version={target}
          />
        </div>
        <div className="flex flex-col gap-1 border-l-2 border-azure-500 pl-4">
          <p className="type-body-strong text-ink">Changed fields</p>
          <p className="type-small text-ink">{changed.join(", ")}</p>
        </div>
        <div role="status" aria-live="polite">
          {message ? (
            <p className="type-small text-red-700">{message}</p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={active}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          loading={active}
          onClick={() => void onConfirm()}
        >
          {preview.action === "rollback"
            ? "Confirm rollback publication"
            : "Confirm publication"}
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
        <p className="type-label">{label}</p>
        <p className="type-small text-ink-muted">Nothing is published.</p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-panel bg-surface-tint p-4">
      <p className="type-label">{label}</p>
      <p className="type-body-strong text-ink">{version.title}</p>
      <p className="type-small line-clamp-4 text-ink-muted">{version.prompt}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 type-small">
        <dt className="text-ink-muted">Topic</dt>
        <dd className="text-ink">
          {topicTitles.get(version.topicId) ?? version.topicId}
        </dd>
        <dt className="text-ink-muted">Difficulty</dt>
        <dd className="text-ink">
          {professorDifficultyLabel(version.difficulty)}
        </dd>
        <dt className="text-ink-muted">Final answer</dt>
        <dd className="font-mono text-ink">
          {version.answer.acceptedAnswers.join(", ")}
        </dd>
        <dt className="text-ink-muted">Structure</dt>
        <dd className="text-ink">
          {version.solutionSteps.length} steps, {version.hints.length} hints,{" "}
          {version.misconceptions.length} misconception notes
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
