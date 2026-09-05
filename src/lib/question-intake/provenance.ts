import type { QuestionIntakeInputMode } from "@/lib/question-intake/types";
import type { QuestionLifecycleDto } from "@/lib/types";

/**
 * Marker stored on the `submit` lifecycle event of every draft saved from the
 * AI question intake screen. The version content itself carries no generator
 * field, so the attributed event is where "this came from AI intake" lives.
 */
export const QUESTION_INTAKE_EVENT_SOURCE = "question_intake";

export type QuestionIntakeAnalysis = {
  inputMode: QuestionIntakeInputMode;
  /** Provider model identifier when AI analysis produced the draft. */
  model?: string;
};

export type QuestionIntakeProvenance = {
  inputMode?: QuestionIntakeInputMode;
  model?: string;
  submittedAt: string;
  submittedBy: string;
};

export function questionIntakeSubmissionMetadata(
  analysis: QuestionIntakeAnalysis | undefined,
  draft: { answerType: string; questionType: string },
): Record<string, string> {
  const metadata: Record<string, string> = {
    answerType: draft.answerType,
    questionType: draft.questionType,
    source: QUESTION_INTAKE_EVENT_SOURCE,
  };
  if (analysis) {
    metadata.inputMode = analysis.inputMode;
    if (analysis.model) metadata.model = analysis.model.slice(0, 200);
  }
  return metadata;
}

export function questionIntakeSubmissionNote(
  analysis: QuestionIntakeAnalysis | undefined,
) {
  if (!analysis?.model) {
    return "Saved from question intake as a professor-completed manual draft. Every tutoring field still requires professor review.";
  }
  const input =
    analysis.inputMode === "image"
      ? "a professor screenshot"
      : "professor-submitted text";
  return `Saved from AI question intake. ${analysis.model} analyzed ${input}; every generated tutoring field still requires professor review.`;
}

/**
 * Finds the intake submission on a lifecycle timeline. Returns undefined for
 * questions created by import, generation scripts, or manual creation.
 */
export function questionIntakeProvenance(
  question: Pick<QuestionLifecycleDto, "events">,
): QuestionIntakeProvenance | undefined {
  const submission = question.events.find(
    (event) =>
      event.action === "submit" &&
      event.metadata?.source === QUESTION_INTAKE_EVENT_SOURCE,
  );
  if (!submission) return undefined;
  const inputMode = submission.metadata?.inputMode;
  const model = submission.metadata?.model;
  return {
    inputMode:
      inputMode === "image" || inputMode === "text" ? inputMode : undefined,
    model: typeof model === "string" ? model : undefined,
    submittedAt: submission.actor.occurredAt,
    submittedBy: submission.actor.displayName,
  };
}

export function questionIntakeSourceLabel(
  provenance: QuestionIntakeProvenance,
) {
  if (!provenance.model) return "Question intake · manual draft";
  return provenance.inputMode === "image"
    ? "AI intake · screenshot"
    : "AI intake · pasted text";
}
