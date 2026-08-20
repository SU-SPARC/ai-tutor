import type { InstructorMisconceptionCount } from "@/lib/types";

const SHORT_CODE_LENGTH = 4;
const DISAMBIGUATED_CODE_LENGTH = 8;

/**
 * Student keys are SHA-256 digests, which are unreadable in a table. Label a
 * student by the first few characters instead — and when two keys in the same
 * listing share that prefix, lengthen both rather than showing one label for
 * two people.
 */
export function assignStudentLabels(studentKeys: string[]) {
  const prefixCounts = new Map<string, number>();

  for (const key of studentKeys) {
    const prefix = key.slice(0, SHORT_CODE_LENGTH);
    prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
  }

  const labels = new Map<string, string>();

  for (const key of studentKeys) {
    const prefix = key.slice(0, SHORT_CODE_LENGTH);
    const length =
      (prefixCounts.get(prefix) ?? 0) > 1
        ? DISAMBIGUATED_CODE_LENGTH
        : SHORT_CODE_LENGTH;
    labels.set(key, studentLabel(key, length));
  }

  return labels;
}

export function studentLabel(studentKey: string, length = SHORT_CODE_LENGTH) {
  return `Student ${studentKey.slice(0, length).toUpperCase()}`;
}

/**
 * A student key is only ever a hex digest. Anything else is a hand-written URL,
 * not a student, and must not reach a query.
 */
export function isStudentKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function accuracy(correctAttempts: number, attempts: number) {
  return attempts > 0 ? correctAttempts / attempts : undefined;
}

export function formatAccuracy(correctAttempts: number, attempts: number) {
  const value = accuracy(correctAttempts, attempts);
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * Misconception ids come from two places: the shared probability/statistics
 * library, whose ids are kebab-case phrases, and per-question records, whose
 * ids are author-chosen. Humanize the id rather than inventing a description
 * neither source provides.
 */
export function misconceptionLabel(misconceptionId: string) {
  const humanized = misconceptionId
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!humanized) {
    return misconceptionId;
  }

  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

export function labelMisconceptions(
  counts: Array<Omit<InstructorMisconceptionCount, "label">>,
): InstructorMisconceptionCount[] {
  return counts.map((count) => ({
    ...count,
    label: misconceptionLabel(count.misconceptionId),
  }));
}
