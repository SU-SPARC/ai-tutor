"use client";

import type { ReactNode } from "react";
import { ChevronRight, RotateCcw } from "lucide-react";

import {
  creationMethodLabel,
  professorDifficultyLabel,
  ProfessorTime,
  questionStateLabel,
  QuestionStateChip,
  sourceTypeLabel,
  validationStatusLabel,
} from "@/components/professor/professor-question-labels";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { questionReserveReasonLabel } from "@/lib/tutor/professor-question-reserve";
import { professorReviewReasonLabel } from "@/lib/tutor/professor-review-reasons";
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";
import type {
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionLifecycleEventAction,
  QuestionLifecycleEventDto,
  QuestionVersionDto,
  QuestionVersionState,
} from "@/lib/types";

/** Past tense: these are things that happened. */
const EVENT_LABELS: Record<QuestionLifecycleEventAction, string> = {
  approve: "Approved",
  archive: "Archived",
  create_version: "Version created",
  migrate: "History migrated",
  publish: "Published",
  regenerate: "Version regenerated",
  reject: "Rejected",
  request_revision: "Revision requested",
  restore: "Restored",
  rollback: "Rolled back",
  submit: "Submitted for review",
  unpublish: "Unpublished",
};

const RESERVE_EVENT_LABELS = {
  allow_practice: "Similar practice allowed",
  disallow_practice: "Similar practice disabled",
  release: "Reserve removed",
  reserve: "Saved for later",
} as const;

/**
 * Every immutable version of one question and everything that happened to it,
 * as two vertical lists: versions (newest first) and the attributed timeline.
 * Two columns when the container is wide enough, one otherwise.
 */
