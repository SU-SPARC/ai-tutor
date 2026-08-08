"use client";

import { Fragment, useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  Loader2,
  Pencil,
  RotateCcw,
} from "lucide-react";

import { ProfessorQuestionBatchConfirmation } from "@/components/professor/professor-question-batch-confirmation";
import {
  canEditGeneratedDraft,
  ProfessorQuestionRevisionEditor,
} from "@/components/professor/professor-question-revision-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";

type LifecycleFilter = QuestionVersionState | "all" | "archived";

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

export function ProfessorQuestionLifecyclePanel({
  initialDashboard,
}: {
  initialDashboard: QuestionLifecycleDashboard;
}) {
  const [activeKey, setActiveKey] = useState<string>();
  const [batchAction, setBatchAction] =
    useState<QuestionLifecycleBatchAction>();
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [expandedId, setExpandedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [filter, setFilter] = useState<LifecycleFilter>("all");
  const [message, setMessage] = useState<string>();
  const [reasonCode, setReasonCode] = useState("");
  const [publicationPreview, setPublicationPreview] =
    useState<PublicationPreviewState>();
  const [selectedVersionIds, setSelectedVersionIds] = useState<number[]>([]);
  const [revisionMethod, setRevisionMethod] = useState<
    "manual" | "regeneration"
  >("manual");

  const questions = useMemo(
    () =>
      dashboard.questions.filter((question) => {
        if (filter === "all") return true;
        if (filter === "archived") return question.recordState === "archived";
        return (
          question.recordState === "active" &&
          question.workingVersion.state === filter
        );
      }),
    [dashboard.questions, filter],
  );
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

  async function transition(
    question: QuestionLifecycleDto,
    action: QuestionLifecycleAction,
    versionId = question.workingVersion.versionId,
    expectedState = question.workingVersion.state,
  ) {
    if (lifecycleActionRequiresReason(action) && !reasonCode.trim()) {
      setMessage(`${ACTION_LABELS[action]} requires a reason code.`);
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
            reasonCode: reasonCode.trim() || undefined,
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
      setDashboard((current) => ({
        ...current,
        questions: current.questions.map((candidate) =>
          candidate.questionId === payload.question?.questionId
            ? payload.question
            : candidate,
        ),
      }));
      setReasonCode("");
      setSelectedVersionIds((current) =>
        current.filter((candidate) => candidate !== versionId),
      );
      setMessage(`${ACTION_LABELS[action]} completed.`);
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
            supersedeReason: reasonCode.trim() || undefined,
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
      setDashboard((current) => ({
        ...current,
        questions: current.questions.map((candidate) =>
          candidate.questionId === detail.question?.questionId
            ? detail.question
            : candidate,
        ),
      }));
      setSelectedVersionIds((current) =>
        current.filter(
          (versionId) => versionId !== question.workingVersion.versionId,
        ),
      );
      setMessage("A regenerated version was submitted for review.");
    } catch {
      setMessage("Regeneration failed.");
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
      setMessage(
        "Inspection recorded for this exact immutable version. It can now be selected for a supported batch action.",
      );
    } catch {
      setMessage("Inspection could not be recorded.");
    } finally {
      setActiveKey(undefined);
    }
  }

  function openBatchConfirmation(action: QuestionLifecycleBatchAction) {
    if (selectedQuestions.length < 2) {
      setMessage("Select at least two inspected versions for a batch action.");
      return;
    }
    if (
      !selectedQuestions.every(
        (question) =>
          question.workingVersion.allowedActions.includes(action) &&
          (action !== "publish" ||
            question.workingVersion.validationStatus === "valid"),
      )
    ) {
      setMessage(
        `Every selected version must be eligible to ${ACTION_LABELS[action].toLowerCase()}.`,
      );
      return;
    }
    if (action !== "publish" && !reasonCode.trim()) {
      setMessage(`${ACTION_LABELS[action]} requires a reason code.`);
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
    setReasonCode("");
    setMessage(
      `${ACTION_LABELS[result.action]} completed for ${result.questions.length} questions${result.reviewedBy ? ` by ${result.reviewedBy.displayName} at ${result.reviewedBy.occurredAt}` : ""}.`,
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" aria-label="Lifecycle filters">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={filter === item.value ? "default" : "outline"}
            aria-pressed={filter === item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_12rem_auto] md:items-end">
        <label className="space-y-1 text-xs text-muted-foreground">
          Reason code for revision, rejection, unpublish, rollback, or archive
          <Input
            value={reasonCode}
            maxLength={80}
            placeholder="content_correction"
            onChange={(event) => setReasonCode(event.target.value)}
          />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          Revision method
          <select
            className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm"
            value={revisionMethod}
            onChange={(event) =>
              setRevisionMethod(
                event.target.value === "regeneration"
                  ? "regeneration"
                  : "manual",
              )
            }
          >
            <option value="manual">Manual revision</option>
            <option value="regeneration">Regeneration</option>
          </select>
        </label>
        <div className="flex gap-2">
          <Badge variant="secondary">{dashboard.mode}</Badge>
          {dashboard.readOnly ? (
            <Badge variant="outline">read-only</Badge>
          ) : null}
        </div>
      </div>

      {message ? (
        <p
          className="border border-border bg-muted px-3 py-2 text-sm"
          role="status"
        >
          {message}
        </p>
      ) : null}

      <section
        aria-label="Inspected question batch actions"
        className="space-y-2 border border-border bg-muted/20 p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              {selectedQuestions.length} inspected versions selected
            </p>
            <p className="text-xs text-muted-foreground">
              Open a question and record inspection of its exact working
              version before selecting it. Batch approval is intentionally not
              available.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                dashboard.readOnly || Boolean(activeKey) || Boolean(batchAction)
              }
              onClick={() => openBatchConfirmation("request_revision")}
            >
              Batch request revision
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={
                dashboard.readOnly || Boolean(activeKey) || Boolean(batchAction)
              }
              onClick={() => openBatchConfirmation("reject")}
            >
              Batch reject
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                dashboard.readOnly || Boolean(activeKey) || Boolean(batchAction)
              }
              onClick={() => openBatchConfirmation("publish")}
            >
              Review batch publication
            </Button>
            {selectedQuestions.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={Boolean(batchAction)}
                onClick={() => setSelectedVersionIds([])}
              >
                Clear selection
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {batchAction ? (
        <ProfessorQuestionBatchConfirmation
          action={batchAction}
          disabled={dashboard.readOnly || Boolean(activeKey)}
          inspections={dashboard.inspections.filter((inspection) =>
            selectedVersionIds.includes(inspection.versionId),
          )}
          questions={selectedQuestions}
          reasonCode={reasonCode}
          revisionMethod={revisionMethod}
          topics={dashboard.topics}
          onCancel={() => setBatchAction(undefined)}
          onCompleted={completeBatch}
        />
      ) : null}

      {publicationPreview ? (
        <PublicationPreview
          active={Boolean(activeKey)}
          preview={publicationPreview}
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Question</TableHead>
            <TableHead>Working</TableHead>
            <TableHead>Published</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Attribution</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {questions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground">
                No questions match this lifecycle view.
              </TableCell>
            </TableRow>
          ) : (
            questions.map((question) => {
              const working = question.workingVersion;
              const inspection = inspectionByVersionId.get(working.versionId);
              const canSelect =
                Boolean(inspection) && isBatchSelectableQuestion(question);
              return (
                <Fragment key={question.questionId}>
                  <TableRow>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select inspected version of ${working.title}`}
                        checked={selectedVersionIds.includes(working.versionId)}
                        disabled={
                          !canSelect || dashboard.readOnly || Boolean(batchAction)
                        }
                        title={
                          canSelect
                            ? "Select this inspected immutable version"
                            : "Inspect an eligible working version before selection"
                        }
                        onChange={(event) =>
                          toggleBatchSelection(
                            working.versionId,
                            event.target.checked,
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="flex max-w-xl items-start gap-2 text-left"
                        aria-expanded={expandedId === question.questionId}
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
                          className={
                            expandedId === question.questionId
                              ? "mt-0.5 h-4 w-4 rotate-180"
                              : "mt-0.5 h-4 w-4"
                          }
                        />
                        <span>
                          <span className="block font-medium">
                            {working.title}
                          </span>
                          <span className="line-clamp-2 text-sm text-muted-foreground">
                            {working.prompt}
                          </span>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>
                      <LifecycleBadge
                        state={
                          question.recordState === "archived"
                            ? "archived"
                            : working.state
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {question.publishedVersion ? (
                        <Badge variant="success">
                          v{question.publishedVersion.versionNumber}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                    </TableCell>
                    <TableCell>v{working.versionNumber}</TableCell>
                    <TableCell className="text-sm">
                      <span className="block">
                        {working.createdBy.displayName}
                      </span>
                      <span className="text-muted-foreground">
                        {working.creationMethod}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        {question.allowedActions.map((action) => {
                          const key = `${question.questionId}:${working.versionId}:${action}`;
                          return (
                            <Button
                              key={action}
                              type="button"
                              size="sm"
                              variant={
                                action === "reject" || action === "unpublish"
                                  ? "destructive"
                                  : "outline"
                              }
                              disabled={
                                dashboard.readOnly ||
                                Boolean(activeKey) ||
                                Boolean(batchAction)
                              }
                              onClick={() => {
                                if (action === "publish") {
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
                              {activeKey === key ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              {action === "publish" ? (
                                <Eye className="h-4 w-4" />
                              ) : null}
                              {action === "publish"
                                ? "Review & publish"
                                : ACTION_LABELS[action]}
                            </Button>
                          );
                        })}
                        {question.regenerationAllowed ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={
                              dashboard.readOnly ||
                              Boolean(activeKey) ||
                              Boolean(batchAction)
                            }
                            onClick={() => regenerate(question)}
                          >
                            {activeKey ===
                            `${question.questionId}:regenerate` ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                            Regenerate
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedId === question.questionId ? (
                    <TableRow>
                      <TableCell colSpan={7}>
                        <WorkingVersionInspection
                          active={
                            activeKey ===
                            `${question.questionId}:${working.versionId}:inspect`
                          }
                          disabled={
                            dashboard.readOnly ||
                            Boolean(activeKey) ||
                            Boolean(batchAction) ||
                            !isBatchSelectableQuestion(question)
                          }
                          inspection={inspection}
                          question={question}
                          topicTitle={
                            dashboard.topics.find(
                              (topic) => topic.id === working.topicId,
                            )?.title
                          }
                          onInspect={() => void markInspected(question)}
                        />
                        {canEditGeneratedDraft(question) ? (
                          editingId === question.questionId ? (
                            <ProfessorQuestionRevisionEditor
                              key={question.workingVersion.versionId}
                              disabled={
                                dashboard.readOnly ||
                                Boolean(activeKey) ||
                                Boolean(batchAction)
                              }
                              question={question}
                              topics={dashboard.topics}
                              onCancel={() => setEditingId(undefined)}
                              onSaved={(updated) => {
                                setDashboard((current) => ({
                                  ...current,
                                  questions: current.questions.map(
                                    (candidate) =>
                                      candidate.questionId ===
                                      updated.questionId
                                        ? updated
                                        : candidate,
                                  ),
                                }));
                                setEditingId(undefined);
                                setSelectedVersionIds((current) =>
                                  current.filter(
                                    (versionId) =>
                                      versionId !== working.versionId,
                                  ),
                                );
                                setMessage(
                                  "Revision saved as a new draft. Submit it for review when ready.",
                                );
                              }}
                            />
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mb-4"
                              disabled={
                                dashboard.readOnly ||
                                Boolean(activeKey) ||
                                Boolean(batchAction)
                              }
                              onClick={() => setEditingId(question.questionId)}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit generated draft
                            </Button>
                          )
                        ) : null}
                        <VersionHistory
                          activeKey={activeKey}
                          dashboardReadOnly={
                            dashboard.readOnly || Boolean(batchAction)
                          }
                          question={question}
                          onTransition={(action, versionId, expectedState) => {
                            if (action === "rollback") {
                              setPublicationPreview({
                                action,
                                expectedState,
                                question,
                                versionId,
                              });
                              return;
                            }
                            void transition(
                              question,
                              action,
                              versionId,
                              expectedState,
                            );
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function WorkingVersionInspection({
  active,
  disabled,
  inspection,
  onInspect,
  question,
  topicTitle,
}: {
  active: boolean;
  disabled: boolean;
  inspection?: QuestionLifecycleDashboard["inspections"][number];
  onInspect: () => void;
  question: QuestionLifecycleDto;
  topicTitle?: string;
}) {
  const version = question.workingVersion;
  return (
    <section
      aria-label={"Inspect working version " + version.versionNumber}
      className="mb-4 space-y-3 border border-border bg-background p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Working-version inspection</h3>
          <p className="text-sm text-muted-foreground">
            Review this complete public-safe aggregate before recording
            inspection. The record applies only to immutable version{" "}
            {version.versionNumber}.
          </p>
        </div>
        {inspection ? (
          <Badge variant="success">
            <CheckCircle2 className="h-4 w-4" />
            Inspected
          </Badge>
        ) : (
          <Badge variant="outline">Not inspected</Badge>
        )}
      </div>
      <dl className="grid gap-2 text-sm md:grid-cols-[10rem_1fr]">
        <dt className="font-medium">Topic</dt>
        <dd>{topicTitle ?? version.topicId}</dd>
        <dt className="font-medium">Difficulty</dt>
        <dd>{version.difficulty}</dd>
        <dt className="font-medium">Wording</dt>
        <dd>{version.prompt}</dd>
        <dt className="font-medium">Accepted answers</dt>
        <dd>{version.answer.acceptedAnswers.join(", ")}</dd>
        <dt className="font-medium">Answer explanation</dt>
        <dd>{version.answer.explanation}</dd>
        <dt className="font-medium">Solution steps</dt>
        <dd>
          <ol className="list-decimal space-y-1 pl-5">
            {version.solutionSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </dd>
        <dt className="font-medium">Hints</dt>
        <dd>{version.hints.join(" · ") || "None"}</dd>
        <dt className="font-medium">Misconception notes</dt>
        <dd>
          {version.misconceptions.map((item) => item.feedback).join(" · ") ||
            "None"}
        </dd>
      </dl>
      {inspection ? (
        <p className="text-sm text-muted-foreground">
          Recorded for {inspection.professorDisplayName} at{" "}
          {inspection.inspectedAt}.
        </p>
      ) : isBatchSelectableQuestion(question) ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={onInspect}
        >
          {active ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Mark this version inspected
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          This lifecycle state is not eligible for batch review selection.
        </p>
      )}
    </section>
  );
}

function isBatchSelectableQuestion(question: QuestionLifecycleDto) {
  return (
    question.recordState === "active" &&
    ["needs_review", "approved", "unpublished"].includes(
      question.workingVersion.state,
    )
  );
}

function PublicationPreview({
  active,
  onCancel,
  onConfirm,
  preview,
}: {
  active: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  preview: PublicationPreviewState;
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
    <section
      aria-label="Publication change summary"
      className="space-y-4 border-2 border-primary/40 bg-muted/20 p-4"
    >
      <div>
        <h2 className="text-lg font-semibold">Review before publishing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This is the exact immutable version students will receive. Confirm
          only after reviewing the change summary.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <PublicationSummary
          label={
            base
              ? `Current/base version ${base.versionNumber}`
              : "No current publication"
          }
          version={base}
        />
        <PublicationSummary
          label={`Target version ${target.versionNumber}`}
          version={target}
        />
      </div>
      <div className="rounded-md border border-border bg-background p-3 text-sm">
        <p className="font-medium">Changed fields</p>
        <p className="mt-1 text-muted-foreground">{changed.join(", ")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={active}
          onClick={() => void onConfirm()}
        >
          {active ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {preview.action === "rollback"
            ? "Confirm rollback publication"
            : "Confirm publication"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={active}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}

function PublicationSummary({
  label,
  version,
}: {
  label: string;
  version?: QuestionVersionDto;
}) {
  if (!version) {
    return (
      <div className="border border-border bg-background p-3 text-sm">
        <p className="font-medium">{label}</p>
        <p className="mt-2 text-muted-foreground">Nothing is published.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2 border border-border bg-background p-3 text-sm">
      <p className="font-medium">{label}</p>
      <p>{version.title}</p>
      <p className="text-muted-foreground">{version.prompt}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt>Topic</dt>
        <dd>{version.topicId}</dd>
        <dt>Difficulty</dt>
        <dd>{version.difficulty}</dd>
        <dt>Final answer</dt>
        <dd>{version.answer.acceptedAnswers.join(", ")}</dd>
        <dt>Structure</dt>
        <dd>
          {version.solutionSteps.length} steps, {version.hints.length} hints,{" "}
          {version.misconceptions.length} misconception notes
        </dd>
      </dl>
    </div>
  );
}

function VersionHistory({
  activeKey,
  dashboardReadOnly,
  onTransition,
  question,
}: {
  activeKey?: string;
  dashboardReadOnly: boolean;
  onTransition: (
    action: "rollback" | "unpublish",
    versionId: number,
    expectedState: QuestionVersionState,
  ) => void;
  question: QuestionLifecycleDto;
}) {
  return (
    <div className="grid gap-5 py-3 lg:grid-cols-2">
      <section>
        <h3 className="mb-2 text-sm font-medium">Immutable versions</h3>
        <div className="space-y-2">
          {question.versions.map((version) => (
            <div
              key={version.versionId}
              className="border border-border p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">v{version.versionNumber}</Badge>
                <LifecycleBadge state={version.state} />
                <span>{version.creationMethod}</span>
                {version.parentVersionId ? (
                  <span className="text-muted-foreground">
                    from #{version.parentVersionId}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 font-medium">{version.title}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {version.contentHash}
              </p>
              <VersionDiff
                base={question.versions.find(
                  (candidate) =>
                    candidate.versionId === version.parentVersionId,
                )}
                version={version}
              />
              {version.versionId !== question.workingVersion.versionId
                ? version.allowedActions
                    .filter(
                      (action) =>
                        action === "rollback" || action === "unpublish",
                    )
                    .map((action) => (
                      <Button
                        key={action}
                        type="button"
                        size="sm"
                        variant={
                          action === "unpublish" ? "destructive" : "outline"
                        }
                        className="mt-3"
                        disabled={dashboardReadOnly || Boolean(activeKey)}
                        onClick={() =>
                          onTransition(action, version.versionId, version.state)
                        }
                      >
                        {action === "rollback" ? (
                          <RotateCcw className="h-4 w-4" />
                        ) : null}
                        {action === "rollback"
                          ? "Roll back to this version"
                          : "Unpublish this version"}
                      </Button>
                    ))
                : null}
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-medium">Lifecycle timeline</h3>
        <ol className="space-y-2">
          {question.events.map((event) => (
            <li
              key={event.id}
              className="border-l-2 border-border pl-3 text-sm"
            >
              <p>
                <span className="font-medium">{event.action}</span>
                {event.fromState || event.toState
                  ? `: ${event.fromState ?? "new"} → ${event.toState ?? "unchanged"}`
                  : ""}
              </p>
              <p className="text-muted-foreground">
                {event.actor.displayName} ({event.actorRole}) ·{" "}
                {event.actor.occurredAt}
              </p>
              {event.requestedBy &&
              event.executedBy &&
              event.requestedBy.userId !== event.executedBy.userId ? (
                <p className="text-muted-foreground">
                  Requested by {event.requestedBy.displayName}; executed by{" "}
                  {event.executedBy.displayName}
                </p>
              ) : null}
              {event.reasonCode ? <p>Reason: {event.reasonCode}</p> : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function VersionDiff({
  base,
  version,
}: {
  base?: QuestionVersionDto;
  version: QuestionVersionDto;
}) {
  if (!base) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">Initial version</p>
    );
  }
  const changed = changedQuestionVersionFields(base, version);

  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Compared with v{base.versionNumber}:{" "}
      {changed.join(", ") || "no content changes"}
    </p>
  );
}

function LifecycleBadge({
  state,
}: {
  state: QuestionVersionState | "archived";
}) {
  return (
    <Badge
      variant={
        state === "published"
          ? "success"
          : state === "rejected" || state === "archived"
            ? "destructive"
            : "secondary"
      }
    >
      {state.replaceAll("_", " ")}
    </Badge>
  );
}
