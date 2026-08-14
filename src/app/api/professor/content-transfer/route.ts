import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  authorizeApi,
  currentAuthenticatedUser,
  requireProfessorReview,
} from "@/lib/auth/authorization";
import {
  addStoredImportErrors,
  buildQuestionContentExport,
  contentTransferPromptFingerprint,
  validateContentTransferDocument,
} from "@/lib/content-transfer/schema";
import type { ContentTransferExportScope } from "@/lib/content-transfer/types";
import { recordContentTransferApiAttempt } from "@/lib/data/content-transfer-audit";
import {
  getQuestionLifecycleDashboard,
  importContentTransferDocument,
  inspectContentTransferStorage,
} from "@/lib/data/data-store";
import { getServerEnv } from "@/lib/env/server";
import { QuestionLifecycleValidationError } from "@/lib/tutor/question-lifecycle";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_048_576;
const REQUEST_FIELDS = new Set(["confirmation", "document", "mode"]);
const EXPORT_SCOPES = new Set<ContentTransferExportScope>([
  "all",
  "approved",
  "drafts",
]);

export async function GET(request: Request) {
  const requestId = requestIdentifier(request);
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) {
    await recordContentTransferApiAttempt({
      action: "export",
      outcome: "denied",
      principal: await currentAuthenticatedUser(),
      requestId,
    });
    return access.response;
  }
  const scopeValue = new URL(request.url).searchParams.get("scope") ?? "all";
  if (!EXPORT_SCOPES.has(scopeValue as ContentTransferExportScope)) {
    return NextResponse.json(
      { error: "scope must be all, approved, or drafts." },
      { status: 400 },
    );
  }
  const scope = scopeValue as ContentTransferExportScope;
  try {
    const dashboard = await getQuestionLifecycleDashboard(access.authorization);
    const document = buildQuestionContentExport({
      questions: dashboard.questions,
      scope,
    });
    return new NextResponse(JSON.stringify(document, null, 2), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="question-content-${scope}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    await recordContentTransferApiAttempt({
      action: "export",
      errorName: error instanceof Error ? error.name : "ContentExportError",
      outcome: "failure",
      principal: access.authorization.principal,
      requestId,
    });
    return NextResponse.json(
      { error: "Content export storage is unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const requestId = requestIdentifier(request);
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) {
    await recordContentTransferApiAttempt({
      action: "preview",
      outcome: "denied",
      principal: await currentAuthenticatedUser(),
      requestId,
    });
    return access.response;
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Content-transfer requests must be smaller than 1MB." },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Content-transfer requests must be smaller than 1MB." },
      { status: 413 },
    );
  }
  const input = recordValue(body);
  if (
    !input ||
    Object.keys(input).some((field) => !REQUEST_FIELDS.has(field)) ||
    (input.mode !== "dry_run" && input.mode !== "apply")
  ) {
    return NextResponse.json(
      {
        error:
          "Request must contain mode dry_run or apply and a transfer document.",
      },
      { status: 400 },
    );
  }

  const validation = validateContentTransferDocument(input.document);
  const storageAvailable = contentTransferStorageAvailable();
  if (validation.document && storageAvailable) {
    try {
      const inspection = await inspectContentTransferStorage(
        access.authorization,
        {
          contentFingerprints: validation.document.questions.map((question) =>
            contentTransferPromptFingerprint(question.prompt),
          ),
          misconceptionIds: validation.document.questions.flatMap((question) =>
            question.misconceptions.map((item) => item.id),
          ),
          questionIds: validation.document.questions.map(
            (question) => question.stableId,
          ),
          topicIds: [
            ...new Set(
              validation.document.questions.map((question) => question.topicId),
            ),
          ],
        },
      );
      addStoredImportErrors(validation, inspection);
    } catch (error) {
      await recordContentTransferApiAttempt({
        action: input.mode === "apply" ? "import" : "preview",
        errorName: error instanceof Error ? error.name : "ContentPreviewError",
        outcome: "failure",
        principal: access.authorization.principal,
        requestId,
      });
      return NextResponse.json(
        { error: "Content-transfer storage is unavailable." },
        { status: 503 },
      );
    }
  }

  if (input.mode === "dry_run") {
    return NextResponse.json({ preview: validation.preview });
  }
  if (input.confirmation !== "IMPORT") {
    return NextResponse.json(
      { error: "Applying an import requires confirmation value IMPORT." },
      { status: 422 },
    );
  }
  if (!storageAvailable) {
    return NextResponse.json(
      { error: "Content imports require configured database storage." },
      { status: 503 },
    );
  }
  if (!validation.document || !validation.preview.canApply) {
    const hasDuplicates = validation.preview.summary.duplicates > 0;
    return NextResponse.json(
      {
        error:
          "No content was imported because the transfer document failed preflight.",
        preview: validation.preview,
      },
      { status: hasDuplicates ? 409 : 422 },
    );
  }

  try {
    const result = await importContentTransferDocument(access.authorization, {
      document: validation.document,
      requestId,
    });
    return NextResponse.json(
      { preview: validation.preview, result },
      { status: 201 },
    );
  } catch (error) {
    await recordContentTransferApiAttempt({
      action: "import",
      errorName: error instanceof Error ? error.name : "ContentImportError",
      outcome: "failure",
      principal: access.authorization.principal,
      requestId,
    });
    const conflict =
      error instanceof Error &&
      (error.name === "QuestionLifecycleConflictError" ||
        /duplicate key|unique constraint/i.test(error.message));
    const validationFailure = error instanceof QuestionLifecycleValidationError;
    return NextResponse.json(
      {
        error: conflict
          ? "No content was imported because a stable question or misconception ID now exists. Refresh the preview."
          : validationFailure
            ? "No content was imported because current storage validation failed. Refresh the preview."
            : "Content import storage is unavailable.",
      },
      { status: conflict ? 409 : validationFailure ? 422 : 503 },
    );
  }
}

function contentTransferStorageAvailable() {
  const env = getServerEnv();
  return !env.APP_DEMO_MODE && Boolean(env.DATABASE_URL);
}

function requestIdentifier(request: Request) {
  const value = request.headers.get("x-request-id")?.trim();
  return value ? value.slice(0, 200) : randomUUID();
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
