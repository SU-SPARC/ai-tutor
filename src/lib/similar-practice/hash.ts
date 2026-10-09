import { createHash } from "node:crypto";

import type { GeneratedVariantContent } from "@/lib/similar-practice/contract";

/**
 * Canonical JSON: object keys sorted, arrays in order, no whitespace. The same
 * convention as `canonicalJson` in scripts/lib/review-candidate-import.mjs and
 * the sorted-key snapshot hashing behind `question_versions.content_sha256`.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The identity of a generated variant: what a student sees and how it is
 * graded. Model, prompt version, and verification reports are deliberately
 * not part of it, so regenerating the same content yields the same hash.
 */
export function generatedVariantContentHash(
  content: GeneratedVariantContent,
): string {
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}
