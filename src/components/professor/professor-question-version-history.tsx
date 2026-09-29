"use client";

import type { ReactNode } from "react";
import { ChevronRight, EyeOff, RotateCcw } from "lucide-react";

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
  QuestionCreationMethod,
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
  archive: "Removed from question bank",
  create_version: "Changes saved",
  migrate: "Brought over from the earlier system",
  publish: "Shown to students",
  regenerate: "Rewritten by AI",
  reject: "Rejected",
  request_revision: "Sent back for changes",
  restore: "Put back",
  rollback: "Went back to this version",
  submit: "Sent for review",
  unpublish: "Hidden from students",
};

const RESERVE_EVENT_LABELS = {
  allow_practice: "Offered as extra practice",
  disallow_practice: "No longer offered as extra practice",
  release: "Taken out of Saved for later",
  reserve: "Saved for later",
} as const;

/** How a version came to be, as a verb for "Version 3 · edited by …". */
const CREATION_VERBS: Record<QuestionCreationMethod, string> = {
  generated: "written",
  imported: "imported",
  manual: "edited",
  regenerated: "rewritten with AI",
  rollback_clone: "restored",
};

/**
 * "All changes": every version of one question (newest first) with what
 * changed and two plain actions, then what happened to it and who did it.
 * Hashes, validation, sources and lineage sit in a nested "Technical details".
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
    <section
      id="all-changes"
      aria-labelledby="all-changes-heading"
      className="@container flex scroll-mt-24 flex-col gap-4"
    >
      <h3 id="all-changes-heading" className="type-h3 text-ink">
        All changes
      </h3>
      <div className="grid gap-8 @3xl:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-3">
          <h4 className="type-body-strong text-ink">Versions</h4>
          <ol className="flex flex-col gap-3">
            {question.versions.map((version) => {
              const base = version.parentVersionId
                ? versionsById.get(version.parentVersionId)
                : undefined;
              return (
                <li
                  key={version.versionId}
                  className="flex flex-col gap-3 rounded-panel bg-sheet p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <QuestionStateChip state={version.state} />
                    {version.versionId === question.workingVersion.versionId ? (
                      <StatusChip
                        icon={false}
                        label="Latest version"
                        tone="neutral"
                      />
                    ) : null}
                    {version.versionId ===
                    question.publishedVersion?.versionId ? (
                      <StatusChip
                        icon={false}
                        label="Students see this version"
                        tone="neutral"
                      />
                    ) : null}
                  </div>
                  <p className="type-body text-ink">
                    <span className="type-body-strong">
                      Version {version.versionNumber}
                    </span>{" "}
                    · {CREATION_VERBS[version.creationMethod] ?? "made"} by{" "}
                    {version.createdBy.displayName} on{" "}
                    <ProfessorTime dateOnly value={version.createdAt} /> ·{" "}
                    {changedSummary(base, version)}
                  </p>
                  {base && base.title !== version.title ? (
                    <p className="type-body text-ink">
                      Title: “{version.title}”
                    </p>
                  ) : null}
                  <details className="group border-t border-rule pt-3">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control type-body-strong text-ink focus-ring [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 text-ink-muted transition-transform duration-fast group-open:rotate-90"
                      />
                      See this version
                    </summary>
                    <VersionContent
                      topicTitle={
                        topicTitles.get(version.topicId) ?? version.topicId
                      }
                      version={version}
                      versionsById={versionsById}
                    />
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
                            variant="outline"
                            className={
                              action === "unpublish"
                                ? "h-11 w-fit border-red-300 text-red-700"
                                : "h-11 w-fit"
                            }
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
                            ) : (
                              <EyeOff aria-hidden="true" />
                            )}
                            {action === "rollback"
                              ? "Go back to this version"
                              : `Hide version ${version.versionNumber} from students`}
                          </Button>
                        ))
                    : null}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="flex min-w-0 flex-col gap-3">
          <h4 className="type-body-strong text-ink">What happened</h4>
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
            <p className="type-body text-ink">Nothing has happened yet.</p>
          )}
          {(question.reserveEvents?.length ?? 0) > 0 ? (
            <>
              <h4 className="mt-4 type-body-strong text-ink">
                Saved for later history
              </h4>
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
                    <p className="type-small text-ink-muted">
                      Version{" "}
                      {versionsById.get(event.versionId)?.versionNumber ?? "—"}
                      {" · "}
                      {event.actor.displayName} ·{" "}
                      <ProfessorTime value={event.actor.occurredAt} />
                    </p>
                    {event.note ? (
                      <p className="type-body text-ink">Note: {event.note}</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function changedSummary(
  base: QuestionVersionDto | undefined,
  version: QuestionVersionDto,
) {
  if (!base) return "first version";
  const changed = changedQuestionVersionFields(base, version).map((field) =>
    field.toLowerCase(),
  );
  return changed.length > 0
    ? `changed: ${changed.join(", ")}`
    : "no changes to the question";
}

function VersionContent({
  topicTitle,
  version,
  versionsById,
}: {
  topicTitle: string;
  version: QuestionVersionDto;
  versionsById: Map<number, QuestionVersionDto>;
}) {
  return (
    <div className="mt-3 flex flex-col gap-3 type-body">
      <HistoryContentBlock label="Question text">
        <p className="max-w-prose">{version.prompt}</p>
      </HistoryContentBlock>
      <HistoryContentBlock label="Correct answers">
        <p className="font-mono">{version.answer.acceptedAnswers.join(", ")}</p>
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
      <HistoryContentBlock label="Common mistakes and what the tutor says">
        {version.misconceptions.length > 0 ? (
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {version.misconceptions.map((item) => (
              <li key={item.id}>{item.feedback}</li>
            ))}
          </ol>
        ) : (
          <p>None.</p>
        )}
      </HistoryContentBlock>
      <details className="group/tech border-t border-rule pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control type-body-strong text-ink focus-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-ink-muted transition-transform duration-fast group-open/tech:rotate-90"
          />
          Technical details
        </summary>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 type-small">
          <HistoryTerm label="History">
            {versionLineageLabel(version, versionsById)}
          </HistoryTerm>
          <HistoryTerm label="How it was made">
            {creationMethodLabel(version.creationMethod)}
          </HistoryTerm>
          <HistoryTerm label="Topic">{topicTitle}</HistoryTerm>
          <HistoryTerm label="Difficulty">
            {professorDifficultyLabel(version.difficulty)}
          </HistoryTerm>
          <HistoryTerm label="Automatic checks">
            {validationStatusLabel(version.validationStatus)}
          </HistoryTerm>
          <HistoryTerm label="Where it came from">
            {sourceTypeLabel(version.source.sourceType)}
          </HistoryTerm>
          {version.source.originalityNote ? (
            <HistoryTerm label="Source note">
              {version.source.originalityNote}
            </HistoryTerm>
          ) : null}
          <HistoryTerm label="Number checking">
            {version.answer.numericValue === undefined
              ? "No number recorded."
              : `Value ${version.answer.numericValue}; allowed difference ${version.answer.tolerance ?? 0}.`}
          </HistoryTerm>
          {version.misconceptions.some((item) => item.matchTerms.length) ? (
            <HistoryTerm label="Wrong answers matched">
              {version.misconceptions
                .flatMap((item) => item.matchTerms)
                .join(", ")}
            </HistoryTerm>
          ) : null}
          <HistoryTerm label="Content fingerprint">
            <span className="break-all font-mono">{version.contentHash}</span>
          </HistoryTerm>
        </dl>
      </details>
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

function HistoryContentBlock({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="type-body-strong text-ink">{label}</p>
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
    <p>None.</p>
  );
}

function LifecycleTimelineEvent({
  event,
  version,
}: {
  event: QuestionLifecycleEventDto;
  version?: QuestionVersionDto;
}) {
  const change =
    event.fromState && event.toState && event.fromState !== event.toState
      ? `${questionStateLabel(event.fromState)} → ${questionStateLabel(event.toState)}`
      : undefined;
  const previousDifficulty = event.metadata?.previousDifficulty;
  const selectedDifficulty = event.metadata?.selectedDifficulty;

  return (
    <li className="flex flex-col gap-0.5 border-l-2 border-rule py-2 pl-4">
      <p className="type-body text-ink">
        <span className="type-body-strong">{EVENT_LABELS[event.action]}</span>
        {version ? <span> · version {version.versionNumber}</span> : null}
      </p>
      <p className="type-small text-ink-muted">
        {event.actor.displayName} ·{" "}
        <ProfessorTime value={event.actor.occurredAt} />
        {change ? ` · ${change}` : ""}
      </p>
      {event.requestedBy &&
      event.executedBy &&
      event.requestedBy.userId !== event.executedBy.userId ? (
        <p className="type-small text-ink-muted">
          Asked for by {event.requestedBy.displayName}, done by{" "}
          {event.executedBy.displayName}
        </p>
      ) : null}
      {event.reasonCode ? (
        <p className="type-body text-ink">
          Why: {professorReviewReasonLabel(event.reasonCode)}
        </p>
      ) : null}
      {event.action === "approve" && selectedDifficulty ? (
        <p className="type-body text-ink">
          Difficulty:{" "}
          {previousDifficulty
            ? professorDifficultyLabel(String(previousDifficulty))
            : "Previous"}{" "}
          → {professorDifficultyLabel(String(selectedDifficulty))}
        </p>
      ) : null}
      {event.note ? (
        <p className="type-body max-w-prose text-ink">Note: {event.note}</p>
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
      return "First version, written by AI";
    }
    if (version.creationMethod === "imported") return "First version, imported";
    return "First version";
  }

  const relationship =
    version.creationMethod === "regenerated"
      ? "Rewritten by AI from"
      : version.creationMethod === "rollback_clone"
        ? "Copy of"
        : version.creationMethod === "manual"
          ? "Edited from"
          : "Made from";
  return `${relationship} version ${parent.versionNumber}`;
}
