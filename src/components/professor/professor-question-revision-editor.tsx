"use client";

import { AnswerCheckingEditor } from "@/components/professor/answer-checking-editor";
import type { AnswerSpec } from "@/lib/tutor/answer/spec";
import { useId, useMemo, useState } from "react";
import { Save } from "lucide-react";

import { professorDifficultyLabel } from "@/components/professor/professor-question-labels";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";
import type {
  Difficulty,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionRevisionContentInput,
} from "@/lib/types";

type RevisionForm = {
  spec?: AnswerSpec;
  acceptedAnswers: string;
  answerExplanation: string;
  difficulty: Difficulty;
  hints: string;
  misconceptionNotes: string;
  numericValue: string;
  prompt: string;
  solutionSteps: string;
  title: string;
  tolerance: string;
  topicId: string;
};

const DIFFICULTIES = [
  "foundational",
  "intermediate",
  "challenge",
] as const satisfies readonly Difficulty[];

export function ProfessorQuestionRevisionEditor({
  disabled,
  onCancel,
  onSaved,
  question,
  topics,
}: {
  disabled: boolean;
  onCancel: () => void;
  onSaved: (question: QuestionLifecycleDto) => void;
  question: QuestionLifecycleDto;
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const version = question.workingVersion;
  const [form, setForm] = useState<RevisionForm>(() =>
    revisionFormFromQuestion(question),
  );
  const [comment, setComment] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const headingId = useId();
  const revision = useMemo(
    () => revisionFromForm(form, question),
    [form, question],
  );
  const changedFields = revision
    ? changedQuestionVersionFields(version, revision)
    : [];

  function updateForm<Key extends keyof RevisionForm>(
    field: Key,
    value: RevisionForm[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveRevision() {
    if (!revision) {
      setMessage(
        "Complete the wording, final answer, explanation, and at least one solution step.",
      );
      return;
    }
    if (changedFields.length === 0) {
      setMessage(
        "Change at least one editable field before saving a revision.",
      );
      return;
    }

    setIsSaving(true);
    setMessage(undefined);
    try {
      const response = await fetch(
        `/api/professor/questions/${encodeURIComponent(question.questionId)}/versions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseVersionId: version.versionId,
            comment: comment.trim() || undefined,
            expectedWorkingVersionId: version.versionId,
            revision,
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        question?: QuestionLifecycleDto;
      };
      if (!response.ok || !payload.question) {
        setMessage(payload.error ?? "Question revision could not be saved.");
        return;
      }
      onSaved(payload.question);
    } catch {
      setMessage("Question revision could not be saved.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className="@container flex flex-col gap-5 rounded-panel bg-sheet p-4 sm:p-6"
    >
      <div className="flex max-w-prose flex-col gap-1">
        <h3 id={headingId} className="type-h3 text-ink">
          {revisionHeading(question)}
        </h3>
        <p className="type-small text-ink-muted">
          Saving creates a new attributed draft from version{" "}
          {version.versionNumber}. The original version and any published
          version remain unchanged. Only public fields can be edited.
        </p>
      </div>

      <Field label="Title">
        <Input
          value={form.title}
          maxLength={500}
          onChange={(event) => updateForm("title", event.target.value)}
        />
      </Field>
      <div className="grid gap-5 @2xl:grid-cols-2">
        <Field label="Syllabus topic">
          <NativeSelect
            value={form.topicId}
            onChange={(event) => updateForm("topicId", event.target.value)}
          >
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Difficulty">
          <NativeSelect
            value={form.difficulty}
            onChange={(event) =>
              updateForm("difficulty", event.target.value as Difficulty)
            }
          >
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {professorDifficultyLabel(difficulty)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field label="Question wording">
        <Textarea
          value={form.prompt}
          className="min-h-28 type-reading"
          maxLength={8000}
          onChange={(event) => updateForm("prompt", event.target.value)}
        />
      </Field>

      <AnswerCheckingEditor
        disabled={disabled || isSaving}
        answer={{
          acceptedAnswers: form.acceptedAnswers.split("\n"),
          explanation: form.answerExplanation,
          spec: form.spec,
          numericValue: form.numericValue.trim()
            ? Number(form.numericValue)
            : undefined,
          tolerance: form.tolerance.trim() ? Number(form.tolerance) : undefined,
        }}
        onChange={(answer) =>
          setForm((current) => ({
            ...current,
            spec: answer.spec,
            acceptedAnswers: answer.acceptedAnswers.join("\n"),
            numericValue: answer.spec ? "" : current.numericValue,
            tolerance: answer.spec ? "" : current.tolerance,
          }))
        }
      />
      {!form.spec && (
        <>
          <Field
            label="Accepted final answers"
            description="One accepted answer per line."
          >
            <Textarea
              value={form.acceptedAnswers}
              className="min-h-24 font-mono"
              onChange={(event) =>
                updateForm("acceptedAnswers", event.target.value)
              }
            />
          </Field>
          <div className="grid gap-5 @2xl:grid-cols-2">
            <Field label="Numeric answer" optional>
              <Input
                type="number"
                step="any"
                value={form.numericValue}
                onChange={(event) =>
                  updateForm("numericValue", event.target.value)
                }
              />
            </Field>
            <Field
              label="Tolerance"
              optional
              description="Zero or more; how far a numeric answer may be off."
            >
              <Input
                type="number"
                min="0"
                step="any"
                value={form.tolerance}
                onChange={(event) =>
                  updateForm("tolerance", event.target.value)
                }
              />
            </Field>
          </div>
        </>
      )}

      <Field label="Answer explanation">
        <Textarea
          value={form.answerExplanation}
          className="min-h-28"
          maxLength={8000}
          onChange={(event) =>
            updateForm("answerExplanation", event.target.value)
          }
        />
      </Field>

      <div className="grid gap-5 @2xl:grid-cols-2">
        <Field label="Solution steps" description="One step per line.">
          <Textarea
            value={form.solutionSteps}
            className="min-h-32"
            onChange={(event) =>
              updateForm("solutionSteps", event.target.value)
            }
          />
        </Field>
        <Field label="Hints" description="One hint per line, in order.">
          <Textarea
            value={form.hints}
            className="min-h-32"
            onChange={(event) => updateForm("hints", event.target.value)}
          />
        </Field>
      </div>

      <Field label="Misconception notes" description="One note per line.">
        <Textarea
          value={form.misconceptionNotes}
          className="min-h-28"
          onChange={(event) =>
            updateForm("misconceptionNotes", event.target.value)
          }
        />
      </Field>

      <Field
        label="Version comment"
        optional
        description="Why this version exists. Professors see it in the version history."
      >
        <Textarea
          value={comment}
          className="min-h-20"
          maxLength={1000}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>

      <div className="flex flex-col gap-1 border-l-2 border-azure-500 pl-4">
        <p className="type-body-strong text-ink">Revision summary</p>
        <p className="type-small text-ink">
          {changedFields.length > 0
            ? changedFields.join(", ")
            : "No content changes yet."}
        </p>
      </div>

      <div role="status" aria-live="polite">
        {message ? <p className="type-small text-red-700">{message}</p> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          disabled={disabled || isSaving}
          loading={isSaving}
          onClick={saveRevision}
        >
          <Save aria-hidden="true" />
          Save revision draft
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isSaving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}

export function canEditQuestionVersion(question: QuestionLifecycleDto) {
  return (
    question.recordState === "active" &&
    question.workingVersion.source.visibility === "public" &&
    question.workingVersion.source.sourceType !== "private_reference_pattern" &&
    question.workingVersion.source.trustLevel !== "private_reference"
  );
}

export function revisionActionLabel(question: QuestionLifecycleDto) {
  if (question.workingVersion.state === "published") {
    return "Edit published question";
  }
  return ["generated_original", "pattern_derived_original"].includes(
    question.workingVersion.source.sourceType,
  )
    ? "Edit generated draft"
    : "Create revision draft";
}

function revisionHeading(question: QuestionLifecycleDto) {
  return question.workingVersion.state === "published"
    ? "Edit published question as a new draft"
    : revisionActionLabel(question);
}

function revisionFormFromQuestion(
  question: QuestionLifecycleDto,
): RevisionForm {
  const version = question.workingVersion;
  return {
    acceptedAnswers: version.answer.acceptedAnswers.join("\n"),
    spec: version.answer.spec,
    answerExplanation: version.answer.explanation,
    difficulty: version.difficulty,
    hints: version.hints.join("\n"),
    misconceptionNotes: version.misconceptions
      .map((item) => item.feedback)
      .join("\n"),
    numericValue:
      version.answer.numericValue === undefined
        ? ""
        : String(version.answer.numericValue),
    prompt: version.prompt,
    solutionSteps: version.solutionSteps.join("\n"),
    title: version.title,
    tolerance:
      version.answer.tolerance === undefined
        ? ""
        : String(version.answer.tolerance),
    topicId: version.topicId,
  };
}

function revisionFromForm(
  form: RevisionForm,
  question: QuestionLifecycleDto,
): QuestionRevisionContentInput | undefined {
  const acceptedAnswers = lines(form.acceptedAnswers);
  const solutionSteps = lines(form.solutionSteps);
  const misconceptionNotes = lines(form.misconceptionNotes);
  if (
    !form.title.trim() ||
    !form.topicId ||
    !form.prompt.trim() ||
    !form.answerExplanation.trim() ||
    acceptedAnswers.length === 0 ||
    solutionSteps.length === 0
  ) {
    return undefined;
  }

  const numericValue = optionalNumber(form.numericValue);
  const tolerance = optionalNumber(form.tolerance);
  if (numericValue === null || tolerance === null) return undefined;
  const previous = question.workingVersion.misconceptions;
  return {
    answer: {
      acceptedAnswers,
      ...(form.spec !== undefined ? { spec: form.spec } : {}),
      explanation: form.answerExplanation.trim(),
      numericValue,
      tolerance,
    },
    difficulty: form.difficulty,
    hints: lines(form.hints),
    misconceptions: misconceptionNotes.map((feedback, index) => ({
      feedback,
      id: previous[index]?.id ?? `professor-note-${index + 1}`,
      matchTerms: previous[index]?.matchTerms
        ? [...previous[index].matchTerms]
        : [],
    })),
    prompt: form.prompt.trim(),
    solutionSteps,
    title: form.title.trim(),
    topicId: form.topicId,
  };
}

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
