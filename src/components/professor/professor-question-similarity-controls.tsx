"use client";

import { useId, useMemo, useState } from "react";
import { Link2, Unlink } from "lucide-react";

import { plainActionError } from "@/components/professor/professor-question-labels";
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

const ORDER_LABELS: Record<number, string> = {
  1: "First",
  2: "Second",
  3: "Third",
};

function orderLabel(slot: number) {
  return ORDER_LABELS[slot] ?? String(slot);
}

/**
 * "Extra practice": for a question students can see, which saved-for-later
 * questions are offered after it; for a saved-for-later question, which
 * question it is offered after. A quiet panel inside "More options".
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
      setError("Choose a question first.");
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
      if (!response.ok) {
        setError(plainActionError(response.status));
        return;
      }
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
    } catch {
      setError(plainActionError());
    } finally {
      setPending(false);
    }
  }

  const readyCount = currentOriginLinks.filter((link) => link.eligible).length;

  return (
    <section
      id="extra-practice"
      aria-labelledby={headingId}
      className="@container flex scroll-mt-24 flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex max-w-prose flex-col gap-1">
        <h3 id={headingId} className="type-h3 text-ink">
          Extra practice
        </h3>
        <p className="type-body text-ink">
          {isPublishedOrigin
            ? `${readyCount} of 3 extra-practice questions ready. Students who finish this question can try these next.`
            : "A question saved for later can be offered as extra practice after a question students can see."}
        </p>
      </div>
      {isPublishedOrigin ? (
        currentOriginLinks.length ? (
          <ul className="flex flex-col divide-y divide-rule rounded-panel bg-surface-tint px-4">
            {currentOriginLinks.map((link) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-3 type-body text-ink"
                key={link.id}
              >
                <span>
                  {orderLabel(link.slot)}: “{link.similarTitle}”
                </span>
                <StatusChip
                  icon={false}
                  label={link.eligible ? "Ready" : "Not ready right now"}
                  tone={link.eligible ? "approved" : "neutral"}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-body text-ink">
            No extra-practice questions are linked to this question yet.
          </p>
        )
      ) : reserveLink ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel bg-surface-tint px-4 py-3 type-body text-ink">
          <span>
            Offered as extra practice after “{reserveLink.originTitle}” (
            {orderLabel(reserveLink.slot).toLowerCase()} of 3)
          </span>
          <Button
            className="h-11"
            disabled={pending}
            loading={pending}
            onClick={() => mutateLink("remove", reserveLink)}
            type="button"
            variant="outline"
          >
            <Unlink aria-hidden="true" /> Unlink
          </Button>
        </div>
      ) : isEligibleReserve ? (
        <div className="grid gap-4 @xl:grid-cols-[minmax(0,1fr)_10rem_auto] @xl:items-end">
          <Field label="Offer this as extra practice after:">
            <NativeSelect
              onChange={(event) => setOriginKey(event.target.value)}
              value={originKey}
            >
              <option value="">Choose a question</option>
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
          <Field label="Order">
            <NativeSelect
              onChange={(event) =>
                setSlot(Number(event.target.value) as 1 | 2 | 3)
              }
              value={slot}
            >
              <option value={1}>First of 3</option>
              <option value={2}>Second of 3</option>
              <option value={3}>Third of 3</option>
            </NativeSelect>
          </Field>
          <Button
            className="h-11"
            disabled={pending || !originKey}
            loading={pending}
            onClick={() => mutateLink("assign")}
            type="button"
            variant="secondary"
          >
            <Link2 aria-hidden="true" /> Link
          </Button>
        </div>
      ) : (
        <p className="type-body max-w-prose text-ink">
          To link it, first choose Offer as extra practice under Saved for
          later.
        </p>
      )}
      <div role="status" aria-live="polite">
        {error ? <p className="type-body text-red-700">{error}</p> : null}
      </div>
    </section>
  );
}
