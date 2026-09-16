import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setContentRepositoryForTests } from "@/lib/data/data-store";
import { isValidAnswerAttempt } from "@/lib/tutor/practice-credit";
import { decideTutorResponse } from "@/lib/tutor/tutor-engine";
import { getQuestionById } from "@/lib/data/data-store";
import {
  getTutorSessionState,
  resetTutorStateForTests,
} from "@/lib/tutor/tutor-state";
import { resetAiUsageControlsForTests } from "@/lib/ai/usage-controls";
import type { PracticeQuestion } from "@/lib/types";
import type { TutorSessionState } from "@/lib/tutor/tutor-state";

/**
 * The demo question "dice-sum-eight" accepts 2/5. Its hints are exhausted so
 * that an AI-help request is eligible; the rule checker would grade "2/5"
 * correct and "1/5" incorrect if it ran.
 */
async function eligibleState(sessionId: string) {
  const question = await getQuestionById("dice-sum-eight");
  if (!question) throw new Error("demo question missing");
  const state: TutorSessionState = {
    ...getTutorSessionState(sessionId, question.id),
    hintsRevealed: question.hints.length,
  };
  return { question: question as PracticeQuestion, state };
}

function isCreditBearing(verdict: string) {
  return isValidAnswerAttempt({ mode: "check", verdict });
}

describe("AI help never consumes a valid answer attempt", () => {
  beforeEach(() => {
    resetTutorStateForTests();
    resetAiUsageControlsForTests();
    vi.stubEnv("APP_DEMO_MODE", "true");
    // No provider: help resolves through retrieval or a blocked notice.
    vi.stubEnv("AI_ENABLED", "false");
    vi.stubEnv("OPENROUTER_API_KEY", "");
  });

  afterEach(() => {
    setContentRepositoryForTests(undefined);
    vi.unstubAllEnvs();
  });

  it("B: an incorrect draft sent with Ask AI is not graded", async () => {
    const { question, state } = await eligibleState("ai-help-incorrect-draft");
    const result = await decideTutorResponse({
      aiHelp: true,
      allowLlmFallback: true,
      answer: "1/5",
      mode: "check",
      question,
      sessionId: "ai-help-incorrect-draft",
      state,
    });

    expect(["guidance", "blocked"]).toContain(result.response.verdict);
    expect(isCreditBearing(result.response.verdict)).toBe(false);
    expect(result.response.misconceptions).toEqual([]);
    expect(result.state.solved).toBe(false);
    expect(result.state.wrongAttemptCount).toBe(state.wrongAttemptCount);
    // The raw interaction counter keeps its historical meaning.
    expect(result.state.attemptCount).toBe(state.attemptCount + 1);
  });

  it("C: a correct-looking draft sent with Ask AI is not graded and does not solve", async () => {
    const { question, state } = await eligibleState("ai-help-correct-draft");
    const result = await decideTutorResponse({
      aiHelp: true,
      allowLlmFallback: true,
      answer: "2/5",
      mode: "check",
      question,
      sessionId: "ai-help-correct-draft",
      state,
    });

    expect(result.response.verdict).not.toBe("correct");
    expect(isCreditBearing(result.response.verdict)).toBe(false);
    expect(result.response.steps).toEqual([]);
    expect(result.state.solved).toBe(false);
    expect(result.state.stepsRevealed).toBe(state.stepsRevealed);
  });

  it("does not run the checker even when a draft matches a misconception", async () => {
    const { question, state } = await eligibleState("ai-help-misconception");
    const result = await decideTutorResponse({
      aiHelp: true,
      allowLlmFallback: true,
      answer: "5/36",
      mode: "check",
      question,
      sessionId: "ai-help-misconception",
      state,
    });

    expect(result.response.verdict).not.toBe("incorrect");
    expect(result.response.misconceptions).toEqual([]);
    expect(result.state.lastMisconceptionIds).toEqual([]);
  });

  it("before the hints are exhausted, Ask AI returns guidance without grading", async () => {
    const question = await getQuestionById("dice-sum-eight");
    if (!question) throw new Error("demo question missing");
    const state = getTutorSessionState("ai-help-early", question.id);
    const result = await decideTutorResponse({
      aiHelp: true,
      allowLlmFallback: true,
      answer: "2/5",
      mode: "check",
      question: question as PracticeQuestion,
      sessionId: "ai-help-early",
      state,
    });

    expect(result.response.verdict).toBe("guidance");
    expect(result.response.message).toContain("hints first");
    expect(result.state.solved).toBe(false);
    expect(result.state.hintsRevealed).toBe(state.hintsRevealed);
  });

  it("a normal Check answer still grades: incorrect and correct each count", async () => {
    const { question, state } = await eligibleState("check-answer-grades");
    const incorrect = await decideTutorResponse({
      answer: "1/5",
      mode: "check",
      question,
      sessionId: "check-answer-grades",
      state,
    });
    expect(incorrect.response.verdict).toBe("incorrect");
    expect(isCreditBearing(incorrect.response.verdict)).toBe(true);

    const correct = await decideTutorResponse({
      answer: "2/5",
      mode: "check",
      question,
      sessionId: "check-answer-grades",
      state: incorrect.state,
    });
    expect(correct.response.verdict).toBe("correct");
    expect(isCreditBearing(correct.response.verdict)).toBe(true);
    expect(correct.state.solved).toBe(true);
  });
});
