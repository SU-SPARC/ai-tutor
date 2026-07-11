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
