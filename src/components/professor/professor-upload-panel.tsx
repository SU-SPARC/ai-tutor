"use client";

import { useId, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import type { ProfessorContentUploadPreview } from "@/lib/tutor/professor-content-upload";

type UploadPayload = {
  error?: string;
  imported?: boolean;
  preview?: ProfessorContentUploadPreview;
  reviewStatus?: "needs_review";
};

const UPLOAD_KIND_LABELS: Record<
  ProfessorContentUploadPreview["uploadKind"],
  string
> = {
  pdf: "PDF",
  tex: "LaTeX",
};

/**
 * Upload one private file and see what the tutor would extract from it.
 * Nothing is imported or approved here; the preview is the whole result.
 */
export function ProfessorUploadPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProfessorContentUploadPreview | null>(
    null,
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsUploading(true);
    setMessage(null);
    setPreview(null);

    const file = fileInputRef.current?.files?.[0];

    if (!file) {
      setMessage("Choose a .tex or .pdf file.");
      setIsUploading(false);
      return;
    }

    const formData = new FormData();
    formData.set("file", file);

    try {
      const response = await fetch("/api/professor/content-preview", {
        body: formData,
        method: "POST",
      });
      const payload = (await response.json()) as UploadPayload;

      if (!response.ok || !payload.preview) {
        setMessage(payload.error ?? "Upload preview failed.");
        return;
      }

      setPreview(payload.preview);
      setMessage("Preview generated. Nothing was approved or imported.");
    } catch {
      setMessage("Upload preview failed.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4 sm:flex-row sm:items-end"
        onSubmit={handleSubmit}
      >
        <Field label="File" className="min-w-0 sm:max-w-md sm:flex-1">
          <Input
            ref={fileInputRef}
            accept=".tex,.pdf,application/pdf,text/x-tex,application/x-tex"
            type="file"
            name="file"
          />
        </Field>
        <Button type="submit" disabled={isUploading} loading={isUploading}>
          Preview extraction
        </Button>
      </form>

      <div role="status" aria-live="polite">
        {message ? (
          <p className="type-small max-w-prose border-l-2 border-azure-500 py-1 pl-4 text-ink">
            {message}
          </p>
        ) : null}
      </div>

      {preview ? <PreviewResult preview={preview} /> : null}
    </div>
  );
}

function PreviewResult({
  preview,
}: {
  preview: ProfessorContentUploadPreview;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="type-h3 text-ink">
          Preview
        </h2>
        <StatusChip label="Needs review" tone="review" />
        <StatusChip icon={false} label="Not imported" tone="neutral" />
      </div>

      <dl className="grid gap-x-6 gap-y-2 type-small sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-ink-muted">File</dt>
        <dd className="truncate text-ink">
          {preview.file.name}{" "}
          <span className="text-ink-muted">
            · {UPLOAD_KIND_LABELS[preview.uploadKind]} ·{" "}
            <span className="tabular">
              {Math.ceil(preview.file.size / 1024)} KB
            </span>
          </span>
        </dd>
        <dt className="text-ink-muted">Storage</dt>
        <dd className="text-ink">
          {preview.privateStorage ?? "Preview only; nothing was stored"}
        </dd>
      </dl>

      {preview.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1 border-l-2 border-input py-1 pl-4 type-small text-ink">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <PreviewSection
          title="Topics"
          items={preview.topics.map((item) => item.label)}
        />
        <PreviewSection
          title="Patterns"
          items={preview.patterns.map((item) => item.label)}
        />
        <PreviewSection
          title="Formulas"
          items={preview.formulas.map(
            (item) => `${item.label}: ${item.symbolicFormula}`,
          )}
        />
        <PreviewSection
          title="Misconceptions"
          items={preview.misconceptions.map((item) => item.label)}
        />
      </div>
    </section>
  );
}

function PreviewSection({ items, title }: { items: string[]; title: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-panel bg-sheet p-4">
      <h3 className="type-body-strong text-ink">
        {title}{" "}
        <span className="font-mono text-ink-muted">{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="type-small text-ink-muted">Nothing found.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule type-small text-ink">
          {items.map((item) => (
            <li key={item} className="py-1.5">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
