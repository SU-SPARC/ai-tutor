"use client";

import Link from "next/link";
import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { Math as Formula } from "@/components/math/math-renderer";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ProfessorContentUploadPreview } from "@/lib/tutor/professor-content-upload";

type UploadPayload = {
  error?: string;
  imported?: boolean;
  preview?: ProfessorContentUploadPreview;
  reviewStatus?: "needs_review";
};

const ACCEPTED_EXTENSIONS = [".pdf", ".tex"] as const;

const WRONG_TYPE_MESSAGE =
  "This file isn't a PDF or .tex file we can read. Try exporting it again as PDF.";
const GENERIC_ERROR_MESSAGE =
  "Something went wrong reading the file. Nothing was saved; please try again.";

/** "500 KB", "2.1 MB": sizes the way a file browser shows them. */
export function formatUploadSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function tooLargeMessage(bytes: number, maxBytes: number) {
  return `This file is ${formatUploadSize(bytes)}. Files must be ${formatUploadSize(maxBytes)} or smaller; try saving a shorter PDF.`;
}

/**
 * The problem with a chosen file, checked in the browser before anything is
 * sent, or undefined when the file can be uploaded.
 */
export function uploadFileProblem(
  file: Pick<File, "name" | "size">,
  maxBytes: number,
) {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return WRONG_TYPE_MESSAGE;
  }
  if (file.size <= 0) {
    return "This file is empty. Choose another file.";
  }
  if (file.size > maxBytes) {
    return tooLargeMessage(file.size, maxBytes);
  }
  return undefined;
}

/**
 * Upload one file of lecture notes and see what the tutor can read from it.
 * Nothing is saved to the course; the preview is the whole result.
 */
export function ProfessorUploadPanel({ maxBytes }: { maxBytes: number }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ProfessorContentUploadPreview | null>(
    null,
  );

  function handleFileChange() {
    const file = fileInputRef.current?.files?.[0];
    setMessage(null);
    setFieldError(file ? uploadFileProblem(file, maxBytes) : undefined);
  }

  function uploadAnother() {
    setPreview(null);
    setMessage(null);
    setFieldError(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.focus();
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setPreview(null);

    const file = fileInputRef.current?.files?.[0];

    if (!file) {
      setFieldError("Choose a file first.");
      fileInputRef.current?.focus();
      return;
    }

    const problem = uploadFileProblem(file, maxBytes);
    if (problem) {
      setFieldError(problem);
      fileInputRef.current?.focus();
      return;
    }

    setFieldError(undefined);
    setIsUploading(true);

    const formData = new FormData();
    formData.set("file", file);

    try {
      const response = await fetch("/api/professor/content-preview", {
        body: formData,
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as UploadPayload;

      if (!response.ok || !payload.preview) {
        // Server wording can carry internal detail; say it plainly instead.
        if (response.status === 413) {
          setFieldError(tooLargeMessage(file.size, maxBytes));
        } else if (response.status === 400) {
          setFieldError(WRONG_TYPE_MESSAGE);
        } else {
          setMessage(GENERIC_ERROR_MESSAGE);
        }
        return;
      }

      setPreview(payload.preview);
      setMessage(
        `Here's what we found in ${payload.preview.file.name}. Nothing was saved to your course.`,
      );
    } catch {
      setMessage(GENERIC_ERROR_MESSAGE);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <Field
          label="Your lecture notes"
          description={`A PDF or LaTeX (.tex) file, up to ${formatUploadSize(maxBytes)}. Example: week3-notes.pdf`}
          error={fieldError}
          className="min-w-0 sm:max-w-md"
        >
          <Input
            ref={fileInputRef}
            accept=".tex,.pdf,application/pdf,text/x-tex,application/x-tex"
            type="file"
            name="file"
            className="min-h-11"
            onChange={handleFileChange}
          />
        </Field>
        <p className="type-body max-w-prose text-ink">
          Your file stays private. Students never see it.
        </p>
        <div>
          <Button
            type="submit"
            size="lg"
            className="min-h-11"
            disabled={isUploading}
            loading={isUploading}
          >
            Upload and preview
          </Button>
        </div>
      </form>

      <div role="status" aria-live="polite">
        {message && !preview ? (
          <p className="type-body max-w-prose border-l-2 border-azure-500 py-1 pl-4 text-ink">
            {message}
          </p>
        ) : null}
        {preview ? (
          <p className="sr-only">{message}</p>
        ) : null}
      </div>

      {preview ? (
        <PreviewResult preview={preview} onUploadAnother={uploadAnother} />
      ) : null}
    </div>
  );
}

function PreviewResult({
  onUploadAnother,
  preview,
}: {
  onUploadAnother: () => void;
  preview: ProfessorContentUploadPreview;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5 rounded-panel bg-surface-tint p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="type-h3 text-ink">
          Here&apos;s what we found in {preview.file.name}
        </h2>
        <p className="type-body text-ink">Nothing was saved to your course.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PreviewSection
          title="Topics we found"
          items={preview.topics.map((item) => ({
            key: item.label,
            content: item.label,
          }))}
        />
        <PreviewSection
          title="Kinds of problems"
          items={preview.patterns.map((item) => ({
            key: item.label,
            content: item.label,
          }))}
        />
        <PreviewSection
          title="Formulas"
          items={preview.formulas.map((item) => ({
            key: `${item.label}:${item.symbolicFormula}`,
            content: (
              <span className="flex flex-col gap-1">
                <span>{item.label}</span>
                <Formula display>{item.symbolicFormula}</Formula>
              </span>
            ),
          }))}
        />
        <PreviewSection
          title="Common student mistakes"
          items={preview.misconceptions.map((item) => ({
            key: item.label,
            content: item.label,
          }))}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg" className="min-h-11">
          <Link href="/professor/questions?tab=intake">
            Add a question on these topics
          </Link>
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="min-h-11"
          onClick={onUploadAnother}
        >
          Upload another file
        </Button>
      </div>
    </section>
  );
}

function PreviewSection({
  items,
  title,
}: {
  items: Array<{ key: string; content: ReactNode }>;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-panel bg-sheet p-4">
      <h3 className="type-body-strong text-ink">{title}</h3>
      {items.length === 0 ? (
        <p className="type-body text-ink-muted">None found in this file.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-rule type-body text-ink">
          {items.map((item) => (
            <li key={item.key} className="py-2">
              {item.content}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
