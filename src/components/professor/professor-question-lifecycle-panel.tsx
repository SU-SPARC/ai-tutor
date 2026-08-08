"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, Loader2, RotateCcw } from "lucide-react";

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
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionVersionDto,
  QuestionVersionState,
} from "@/lib/types";
import { lifecycleActionRequiresReason } from "@/lib/tutor/question-lifecycle";

type LifecycleFilter = QuestionVersionState | "all" | "archived";

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
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [expandedId, setExpandedId] = useState<string>();
  const [filter, setFilter] = useState<LifecycleFilter>("all");
  const [message, setMessage] = useState<string>();
  const [reasonCode, setReasonCode] = useState("");
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

  async function transition(
    question: QuestionLifecycleDto,
    action: QuestionLifecycleAction,
    versionId = question.workingVersion.versionId,
    expectedState = question.workingVersion.state,
  ) {
    if (lifecycleActionRequiresReason(action) && !reasonCode.trim()) {
      setMessage(`${ACTION_LABELS[action]} requires a reason code.`);
      return;
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
        return;
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
      setMessage(`${ACTION_LABELS[action]} completed.`);
    } catch {
      setMessage("Lifecycle transition failed.");
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
      setMessage("A regenerated version was submitted for review.");
    } catch {
      setMessage("Regeneration failed.");
    } finally {
      setActiveKey(undefined);
    }
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

      <Table>
        <TableHeader>
          <TableRow>
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
              <TableCell colSpan={6} className="text-muted-foreground">
                No questions match this lifecycle view.
              </TableCell>
            </TableRow>
          ) : (
            questions.map((question) => {
              const working = question.workingVersion;
              return (
                <Fragment key={question.questionId}>
                  <TableRow>
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
                                dashboard.readOnly || Boolean(activeKey)
                              }
                              onClick={() => transition(question, action)}
                            >
                              {activeKey === key ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : null}
                              {ACTION_LABELS[action]}
                            </Button>
                          );
                        })}
                        {question.regenerationAllowed ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={dashboard.readOnly || Boolean(activeKey)}
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
                      <TableCell colSpan={6}>
                        <VersionHistory
                          activeKey={activeKey}
                          dashboardReadOnly={dashboard.readOnly}
                          question={question}
                          onRollback={transition}
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

function VersionHistory({
  activeKey,
  dashboardReadOnly,
  onRollback,
  question,
}: {
  activeKey?: string;
  dashboardReadOnly: boolean;
  onRollback: (
    question: QuestionLifecycleDto,
    action: QuestionLifecycleAction,
    versionId?: number,
    expectedState?: QuestionVersionState,
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
                          onRollback(
                            question,
                            action,
                            version.versionId,
                            version.state,
                          )
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
  const changed = [
    ["title", version.title, base.title],
    ["prompt", version.prompt, base.prompt],
    ["topic", version.topicId, base.topicId],
    ["difficulty", version.difficulty, base.difficulty],
    ["answer", version.answer, base.answer],
    ["hints", version.hints, base.hints],
    ["solution", version.solutionSteps, base.solutionSteps],
    ["misconceptions", version.misconceptions, base.misconceptions],
  ].flatMap(([label, current, previous]) =>
    JSON.stringify(current) === JSON.stringify(previous) ? [] : [String(label)],
  );

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
