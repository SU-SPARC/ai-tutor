"use client";

import { useId, useMemo, useState } from "react";
import { Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import type {
  QuestionLifecycleDto,
  QuestionSimilarityLinkDto,
} from "@/lib/types";

type PublishedOriginOption = {
  questionId: string;
  title: string;
  versionId: number;
};

/**
 * The similar-practice relationship: for a published origin, which reserve
 * siblings are pinned to it; for a reserve question, which origin it stands
 * in for. A quiet panel on the question detail page.
 */
export function ProfessorQuestionSimilarityControls({
  initialLinks,
  publishedOrigins,
  question,
}: {
  initialLinks: QuestionSimilarityLinkDto[];
  publishedOrigins: PublishedOriginOption[];
  question: QuestionLifecycleDto;
}) {
  const [links, setLinks] = useState(initialLinks);
  const [originKey, setOriginKey] = useState("");
  const [slot, setSlot] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const headingId = useId();
  const currentOriginVersionId = question.publishedVersion?.versionId;
  const currentOriginLinks = useMemo(
    () =>
      links.filter(
        (link) =>
          link.originQuestionId === question.questionId &&
          link.originVersionId === currentOriginVersionId &&
          !link.revokedAt,
      ),
    [currentOriginVersionId, links, question.questionId],
  );
  const reserveLink = links.find(
    (link) => link.similarQuestionId === question.questionId && !link.revokedAt,
  );
  const isEligibleReserve = Boolean(
    question.reserve?.practiceAllowed && !question.publishedVersion,
  );
  const isPublishedOrigin = Boolean(question.publishedVersion);

  if (!isPublishedOrigin && !question.reserve) return null;

  async function mutateLink(
    action: "assign" | "remove",
    link?: QuestionSimilarityLinkDto,
  ) {
    const selected = publishedOrigins.find(
      (origin) => `${origin.questionId}:${origin.versionId}` === originKey,
    );
    const originQuestionId = link?.originQuestionId ?? selected?.questionId;
    const originVersionId = link?.originVersionId ?? selected?.versionId;
    const targetSlot = link?.slot ?? slot;
    if (!originQuestionId || !originVersionId) {
      setError("Select a published origin first.");
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      const response = await fetch(
        `/api/professor/questions/${encodeURIComponent(question.questionId)}/similarity`,
        {
          body: JSON.stringify({
            action,
            expectedSimilarVersionId:
              link?.similarVersionId ?? question.workingVersion.versionId,
            originQuestionId,
            originVersionId,
            linkId: link?.id,
            slot: targetSlot,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        links?: QuestionSimilarityLinkDto[];
      };
      if (!response.ok) throw new Error(payload.error ?? "Update failed.");
      if (action === "remove") {
        setLinks((current) =>
          current.filter(
            (candidate) =>
              !(
                candidate.originQuestionId === originQuestionId &&
                candidate.similarQuestionId === question.questionId
              ),
          ),
        );
      } else {
        setLinks(payload.links ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="@container flex flex-col gap-4 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={headingId} className="type-h3 text-ink">
            Similar-practice relationship
          </h2>
          {isPublishedOrigin ? (
            <span className="type-small tabular text-ink-muted">
              {currentOriginLinks.filter((link) => link.eligible).length} of 3
              eligible
            </span>
          ) : null}
        </div>
        <p className="type-small max-w-prose text-ink-muted">
          Relationships pin both reviewed versions. Publishing a new origin
          version or revising the reserve sibling makes the old link ineligible
          until you assign a new one.
        </p>
      </div>
      {isPublishedOrigin ? (
        currentOriginLinks.length ? (
          <ul className="flex flex-col divide-y divide-rule rounded-panel bg-sheet px-4">
            {currentOriginLinks.map((link) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-3 type-small text-ink"
                key={link.id}
              >
                <span>
                  Slot {link.slot} of 3 · {link.similarTitle}
                </span>
                <StatusChip
                  icon={false}
                  label={link.eligible ? "Eligible" : "Not currently eligible"}
                  tone={link.eligible ? "approved" : "neutral"}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-small text-ink-muted">
            No reserve siblings are assigned to this published version.
          </p>
        )
      ) : reserveLink ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-sheet px-4 py-3 type-small text-ink">
          <span>
            Similar to: {reserveLink.originTitle} · slot {reserveLink.slot} of
            3
          </span>
          <Button
            disabled={pending}
            loading={pending}
            onClick={() => mutateLink("remove", reserveLink)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Unlink aria-hidden="true" /> Revoke link
          </Button>
        </div>
      ) : isEligibleReserve ? (
        <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_8rem_auto] @xl:items-end">
          <Field label="Published origin">
            <NativeSelect
              onChange={(event) => setOriginKey(event.target.value)}
              value={originKey}
            >
              <option value="">Select an origin</option>
              {publishedOrigins.map((origin) => (
                <option
                  key={`${origin.questionId}:${origin.versionId}`}
                  value={`${origin.questionId}:${origin.versionId}`}
                >
                  {origin.title}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Slot">
            <NativeSelect
              onChange={(event) =>
                setSlot(Number(event.target.value) as 1 | 2 | 3)
              }
              value={slot}
            >
              <option value={1}>1 of 3</option>
              <option value={2}>2 of 3</option>
              <option value={3}>3 of 3</option>
            </NativeSelect>
          </Field>
          <Button
            disabled={pending || !originKey}
            loading={pending}
            onClick={() => mutateLink("assign")}
            type="button"
            variant="secondary"
          >
            Assign origin
          </Button>
        </div>
      ) : (
        <p className="type-small max-w-prose text-ink-muted">
          Enable this unpublished reserve question for optional practice before
          assigning a published origin.
        </p>
      )}
      <div role="status" aria-live="polite">
        {error ? <p className="type-small text-red-700">{error}</p> : null}
      </div>
    </section>
  );
}
