"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, Download, FileUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { canonicalSyllabusTopics } from "@/lib/data/canonical-syllabus-topics";
import type {
  ContentTransferDocument,
  ContentTransferImportResult,
  ContentTransferImportState,
  ContentTransferPreview,
  ContentTransferPreviewRow,
} from "@/lib/content-transfer/types";

const MAX_FILE_BYTES = 1_048_576;

/** The API needs this exact word to add questions; the checkbox stands in for typing it. */
const API_CONFIRMATION = "IMPORT";

const GENERIC_ERROR =
  "That didn't work and nothing changed. Try again, or reload the page.";

type TransferResponse = {
  error?: string;
  preview?: ContentTransferPreview;
  result?: ContentTransferImportResult;
};

/** The status each question will have once added, in professor words. */
const REVIEW_STATES: Record<
  ContentTransferImportState,
  { label: string; tone: StatusTone }
> = {
  approved: { label: "Approved", tone: "approved" },
  draft: { label: "Being written", tone: "draft" },
  needs_review: { label: "Waiting for your review", tone: "review" },
  rejected: { label: "Rejected", tone: "retired" },
  revision_requested: { label: "Sent back for changes", tone: "draft" },
};

const ROW_STATUS: Record<
  ContentTransferPreviewRow["status"],
  { label: string; tone: StatusTone }
> = {
  duplicate: { label: "Already here", tone: "neutral" },
  invalid: { label: "Has problems", tone: "wrong" },
  ready: { label: "Ready to add", tone: "approved" },
};

