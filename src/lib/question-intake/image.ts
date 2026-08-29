import "server-only";

import path from "node:path";

export const QUESTION_INTAKE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const QUESTION_INTAKE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

type QuestionIntakeImageType = (typeof QUESTION_INTAKE_IMAGE_TYPES)[number];

export type ValidatedQuestionIntakeImage = {
  bytes: Uint8Array;
  dataUrl: string;
  mimeType: QuestionIntakeImageType;
  name: string;
};

export class QuestionIntakeImageError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413) {
    super(message);
    this.name = "QuestionIntakeImageError";
    this.status = status;
  }
}

export function validateQuestionIntakeImage(input: {
  bytes: Uint8Array;
  name: string;
  size: number;
  type: string;
}): ValidatedQuestionIntakeImage {
  if (input.size <= 0 || input.bytes.byteLength <= 0) {
    throw new QuestionIntakeImageError(
      "Upload a non-empty screenshot or photo.",
      400,
    );
  }
  if (
    input.size > QUESTION_INTAKE_IMAGE_MAX_BYTES ||
    input.bytes.byteLength > QUESTION_INTAKE_IMAGE_MAX_BYTES
  ) {
    throw new QuestionIntakeImageError(
      "Question screenshots must be 5MB or smaller.",
      413,
    );
  }
  if (
    !(QUESTION_INTAKE_IMAGE_TYPES as readonly string[]).includes(input.type)
  ) {
    throw new QuestionIntakeImageError(
      "Question screenshots must be PNG, JPEG, or WEBP images.",
      400,
    );
  }

  const mimeType = input.type as QuestionIntakeImageType;
  const extension = path.extname(input.name).toLowerCase();
  const extensionMatches =
    (mimeType === "image/png" && extension === ".png") ||
    (mimeType === "image/jpeg" && [".jpg", ".jpeg"].includes(extension)) ||
    (mimeType === "image/webp" && extension === ".webp");
  if (!extensionMatches || !hasExpectedImageSignature(input.bytes, mimeType)) {
    throw new QuestionIntakeImageError(
      "The image extension, MIME type, and file signature must agree.",
      400,
    );
  }

  return {
    bytes: input.bytes,
    dataUrl: `data:${mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`,
    mimeType,
    name: path.basename(input.name).slice(0, 200),
  };
}

function hasExpectedImageSignature(
  bytes: Uint8Array,
  mimeType: QuestionIntakeImageType,
) {
  if (mimeType === "image/png") {
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return (
    Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP"
  );
}
