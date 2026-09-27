"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  CircleX,
  Download,
  FileUp,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

type TransferResponse = {
  error?: string;
  preview?: ContentTransferPreview;
  result?: ContentTransferImportResult;
};

type Message = { text: string; tone: "info" | "success" | "destructive" };

/** The lifecycle words and chip tones the review and question screens use. */
const REVIEW_STATES: Record<
  ContentTransferImportState,
  { icon?: LucideIcon; label: string; tone: StatusTone }
> = {
  approved: { label: "Approved", tone: "approved" },
  draft: { label: "Draft", tone: "draft" },
  needs_review: { label: "Needs review", tone: "review" },
  rejected: { icon: CircleX, label: "Rejected", tone: "retired" },
  revision_requested: {
    icon: RotateCcw,
    label: "Revision requested",
    tone: "draft",
  },
};

const ROW_STATUS: Record<
  ContentTransferPreviewRow["status"],
  { label: string; tone: StatusTone }
> = {
  duplicate: { label: "Duplicate", tone: "neutral" },
  invalid: { label: "Invalid", tone: "wrong" },
  ready: { label: "Ready", tone: "approved" },
};

const TOPIC_TITLES = new Map(
  canonicalSyllabusTopics.map((topic) => [topic.id, topic.title]),
);

const EXPORTS = [
  { label: "Export approved", scope: "approved" },
  { label: "Export drafts", scope: "drafts" },
  { label: "Export all eligible", scope: "all" },
] as const;

