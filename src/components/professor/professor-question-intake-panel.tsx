"use client";

import { AnswerCheckingEditor } from "@/components/professor/answer-checking-editor";
import { LinesTextarea } from "@/components/professor/lines-textarea";
import { professorDifficultyLabel } from "@/components/professor/professor-question-labels";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  professorQuestionPath,
  professorReviewQueuePagePath,
} from "@/lib/professor/question-paths";
import type { QuestionIntakeAnalysis } from "@/lib/question-intake/provenance";
import { questionIntakeModelDraftForSave } from "@/lib/question-intake/schema";
import type {
  QuestionIntakeAnalysisResult,
  QuestionIntakeAnswerType,
  QuestionIntakeDraft,
  QuestionIntakeDuplicate,
  QuestionIntakeInputMode,
  QuestionIntakeSourceKind,
} from "@/lib/question-intake/types";
import type {
  Difficulty,
  QuestionLifecycleDashboard,
  QuestionVersionState,
} from "@/lib/types";

type IntakeResponse = Partial<QuestionIntakeAnalysisResult> & {
  code?: string;
  error?: string;
  manualDraftAllowed?: boolean;
  question?: {
    questionId: string;
    workingVersion: {
      state: QuestionVersionState;
      title: string;
      topicId: string;
    };
  };
  reasons?: string[];
  requiresDuplicateAcknowledgement?: boolean;
};

/** What the professor needs after a save: where the question went and how to reopen it. */
export type QuestionIntakeSavedQuestion = {
  questionId: string;
  state: QuestionVersionState;
  title: string;
  topicId: string;
};

export const QUESTION_INTAKE_SAVE_FAILURE_MESSAGE =
  "The draft could not be saved. Your generated question is still available on this page. Please try again.";

const DIFFICULTIES = [
  "foundational",
  "intermediate",
  "challenge",
] as const satisfies readonly Difficulty[];
const SOURCE_OPTIONS: Array<{
  label: string;
  value: QuestionIntakeSourceKind;
}> = [
  { label: "Professor authored", value: "professor_authored" },
  {
    label: "Professor-provided course material",
    value: "professor_provided_course_material",
  },
  {
    label: "Licensed / approved course material",
    value: "licensed_approved_course_material",
  },
  { label: "Source unknown / needs review", value: "unknown_needs_review" },
];

