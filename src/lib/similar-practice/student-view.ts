import type {
  GeneratedPracticeVariant,
  StudentGeneratedPracticeQuestion,
} from "@/lib/similar-practice/contract";

/**
 * The only projection of a generated variant toward a student. It copies
 * named display fields and a derived answer format; answers, the spec's
 * value and tolerance, computation, parameters, match terms, reports, model
 * metadata, and source analysis never leave the server. Phase 1 has no route
 * that calls it.
 */
export function toStudentGeneratedPracticeQuestion(
  variant: GeneratedPracticeVariant,
): StudentGeneratedPracticeQuestion {
  const spec = variant.content.answer.spec;
  const answerFormat: StudentGeneratedPracticeQuestion["answerFormat"] =
    spec.kind === "numeric"
      ? {
          kind: "numeric",
          percentMode: spec.percentMode,
          ...(spec.requiredForm ? { requiredForm: spec.requiredForm } : {}),
          ...(spec.unit ? { unitLabel: spec.unit.label } : {}),
        }
      : { kind: "numeric" };
  return {
    answerFormat,
    contentKind: "generated_practice",
    courseId: variant.source.courseId,
    difficulty: variant.content.difficulty,
    hintCount: variant.content.hints.length,
    label: "AI-generated practice",
    prompt: variant.content.prompt,
    sourceQuestionId: variant.source.questionId,
    stepCount: variant.content.solutionSteps.length,
    title: variant.content.title,
    topicId: variant.source.topicId,
    variantId: variant.id,
  };
}