export function ProfessorContentTransferPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [document, setDocument] = useState<ContentTransferDocument>();
  const [isApplying, setIsApplying] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [message, setMessage] = useState<Message>();
  const [preview, setPreview] = useState<ContentTransferPreview>();
  const [result, setResult] = useState<ContentTransferImportResult>();

  function resetPreview() {
    setConfirmation("");
    setDocument(undefined);
    setMessage(undefined);
    setPreview(undefined);
    setResult(undefined);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    resetPreview();
    const file = event.currentTarget.files?.[0];
    if (file && file.size > MAX_FILE_BYTES) {
      setMessage({
        text: "That file is over 1 MB. Choose a JSON file smaller than 1 MB.",
        tone: "destructive",
      });
    }
  }

  async function previewImport() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setMessage({
        text: "Choose a JSON content-transfer file first.",
        tone: "destructive",
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setMessage({
        text: "That file is over 1 MB. Choose a JSON file smaller than 1 MB.",
        tone: "destructive",
      });
      return;
    }

    setIsPreviewing(true);
    setMessage(undefined);
    setPreview(undefined);
    setResult(undefined);
    setConfirmation("");
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const response = await fetch("/api/professor/content-transfer", {
        body: JSON.stringify({ document: parsed, mode: "dry_run" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as TransferResponse;
      if (!response.ok || !payload.preview) {
        setMessage({
          text:
            payload.error ?? "The import preview failed. Nothing was imported.",
          tone: "destructive",
        });
        return;
      }
      setDocument(parsed as ContentTransferDocument);
      setPreview(payload.preview);
      setMessage(
        payload.preview.canApply
          ? {
              text: "Dry run passed. Review every row before you confirm the import.",
              tone: "info",
            }
          : {
              text: "Dry run found issues. Nothing was imported; fix the rows below and preview again.",
              tone: "destructive",
            },
      );
    } catch (error) {
      setMessage({
        text:
          error instanceof SyntaxError
            ? "The selected file is not valid JSON."
            : "The import preview failed. Nothing was imported.",
        tone: "destructive",
      });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function applyImport() {
    if (!document || !preview?.canApply || confirmation !== "IMPORT") return;
    setIsApplying(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/professor/content-transfer", {
        body: JSON.stringify({
          confirmation,
          document,
          mode: "apply",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as TransferResponse;
      if (!response.ok || !payload.result) {
        setMessage({
          text: payload.error ?? "The import failed. Nothing was imported.",
          tone: "destructive",
        });
        if (payload.preview) setPreview(payload.preview);
        return;
      }
      setResult(payload.result);
      setMessage({
        text: `${payload.result.importedIds.length} questions imported. Approved rows stay unpublished.`,
        tone: "success",
      });
    } catch {
      setMessage({
        text: "The import failed. Nothing was imported.",
        tone: "destructive",
      });
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <section
        aria-labelledby="transfer-import-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="transfer-import-heading" className="type-h2 text-ink">
            Import
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            Question content only: raw textbook material, private source fields
            and student data are rejected. The dry run checks every row without
            changing anything.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:flex-row sm:items-end sm:p-5">
          <Field
            label="Question content file"
            description="JSON, up to 1 MB."
            className="min-w-0 sm:flex-1"
          >
            <Input
              ref={fileInputRef}
              accept=".json,application/json"
              onChange={handleFileChange}
              type="file"
            />
          </Field>
          <Button
            className="sm:mb-7"
            variant={preview?.canApply && !result ? "secondary" : "primary"}
            loading={isPreviewing}
            disabled={isApplying}
            onClick={previewImport}
            type="button"
          >
            <FileUp aria-hidden="true" />
            Preview import
          </Button>
        </div>

        <div
          aria-live={message?.tone === "destructive" ? "assertive" : "polite"}
        >
          {message ? (
            <Alert role="note" variant={message.tone}>
              <AlertDescription className="text-ink">
                {message.text}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        {preview ? <PreviewResult preview={preview} /> : null}

        {preview?.canApply && document && !result ? (
          <section
            aria-labelledby="transfer-confirm-heading"
            className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:p-5"
          >
            <h3 id="transfer-confirm-heading" className="type-h3 text-ink">
              Confirm the import
            </h3>
            <p className="type-small max-w-prose text-ink-muted">
              This creates{" "}
              <span className="font-mono tabular text-ink">
                {preview.summary.ready}
              </span>{" "}
              immutable question versions in their listed review states. It
              never publishes content or changes what students can see.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Type IMPORT to confirm" className="sm:w-60">
                <Input
                  autoComplete="off"
                  mono
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="IMPORT"
                  value={confirmation}
                />
              </Field>
              <Button
                disabled={confirmation !== "IMPORT"}
                loading={isApplying}
                onClick={applyImport}
                type="button"
              >
                Import {preview.summary.ready}{" "}
                {preview.summary.ready === 1 ? "question" : "questions"}
              </Button>
            </div>
          </section>
        ) : null}

        {result ? (
          <Alert role="note" variant="success">
            <AlertTitle>Import complete</AlertTitle>
            <AlertDescription>
              Audit event {result.auditEventId} records this import. Review and
              publish approved versions separately, from Question lifecycle.
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      <section
        aria-labelledby="transfer-export-heading"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-1">
          <h2 id="transfer-export-heading" className="type-h2 text-ink">
            Export
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            Exports hold question content and canonical topic mappings, never
            student records, reviewer identities, lifecycle notes, generation
            controls or private source material.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-panel bg-sheet p-4 sm:flex-row sm:flex-wrap sm:p-5">
          {EXPORTS.map((item) => (
            <Button key={item.scope} asChild variant="secondary">
              <a href={`/api/professor/content-transfer?scope=${item.scope}`}>
                <Download aria-hidden="true" />
                {item.label}
              </a>
            </Button>
          ))}
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
          Dry run
        </h3>
        <StatusChip
          tone={preview.canApply ? "correct" : "wrong"}
          label={preview.canApply ? "Preflight passed" : "Preflight blocked"}
        />
      </div>
      <dl className="flex flex-wrap gap-x-5 gap-y-1 type-small">
        <SummaryCount label="Rows" value={summary.total} />
        <SummaryCount label="Ready" value={summary.ready} />
        <SummaryCount label="Duplicates" value={summary.duplicates} />
        <SummaryCount label="Invalid" value={summary.invalid} />
        <div className="flex gap-2">
          <dt className="text-ink-muted">Storage</dt>
          <dd className="text-ink">
            {preview.storageChecked ? "checked" : "not checked"}
          </dd>
        </div>
      </dl>

      {preview.rootErrors.length > 0 ? (
        <Alert role="note" variant="destructive">
          <AlertTitle>The file as a whole has problems</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {preview.rootErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-panel bg-sheet">
        <Table
          stickyHeader
          containerClassName="rounded-panel lg:max-h-[70svh]"
          className="[&_thead_th]:bg-sheet"
        >
          <TableCaption className="sr-only">
            Dry-run result for each row in the file
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" numeric className="pl-4">
                Row
              </TableHead>
              <TableHead scope="col">Question</TableHead>
              <TableHead scope="col">Topic</TableHead>
              <TableHead scope="col">Review state</TableHead>
              <TableHead scope="col" className="pr-4">
                Status and details
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((row) => {
              const status = ROW_STATUS[row.status];
              const reviewState = row.reviewState
                ? REVIEW_STATES[row.reviewState]
                : undefined;
              return (
                <TableRow
                  key={`${row.index}:${row.stableId ?? "unknown"}`}
                  className="align-top"
                >
                  <TableCell numeric className="pl-4">
                    {row.index + 1}
                  </TableCell>
                  <TableCell className="min-w-56 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {row.title ?? "Untitled row"}
                      </span>
                      <span className="type-caption font-mono break-all">
                        {row.stableId ?? "No stable ID"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="min-w-40">
                    {row.topicId
                      ? (TOPIC_TITLES.get(row.topicId) ?? row.topicId)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {reviewState ? (
                      <StatusChip
                        icon={reviewState.icon ?? true}
                        label={reviewState.label}
                        tone={reviewState.tone}
                      />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="min-w-72 py-2.5 pr-4">
                    <div className="flex flex-col items-start gap-1">
                      <StatusChip tone={status.tone} label={status.label} />
                      {[...row.errors, ...row.warnings].map((detail) => (
                        <span className="type-caption" key={detail}>
                          {detail}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-mono tabular text-ink">{value}</dd>
    </div>
  );
}
