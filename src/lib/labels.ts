import type { Difficulty, SourceMetadata, TrustLevel } from "@/lib/types"

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  foundational: "Foundational",
  intermediate: "Intermediate",
  challenge: "Challenge",
}

const TRUST_LABELS: Record<TrustLevel, string> = {
  public_original: "Original",
  professor_approved: "Professor-approved",
  course_approved: "Course-approved",
  generated_unverified: "Generated draft",
  private_reference: "Private reference",
}

export function difficultyLabel(difficulty: Difficulty) {
  return DIFFICULTY_LABELS[difficulty] ?? difficulty
}

export function sourceLabel(source: SourceMetadata) {
  return TRUST_LABELS[source.trustLevel] ?? "Approved"
}

// A trailing "Draft" marker ("… Union Draft", "… (Draft)", "… - Draft").
// It must follow a separator or whitespace so words like "Overdraft" survive.
const TRAILING_DRAFT_MARKER = /(?:\s*[-–—:|]\s*|\s*\(\s*|\s+)draft\s*\)?\s*$/i

/**
 * Student-facing question title. Published titles can still carry an
 * authoring "Draft" marker that means nothing to students, so the display
 * drops it. Question ids, stored records, and professor views are untouched.
 */
export function studentQuestionTitle(title: string) {
  const cleaned = title.replace(TRAILING_DRAFT_MARKER, "").trim()
  return cleaned.length > 0 ? cleaned : title.trim()
}

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"

export function difficultyBadgeVariant(difficulty: Difficulty): BadgeVariant {
  switch (difficulty) {
    case "foundational":
      return "success"
    case "intermediate":
      return "secondary"
    case "challenge":
      return "default"
    default:
      return "secondary"
  }
}