export function ProfessorQuestionIntakePanel({
  readOnly,
  topics,
}: {
  readOnly: boolean;
  topics: QuestionLifecycleDashboard["topics"];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // One save key per generated draft: the server derives the stable question
  // ID from it, so a second click or a retry cannot create a second question.
  const saveKeyRef = useRef<string>(undefined);
  const saveInFlightRef = useRef(false);
  const [analysis, setAnalysis] = useState<QuestionIntakeAnalysis>();
  const [draft, setDraft] = useState<QuestionIntakeDraft>();
  const [duplicates, setDuplicates] = useState<QuestionIntakeDuplicate[]>([]);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [inputMode, setInputMode] = useState<QuestionIntakeInputMode>("text");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [manualDraftAllowed, setManualDraftAllowed] = useState(false);
  const [message, setMessage] = useState<string>();
  const [model, setModel] = useState<string>();
  const [questionText, setQuestionText] = useState("");
  const [saved, setSaved] = useState<QuestionIntakeSavedQuestion>();
  const [saveError, setSaveError] = useState<string>();
  const [sourceKind, setSourceKind] =
    useState<QuestionIntakeSourceKind>("professor_authored");

  function startNewDraft(next: QuestionIntakeDraft | undefined) {
    saveKeyRef.current = next ? newSaveKey() : undefined;
    setDraft(next);
    setDuplicates([]);
    setDuplicateAcknowledged(false);
    setSaved(undefined);
    setSaveError(undefined);
  }

  function changeInputMode(mode: QuestionIntakeInputMode) {
    setInputMode(mode);
    startNewDraft(undefined);
    setAnalysis(undefined);
    setManualDraftAllowed(false);
    setMessage(undefined);
  }

  function resetForAnotherQuestion() {
    startNewDraft(undefined);
    setAnalysis(undefined);
    setManualDraftAllowed(false);
    setMessage(undefined);
    setModel(undefined);
    setQuestionText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function analyzeQuestion() {
    const file = fileInputRef.current?.files?.[0];
    if (inputMode === "text" && !questionText.trim()) {
      setMessage("Paste or type the question before analyzing it.");
      return;
    }
    if (inputMode === "image" && !file) {
      setMessage("Choose one PNG, JPEG, or WEBP screenshot.");
      return;
    }

    setIsAnalyzing(true);
    setMessage(undefined);
    startNewDraft(undefined);
    const formData = new FormData();
    formData.set("mode", inputMode);
    if (inputMode === "text") formData.set("questionText", questionText);
    if (inputMode === "image" && file) formData.set("file", file);

    try {
      const response = await fetch("/api/professor/question-intake", {
        body: formData,
        method: "POST",
      });
      const payload = (await response.json()) as IntakeResponse;
      if (!response.ok || !payload.draft) {
        setManualDraftAllowed(payload.manualDraftAllowed !== false);
        setMessage(payload.error ?? "Question analysis failed.");
        return;
      }
      startNewDraft(payload.draft);
      setDuplicates(payload.duplicates ?? []);
      setModel(payload.model);
      setAnalysis({ inputMode, model: payload.model });
      setManualDraftAllowed(false);
      setMessage(
        "AI question draft created. Nothing has been saved, approved, or published.",
      );
    } catch {
      setManualDraftAllowed(true);
      setMessage(
        "Question analysis is unavailable. Continue with a manual editable draft.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function startManualDraft() {
    startNewDraft(manualQuestionDraft(questionText, topics));
    setAnalysis({ inputMode });
    setManualDraftAllowed(false);
    setModel(undefined);
    setMessage(
      "Manual draft opened. Complete the answer, solution, and progressive hints before saving.",
    );
  }

  function replaceDraft(next: QuestionIntakeDraft) {
    setDraft(next);
    setDuplicates([]);
    setDuplicateAcknowledged(false);
  }

  async function saveDraft() {
    if (!draft || saved || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    saveKeyRef.current ??= newSaveKey();
    setIsSaving(true);
    setSaveError(undefined);
    setMessage(undefined);
    try {
      const response = await fetch("/api/professor/question-intake", {
        body: JSON.stringify({
          analysis,
          draft: questionIntakeModelDraftForSave(draft),
          duplicateAcknowledged,
          sourceKind,
        }),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": saveKeyRef.current,
        },
        method: "PUT",
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as IntakeResponse;
      if (payload.draft) setDraft(payload.draft);
      if (payload.duplicates) setDuplicates(payload.duplicates);
      if (!response.ok || !payload.question) {
        console.error("Question draft save failed.", {
          status: response.status,
        });
        setSaveError(
          questionIntakeSaveFailureMessage(response.status, payload),
        );
        return;
      }
      setSaved({
        questionId: payload.question.questionId,
        state: payload.question.workingVersion.state,
        title: payload.question.workingVersion.title,
        topicId: payload.question.workingVersion.topicId,
      });
      // The lifecycle table on this page is server-rendered; refresh it so
      // the saved question appears there without a manual reload.
      router.refresh();
    } catch (error) {
      console.error("Question draft save failed.", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      setSaveError(QUESTION_INTAKE_SAVE_FAILURE_MESSAGE);
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }

  const inputHeadingId = useId();
  const previewHeadingId = useId();

  return (
    <div className="@container flex flex-col gap-6">
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @3xl:items-start">
        <section
          aria-labelledby={inputHeadingId}
          className="flex flex-col gap-4 rounded-panel bg-sheet p-4 sm:p-5 @3xl:sticky @3xl:top-[calc(var(--header-h)+1rem)]"
        >
          <div className="flex flex-col gap-1">
            <h2 id={inputHeadingId} className="type-h3 text-ink">
              Add a question with AI
            </h2>
            <p className="type-small max-w-prose text-ink-muted">
              Analyze one pasted question or one screenshot. The result is an
              editable preview; nothing is saved until you save it as a draft.
            </p>
          </div>

          <div
            className="flex gap-1.5"
            role="group"
            aria-label="Question input type"
          >
            {(
              [
                { label: "Paste or type", value: "text" },
                { label: "Screenshot", value: "image" },
              ] as const
            ).map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={inputMode === mode.value}
                onClick={() => changeInputMode(mode.value)}
                className={cn(
                  "relative inline-flex h-8 items-center rounded-chip px-3 type-small transition-colors duration-fast focus-ring",
                  "pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5",
                  inputMode === mode.value
                    ? "bg-azure-100 font-medium text-azure-700"
                    : "bg-surface-tint text-ink hover:bg-hover",
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>

          {inputMode === "text" ? (
            <Field label="Paste or type the question">
              <Textarea
                className="min-h-36 type-reading"
                maxLength={8000}
                placeholder="A fair die is rolled twice…"
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
              />
            </Field>
          ) : (
            <Field
              label="Upload a screenshot or photo of the question"
              description="One PNG, JPEG, or WEBP image, up to 5 MB. It is read once and never stored as a public asset."
            >
              <Input
                ref={fileInputRef}
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                type="file"
              />
            </Field>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              disabled={isAnalyzing}
              loading={isAnalyzing}
              onClick={analyzeQuestion}
            >
              Analyze question
            </Button>
            {manualDraftAllowed ? (
              <Button
                type="button"
                variant="secondary"
                onClick={startManualDraft}
              >
                Continue manually
              </Button>
            ) : null}
          </div>

          <div role="status" aria-live="polite">
            {message ? (
              <p className="type-small max-w-prose border-l-2 border-azure-500 py-1 pl-4 text-ink">
                {message}
              </p>
            ) : null}
          </div>
        </section>

        <section
          aria-labelledby={previewHeadingId}
          className="flex min-w-0 flex-col gap-4"
        >
          <h2 id={previewHeadingId} className="sr-only">
            Question draft
          </h2>

          {saved ? (
            <QuestionIntakeSavedNotice
              saved={saved}
              topicTitle={
                topics.find((topic) => topic.id === saved.topicId)?.title
              }
              onAddAnother={resetForAnotherQuestion}
            />
          ) : null}

          {saveError ? (
            <Alert variant="destructive" role="alert">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>Draft not saved</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          ) : null}

          {draft && !saved ? (
            <QuestionDraftEditor
              draft={draft}
              duplicateAcknowledged={duplicateAcknowledged}
              duplicates={duplicates}
              isSaving={isSaving}
              model={model}
              readOnly={readOnly}
              sourceKind={sourceKind}
              topics={topics}
              onDuplicateAcknowledged={setDuplicateAcknowledged}
              onDraftChange={replaceDraft}
              onSave={saveDraft}
              onSourceKindChange={setSourceKind}
            />
          ) : !saved ? (
            <EmptyState className="rounded-panel bg-surface-tint px-5">
              The draft appears here after you analyze a question. Every field
              stays editable until you save it.
            </EmptyState>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/**
 * The post-save confirmation. It names the destination in the professor's own
 * vocabulary (review queue, approve, publish) and links straight to the saved
 * question so nobody has to hunt for it.
 */
export function QuestionIntakeSavedNotice({
  onAddAnother,
  saved,
  topicTitle,
}: {
  onAddAnother?: () => void;
  saved: QuestionIntakeSavedQuestion;
  topicTitle?: string;
}) {
  return (
    <Alert variant="success" role="status" aria-live="polite">
      <CheckCircle2 aria-hidden="true" />
      <AlertTitle>Draft saved.</AlertTitle>
      <AlertDescription>
        <p>{questionIntakeSavedSummary(saved, topicTitle)}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={professorQuestionPath(saved.questionId)}>
              View draft
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary">
            <Link
              href={professorReviewQueuePagePath(
                saved.topicId,
                saved.questionId,
              )}
            >
              Open in review queue
            </Link>
          </Button>
          {onAddAnother ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onAddAnother}
            >
              <Plus aria-hidden="true" />
              Add another question
            </Button>
          ) : null}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function questionIntakeSavedSummary(
  saved: Pick<QuestionIntakeSavedQuestion, "state" | "title" | "topicId">,
  topicTitle?: string,
) {
  const topic = topicTitle ?? saved.topicId;
  const location =
    saved.state === "needs_review"
      ? `is waiting in your review queue under ${topic}.`
      : `was filed under ${topic} in the question lifecycle.`;
  return `“${saved.title}” ${location} Review and approve it before publishing to students. Students cannot see it yet.`;
}

export function questionIntakeSaveFailureMessage(
  status: number,
  payload: Pick<IntakeResponse, "error" | "reasons">,
) {
  const detail = [payload.error, ...(payload.reasons ?? [])]
    .filter(Boolean)
    .join(" ");
  if (status >= 500 || !detail) return QUESTION_INTAKE_SAVE_FAILURE_MESSAGE;
  // Client-correctable problems (duplicates, consistency checks) keep the
  // server's actionable wording and the same reassurance about lost work.
  return `${detail} Your generated question is still available on this page.`;
}

export function saveDraftButtonLabel(input: {
  isSaving: boolean;
  saved: boolean;
}) {
  if (input.isSaving) return "Saving…";
  return input.saved ? "Draft saved" : "Save draft";
}

function newSaveKey() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function QuestionDraftEditor({
  draft,
  duplicateAcknowledged,
  duplicates,
  isSaving,
  model,
  onDraftChange,
  onDuplicateAcknowledged,
  onSave,
  onSourceKindChange,
  readOnly,
  sourceKind,
  topics,
}: {
  draft: QuestionIntakeDraft;
  duplicateAcknowledged: boolean;
  duplicates: QuestionIntakeDuplicate[];
  isSaving: boolean;
  model?: string;
  onDraftChange: (draft: QuestionIntakeDraft) => void;
  onDuplicateAcknowledged: (checked: boolean) => void;
  onSave: () => void;
  onSourceKindChange: (value: QuestionIntakeSourceKind) => void;
  readOnly: boolean;
  sourceKind: QuestionIntakeSourceKind;
  topics: QuestionLifecycleDashboard["topics"];
}) {
  function update<Key extends keyof QuestionIntakeDraft>(
    key: Key,
    value: QuestionIntakeDraft[Key],
  ) {
    onDraftChange({ ...draft, [key]: value });
  }

  function updateAnswer<Key extends keyof QuestionIntakeDraft["answer"]>(
    key: Key,
    value: QuestionIntakeDraft["answer"][Key],
  ) {
    update("answer", { ...draft.answer, [key]: value });
  }

  const headingId = useId();
  const misconceptionsHeadingId = useId();
  const checksHeadingId = useId();

  function changeAnswerType(answerType: QuestionIntakeAnswerType) {
    onDraftChange({
      ...draft,
      answer: {
        ...draft.answer,
        numericValue:
          answerType === "numeric" ? draft.answer.numericValue : undefined,
        tolerance:
          answerType === "numeric" ? draft.answer.tolerance : undefined,
      },
      answerType,
    });
  }

  const checkTone = (status: "failed" | "passed" | "warning") =>
    status === "passed" ? "approved" : status === "failed" ? "wrong" : "hint";
  const checkLabel = (status: "failed" | "passed" | "warning") =>
    status === "passed"
      ? "Passed"
      : status === "failed"
        ? "Failed"
        : "Warning";

  return (
    <section
      aria-labelledby={headingId}
      className="@container flex flex-col gap-5 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="type-h3 text-ink">
            AI question draft
          </h3>
          <StatusChip icon={false} label="AI-generated draft" tone="hint" />
          {model ? (
            <span className="type-caption font-mono">{model}</span>
          ) : null}
        </div>
        <p className="type-small max-w-prose text-ink-muted">
          Every field is unverified until you review it. Saving files the
          question in your review queue; approving and publishing stay separate
          steps.
        </p>
      </div>

      {draft.warnings.length > 0 || draft.unreadableSegments.length > 0 ? (
        <Alert variant="warning" role="note">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Needs professor review</AlertTitle>
          <AlertDescription>
            {[
              ...draft.warnings,
              ...draft.unreadableSegments.map((item) => `Unreadable: ${item}`),
            ].map((warning) => (
              <span key={warning}>{warning}</span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 @xl:grid-cols-2">
        <Field label="Title">
          <Input
            maxLength={500}
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </Field>
        <Field
          label="Existing course topic"
          description={confidenceText("Topic confidence", draft.confidence.topic)}
        >
          <NativeSelect
            value={draft.topicId}
            onChange={(event) => update("topicId", event.target.value)}
          >
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Question type"
          description="Free response is the only question format the tutor supports today."
        >
          <NativeSelect value={draft.questionType} disabled>
            <option value="free_response">Free response</option>
          </NativeSelect>
        </Field>
        <Field label="Answer type">
          <NativeSelect
            value={draft.answerType}
            onChange={(event) =>
              changeAnswerType(event.target.value as QuestionIntakeAnswerType)
            }
          >
            <option value="numeric">Numeric</option>
            <option value="text">Text</option>
          </NativeSelect>
        </Field>
        <Field label="Difficulty">
          <NativeSelect
            value={draft.difficulty}
            onChange={(event) =>
              update("difficulty", event.target.value as Difficulty)
            }
          >
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {professorDifficultyLabel(difficulty)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="Question source"
          description="Stored as professor-provided provenance; no pattern ID is created."
        >
          <NativeSelect
            value={sourceKind}
            onChange={(event) =>
              onSourceKindChange(event.target.value as QuestionIntakeSourceKind)
            }
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <Field
        label="Question wording"
        description={confidenceText(
          "Extraction confidence",
          draft.confidence.extraction,
        )}
      >
        <Textarea
          className="min-h-36 type-reading"
          maxLength={8000}
          value={draft.prompt}
          onChange={(event) => update("prompt", event.target.value)}
        />
      </Field>

      <AnswerCheckingEditor
        answer={draft.answer}
        onChange={(answer) =>
          onDraftChange({
            ...draft,
            answer,
            answerType:
              answer.spec?.kind === "numeric"
                ? "numeric"
                : answer.spec
                  ? "text"
                  : draft.answerType,
          })
        }
      />
      {!draft.answer.spec && (
        <Field label="Correct accepted answers (one per line)">
          <LinesTextarea
            className="min-h-28 font-mono"
            values={draft.answer.acceptedAnswers}
            onChange={(acceptedAnswers) =>
              updateAnswer("acceptedAnswers", acceptedAnswers)
            }
          />
        </Field>
      )}
      {draft.answerType === "numeric" && !draft.answer.spec ? (
        <div className="grid gap-5 @xl:grid-cols-2">
          <Field label="Numeric value">
            <Input
              type="number"
              step="any"
              value={draft.answer.numericValue ?? ""}
              onChange={(event) =>
                updateAnswer("numericValue", optionalNumber(event.target.value))
              }
            />
          </Field>
          <Field label="Tolerance">
            <Input
              type="number"
              min="0"
              step="any"
              value={draft.answer.tolerance ?? ""}
              onChange={(event) =>
                updateAnswer("tolerance", optionalNumber(event.target.value))
              }
            />
          </Field>
        </div>
      ) : null}

      <Field
        label="Answer explanation"
        description={confidenceText("Answer confidence", draft.confidence.answer)}
      >
        <Textarea
          className="min-h-32"
          maxLength={8000}
          value={draft.answer.explanation}
          onChange={(event) => updateAnswer("explanation", event.target.value)}
        />
      </Field>

      <div className="grid gap-5 @xl:grid-cols-2">
        <Field label="Progressive hints (2–4, one per line)">
          <LinesTextarea
            className="min-h-44"
            values={draft.hints}
            onChange={(hints) => update("hints", hints)}
          />
        </Field>
        <Field label="Full solution steps (one per line)">
          <LinesTextarea
            className="min-h-44"
            values={draft.solutionSteps}
            onChange={(solutionSteps) => update("solutionSteps", solutionSteps)}
          />
        </Field>
      </div>

      <section
        aria-labelledby={misconceptionsHeadingId}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <h4 id={misconceptionsHeadingId} className="type-body-strong text-ink">
              Likely student misconceptions
            </h4>
            <p className="type-caption">
              Keep only recognizable incorrect patterns with targeted feedback.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() =>
              update("misconceptions", [
                ...draft.misconceptions,
                {
                  feedback: "",
                  id: `professor-intake-${draft.misconceptions.length + 1}`,
                  matchTerms: [],
                },
              ])
            }
          >
            <Plus aria-hidden="true" /> Add misconception
          </Button>
        </div>
        {draft.misconceptions.length === 0 ? (
          <p className="type-small text-ink-muted">
            No meaningful misconception suggested.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {draft.misconceptions.map((misconception, index) => (
              <li
                key={index}
                className="grid gap-4 rounded-panel bg-surface-tint p-4 @xl:grid-cols-[1fr_1fr_auto]"
              >
                <div className="flex flex-col gap-4">
                  <Field label={`Code / incorrect pattern ${index + 1}`}>
                    <Input
                      maxLength={500}
                      value={misconception.id}
                      onChange={(event) =>
                        updateMisconception(
                          draft,
                          index,
                          { id: event.target.value },
                          onDraftChange,
                        )
                      }
                    />
                  </Field>
                  <Field
                    label={`Match terms ${index + 1}`}
                    description="Recognizable answer terms, comma separated."
                  >
                    <Input
                      value={misconception.matchTerms.join(", ")}
                      onChange={(event) =>
                        updateMisconception(
                          draft,
                          index,
                          { matchTerms: commaSeparated(event.target.value) },
                          onDraftChange,
                        )
                      }
                    />
                  </Field>
                </div>
                <Field label={`Targeted tutor feedback ${index + 1}`}>
                  <Textarea
                    className="min-h-24"
                    maxLength={8000}
                    value={misconception.feedback}
                    onChange={(event) =>
                      updateMisconception(
                        draft,
                        index,
                        { feedback: event.target.value },
                        onDraftChange,
                      )
                    }
                  />
                </Field>
                <Button
                  aria-label={`Remove misconception ${index + 1}`}
                  className="@xl:mt-7"
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    update(
                      "misconceptions",
                      draft.misconceptions.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    )
                  }
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid gap-4 @xl:grid-cols-2">
        <section
          aria-labelledby={checksHeadingId}
          className="flex flex-col gap-2 rounded-panel bg-surface-tint p-4"
        >
          <h4 id={checksHeadingId} className="type-body-strong text-ink">
            Consistency checks
          </h4>
          <ul className="flex flex-col gap-2 type-small text-ink">
            {draft.review.checks.length > 0 ? (
              draft.review.checks.map((check) => (
                <li key={check.code} className="flex items-start gap-2">
                  <StatusChip
                    className="mt-0.5"
                    label={checkLabel(check.status)}
                    tone={checkTone(check.status)}
                  />
                  <span>{check.message}</span>
                </li>
              ))
            ) : (
              <li className="text-ink-muted">
                Checks run when the completed draft is saved.
              </li>
            )}
          </ul>
        </section>
        <DuplicateWarnings
          acknowledged={duplicateAcknowledged}
          duplicates={duplicates}
          onAcknowledged={onDuplicateAcknowledged}
        />
      </div>

      {readOnly ? (
        <p className="type-small max-w-prose border-l-2 border-input pl-4 text-ink-muted">
          This operating mode is read-only. You can analyze and edit the
          preview, but saving needs configured database storage.
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center">
        <Button
          type="button"
          aria-busy={isSaving}
          disabled={readOnly || isSaving}
          loading={isSaving}
          onClick={onSave}
        >
          {saveDraftButtonLabel({ isSaving, saved: false })}
        </Button>
        <p className="type-caption max-w-prose">
          Saving files a non-public draft in your review queue. Students see
          nothing until you approve and publish it.
        </p>
      </div>
    </section>
  );
}

const DUPLICATE_REASON_LABELS: Record<QuestionIntakeDuplicate["reason"], string> =
  {
    exact_text: "Same text",
    same_structure: "Same structure",
    similar_wording: "Similar wording",
  };

function DuplicateWarnings({
  acknowledged,
  duplicates,
  onAcknowledged,
}: {
  acknowledged: boolean;
  duplicates: QuestionIntakeDuplicate[];
  onAcknowledged: (checked: boolean) => void;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-panel bg-surface-tint p-4"
    >
      <h4 id={headingId} className="type-body-strong text-ink">
        Duplicate review
      </h4>
      {duplicates.length === 0 ? (
        <p className="type-small text-ink-muted">
          No similar question was found in the latest server check. Saving
          checks again.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="type-small text-ink">
            A similar question may already exist.
          </p>
          <ul className="flex flex-col gap-2">
            {duplicates.map((duplicate) => (
              <li
                key={duplicate.questionId}
                className="flex flex-col gap-0.5 rounded-control bg-sheet px-3 py-2"
              >
                <span className="type-small font-medium text-ink">
                  {duplicate.title}
                </span>
                <span className="type-caption">
                  <span className="font-mono">{duplicate.questionId}</span>
                  {" · "}
                  {DUPLICATE_REASON_LABELS[duplicate.reason] ??
                    duplicate.reason}{" "}
                  · {Math.round(duplicate.similarity * 100)}% similar
                </span>
              </li>
            ))}
          </ul>
          <CheckboxField
            label="I reviewed these possible duplicates and want to save this legitimate variant."
            checked={acknowledged}
            onCheckedChange={(checked) => onAcknowledged(checked === true)}
          />
        </div>
      )}
    </section>
  );
}

function confidenceText(label: string, value: number) {
  const level = value >= 0.85 ? "High" : value >= 0.7 ? "Medium" : "Low";
  return `${label}: ${level} (${Math.round(value * 100)}%)`;
}

function manualQuestionDraft(
  questionText: string,
  topics: QuestionLifecycleDashboard["topics"],
): QuestionIntakeDraft {
  const prompt = questionText.trim();
  return {
    answer: { acceptedAnswers: [], explanation: "" },
    answerType: "text",
    confidence: { answer: 0, extraction: prompt ? 1 : 0, overall: 0, topic: 0 },
    difficulty: "foundational",
    hints: [],
    misconceptions: [],
    prompt,
    questionType: "free_response",
    review: { checks: [], required: true, status: "needs_professor_review" },
    schemaVersion: 1,
    solutionSteps: [],
    title: prompt.split(/\n|[.!?]/u)[0]?.slice(0, 100) || "Untitled question",
    topicId: topics[0]?.id ?? "",
    unreadableSegments: [],
    warnings: ["Manual draft: all tutoring fields require professor review."],
  };
}

function updateMisconception(
  draft: QuestionIntakeDraft,
  index: number,
  update: Partial<QuestionIntakeDraft["misconceptions"][number]>,
  onDraftChange: (draft: QuestionIntakeDraft) => void,
) {
  onDraftChange({
    ...draft,
    misconceptions: draft.misconceptions.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...update } : item,
    ),
  });
}

function commaSeparated(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalNumber(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