const TOPIC_TITLES = new Map(
  canonicalSyllabusTopics.map((topic) => [topic.id, topic.title]),
);

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export function ProfessorContentTransferPanel({
  canAddQuestions = true,
}: {
  /** False in the demo: files can be checked, but nothing can be added. */
  canAddQuestions?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [checkedList, setCheckedList] = useState(false);
  const [document, setDocument] = useState<ContentTransferDocument>();
  const [fileError, setFileError] = useState<string>();
  const [error, setError] = useState<string>();
  const [isApplying, setIsApplying] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [preview, setPreview] = useState<ContentTransferPreview>();
  const [result, setResult] = useState<ContentTransferImportResult>();

  function resetPreview() {
    setCheckedList(false);
    setDocument(undefined);
    setFileError(undefined);
    setError(undefined);
    setPreview(undefined);
    setResult(undefined);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    resetPreview();
    const file = event.currentTarget.files?.[0];
    if (file && file.size > MAX_FILE_BYTES) {
      setFileError("This file is larger than 1 MB. Choose a smaller file.");
    }
  }

  async function checkFile() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setFileError("Choose a question file first.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFileError("This file is larger than 1 MB. Choose a smaller file.");
      return;
    }

    setIsPreviewing(true);
    setFileError(undefined);
    setError(undefined);
    setPreview(undefined);
    setResult(undefined);
    setCheckedList(false);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text()) as unknown;
      } catch {
        setFileError(
          "This isn't a question file from this tutor. Choose the .json file you were sent.",
        );
        return;
      }
      const response = await fetch("/api/professor/content-transfer", {
        body: JSON.stringify({ document: parsed, mode: "dry_run" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as TransferResponse;
      if (!response.ok || !payload.preview) {
        setError(GENERIC_ERROR);
        return;
      }
      setDocument(parsed as ContentTransferDocument);
      setPreview(payload.preview);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function addQuestions() {
    if (!document || !preview?.canApply || !checkedList) return;
    setIsApplying(true);
    setError(undefined);
    try {
      const response = await fetch("/api/professor/content-transfer", {
        body: JSON.stringify({
          confirmation: API_CONFIRMATION,
          document,
          mode: "apply",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as TransferResponse;
      if (!response.ok || !payload.result) {
        if (payload.preview) setPreview(payload.preview);
        setError(
          payload.preview && !payload.preview.canApply
            ? "Some questions in this file now have problems, so nothing was added. Check the list below."
            : GENERIC_ERROR,
        );
        return;
      }
      setResult(payload.result);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setIsApplying(false);
    }
  }

  const readyStates = preview
    ? preview.rows
        .filter((row) => row.status === "ready")
        .map((row) => row.reviewState)
    : [];
  const allDrafts =
    readyStates.length > 0 && readyStates.every((state) => state === "draft");
  const readyCount = preview?.summary.ready ?? 0;
  const addLabel = `Add ${plural(readyCount, "question", "questions")}${allDrafts ? " as drafts" : ""}`;
  const addedCount = result?.importedIds.length ?? 0;
  const addedApproved = result?.importedStates.approved ?? 0;

  return (
    <div className="flex flex-col gap-10">
      <section
        aria-labelledby="transfer-import-heading"
        className="flex flex-col gap-4"
      >
        <h2 id="transfer-import-heading" className="type-h2 text-ink">
          Bring in questions
        </h2>

        <div className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:flex-row sm:items-start sm:p-5">
          <Field
            label="Question file"
            description="A .json file up to 1 MB, made by this tutor."
            error={fileError}
            className="min-w-0 sm:flex-1"
          >
            <Input
              ref={fileInputRef}
              accept=".json,application/json"
              className="min-h-11"
              onChange={handleFileChange}
              type="file"
            />
          </Field>
          <Button
            className="min-h-11 sm:mt-8"
            variant={preview?.canApply && !result ? "secondary" : "primary"}
            loading={isPreviewing}
            disabled={isApplying}
            onClick={checkFile}
            type="button"
          >
            <FileUp aria-hidden="true" />
            Check this file
          </Button>
        </div>

        <div aria-live="polite">
          {error ? (
            <p role="alert" className="type-body font-medium text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        {preview ? <PreviewResult preview={preview} /> : null}

        {preview?.canApply && document && !result ? (
          canAddQuestions ? (
            <section
              aria-labelledby="transfer-confirm-heading"
              className="flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5"
            >
              <h3 id="transfer-confirm-heading" className="type-h3 text-ink">
                Add these questions
              </h3>
              <p className="type-body max-w-prose text-ink">
                {plural(readyCount, "question", "questions")} will be added to
                your question bank with the status shown above. Students
                can&apos;t see any of them until you show them.
              </p>
              <CheckboxField
                label="I've checked the list above"
                checked={checkedList}
                onCheckedChange={(value) => setCheckedList(value === true)}
              />
              <Button
                className="min-h-11 self-start"
                disabled={!checkedList}
                loading={isApplying}
                onClick={addQuestions}
                type="button"
              >
                {addLabel}
              </Button>
            </section>
          ) : (
            <p className="type-body max-w-prose text-ink">
              This file is ready, but questions can&apos;t be added in the
              demo.
            </p>
          )
        ) : null}

        {result ? (
          <div
            role="status"
            className="flex flex-col items-start gap-2 rounded-panel bg-green-100 p-4 sm:p-5"
          >
            <p className="type-body-strong text-green-700">
              {plural(addedCount, "question", "questions")} added. Find them in
              Review questions.
              {addedApproved > 0
                ? ` ${plural(addedApproved, "approved question is", "approved questions are")} in the Question bank.`
                : ""}
            </p>
            <Link
              href="/professor/review"
              className="type-body inline-flex min-h-11 items-center font-medium text-azure-700 underline underline-offset-4 focus-ring"
            >
              Go to Review questions
            </Link>
          </div>
        ) : null}
      </section>

      <section
        aria-labelledby="transfer-export-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="transfer-export-heading" className="type-h2 text-ink">
            Download questions to share
          </h2>
          <p className="type-body max-w-prose text-ink">
            The file holds only the questions: no student information.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:flex-row sm:flex-wrap sm:items-center sm:p-5">
          <Button asChild variant="outline" className="min-h-11">
            <a href="/api/professor/content-transfer?scope=approved">
              <Download aria-hidden="true" />
              Download approved questions
            </a>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className="min-h-11">
                More options
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem asChild className="min-h-11">
                <a href="/api/professor/content-transfer?scope=drafts">
                  <Download aria-hidden="true" />
                  Download questions still being written
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem asChild className="min-h-11">
                <a href="/api/professor/content-transfer?scope=all">
                  <Download aria-hidden="true" />
                  Download all questions, including drafts
                </a>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>
    </div>
  );
}

function PreviewResult({ preview }: { preview: ContentTransferPreview }) {
  const { summary } = preview;
  return (
    <section
      aria-labelledby="transfer-preview-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h3 id="transfer-preview-heading" className="type-h3 text-ink">
          What&apos;s in this file
        </h3>
        <StatusChip
          tone={preview.canApply ? "correct" : "wrong"}
          label={preview.canApply ? "Ready to add" : "Has problems"}
        />
      </div>
      <ul className="type-body flex flex-wrap gap-x-6 gap-y-1 text-ink">
        <li>Questions: {summary.total}</li>
        <li>Ready to add: {summary.ready}</li>
        <li>Already here: {summary.duplicates}</li>
        <li>Has problems: {summary.invalid}</li>
      </ul>
      {!preview.canApply ? (
        <p className="type-body max-w-prose text-ink">
          Nothing will be added until every question is ready. Questions that
          are already here or have problems are listed below; ask the person
          who sent the file for a new copy.
        </p>
      ) : null}

      {preview.rootErrors.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="type-body-strong text-red-700">
            This file can&apos;t be used. It may not have been made by this
            tutor, or it was changed after it was downloaded.
          </p>
          <TechnicalDetails items={preview.rootErrors} />
        </div>
      ) : null}

      {preview.rows.length > 0 ? (
        <div className="rounded-panel bg-sheet">
          <Table
            stickyHeader
            containerClassName="rounded-panel lg:max-h-[70svh]"
            className="[&_thead_th]:bg-sheet"
          >
            <TableCaption className="sr-only">
              Each question in the file and whether it can be added
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="type-small pl-4 text-ink">
                  Question
                </TableHead>
                <TableHead scope="col" className="type-small text-ink">
                  Topic
                </TableHead>
                <TableHead scope="col" className="type-small text-ink">
                  Status once added
                </TableHead>
                <TableHead scope="col" className="type-small pr-4 text-ink">
                  Check
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.map((row) => {
                const status = ROW_STATUS[row.status];
                const reviewState = row.reviewState
                  ? REVIEW_STATES[row.reviewState]
                  : undefined;
                const details = [...row.errors, ...row.warnings];
                return (
                  <TableRow
                    key={`${row.index}:${row.stableId ?? "unknown"}`}
                    className="align-top"
                  >
                    <TableCell className="type-body min-w-56 py-2.5 pl-4 font-medium">
                      {row.title ?? `Question ${row.index + 1} (no title)`}
                    </TableCell>
                    <TableCell className="type-body min-w-40">
                      {row.topicId
                        ? (TOPIC_TITLES.get(row.topicId) ?? "Unknown topic")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {reviewState ? (
                        <StatusChip
                          label={reviewState.label}
                          tone={reviewState.tone}
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="min-w-56 py-2.5 pr-4">
                      <div className="flex flex-col items-start gap-1">
                        <StatusChip tone={status.tone} label={status.label} />
                        {details.length > 0 ? (
                          <TechnicalDetails items={details} />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </section>
  );
}

/** The checker's own wording, kept out of the default view. */
function TechnicalDetails({ items }: { items: string[] }) {
  return (
    <details className="type-small text-ink">
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium focus-ring">
        Technical details
      </summary>
      <ul className="list-disc pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}
