"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Loader2,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  ContentTransferDocument,
  ContentTransferImportResult,
  ContentTransferPreview,
} from "@/lib/content-transfer/types";

const MAX_FILE_BYTES = 1_048_576;

type TransferResponse = {
  error?: string;
  preview?: ContentTransferPreview;
  result?: ContentTransferImportResult;
};

export function ProfessorContentTransferPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const [document, setDocument] = useState<ContentTransferDocument>();
  const [isApplying, setIsApplying] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [message, setMessage] = useState<string>();
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
      setMessage("Choose a JSON file smaller than 1MB.");
    }
  }

  async function previewImport() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setMessage("Choose a JSON content-transfer file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setMessage("Choose a JSON file smaller than 1MB.");
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
        setMessage(payload.error ?? "Import preview failed.");
        return;
      }
      setDocument(parsed as ContentTransferDocument);
      setPreview(payload.preview);
      setMessage(
        payload.preview.canApply
          ? "Dry run passed. Review every row before confirming the import."
          : "Dry run found issues. Nothing was imported.",
      );
    } catch (error) {
      setMessage(
        error instanceof SyntaxError
          ? "The selected file is not valid JSON."
          : "Import preview failed.",
      );
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
        setMessage(
          payload.error ?? "Content import failed. Nothing was imported.",
        );
        if (payload.preview) setPreview(payload.preview);
        return;
      }
      setResult(payload.result);
      setMessage(
        `${payload.result.importedIds.length} questions imported. Approved rows remain unpublished.`,
      );
    } catch {
      setMessage("Content import failed. Nothing was imported.");
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 rounded-md border border-border p-4 lg:grid-cols-[1fr_auto]">
        <div>
          <div className="flex items-center gap-2 font-medium">
            <FileJson className="h-4 w-4 text-primary" />
            Validated JSON import
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Upload question content only. Raw textbook material, private source
            fields, and student data are rejected. The dry run checks every row
            without changing content.
          </p>
        </div>
        <Badge variant="outline" className="h-8 gap-2 px-3">
          <ShieldCheck className="h-4 w-4" />
          professor only
        </Badge>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] lg:col-span-2">
          <Input
            ref={fileInputRef}
            accept=".json,application/json"
            aria-label="Question content JSON file"
            onChange={handleFileChange}
            type="file"
          />
          <Button
            disabled={isPreviewing || isApplying}
            onClick={previewImport}
            type="button"
          >
            {isPreviewing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UploadCloud className="h-4 w-4" />
            )}
            Run dry preview
          </Button>
        </div>
      </section>

      {message ? (
        <Alert aria-live="polite">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {preview ? <PreviewResult preview={preview} /> : null}

      {preview?.canApply && document && !result ? (
        <section className="rounded-md border border-border p-4">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Confirm content import
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            This creates {preview.summary.ready} immutable question versions in
            their listed review states. It never publishes content or changes
            student visibility. Type <strong>IMPORT</strong> to continue.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <Input
              aria-label="Type IMPORT to confirm"
              autoComplete="off"
              className="sm:max-w-xs"
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder="Type IMPORT"
              value={confirmation}
            />
            <Button
              disabled={confirmation !== "IMPORT" || isApplying}
              onClick={applyImport}
              type="button"
            >
              {isApplying ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Import validated rows
            </Button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section className="rounded-md border border-success/50 bg-success/10 p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            Import complete
          </div>
          <p className="mt-2 text-muted-foreground">
            Audit event {result.auditEventId} records this import. Review and
            publish approved versions separately from the question catalog.
          </p>
        </section>
      ) : null}

      <section className="rounded-md border border-border p-4">
        <div className="flex items-center gap-2 font-medium">
          <Download className="h-4 w-4 text-primary" />
          Sanitized content exports
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Exports contain question aggregates and canonical topic mappings. They
          exclude student records, reviewer identities, lifecycle notes,
          generation controls, and private source material.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ExportLink label="Export approved" scope="approved" />
          <ExportLink label="Export drafts" scope="drafts" />
          <ExportLink label="Export all eligible" scope="all" />
        </div>
      </section>
    </div>
  );
}

function PreviewResult({ preview }: { preview: ContentTransferPreview }) {
  return (
    <section className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={preview.canApply ? "success" : "destructive"}>
          {preview.canApply ? "preflight passed" : "preflight blocked"}
        </Badge>
        <Badge variant="outline">{preview.summary.total} rows</Badge>
        <Badge variant="outline">{preview.summary.ready} ready</Badge>
        <Badge variant="outline">{preview.summary.duplicates} duplicates</Badge>
        <Badge variant="outline">{preview.summary.invalid} invalid</Badge>
        <Badge variant="outline">
          {preview.storageChecked ? "storage checked" : "storage not checked"}
        </Badge>
      </div>

      {preview.rootErrors.length > 0 ? (
        <ul className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 px-5 py-3 text-sm">
          {preview.rootErrors.map((error) => (
            <li className="list-disc" key={error}>
              {error}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Topic</TableHead>
              <TableHead>Review state</TableHead>
              <TableHead>Status and details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.rows.map((row) => (
              <TableRow key={`${row.index}:${row.stableId ?? "unknown"}`}>
                <TableCell>{row.index + 1}</TableCell>
                <TableCell>
                  <div className="font-medium">
                    {row.title ?? "Invalid row"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {row.stableId ?? "No stable ID"}
                  </div>
                </TableCell>
                <TableCell>{row.topicId ?? "—"}</TableCell>
                <TableCell>{row.reviewState ?? "—"}</TableCell>
                <TableCell className="min-w-72">
                  <Badge
                    variant={
                      row.status === "ready"
                        ? "success"
                        : row.status === "duplicate"
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {row.status}
                  </Badge>
                  {[...row.errors, ...row.warnings].map((detail) => (
                    <div
                      className="mt-1 text-xs text-muted-foreground"
                      key={detail}
                    >
                      {detail}
                    </div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function ExportLink({ label, scope }: { label: string; scope: string }) {
  return (
    <Button asChild variant="outline">
      <a href={`/api/professor/content-transfer?scope=${scope}`}>
        <Download className="h-4 w-4" />
        {label}
      </a>
    </Button>
  );
}
