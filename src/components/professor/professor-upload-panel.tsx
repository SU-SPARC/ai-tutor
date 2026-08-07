"use client";

import { useRef, useState, type FormEvent } from "react";
import { AlertTriangle, FileText, Loader2, UploadCloud } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProfessorContentUploadPreview } from "@/lib/tutor/professor-content-upload";

type UploadPayload = {
  error?: string;
  imported?: boolean;
  preview?: ProfessorContentUploadPreview;
  reviewStatus?: "needs_review";
};

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
    <div className="flex flex-col gap-5">
      <form
        className="grid gap-3 lg:grid-cols-[1fr_auto]"
        onSubmit={handleSubmit}
      >
        <Input
          ref={fileInputRef}
          accept=".tex,.pdf,application/pdf,text/x-tex,application/x-tex"
          type="file"
        />
        <Button type="submit" disabled={isUploading}>
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <UploadCloud className="h-4 w-4" />
          )}
          Preview
        </Button>
      </form>

      {message ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
          {message}
        </div>
      ) : null}

      {preview ? <PreviewResult preview={preview} /> : null}
    </div>
  );
}

function PreviewResult({
  preview,
}: {
  preview: ProfessorContentUploadPreview;
}) {
  return (
    <div className="flex flex-col gap-4 border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{preview.uploadKind}</Badge>
        <Badge variant="outline">{preview.reviewStatus}</Badge>
        <Badge variant="outline">not imported</Badge>
        <Badge variant="outline">not approved</Badge>
      </div>

      <div className="grid gap-3 text-sm md:grid-cols-3">
        <Info label="File" value={preview.file.name} />
        <Info
          label="Size"
          value={`${Math.ceil(preview.file.size / 1024)} KB`}
        />
        <Info
          label="Storage"
          value={preview.privateStorage ?? "preview only"}
        />
      </div>

      {preview.warnings.length > 0 ? (
        <div className="flex gap-2 rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex flex-col gap-1">
            {preview.warnings.map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
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
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium">{value}</div>
    </div>
  );
}

function PreviewSection({ items, title }: { items: string[]; title: string }) {
  return (
    <section className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4" />
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No preview items found.
        </div>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {items.map((item) => (
            <li key={item} className="rounded-sm bg-muted px-2 py-1">
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
