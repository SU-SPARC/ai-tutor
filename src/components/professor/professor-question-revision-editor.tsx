"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Loader2, Save, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      aria-label={`Edit ${version.title}`}
      className="space-y-4 border border-primary/30 bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{revisionHeading(question)}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Saving creates a new attributed draft from version{" "}
            {version.versionNumber}. The original version and any published
            version remain unchanged.
          </p>
        </div>
        <Badge variant="outline">public-safe fields only</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RevisionField label="Title">
          <Input
            value={form.title}
            maxLength={500}
            onChange={(event) => updateForm("title", event.target.value)}
          />
        </RevisionField>
        <RevisionField label="Syllabus topic">
          <select
            className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm"
            value={form.topicId}
            onChange={(event) => updateForm("topicId", event.target.value)}
          >
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
        </RevisionField>
        <RevisionField label="Difficulty">
          <select
            className="flex h-10 w-full border border-input bg-background px-3 py-2 text-sm"
            value={form.difficulty}
            onChange={(event) =>
              updateForm("difficulty", event.target.value as Difficulty)
            }
          >
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </RevisionField>
        <RevisionField label="Accepted final answers (one per line)">
          <Textarea
            value={form.acceptedAnswers}
            className="min-h-24"
            onChange={(event) =>
              updateForm("acceptedAnswers", event.target.value)
            }
          />
        </RevisionField>
      </div>

      <RevisionField label="Question wording">
        <Textarea
          value={form.prompt}
          className="min-h-28"
          maxLength={8000}
          onChange={(event) => updateForm("prompt", event.target.value)}
        />
      </RevisionField>
      <RevisionField label="Answer explanation">
        <Textarea
          value={form.answerExplanation}
          className="min-h-28"
          maxLength={8000}
          onChange={(event) =>
            updateForm("answerExplanation", event.target.value)
          }
        />
      </RevisionField>

      <div className="grid gap-4 md:grid-cols-2">
        <RevisionField label="Numeric answer (optional)">
          <Input
            type="number"
            step="any"
            value={form.numericValue}
            onChange={(event) => updateForm("numericValue", event.target.value)}
          />
        </RevisionField>
        <RevisionField label="Tolerance (optional, non-negative)">
          <Input
            type="number"
            min="0"
            step="any"
            value={form.tolerance}
            onChange={(event) => updateForm("tolerance", event.target.value)}
          />
        </RevisionField>
        <RevisionField label="Solution steps (one per line)">
          <Textarea
            value={form.solutionSteps}
            className="min-h-32"
            onChange={(event) =>
              updateForm("solutionSteps", event.target.value)
            }
          />
        </RevisionField>
        <RevisionField label="Hints (one per line)">
          <Textarea
            value={form.hints}
            className="min-h-32"
            onChange={(event) => updateForm("hints", event.target.value)}
          />
        </RevisionField>
      </div>

      <RevisionField label="Misconception notes (one per line)">
        <Textarea
          value={form.misconceptionNotes}
          className="min-h-28"
          onChange={(event) =>
            updateForm("misconceptionNotes", event.target.value)
          }
        />
      </RevisionField>

      <RevisionField label="Version comment (optional)">
        <Textarea
          value={comment}
          className="min-h-20"
          maxLength={1000}
          placeholder="Explain why this version is being created. Professors can see this in the lifecycle history."
          onChange={(event) => setComment(event.target.value)}
        />
      </RevisionField>

      <div className="rounded-md border border-border bg-background p-3 text-sm">
        <p className="font-medium">Revision summary</p>
        <p className="mt-1 text-muted-foreground">
          {changedFields.length > 0
            ? changedFields.join(", ")
            : "No content changes yet."}
        </p>
      </div>

      {message ? (
        <p role="status" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={disabled || isSaving}
          onClick={saveRevision}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save revision draft
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSaving}
          onClick={onCancel}
        >
          <X className="h-4 w-4" />
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

function RevisionField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
