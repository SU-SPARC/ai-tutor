import type { QuestionReserveReasonCode } from "@/lib/types";

export const QUESTION_RESERVE_REASONS = [
  { label: "Repetitive", value: "repetitive" },
  { label: "Save for later", value: "save_for_later" },
  { label: "Future topic", value: "future_topic" },
  { label: "Extra practice", value: "extra_practice" },
  { label: "Other", value: "other" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: QuestionReserveReasonCode;
}>;

const REASON_LABELS = new Map<string, string>(
  QUESTION_RESERVE_REASONS.map(({ label, value }) => [value, label]),
);

export function isQuestionReserveReasonCode(
  value: unknown,
): value is QuestionReserveReasonCode {
  return (
    typeof value === "string" &&
    QUESTION_RESERVE_REASONS.some((reason) => reason.value === value)
  );
}

export function questionReserveReasonLabel(value: string) {
  return REASON_LABELS.get(value) ?? value.replaceAll("_", " ");
}

export function questionReserveReasonRequiresNote(value: string) {
  return value === "other";
}
