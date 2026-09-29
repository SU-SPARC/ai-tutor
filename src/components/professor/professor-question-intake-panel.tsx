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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { professorQuestionPath } from "@/lib/professor/question-paths";
import type { QuestionIntakeAnalysis } from "@/lib/question-intake/provenance";
import { questionIntakeModelDraftForSave } from "@/lib/question-intake/schema";
import type {
  QuestionIntakeAnalysisResult,
  QuestionIntakeDraft,
  QuestionIntakeDuplicate,
  QuestionIntakeInputMode,
  QuestionIntakeSourceKind,
} from "@/lib/question-intake/types";
import { parseRational } from "@/lib/tutor/answer/rational";
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

/** The one sentence shown whenever this page cannot save (the demo). */
export const DEMO_NOTICE = "Demo: changes on this page are not saved.";

export const QUESTION_INTAKE_SAVE_FAILURE_MESSAGE =
  "Your question wasn't saved. Your draft is still here. Please try again.";

const DIFFICULTIES = [
  "foundational",
  "intermediate",
  "challenge",
] as const satisfies readonly Difficulty[];
const SOURCE_OPTIONS: Array<{
  label: string;
  value: QuestionIntakeSourceKind;
}> = [
  { label: "I wrote it", value: "professor_authored" },
  {
    label: "My course materials",
    value: "professor_provided_course_material",
  },
  {
    label: "A textbook or licensed source",
    value: "licensed_approved_course_material",
  },
  { label: "Not sure", value: "unknown_needs_review" },
];

/** What the professor asked for when a draft already exists. */
type ReplaceRequest =
  | { kind: "mode"; mode: QuestionIntakeInputMode }
  | { kind: "analyze" }
  | { kind: "manual" };

