import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { lifecycleApiErrorResponse } from "@/lib/api/question-lifecycle";
import { authorizeApi, requireProfessorReview } from "@/lib/auth/authorization";
import {
  createQuestionLifecycle,
  findQuestionIntakeDuplicates,
  getQuestionIntakeTopics,
} from "@/lib/data/data-store";
import { DataServiceUnavailableError } from "@/lib/data/service-error";
import {
  QuestionIntakeAiError,
  generateQuestionIntakeDraft,
} from "@/lib/question-intake/ai";
import {
  QUESTION_INTAKE_IMAGE_MAX_BYTES,
  QuestionIntakeImageError,
  validateQuestionIntakeImage,
} from "@/lib/question-intake/image";
import {
  hasBlockingQuestionIntakeFailure,
  isQuestionIntakeSourceKind,
  originalityNoteForQuestionIntake,
  validateQuestionIntakeModelDraft,
  verifyQuestionIntakeDraft,
} from "@/lib/question-intake/schema";
import type {
  QuestionIntakeDuplicate,
  QuestionIntakeInputMode,
} from "@/lib/question-intake/types";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { isQuestionLifecycleDomainError } from "@/lib/tutor/question-lifecycle";

export const runtime = "nodejs";

const MAX_TEXT_CHARACTERS = 8_000;
const MAX_MULTIPART_BYTES = QUESTION_INTAKE_IMAGE_MAX_BYTES + 65_536;
const MAX_SAVE_BYTES = 65_536;
const ANALYSIS_RATE_LIMIT = { max: 10, windowMs: 5 * 60_000 };
const SAVE_RATE_LIMIT = { max: 30, windowMs: 5 * 60_000 };
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;

  const rateLimit = professorRateLimit(
    request,
    access.authorization.principal.userId,
    "analyze",
    ANALYSIS_RATE_LIMIT,
  );
  if (rateLimit) return rateLimit;
  if (
    Number(request.headers.get("content-length") ?? 0) > MAX_MULTIPART_BYTES
  ) {
    return jsonError("Question intake requests must be 5MB or smaller.", 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("Question analysis must use multipart form data.", 400);
  }
  const unsupported = [...formData.keys()].find(
    (key) => !["file", "mode", "questionText"].includes(key),
  );
  if (unsupported) {
    return jsonError(`Unsupported question intake field: ${unsupported}.`, 400);
  }

  const modeValue = formData.get("mode");
  const inputMode: QuestionIntakeInputMode | undefined =
    modeValue === "text" || modeValue === "image" ? modeValue : undefined;
  if (!inputMode) return jsonError("mode must be text or image.", 400);
  const questionText = textValue(formData.get("questionText"));
  const file = formData.get("file");
  if (formData.getAll("file").length > 1) {
    return jsonError("Upload exactly one question image.", 400);
  }

  let imageDataUrl: string | undefined;
  if (inputMode === "text") {
    if (!questionText || questionText.length > MAX_TEXT_CHARACTERS) {
      return jsonError(
        "Paste or type a question between 1 and 8,000 characters.",
        400,
      );
    }
    if (isUploadedFile(file) && file.size > 0) {
      return jsonError("Submit either text or one image, not both.", 400);
    }
  } else {
    if (questionText) {
      return jsonError("Submit either text or one image, not both.", 400);
    }
    if (!isUploadedFile(file)) {
      return jsonError("Upload one PNG, JPEG, or WEBP question image.", 400);
    }
    try {
      const image = validateQuestionIntakeImage({
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        size: file.size,
        type: file.type,
      });
      imageDataUrl = image.dataUrl;
    } catch (error) {
      if (error instanceof QuestionIntakeImageError) {
        return jsonError(error.message, error.status);
      }
      return jsonError("The question image could not be read safely.", 400);
    }
  }

  try {
    const topics = await getQuestionIntakeTopics(access.authorization);
    if (topics.length === 0) {
      return jsonError(
        "No active course topics are available for intake.",
        503,
      );
    }
    const generated = await generateQuestionIntakeDraft({
      imageDataUrl,
      inputMode,
      questionText,
      topics,
    });
    let duplicates: QuestionIntakeDuplicate[] = [];
    try {
      duplicates = await findQuestionIntakeDuplicates(access.authorization, {
        prompt: generated.draft.prompt,
        topicId: generated.draft.topicId,
      });
    } catch {
      generated.draft.warnings = [
        ...new Set([
          ...generated.draft.warnings,
          "Duplicate detection is temporarily unavailable and will run again before saving.",
        ]),
      ];
    }
    return NextResponse.json(
      {
        draft: generated.draft,
        duplicates,
        inputMode,
        model: generated.model,
        saved: false,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof QuestionIntakeAiError) {
      return NextResponse.json(
        {
          code: error.code,
          details: error.details,
          error: error.message,
          manualDraftAllowed: true,
        },
        {
          headers: NO_STORE_HEADERS,
          status: error.code === "invalid_provider_output" ? 422 : 503,
        },
      );
    }
    return jsonError(
      "Question analysis storage is unavailable. Manual question creation remains available.",
      503,
    );
  }
}

export async function PUT(request: Request) {
  const access = await authorizeApi(requireProfessorReview);
  if (!access.ok) return access.response;
  const rateLimit = professorRateLimit(
    request,
    access.authorization.principal.userId,
    "save",
    SAVE_RATE_LIMIT,
  );
  if (rateLimit) return rateLimit;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_SAVE_BYTES) {
    return jsonError(
      "Question draft save requests must be smaller than 64KB.",
      413,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Question draft save body must be valid JSON.", 400);
  }
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_SAVE_BYTES) {
    return jsonError(
      "Question draft save requests must be smaller than 64KB.",
      413,
    );
  }
  const input = recordValue(body);
  if (
    !input ||
    Object.keys(input).some(
      (key) => !["draft", "duplicateAcknowledged", "sourceKind"].includes(key),
    ) ||
    !isQuestionIntakeSourceKind(input.sourceKind) ||
    (input.duplicateAcknowledged !== undefined &&
      typeof input.duplicateAcknowledged !== "boolean")
  ) {
    return jsonError(
      "Save requires an editable draft, a supported source selection, and optional duplicate acknowledgement.",
      400,
    );
  }

  try {
    const topics = await getQuestionIntakeTopics(access.authorization);
    const validation = validateQuestionIntakeModelDraft(input.draft, topics);
    if (!validation.draft) {
      return NextResponse.json(
        {
          error: "The editable question draft is incomplete or invalid.",
          reasons: validation.errors,
        },
        { headers: NO_STORE_HEADERS, status: 422 },
      );
    }
    const draft = verifyQuestionIntakeDraft(validation.draft, topics);
    if (hasBlockingQuestionIntakeFailure(draft)) {
      return NextResponse.json(
        {
          draft,
          error:
            "Correct the answer, solution, topic, or first-hint consistency checks before saving.",
        },
        { headers: NO_STORE_HEADERS, status: 422 },
      );
    }

    const duplicates = await findQuestionIntakeDuplicates(
      access.authorization,
      { prompt: draft.prompt, topicId: draft.topicId },
    );
    if (duplicates.length > 0 && input.duplicateAcknowledged !== true) {
      return NextResponse.json(
        {
          duplicates,
          error: "A similar question may already exist.",
          requiresDuplicateAcknowledgement: true,
        },
        { headers: NO_STORE_HEADERS, status: 409 },
      );
    }

    const questionId = questionIdFromTitle(draft.title);
    const question = await createQuestionLifecycle(access.authorization, {
      allowDuplicatePrompt: input.duplicateAcknowledged === true,
      content: {
        answer: { ...draft.answer },
        difficulty: draft.difficulty,
        hints: [...draft.hints],
        id: questionId,
        misconceptions: draft.misconceptions.map((item) => ({
          ...item,
          matchTerms: [...item.matchTerms],
        })),
        prompt: draft.prompt,
        solutionSteps: [...draft.solutionSteps],
        source: {
          originalityNote: originalityNoteForQuestionIntake(input.sourceKind),
          sourceType: "professor_provided",
          trustLevel: "public_original",
          visibility: "public",
        },
        title: draft.title,
        topicId: draft.topicId,
      },
      creationMethod: "generated",
      submit: false,
    });
    return NextResponse.json(
      { duplicates, question },
      { headers: NO_STORE_HEADERS, status: 201 },
    );
  } catch (error) {
    if (isQuestionLifecycleDomainError(error)) {
      return lifecycleApiErrorResponse(error);
    }
    if (error instanceof DataServiceUnavailableError) {
      return jsonError(
        "Question drafts require configured database storage. The editable draft has not been lost from this page.",
        503,
      );
    }
    return jsonError("Question draft storage is unavailable.", 503);
  }
}

function professorRateLimit(
  request: Request,
  userId: string,
  action: string,
  options: { max: number; windowMs: number },
) {
  const results = [
    checkRateLimit(`question-intake:${action}:user:${userId}`, options),
    checkRateLimit(
      `question-intake:${action}:ip:${getClientIp(request)}`,
      options,
    ),
  ];
  const blocked = results.find((result) => !result.allowed);
  return blocked
    ? NextResponse.json(
        {
          error: "Too many question intake requests. Please try again shortly.",
        },
        {
          headers: {
            ...NO_STORE_HEADERS,
            "Retry-After": String(blocked.retryAfterSeconds ?? 1),
          },
          status: 429,
        },
      )
    : undefined;
}

function questionIdFromTitle(title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 72);
  return `ai-intake-${slug || "question"}-${randomUUID().slice(0, 8)}`;
}

function textValue(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
    typeof value === "object" &&
    "arrayBuffer" in value &&
    "name" in value &&
    "size" in value &&
    typeof value.arrayBuffer === "function" &&
    typeof value.name === "string" &&
    typeof value.size === "number",
  );
}

function jsonError(message: string, status: 400 | 413 | 503) {
  return NextResponse.json(
    { error: message },
    { headers: NO_STORE_HEADERS, status },
  );
}
