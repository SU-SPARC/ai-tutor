"use client";

import { useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <label className="text-sm font-medium" htmlFor={htmlFor}>
      {children}
    </label>
  );
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
  const fieldId = useId();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answerType, setAnswerType] = useState<AnswerType>("numeric");
  const [difficulty, setDifficulty] = useState<Difficulty>("core");
  const [finalAnswer, setFinalAnswer] = useState("");
  const [hints, setHints] = useState("");
  const [solutionSteps, setSolutionSteps] = useState("");

  const ready = title.trim().length > 0 && prompt.trim().length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready) {
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
    <Card>
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle>Write a question for this topic</CardTitle>
          <CardDescription>
            Saved straight into the review queue as <em>needs review</em>. The
            topic is already set; approve it, publish it, then release it to a
            section.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-title`}>Title</Label>
            <Input
              id={`${fieldId}-title`}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Bayes with two urns"
              required
              value={title}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-prompt`}>Prompt</Label>
            <Textarea
              id={`${fieldId}-prompt`}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="An urn holds 4 red and 6 blue balls…  LaTeX in $…$ renders."
              required
              rows={4}
              value={prompt}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-answer-type`}>Answer type</Label>
              <NativeSelect
                id={`${fieldId}-answer-type`}
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
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${fieldId}-difficulty`}>Difficulty</Label>
              <NativeSelect
                id={`${fieldId}-difficulty`}
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
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-final-answer`}>Final answer</Label>
            <Input
              id={`${fieldId}-final-answer`}
              onChange={(event) => setFinalAnswer(event.target.value)}
              placeholder="7/12"
              value={finalAnswer}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-hints`}>Hints</Label>
            <Textarea
              id={`${fieldId}-hints`}
              onChange={(event) => setHints(event.target.value)}
              placeholder={"One hint per line."}
              rows={3}
              value={hints}
            />
            <p className="text-xs text-muted-foreground">One per line.</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${fieldId}-steps`}>Solution steps</Label>
            <Textarea
              id={`${fieldId}-steps`}
              onChange={(event) => setSolutionSteps(event.target.value)}
              placeholder={"One step per line."}
              rows={3}
              value={solutionSteps}
            />
            <p className="text-xs text-muted-foreground">One per line.</p>
          </div>
        </CardContent>
        <CardFooter className="gap-3">
          <Button disabled={!ready} type="submit">
            Save to review queue
          </Button>
          <Button onClick={onCancel} type="button" variant="outline">
            Cancel
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
