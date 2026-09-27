"use client";

import { useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { AnswerType, Difficulty } from "@/lib/courses/types";

export type WrittenQuestionDraft = {
  title: string;
  prompt: string;
  answerType: AnswerType;
  difficulty: Difficulty;
  finalAnswer: string;
  hints: string[];
  solutionSteps: string[];
};

const ANSWER_TYPES: AnswerType[] = ["numeric", "categorical", "expression"];
const DIFFICULTIES: Difficulty[] = ["foundational", "core", "challenge"];

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  numeric: "Numeric",
  categorical: "Categorical",
  expression: "Expression",
};

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  foundational: "Foundational",
  core: "Core",
  challenge: "Challenge",
};

/** One per line, blanks dropped — the same shape the intake panel uses. */
function toLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The "Write it myself" path, inline under the topic header so the professor
 * never leaves the topic they are filling. It writes a draft into the same
 * review queue as an upload — it does not publish anything.
 */
export function WriteQuestionForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (draft: WrittenQuestionDraft) => void;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answerType, setAnswerType] = useState<AnswerType>("numeric");
  const [difficulty, setDifficulty] = useState<Difficulty>("core");
  const [finalAnswer, setFinalAnswer] = useState("");
  const [hints, setHints] = useState("");
  const [solutionSteps, setSolutionSteps] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const titleError =
    showErrors && title.trim().length === 0
      ? "Give the question a title."
      : undefined;
  const promptError =
    showErrors && prompt.trim().length === 0
      ? "Write the prompt students will see."
      : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (title.trim().length === 0 || prompt.trim().length === 0) {
      setShowErrors(true);
      (title.trim().length === 0 ? titleRef : promptRef).current?.focus();
      return;
    }
    onSubmit({
      title: title.trim(),
      prompt: prompt.trim(),
      answerType,
      difficulty,
      finalAnswer: finalAnswer.trim() || "—",
      hints: toLines(hints),
      solutionSteps: toLines(solutionSteps),
    });
  }

  return (
    <section
      aria-labelledby="write-question-title"
      className="rounded-panel bg-sheet p-5 sm:p-6"
    >
      <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
        <div className="flex flex-col gap-1">
          <h2 className="type-h2 text-ink" id="write-question-title">
            Write a question for this topic
          </h2>
          <p className="type-small max-w-prose text-ink-muted">
            It saves to the review queue as Needs review. Approve it, publish
            it, then release it to a section.
          </p>
        </div>

        <Field error={titleError} label="Title">
          <Input
            autoComplete="off"
            name="title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Bayes with two urns…"
            ref={titleRef}
            value={title}
          />
        </Field>

        <Field
          description="LaTeX between $…$ renders as math."
          error={promptError}
          label="Prompt"
        >
          <Textarea
            name="prompt"
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="An urn holds 4 red and 6 blue balls…"
            ref={promptRef}
            rows={4}
            value={prompt}
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Answer type">
            <NativeSelect
              name="answerType"
              onChange={(event) =>
                setAnswerType(event.target.value as AnswerType)
              }
              value={answerType}
            >
              {ANSWER_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ANSWER_TYPE_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Difficulty">
            <NativeSelect
              name="difficulty"
              onChange={(event) =>
                setDifficulty(event.target.value as Difficulty)
              }
              value={difficulty}
            >
              {DIFFICULTIES.map((value) => (
                <option key={value} value={value}>
                  {DIFFICULTY_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Final answer" optional>
            <Input
              autoComplete="off"
              mono
              name="finalAnswer"
              onChange={(event) => setFinalAnswer(event.target.value)}
              placeholder="7/12…"
              value={finalAnswer}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field description="One hint per line." label="Hints" optional>
            <Textarea
              name="hints"
              onChange={(event) => setHints(event.target.value)}
              rows={3}
              value={hints}
            />
          </Field>
          <Field
            description="One step per line."
            label="Solution steps"
            optional
          >
            <Textarea
              name="solutionSteps"
              onChange={(event) => setSolutionSteps(event.target.value)}
              rows={3}
              value={solutionSteps}
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit">Save to review queue</Button>
          <Button onClick={onCancel} type="button" variant="ghost">
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
