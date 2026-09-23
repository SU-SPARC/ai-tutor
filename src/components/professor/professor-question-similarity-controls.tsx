"use client";

import { useMemo, useState } from "react";
import { Link2, Unlink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  QuestionLifecycleDto,
  QuestionSimilarityLinkDto,
} from "@/lib/types";

type PublishedOriginOption = {
  questionId: string;
  title: string;
  versionId: number;
};

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
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Link2 className="h-5 w-5" />
          Similar-practice relationship
          {isPublishedOrigin ? (
            <Badge variant="outline">
              {currentOriginLinks.filter((link) => link.eligible).length} of 3
              eligible
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Relationships pin both reviewed versions. Publishing a new origin
          version or revising the Reserve sibling makes the old link ineligible
          until a professor assigns a new one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPublishedOrigin ? (
          currentOriginLinks.length ? (
            <ul className="space-y-2 text-sm">
              {currentOriginLinks.map((link) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
                  key={link.id}
                >
                  <span>
                    Slot {link.slot} of 3 · {link.similarTitle}
                  </span>
                  <Badge variant={link.eligible ? "success" : "warning"}>
                    {link.eligible ? "eligible" : "Not currently eligible"}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              No dedicated Reserve siblings are assigned to this published
              version.
            </p>
          )
        ) : reserveLink ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm">
            <span>
              Similar to: {reserveLink.originTitle} · slot {reserveLink.slot} of
              3
            </span>
            <Button
              disabled={pending}
              onClick={() => mutateLink("remove", reserveLink)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Unlink className="h-4 w-4" /> Revoke link
            </Button>
          </div>
        ) : isEligibleReserve ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_auto] sm:items-end">
            <label className="space-y-1 text-sm font-medium">
              Published origin
              <NativeSelect
                aria-label="Published origin"
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
            </label>
            <label className="space-y-1 text-sm font-medium">
              Slot
              <NativeSelect
                aria-label="Similarity slot"
                onChange={(event) =>
                  setSlot(Number(event.target.value) as 1 | 2 | 3)
                }
                value={slot}
              >
                <option value={1}>1 of 3</option>
                <option value={2}>2 of 3</option>
                <option value={3}>3 of 3</option>
              </NativeSelect>
            </label>
            <Button
              disabled={pending || !originKey}
              onClick={() => mutateLink("assign")}
              type="button"
            >
              Assign origin
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Enable this unpublished Reserve question for optional practice
            before assigning a published origin.
          </p>
        )}
        {error ? (
          <p aria-live="polite" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