const CONTROL = "min-h-11";

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
  const [draftByAi, setDraftByAi] = useState(false);
  // Bumped for every new draft so the editor (and its answer options) starts
  // fresh instead of carrying settings over from the replaced draft.
  const [draftSerial, setDraftSerial] = useState(0);
  const [duplicates, setDuplicates] = useState<QuestionIntakeDuplicate[]>([]);
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [inputMode, setInputMode] = useState<QuestionIntakeInputMode>("text");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [questionText, setQuestionText] = useState("");
  const [replaceRequest, setReplaceRequest] = useState<ReplaceRequest>();
  const [saved, setSaved] = useState<QuestionIntakeSavedQuestion>();
  const [saveError, setSaveError] = useState<string>();
  const [sourceKind, setSourceKind] =
    useState<QuestionIntakeSourceKind>("professor_authored");

  // A draft the professor may have edited: replacing it needs a yes first.
  const hasOpenDraft = Boolean(draft && !saved);

  function startNewDraft(next: QuestionIntakeDraft | undefined) {
    saveKeyRef.current = next ? newSaveKey() : undefined;
    setDraftSerial((serial) => serial + 1);
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
    setMessage(undefined);
  }

  function resetForAnotherQuestion() {
    startNewDraft(undefined);
    setAnalysis(undefined);
    setMessage(undefined);
    setQuestionText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function request(next: ReplaceRequest) {
    if (next.kind === "mode" && next.mode === inputMode) return;
    if (hasOpenDraft) {
      setReplaceRequest(next);
      return;
    }
    run(next);
  }

  function run(next: ReplaceRequest) {
    if (next.kind === "mode") changeInputMode(next.mode);
    else if (next.kind === "analyze") void analyzeQuestion();
    else startManualDraft();
  }

  async function analyzeQuestion() {
    const file = fileInputRef.current?.files?.[0];
    if (inputMode === "text" && !questionText.trim()) {
      setMessage("Please type or paste a question first.");
      return;
    }
    if (inputMode === "image" && !file) {
      setMessage("Please choose a photo of the question first.");
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
        setMessage(analysisFailureMessage(response.status, inputMode));
        return;
      }
      startNewDraft(payload.draft);
      setDraftByAi(true);
      setDuplicates(payload.duplicates ?? []);
      setAnalysis({ inputMode, model: payload.model });
      setMessage(
        "Your draft is ready. Check each part, then save it. Nothing is saved yet.",
      );
    } catch {
      setMessage(
        "The AI couldn't make a draft this time. Try again, or fill in the details yourself.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  function startManualDraft() {
    startNewDraft(manualQuestionDraft(questionText, topics));
    setDraftByAi(false);
    setAnalysis({ inputMode });
    setMessage(
      "Fill in the answer, the hints and the solution, then save your question.",
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
      // The question list on this page is server-rendered; refresh it so
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
              Add a question
            </h2>
            <p className="type-body max-w-prose text-ink">
              Type or paste a question, or add a photo of one. We&apos;ll draft
              the hints and solution for you to check. Nothing is saved until
              you save it.
            </p>
          </div>

          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="How to add the question"
          >
            {(
              [
                { label: "Type or paste", value: "text" },
                { label: "Photo", value: "image" },
              ] as const
            ).map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={inputMode === mode.value}
                onClick={() => request({ kind: "mode", mode: mode.value })}
                className={cn(
                  "inline-flex h-11 items-center rounded-chip px-4 type-body transition-colors duration-fast focus-ring",
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
            <Field label="Question text">
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
              label="Add a photo of the question"
              description="One question per photo for now. For a whole worksheet, add one photo per question. PNG, JPEG or WEBP, up to 5 MB."
            >
              <Input
                ref={fileInputRef}
                className={CONTROL}
                accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                type="file"
              />
            </Field>
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className={CONTROL}
              disabled={isAnalyzing}
              loading={isAnalyzing}
              onClick={() => request({ kind: "analyze" })}
            >
              Create draft with AI
            </Button>
            <Button
              type="button"
              variant="secondary"
              className={CONTROL}
              disabled={isAnalyzing}
              onClick={() => request({ kind: "manual" })}
            >
              Fill in the details myself
            </Button>
          </div>

          <div role="status" aria-live="polite">
            {message ? (
              <p className="type-body max-w-prose border-l-2 border-azure-500 py-1 pl-4 text-ink">
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
            Your draft
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
              <AlertTitle>Not saved</AlertTitle>
              <AlertDescription>
                <p className="type-body text-ink">{saveError}</p>
              </AlertDescription>
            </Alert>
          ) : null}

          {draft && !saved ? (
            <QuestionDraftEditor
              key={draftSerial}
              byAi={draftByAi}
              draft={draft}
              duplicateAcknowledged={duplicateAcknowledged}
              duplicates={duplicates}
              isSaving={isSaving}
              readOnly={readOnly}
              sourceKind={sourceKind}
              topics={topics}
              onDuplicateAcknowledged={setDuplicateAcknowledged}
              onDraftChange={replaceDraft}
              onSave={saveDraft}
              onSourceKindChange={setSourceKind}
            />
          ) : !saved ? (
            <EmptyState className="type-body rounded-panel bg-surface-tint px-5 text-ink">
              Type or paste a question on the left, or add a photo. Your draft
              appears here.
            </EmptyState>
          ) : null}
        </section>
      </div>

      <Dialog
        open={replaceRequest !== undefined}
        onOpenChange={(open) => {
          if (!open) setReplaceRequest(undefined);
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Replace your current draft?</DialogTitle>
            <DialogDescription className="type-body text-ink">
              Your edits will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              className={CONTROL}
              onClick={() => setReplaceRequest(undefined)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              className={CONTROL}
              onClick={() => {
                const next = replaceRequest;
                setReplaceRequest(undefined);
                if (next) run(next);
              }}
            >
              Replace draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function analysisFailureMessage(
  status: number,
  inputMode: QuestionIntakeInputMode,
) {
  if (status === 413)
    return "That photo is too large. Please use a photo under 5 MB.";
  if (status === 429)
    return "Too many tries in a row. Please wait a minute, then try again.";
  if (status === 400 && inputMode === "image")
    return "We couldn't read that photo. Please use a PNG, JPEG or WEBP photo of one question.";
  return "The AI couldn't make a draft this time. Try again, or fill in the details yourself.";
}

/**
 * The post-save confirmation. It says in one sentence that students cannot
 * see the question yet and links straight to the saved question.
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
      <AlertTitle>Question saved</AlertTitle>
      <AlertDescription>
        <p className="type-body text-ink">
          {questionIntakeSavedSummary(saved, topicTitle)}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button asChild variant="cta" className={CONTROL}>
            <Link href={professorQuestionPath(saved.questionId)}>
              Open this question
            </Link>
          </Button>
          {onAddAnother ? (
            <Button
              type="button"
              variant="secondary"
              className={CONTROL}
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
      ? `It's waiting for your review under ${topic}.`
      : `You'll find it in your question list under ${topic}.`;
  return `“${saved.title}” is saved. Students can't see it yet. ${location}`;
}

export function questionIntakeSaveFailureMessage(
  status: number,
  payload: Pick<IntakeResponse, "error" | "reasons">,
) {
  const detail = [payload.error, ...(payload.reasons ?? [])]
    .filter(Boolean)
    .join(" ");
  if (status >= 500 || !detail) return QUESTION_INTAKE_SAVE_FAILURE_MESSAGE;
  // Problems the professor can fix (duplicates, things to check) keep the
  // server's wording and the same reassurance about lost work.
  return `${detail} Your draft is still here.`;
}

export function saveDraftButtonLabel(input: {
  isSaving: boolean;
  saved: boolean;
}) {
  if (input.isSaving) return "Saving…";
  return input.saved ? "Saved" : "Save question";
}

function newSaveKey() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * The intake payload still carries `answerType`, `numericValue` and
 * `tolerance`. They are derived from the answer the professor entered: a typed
 * answer sets the type from its kind and drops the older number fields; an
 * older-style answer reads the number from the first accepted answer.
 */
function withDerivedAnswerFields(
  draft: QuestionIntakeDraft,
  answer: QuestionIntakeDraft["answer"],
): QuestionIntakeDraft {
  if (answer.spec) {
    const next = { ...answer };
    delete next.numericValue;
    delete next.tolerance;
    return {
      ...draft,
      answer: next,
      answerType: answer.spec.kind === "numeric" ? "numeric" : "text",
    };
  }
  const first = answer.acceptedAnswers.find((entry) => entry.trim());
  const value = first ? numberFromAnswer(first) : undefined;
  if (value === undefined) {
    const next = { ...answer };
    delete next.numericValue;
    delete next.tolerance;
    return { ...draft, answer: next, answerType: "text" };
  }
  return {
    ...draft,
    answer: { ...answer, numericValue: value },
    answerType: "numeric",
  };
}

function numberFromAnswer(text: string) {
  const direct = Number(text.trim());
  if (text.trim() && Number.isFinite(direct)) return direct;
  const parsed = parseRational(text.trim());
  if (!parsed) return undefined;
  const value = Number(parsed.n) / Number(parsed.d);
  return Number.isFinite(value) ? value : undefined;
}

function QuestionDraftEditor({
  byAi,
  draft,
  duplicateAcknowledged,
  duplicates,
  isSaving,
  onDraftChange,
  onDuplicateAcknowledged,
  onSave,
  onSourceKindChange,
  readOnly,
  sourceKind,
  topics,
}: {
  byAi: boolean;
  draft: QuestionIntakeDraft;
  duplicateAcknowledged: boolean;
  duplicates: QuestionIntakeDuplicate[];
  isSaving: boolean;
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
  const checksHeadingId = useId();

  const checkTone = (status: "failed" | "passed" | "warning") =>
    status === "passed" ? "approved" : status === "failed" ? "wrong" : "hint";
  const checkLabel = (status: "failed" | "passed" | "warning") =>
    status === "passed"
      ? "Looks right"
      : status === "failed"
        ? "Needs fixing"
        : "Please check";

  return (
    <section
      aria-labelledby={headingId}
      className="@container flex flex-col gap-5 rounded-panel bg-sheet p-4 sm:p-5"
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="type-h3 text-ink">
            Your draft
          </h3>
          {byAi ? (
            <StatusChip icon={false} label="Written by AI" tone="hint" />
          ) : null}
        </div>
        <p className="type-body max-w-prose text-ink">
          {byAi
            ? "Check every part before you save it. You can change anything."
            : "Fill in each part. You can change anything before you save it."}
        </p>
      </div>

      {draft.warnings.length > 0 || draft.unreadableSegments.length > 0 ? (
        <Alert variant="warning" role="note">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Please check</AlertTitle>
          <AlertDescription>
            {[
              ...draft.warnings,
              ...draft.unreadableSegments.map(
                (item) => `We couldn't read: ${item}`,
              ),
            ].map((warning) => (
              <span key={warning} className="type-body text-ink">
                {warning}
              </span>
            ))}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 @xl:grid-cols-2">
        <Field label="Title">
          <Input
            className={CONTROL}
            maxLength={500}
            value={draft.title}
            onChange={(event) => update("title", event.target.value)}
          />
        </Field>
        <Field
          label="Topic"
          description={
            byAi && isLow(draft.confidence.topic)
              ? "Please check: the AI was unsure about the topic."
              : undefined
          }
        >
          <NativeSelect
            className={CONTROL}
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
        <Field label="Difficulty">
          <NativeSelect
            className={CONTROL}
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
          label="Where is this question from?"
          description="For your records. Students never see this."
        >
          <NativeSelect
            className={CONTROL}
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
        label="Question text"
        description={
          byAi && isLow(draft.confidence.extraction)
            ? "Please check: the AI had trouble reading parts of this question."
            : undefined
        }
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
          onDraftChange(withDerivedAnswerFields(draft, answer))
        }
      />

      <Field
        label="Explanation of the answer"
        description={
          byAi && isLow(draft.confidence.answer)
            ? "Please check: the AI was unsure about the answer."
            : undefined
        }
      >
        <Textarea
          className="min-h-32"
          maxLength={8000}
          value={draft.answer.explanation}
          onChange={(event) => updateAnswer("explanation", event.target.value)}
        />
      </Field>

      <div className="grid gap-5 @xl:grid-cols-2">
        <Field
          label="Hints (2 to 4, one per line)"
          description="Students see them one at a time, in this order."
        >
          <LinesTextarea
            className="min-h-44"
            values={draft.hints}
            onChange={(hints) => update("hints", hints)}
          />
        </Field>
        <Field label="Solution steps (one per line)">
          <LinesTextarea
            className="min-h-44"
            values={draft.solutionSteps}
            onChange={(solutionSteps) => update("solutionSteps", solutionSteps)}
          />
        </Field>
      </div>

      <details className="rounded-panel bg-surface-tint">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2 type-body-strong text-ink focus-ring">
          Common wrong answers (optional)
          {draft.misconceptions.length > 0
            ? ` · ${draft.misconceptions.length} added`
            : ""}
        </summary>
        <div className="flex flex-col gap-3 border-t border-rule p-4">
          <p className="type-body max-w-prose text-ink">
            When a student gives one of these wrong answers, the tutor replies
            with your message.
          </p>
          {draft.misconceptions.length === 0 ? (
            <p className="type-body text-ink">None added yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {draft.misconceptions.map((misconception, index) => (
                <li
                  key={index}
                  className="grid gap-4 rounded-panel bg-sheet p-4 @xl:grid-cols-[1fr_1fr_auto]"
                >
                  <Field
                    label={`Wrong answer students give (${index + 1})`}
                    description="Separate several with commas, for example 0.5, 1/2."
                  >
                    <Input
                      className={CONTROL}
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
                  <Field label={`What the tutor should say (${index + 1})`}>
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
                    aria-label={`Remove wrong answer ${index + 1}`}
                    className="min-h-11 w-fit @xl:mt-8"
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
                    Remove
                  </Button>
                </li>
              ))}
            </ol>
          )}
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-fit"
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
            <Plus aria-hidden="true" /> Add a wrong answer
          </Button>
        </div>
      </details>

      <div className="grid gap-4 @xl:grid-cols-2">
        <section
          aria-labelledby={checksHeadingId}
          className="flex flex-col gap-2 rounded-panel bg-surface-tint p-4"
        >
          <h4 id={checksHeadingId} className="type-body-strong text-ink">
            Things to check
          </h4>
          <ul className="flex flex-col gap-2 type-body text-ink">
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
              <li>We check these when you save.</li>
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
        <p className="type-body max-w-prose border-l-2 border-input pl-4 text-ink">
          {DEMO_NOTICE}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-rule pt-5 sm:flex-row sm:items-center">
        <Button
          type="button"
          className={CONTROL}
          aria-busy={isSaving}
          disabled={readOnly || isSaving}
          loading={isSaving}
          onClick={onSave}
        >
          {saveDraftButtonLabel({ isSaving, saved: false })}
        </Button>
        <p className="type-body max-w-prose text-ink">
          Saving adds it to your question list. Students can&apos;t see it
          until you choose to show it to them.
        </p>
      </div>
    </section>
  );
}

const DUPLICATE_REASON_LABELS: Record<QuestionIntakeDuplicate["reason"], string> =
  {
    exact_text: "Same text",
    same_structure: "Same kind of problem",
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
        Possible duplicates
      </h4>
      {duplicates.length === 0 ? (
        <p className="type-body text-ink">
          We didn&apos;t find a similar question. We check again when you
          save.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="type-body text-ink">
            A similar question may already be in your question bank.
          </p>
          <ul className="flex flex-col gap-2">
            {duplicates.map((duplicate) => (
              <li
                key={duplicate.questionId}
                className="flex flex-col gap-0.5 rounded-control bg-sheet px-3 py-2"
              >
                <span className="type-body-strong text-ink">
                  {duplicate.title}
                </span>
                <span className="type-small text-ink-muted">
                  {DUPLICATE_REASON_LABELS[duplicate.reason] ??
                    duplicate.reason}{" "}
                  · {Math.round(duplicate.similarity * 100)}% alike
                </span>
              </li>
            ))}
          </ul>
          <CheckboxField
            label="I've looked at these. Save mine anyway."
            checked={acknowledged}
            onCheckedChange={(checked) => onAcknowledged(checked === true)}
          />
        </div>
      )}
    </section>
  );
}

function isLow(value: number) {
  return value < 0.7;
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
    warnings: [],
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
