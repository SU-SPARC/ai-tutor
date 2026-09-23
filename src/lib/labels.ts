import type { Difficulty, SourceMetadata, TrustLevel } from "@/lib/types";

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  foundational: "Foundational",
  intermediate: "Intermediate",
  challenge: "Challenge",
};

const TRUST_LABELS: Record<TrustLevel, string> = {
  public_original: "Original",
  professor_approved: "Professor-approved",
  course_approved: "Course-approved",
  generated_unverified: "Generated draft",
  private_reference: "Private reference",
};

export function difficultyLabel(difficulty: Difficulty) {
  return DIFFICULTY_LABELS[difficulty] ?? difficulty;
}

export function sourceLabel(source: SourceMetadata) {
  return TRUST_LABELS[source.trustLevel] ?? "Approved";
}

// A trailing "Draft" marker ("… Union Draft", "… (Draft)", "… - Draft").
// It must follow a separator or whitespace so words like "Overdraft" survive.
const TRAILING_DRAFT_MARKER = /(?:\s*[-–—:|]\s*|\s*\(\s*|\s+)draft\s*\)?\s*$/i;

/**
 * Student-facing question title. Published titles can still carry an
 * authoring "Draft" marker that means nothing to students, so the display
 * drops it. Question ids, stored records, and professor views are untouched.
 */
export function studentQuestionTitle(title: string) {
  const cleaned = title.replace(TRAILING_DRAFT_MARKER, "").trim();
  return cleaned.length > 0 ? cleaned : title.trim();
}

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success";

export function difficultyBadgeVariant(difficulty: Difficulty): BadgeVariant {
  switch (difficulty) {
    case "foundational":
      return "success";
    case "intermediate":
      return "secondary";
    case "challenge":
      return "default";
    default:
      return "secondary";
  }
}

// Course words, not interview words: a student sees where a question sits in
// the course, and never a colour-coded badge. Difficulty is information, not a
// warning.
const STUDENT_DIFFICULTY_LABELS: Record<Difficulty, string> = {
  foundational: "Intro",
  intermediate: "Core",
  challenge: "Stretch",
};

export function studentDifficultyLabel(difficulty: Difficulty) {
  return STUDENT_DIFFICULTY_LABELS[difficulty] ?? difficulty;
}

/**
 * A short, stable, readable handle for a question — "Q-3F2A". Question ids are
 * long slugs that mean nothing out loud; this is what goes in the sheet header
 * and what a student quotes when they report a problem.
 *
 * FNV-1a over the id, so the same question always gets the same code without a
 * lookup table and without a round trip.
 */
export function questionCode(id: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    // FNV prime 16777619. `Math.imul` keeps the multiply in 32 bits.
    hash = Math.imul(hash, 0x01000193);
  }

  const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `Q-${hex.slice(-4)}`;
}
