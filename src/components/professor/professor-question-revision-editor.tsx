"use client";

import { AnswerCheckingEditor } from "@/components/professor/answer-checking-editor";
import type { AnswerSpec } from "@/lib/tutor/answer/spec";
import { useId, useMemo, useState } from "react";
import { ChevronRight, Save } from "lucide-react";

import {
  plainActionError,
  professorDifficultyLabel,
} from "@/components/professor/professor-question-labels";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { validateQuestionFigure } from "@/lib/tutor/question-figure";
import { changedQuestionVersionFields } from "@/lib/tutor/question-version-diff";
import type {
  Difficulty,
  QuestionFigure,
  QuestionLifecycleDashboard,
  QuestionLifecycleDto,
  QuestionRevisionContentInput,
} from "@/lib/types";

type RevisionForm = {
  spec?: AnswerSpec;
  acceptedAnswers: string;
  answerExplanation: string;
  difficulty: Difficulty;
  /** The figure as JSON text; empty means "no figure". */
  figureJson: string;
  hints: string;
  misconceptionNotes: string;
  numericValue: string;
  prompt: string;
  solutionSteps: string;
  title: string;
  tolerance: string;
  topicId: string;
};

type FigureCheck =
  | { ok: true; figure?: QuestionFigure }
  | { ok: false; issues: string[] };

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
  // Figure issues show after the field is left or a save is tried, not
  // while the JSON is still being typed.
  const [showFigureIssues, setShowFigureIssues] = useState(false);
  const [figureOpen, setFigureOpen] = useState(false);
  const headingId = useId();
  const figureCheck = useMemo(
    () => checkFigureJson(form.figureJson),
    [form.figureJson],
  );
  const revision = useMemo(
    () => revisionFromForm(form, question, figureCheck),
    [form, question, figureCheck],
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
    if (!figureCheck.ok) {
      setShowFigureIssues(true);
      setFigureOpen(true);
      setMessage(
        "Fix the figure JSON, or empty the field to save without one.",
      );
      return;
    }
    if (!revision) {
      setMessage(
        "Please fill in the title, the question text, the correct answer, the explanation, and at least one solution step.",
      );
      return;
    }
    if (changedFields.length === 0) {
      setMessage("Change something before saving.");
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
            // null says "no figure" explicitly, so a revision can drop one.
            revision: { ...revision, figure: revision.figure ?? null },
          }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        question?: QuestionLifecycleDto;
      };
      if (!response.ok || !payload.question) {
        setMessage(plainActionError(response.status));
        return;
      }
      onSaved(payload.question);
    } catch {
      setMessage(plainActionError());
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
          Edit “{version.title}”
        </h3>
        <p className="type-body text-ink">
          {question.publishedVersion
            ? "Students keep seeing the current version until you choose Show my changes."
            : "Students can't see this question yet. Your earlier wording is kept in its history."}
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
        <Field label="Topic">
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

      <Field label="Question text">
        <Textarea
          value={form.prompt}
          className="min-h-28 type-reading"
          maxLength={8000}
          onChange={(event) => updateForm("prompt", event.target.value)}
        />
      </Field>

      <details
        className="group border-t border-rule pt-3"
        open={figureOpen}
        onToggle={(event) => setFigureOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control type-body-strong text-ink focus-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight
            aria-hidden="true"
            className="size-4 text-ink-muted transition-transform duration-fast group-open:rotate-90"
          />
          Figure (JSON, optional)
        </summary>
        <Field
          className="pt-2"
          label="Figure JSON"
          optional
          description="A bar, line, normal, or venn graph shown under the wording. Leave empty for no figure. See docs/question-figures.md."
          error={
            showFigureIssues && !figureCheck.ok
              ? figureCheck.issues.join(" ")
              : undefined
          }
        >
          <Textarea
            value={form.figureJson}
            className="min-h-40 font-mono text-sm"
            spellCheck={false}
            onBlur={() => setShowFigureIssues(true)}
            onChange={(event) => updateForm("figureJson", event.target.value)}
          />
        </Field>
      </details>

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
            // With no typed spec the editor passes the older number fields
            // through; keep whatever it emits so the payload is unchanged.
            numericValue: answer.spec
              ? ""
              : answer.numericValue === undefined
                ? current.numericValue
                : String(answer.numericValue),
            tolerance: answer.spec
              ? ""
              : answer.tolerance === undefined
                ? current.tolerance
                : String(answer.tolerance),
          }))
        }
      />

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

      <Field
        label="Notes on common mistakes"
        optional
        description="One note per line. The tutor shows a note when a student makes that mistake."
      >
        <Textarea
          value={form.misconceptionNotes}
          className="min-h-28"
          onChange={(event) =>
            updateForm("misconceptionNotes", event.target.value)
          }
        />
      </Field>

      <Field
        label="Note about this change"
        optional
        description="Only instructors see this."
      >
        <Textarea
          value={comment}
          className="min-h-20"
          maxLength={1000}
          onChange={(event) => setComment(event.target.value)}
        />
      </Field>

      <div className="flex flex-col gap-1 border-l-2 border-azure-500 pl-4">
        <p className="type-body-strong text-ink">What you changed</p>
        <p className="type-body text-ink">
          {changedFields.length > 0 ? changedFields.join(", ") : "Nothing yet."}
        </p>
      </div>

      <div role="status" aria-live="polite">
        {message ? <p className="type-body text-red-700">{message}</p> : null}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          className="h-11"
          disabled={disabled || isSaving}
          loading={isSaving}
          onClick={saveRevision}
        >
          <Save aria-hidden="true" />
          Save changes
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11"
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

/** One label for every edit, whatever state the question is in. */
export function revisionActionLabel(question: QuestionLifecycleDto) {
  void question;
  return "Edit question";
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
    figureJson: version.figure ? JSON.stringify(version.figure, null, 2) : "",
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

/**
 * Parse and validate the figure field with the same validator the server
 * runs, so a bad figure is caught before the request.
 */
function checkFigureJson(text: string): FigureCheck {
  if (!text.trim()) {
    return { ok: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      issues: [
        "The figure is not valid JSON; check quotes, commas and braces.",
      ],
    };
  }
  const result = validateQuestionFigure(parsed);
  return result.ok
    ? { ok: true, figure: result.figure }
    : { ok: false, issues: result.issues };
}

function revisionFromForm(
  form: RevisionForm,
  question: QuestionLifecycleDto,
  figureCheck: FigureCheck,
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
  const usedIds = new Set<string>();
  return {
    answer: {
      acceptedAnswers,
      ...(form.spec !== undefined ? { spec: form.spec } : {}),
      explanation: form.answerExplanation.trim(),
      numericValue,
      tolerance,
    },
    difficulty: form.difficulty,
    ...(figureCheck.ok && figureCheck.figure
      ? { figure: figureCheck.figure }
      : {}),
    hints: lines(form.hints),
    // A note keeps its id and matched wrong answers only while its text is
    // unchanged; matching by line position would hand one note's matches to
    // the next note after a deletion.
    misconceptions: misconceptionNotes.map((feedback, index) => {
      const same = previous.find(
        (item) => item.feedback.trim() === feedback && !usedIds.has(item.id),
      );
      let id = same?.id ?? `professor-note-${index + 1}`;
      for (let suffix = 2; usedIds.has(id); suffix += 1) {
        id = `professor-note-${index + 1}-${suffix}`;
      }
      usedIds.add(id);
      return {
        feedback,
        id,
        matchTerms: same ? [...same.matchTerms] : [],
      };
    }),
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
