"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileImage,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nativeSelectClassName } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-md border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" />
              Add Question with AI
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Analyze one pasted question or one private screenshot. Analysis
              creates only an editable preview; saving is a separate professor
              action.
            </p>
          </div>
          <Badge variant="outline">professor only · preview first</Badge>
        </div>

        <div
          className="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Question input type"
        >
          <Button
            type="button"
            size="sm"
            variant={inputMode === "text" ? "default" : "outline"}
            onClick={() => changeInputMode("text")}
          >
            Paste or type
          </Button>
          <Button
            type="button"
            size="sm"
            variant={inputMode === "image" ? "default" : "outline"}
            onClick={() => changeInputMode("image")}
          >
            <FileImage className="h-4 w-4" />
            Screenshot
          </Button>
        </div>

        <div className="mt-4">
          {inputMode === "text" ? (
            <Field label="Paste or type the question">
              <Textarea
                className="min-h-36"
                maxLength={8000}
                placeholder="A fair die is rolled twice..."
                value={questionText}
                onChange={(event) => setQuestionText(event.target.value)}
              />
            </Field>
          ) : (
            <Field label="Upload a screenshot or photo of the question">
              <Input
                ref={fileInputRef}
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                type="file"
              />
              <span className="text-xs text-muted-foreground">
                One PNG, JPEG, or WEBP image, up to 5MB. The image is processed
                transiently and is not saved as a public asset.
              </span>
            </Field>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={isAnalyzing}
            onClick={analyzeQuestion}
          >
            {isAnalyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Analyze Question
          </Button>
          {manualDraftAllowed ? (
            <Button type="button" variant="outline" onClick={startManualDraft}>
              Continue manually
            </Button>
          ) : null}
        </div>
      </section>

      {message ? (
        <Alert variant="info" aria-live="polite">
          <Sparkles />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {saved ? (
        <QuestionIntakeSavedNotice
          saved={saved}
          topicTitle={topics.find((topic) => topic.id === saved.topicId)?.title}
          onAddAnother={resetForAnotherQuestion}
        />
      ) : null}

      {saveError ? (
        <Alert variant="destructive" role="alert">
          <AlertTriangle />
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
      ) : null}
    </div>
  );
}

/**
 * The post-save confirmation. It names the destination in the professor's own
 * vocabulary (Review Queue, approve, publish) and links straight to the saved
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
      <CheckCircle2 />
      <AlertTitle>Draft saved.</AlertTitle>
      <AlertDescription>
        <p>{questionIntakeSavedSummary(saved, topicTitle)}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={professorQuestionPath(saved.questionId)}>
              <Eye className="h-4 w-4" />
              View Draft
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link
              href={professorReviewQueuePagePath(
                saved.topicId,
                saved.questionId,
              )}
            >
              <ClipboardCheck className="h-4 w-4" />
              Open in Review Queue
            </Link>
          </Button>
          {onAddAnother ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onAddAnother}
            >
              <Plus className="h-4 w-4" />
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
      ? `is waiting in your Review Queue under ${topic}.`
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
  return input.saved ? "Draft saved" : "Save Draft";
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

  return (
    <section className="rounded-md border border-primary/30 bg-muted/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">AI Question Draft</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Every tutoring field remains unverified until a professor reviews
            it. Saving files the question in your Review Queue; approval and
            publication stay separate steps.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="warning">AI-generated draft</Badge>
          {model ? <Badge variant="outline">{model}</Badge> : null}
        </div>
      </div>

      {draft.warnings.length > 0 || draft.unreadableSegments.length > 0 ? (
        <Alert variant="warning" className="mt-4">
          <AlertTriangle />
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

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <Input
            maxLength={500}
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </Field>
        <Field label="Existing course topic">
          <select
            className={nativeSelectClassName}
            value={draft.topicId}
            onChange={(event) => update("topicId", event.target.value)}
          >
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
          <ConfidenceLabel
            value={draft.confidence.topic}
            label="Topic confidence"
          />
        </Field>
        <Field label="Question type">
          <select
            className={nativeSelectClassName}
            value={draft.questionType}
            disabled
          >
            <option value="free_response">Free response</option>
          </select>
          <span className="text-xs text-muted-foreground">
            Free response is the tutor&apos;s current supported question format.
          </span>
        </Field>
        <Field label="Answer type">
          <select
            className={nativeSelectClassName}
            value={draft.answerType}
            onChange={(event) =>
              changeAnswerType(event.target.value as QuestionIntakeAnswerType)
            }
          >
            <option value="numeric">Numeric</option>
            <option value="text">Text</option>
          </select>
        </Field>
        <Field label="Difficulty">
          <select
            className={nativeSelectClassName}
            value={draft.difficulty}
            onChange={(event) =>
              update("difficulty", event.target.value as Difficulty)
            }
          >
            {DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Question source">
          <select
            className={nativeSelectClassName}
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
          </select>
          <span className="text-xs text-muted-foreground">
            Stored with the existing professor-provided provenance; no pattern
            ID is created.
          </span>
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Question wording">
          <Textarea
            className="min-h-36"
            maxLength={8000}
            value={draft.prompt}
            onChange={(event) => update("prompt", event.target.value)}
          />
          <ConfidenceLabel
            value={draft.confidence.extraction}
            label="Extraction confidence"
          />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Correct accepted answers (one per line)">
          <Textarea
            className="min-h-28"
            value={draft.answer.acceptedAnswers.join("\n")}
            onChange={(event) =>
              updateAnswer("acceptedAnswers", lines(event.target.value))
            }
          />
        </Field>
        {draft.answerType === "numeric" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Numeric value">
              <Input
                type="number"
                step="any"
                value={draft.answer.numericValue ?? ""}
                onChange={(event) =>
                  updateAnswer(
                    "numericValue",
                    optionalNumber(event.target.value),
                  )
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
      </div>

      <div className="mt-4">
        <Field label="Answer explanation">
          <Textarea
            className="min-h-32"
            maxLength={8000}
            value={draft.answer.explanation}
            onChange={(event) =>
              updateAnswer("explanation", event.target.value)
            }
          />
          <ConfidenceLabel
            value={draft.confidence.answer}
            label="Answer confidence"
          />
        </Field>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Progressive hints (2–4, one per line)">
          <Textarea
            className="min-h-44"
            value={draft.hints.join("\n")}
            onChange={(event) => update("hints", lines(event.target.value))}
          />
        </Field>
        <Field label="Full solution steps (one per line)">
          <Textarea
            className="min-h-44"
            value={draft.solutionSteps.join("\n")}
            onChange={(event) =>
              update("solutionSteps", lines(event.target.value))
            }
          />
        </Field>
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="font-medium">Likely student misconceptions</h4>
            <p className="text-xs text-muted-foreground">
              Keep only recognizable incorrect patterns with targeted feedback.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
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
            <Plus className="h-4 w-4" /> Add misconception
          </Button>
        </div>
        {draft.misconceptions.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No meaningful misconception suggested.
          </p>
        ) : (
          draft.misconceptions.map((misconception, index) => (
            <div
              key={index}
              className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto]"
            >
              <Field label="Code / incorrect pattern">
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
                <Input
                  placeholder="Recognizable answer terms, comma separated"
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
              <Field label="Targeted tutor feedback">
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
                className="md:mt-6"
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
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <section className="rounded-md border p-3 text-sm">
          <h4 className="font-medium">Consistency checks</h4>
          <ul className="mt-2 space-y-2 text-muted-foreground">
            {draft.review.checks.length > 0 ? (
              draft.review.checks.map((check) => (
                <li key={check.code} className="flex gap-2">
                  <Badge
                    variant={check.status === "passed" ? "success" : "warning"}
                  >
                    {check.status}
                  </Badge>
                  <span>{check.message}</span>
                </li>
              ))
            ) : (
              <li>Checks will run when the completed draft is saved.</li>
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
        <Alert variant="warning" className="mt-4">
          <AlertTriangle />
          <AlertDescription>
            This operating mode is read-only. You can analyze and edit the
            preview, but configured database storage is required to save it.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          aria-busy={isSaving}
          disabled={readOnly || isSaving}
          onClick={onSave}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saveDraftButtonLabel({ isSaving, saved: false })}
        </Button>
        <span className="text-xs text-muted-foreground">
          Save files a non-public draft in your Review Queue. Approve and
          publish remain separate lifecycle actions; students see nothing until
          you publish.
        </span>
      </div>
    </section>
  );
}

function DuplicateWarnings({
  acknowledged,
  duplicates,
  onAcknowledged,
}: {
  acknowledged: boolean;
  duplicates: QuestionIntakeDuplicate[];
  onAcknowledged: (checked: boolean) => void;
}) {
  return (
    <section className="rounded-md border p-3 text-sm">
      <h4 className="font-medium">Duplicate review</h4>
      {duplicates.length === 0 ? (
        <p className="mt-2 text-muted-foreground">
          No similar question was found during the latest server check. Saving
          checks again.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          <Alert variant="warning">
            <AlertTriangle />
            <AlertDescription>
              A similar question may already exist.
            </AlertDescription>
          </Alert>
          <ul className="space-y-2">
            {duplicates.map((duplicate) => (
              <li
                key={duplicate.questionId}
                className="rounded-md bg-muted p-2"
              >
                <span className="font-medium">{duplicate.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {duplicate.questionId} ·{" "}
                  {duplicate.reason.replaceAll("_", " ")} ·{" "}
                  {Math.round(duplicate.similarity * 100)}%
                </span>
              </li>
            ))}
          </ul>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledged}
              onChange={(event) => onAcknowledged(event.target.checked)}
            />
            <span>
              I reviewed these possible duplicates and want to save this
              legitimate variant.
            </span>
          </label>
        </div>
      )}
    </section>
  );
}

function ConfidenceLabel({ label, value }: { label: string; value: number }) {
  const level = value >= 0.85 ? "High" : value >= 0.7 ? "Medium" : "Low";
  return (
    <span className="text-xs text-muted-foreground">
      {label}: {level} ({Math.round(value * 100)}%)
    </span>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
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

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
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