export function ProfessorQuestionVersionHistory({
  activeKey,
  dashboardReadOnly,
  onTransition,
  question,
  topics,
}: {
  activeKey?: string;
  dashboardReadOnly: boolean;
  onTransition: (
    action: "rollback" | "unpublish",
    versionId: number,
    expectedState: QuestionVersionState,
  ) => void;
  question: QuestionLifecycleDto;
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const versionsById = new Map(
    question.versions.map((version) => [version.versionId, version]),
  );
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));

  return (
    <div className="@container">
      <div className="grid gap-8 @3xl:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-3">
          <h3 className="type-h3 text-ink">Versions</h3>
          <ol className="flex flex-col gap-3">
            {question.versions.map((version) => (
              <li
                key={version.versionId}
                className="flex flex-col gap-3 rounded-panel bg-sheet p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-mono text-ink">
                    v{version.versionNumber}
                  </span>
                  <QuestionStateChip state={version.state} />
                  {version.versionId === question.workingVersion.versionId ? (
                    <StatusChip
                      icon={false}
                      label="Working version"
                      tone="neutral"
                    />
                  ) : null}
                  {version.versionId === question.publishedVersion?.versionId ? (
                    <StatusChip
                      icon={false}
                      label="Published version"
                      tone="neutral"
                    />
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="type-body-strong text-ink">{version.title}</p>
                  <p className="type-small text-ink-muted">
                    {versionLineageLabel(version, versionsById)}
                  </p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-small">
                  <HistoryTerm label="Created by">
                    {version.createdBy.displayName} ·{" "}
                    <ProfessorTime value={version.createdAt} />
                  </HistoryTerm>
                  <HistoryTerm label="Creation">
                    {creationMethodLabel(version.creationMethod)}
                  </HistoryTerm>
                  <HistoryTerm label="Topic">
                    {topicTitles.get(version.topicId) ?? version.topicId}
                  </HistoryTerm>
                  <HistoryTerm label="Difficulty">
                    {professorDifficultyLabel(version.difficulty)}
                  </HistoryTerm>
                  <HistoryTerm label="Validation">
                    {validationStatusLabel(version.validationStatus)}
                  </HistoryTerm>
                  <HistoryTerm label="Source">
                    {sourceTypeLabel(version.source.sourceType)}
                  </HistoryTerm>
                  {version.source.originalityNote ? (
                    <HistoryTerm label="Originality">
                      {version.source.originalityNote}
                    </HistoryTerm>
                  ) : null}
                </dl>
                <VersionDiff
                  base={
                    version.parentVersionId
                      ? versionsById.get(version.parentVersionId)
                      : undefined
                  }
                  version={version}
                />
                <details className="group border-t border-rule pt-3">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control type-body-strong text-ink focus-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 text-ink-muted transition-transform duration-fast group-open:rotate-90"
                    />
                    Inspect immutable content
                  </summary>
                  <VersionContent version={version} />
                </details>
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
                          className="w-fit"
                          disabled={dashboardReadOnly || Boolean(activeKey)}
                          onClick={() =>
                            onTransition(
                              action,
                              version.versionId,
                              version.state,
                            )
                          }
                        >
                          {action === "rollback" ? (
                            <RotateCcw aria-hidden="true" />
                          ) : null}
                          {action === "rollback"
                            ? `Roll back to v${version.versionNumber}`
                            : `Unpublish v${version.versionNumber}`}
                        </Button>
                      ))
                  : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <h3 className="type-h3 text-ink">Timeline</h3>
          {question.events.length > 0 ? (
            <ol className="flex flex-col">
              {question.events.map((event) => (
                <LifecycleTimelineEvent
                  key={event.id}
                  event={event}
                  version={versionsById.get(event.versionId)}
                />
              ))}
            </ol>
          ) : (
            <p className="type-small text-ink-muted">
              No lifecycle events are recorded yet.
            </p>
          )}
          {(question.reserveEvents?.length ?? 0) > 0 ? (
            <>
              <h3 className="mt-4 type-h3 text-ink">Save for later history</h3>
              <ol className="flex flex-col">
                {question.reserveEvents?.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-col gap-0.5 border-l-2 border-rule py-2 pl-4"
                  >
                    <p className="type-body-strong text-ink">
                      {RESERVE_EVENT_LABELS[event.action]}
                      {event.reasonCode
                        ? ` · ${questionReserveReasonLabel(event.reasonCode)}`
                        : ""}
                    </p>
                    <p className="type-caption">
                      v
                      {versionsById.get(event.versionId)?.versionNumber ?? "?"}
                      {" · "}
                      {event.actor.displayName} ·{" "}
                      <ProfessorTime value={event.actor.occurredAt} />
                    </p>
                    {event.note ? (
                      <p className="type-small text-ink">{event.note}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function HistoryTerm({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </>
  );
}

function VersionContent({ version }: { version: QuestionVersionDto }) {
  return (
    <div className="mt-3 flex flex-col gap-3 type-small">
      <HistoryContentBlock label="Question wording">
        <p className="max-w-prose">{version.prompt}</p>
      </HistoryContentBlock>
      <HistoryContentBlock label="Accepted answers">
        <p className="font-mono">{version.answer.acceptedAnswers.join(", ")}</p>
      </HistoryContentBlock>
      <HistoryContentBlock label="Numeric grading">
        <p>
          {version.answer.numericValue === undefined
            ? "No numeric value recorded."
            : `Value ${version.answer.numericValue}; tolerance ${version.answer.tolerance ?? 0}.`}
        </p>
      </HistoryContentBlock>
      <HistoryContentBlock label="Answer explanation">
        <p className="max-w-prose">{version.answer.explanation}</p>
      </HistoryContentBlock>
      <HistoryContentBlock label="Solution steps">
        <HistoryList items={version.solutionSteps} />
      </HistoryContentBlock>
      <HistoryContentBlock label="Hints">
        <HistoryList items={version.hints} />
      </HistoryContentBlock>
      <HistoryContentBlock label="Misconceptions">
        {version.misconceptions.length > 0 ? (
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {version.misconceptions.map((item) => (
              <li key={item.id}>
                <p>{item.feedback}</p>
                <p className="text-ink-muted">
                  Match terms: {item.matchTerms.join(", ") || "none recorded"}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p>None recorded.</p>
        )}
      </HistoryContentBlock>
      <p className="break-all font-mono text-ink-muted">
        Content SHA-256: {version.contentHash}
      </p>
    </div>
  );
}

function HistoryContentBlock({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="type-label">{label}</p>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function HistoryList({ items }: { items: string[] }) {
  return items.length > 0 ? (
    <ol className="flex max-w-prose list-decimal flex-col gap-1 pl-5">
      {items.map((item, index) => (
        <li key={`${index}:${item}`}>{item}</li>
      ))}
    </ol>
  ) : (
    <p>None recorded.</p>
  );
}

function LifecycleTimelineEvent({
  event,
  version,
}: {
  event: QuestionLifecycleEventDto;
  version?: QuestionVersionDto;
}) {
  const transition =
    event.fromState || event.toState
      ? `${event.fromState ? questionStateLabel(event.fromState) : "New"} → ${
          event.toState ? questionStateLabel(event.toState) : "Unchanged"
        }`
      : undefined;
  const previousDifficulty = event.metadata?.previousDifficulty;
  const selectedDifficulty = event.metadata?.selectedDifficulty;

  return (
    <li className="flex flex-col gap-0.5 border-l-2 border-rule py-2 pl-4">
      <p className="text-ink">
        <span className="type-body-strong">{EVENT_LABELS[event.action]}</span>
        {version ? (
          <span className="font-mono text-ink-muted">
            {" "}
            v{version.versionNumber}
          </span>
        ) : null}
        {transition ? (
          <span className="type-small text-ink-muted"> · {transition}</span>
        ) : null}
      </p>
      <p className="type-caption">
        {event.actor.displayName}
        {event.actorRole === "system" ? " (system)" : ""} ·{" "}
        <ProfessorTime value={event.actor.occurredAt} />
      </p>
      {event.requestedBy &&
      event.executedBy &&
      event.requestedBy.userId !== event.executedBy.userId ? (
        <p className="type-caption">
          Requested by {event.requestedBy.displayName}; executed by{" "}
          {event.executedBy.displayName}
        </p>
      ) : null}
      {event.reasonCode ? (
        <p className="type-small text-ink">
          Reason: {professorReviewReasonLabel(event.reasonCode)}
        </p>
      ) : null}
      {event.action === "approve" && selectedDifficulty ? (
        <p className="type-small text-ink">
          Difficulty:{" "}
          {previousDifficulty
            ? professorDifficultyLabel(String(previousDifficulty))
            : "Previous"}{" "}
          → {professorDifficultyLabel(String(selectedDifficulty))}
        </p>
      ) : null}
      {event.note ? (
        <p className="type-small max-w-prose text-ink">
          Comment: {event.note}
        </p>
      ) : null}
    </li>
  );
}

function versionLineageLabel(
  version: QuestionVersionDto,
  versionsById: Map<number, QuestionVersionDto>,
) {
  const parent = version.parentVersionId
    ? versionsById.get(version.parentVersionId)
    : undefined;
  if (!parent) {
    if (version.creationMethod === "generated") {
      return "Original generated draft";
    }
    if (version.creationMethod === "imported") return "Original import";
    return "Original version";
  }

  const relationship =
    version.creationMethod === "regenerated"
      ? "Regenerated"
      : version.creationMethod === "rollback_clone"
        ? "Rollback clone"
        : version.creationMethod === "manual"
          ? "Professor edit"
          : "Derived version";
  return `${relationship} from v${parent.versionNumber}`;
}

function VersionDiff({
  base,
  version,
}: {
  base?: QuestionVersionDto;
  version: QuestionVersionDto;
}) {
  if (!base) {
    return <p className="type-caption">Initial version</p>;
  }
  const changed = changedQuestionVersionFields(base, version);

  return (
    <p className="type-caption">
      Compared with v{base.versionNumber}:{" "}
      {changed.join(", ") || "no content changes"}
    </p>
  );
}
