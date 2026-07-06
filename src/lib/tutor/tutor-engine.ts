import "server-only"

import { getApprovedQuestionById } from "@/lib/data/data-store"
import type { AnswerCheckResult } from "@/lib/tutor/answer-checker"
import { checkAnswer, normalizeAnswerText } from "@/lib/tutor/answer-checker"
import { detectMisconceptions } from "@/lib/tutor/misconceptions"
import { retrieveCourseContext } from "@/lib/tutor/retrieval"
import {
  getTutorSessionState,
  recordTutorAttemptSnapshot,
  saveTutorSessionState,
  tutorProgressFromState,
  type TutorSessionState,
} from "@/lib/tutor/tutor-state"
import {
  DEFAULT_USAGE_POLICY,
  estimateTokens,
  getLlmFallbacksRemaining,
  recordTutorInteraction,
} from "@/lib/tutor/usage"
import type {
  PracticeQuestion,
  TutorMode,
  TutorRequest,
  TutorResponse,
} from "@/lib/types"

export type RuleTutorMode = TutorMode | "full_solution"

export type TutorDecisionInput = {
  allowFullSolution?: boolean
  answer: string
  mode: RuleTutorMode
  question: PracticeQuestion
  sessionId: string
  state: TutorSessionState
}

export type StudentAttemptCheck = {
  answerCheck: AnswerCheckResult
  misconception?: MisconceptionMatch
}

export type EscalationInput = {
  allowLlmFallback?: boolean
  answer: string
  mode: RuleTutorMode
  question?: PracticeQuestion
  retrievalMatches?: number
  state: TutorSessionState
}

type RuleResult = {
  response: TutorResponse
  state: TutorSessionState
}

export type MisconceptionMatch = {
  correctiveHint?: string
  feedback: string
  id: string
}

export async function createTutorResponse(
  request: TutorRequest,
): Promise<TutorResponse> {
  const sessionId = request.sessionId || "anonymous-demo-session"
  const answer = request.answer.trim()
  const questionKey = questionKeyForRequest(request)
  const state = getTutorSessionState(sessionId, questionKey)

  if (answer.length > DEFAULT_USAGE_POLICY.maxInputCharacters) {
    const nextState = saveTutorSessionState(
      nextStateForAttempt(state, {
        state: "blocked",
      }),
    )
    return finalizeResponse(
      blockedResponse(
        "That answer is too long for the tutor. Please shorten it and try again.",
        sessionId,
        nextState,
      ),
      request,
      answer,
      sessionId,
      nextState,
    )
  }

  const question = request.questionId
    ? await getApprovedQuestionById(request.questionId)
    : undefined

  if (question) {
    const result = await decideTutorResponse({
      answer,
      mode: request.mode,
      question,
      sessionId,
      state,
    })
    const nextState = saveTutorSessionState(result.state)
    return finalizeResponse(
      withProgress(result.response, nextState),
      request,
      answer,
      sessionId,
      nextState,
    )
  }

  const shouldRetrieve = shouldEscalateToRetrieval({
    answer,
    mode: request.mode,
    state,
  })
  const retrievedResult = shouldRetrieve
    ? await buildRetrievalResponse(
        `${request.topicId ?? ""} ${answer}`,
        request.topicId,
        sessionId,
        state,
      )
    : undefined

  if (retrievedResult) {
    const nextState = saveTutorSessionState(retrievedResult.state)
    return finalizeResponse(
      withProgress(retrievedResult.response, nextState),
      request,
      answer,
      sessionId,
      nextState,
    )
  }

  if (
    shouldEscalateToLLM({
      allowLlmFallback: request.allowLlmFallback,
      answer,
      mode: request.mode,
      retrievalMatches: 0,
      state,
    })
  ) {
    const nextState = saveTutorSessionState(
      nextStateForAttempt(state, {
        state: "blocked",
      }),
    )
    return finalizeResponse(
      blockedResponse(
        "The rule-based tutor does not call LLM fallback yet.",
        sessionId,
        nextState,
      ),
      request,
      answer,
      sessionId,
      nextState,
    )
  }

  const nextState = saveTutorSessionState(
    nextStateForAttempt(state, {
      state: "blocked",
    }),
  )
  return finalizeResponse(
    blockedResponse(
      "No approved rule or retrieval match was found, and LLM fallback was not requested.",
      sessionId,
      nextState,
    ),
    request,
    answer,
    sessionId,
    nextState,
  )
}

export async function decideTutorResponse({
  allowFullSolution,
  answer,
  mode,
  question,
  sessionId,
  state,
}: TutorDecisionInput): Promise<RuleResult> {
  if (mode === "hint") {
    if (question.hints.length === 0) {
      const retrieved = await buildRetrievalResponse(
        question.prompt,
        question.topicId,
        sessionId,
        state,
      )

      if (retrieved) {
        return retrieved
      }
    }

    const hintResult = getNextHint(question, state)

    return {
      response: {
        source: "rule",
        verdict: "guidance",
        message: hintResult.message,
        hints: hintResult.hints,
        steps: [],
        misconceptions: [],
        retrievedContext: [],
        usage: usageFor(sessionId, answer),
      },
      state: hintResult.state,
    }
  }

  if (mode === "solution" || mode === "full_solution") {
    if (question.solutionSteps.length === 0) {
      const retrieved = await buildRetrievalResponse(
        question.prompt,
        question.topicId,
        sessionId,
        state,
      )

      if (retrieved) {
        return retrieved
      }
    }

    const stepResult = getNextStep(question, state, {
      allowFullSolution:
        mode === "full_solution" ? Boolean(allowFullSolution) : state.solved,
      fullSolutionRequested: mode === "full_solution",
    })

    return {
      response: {
        source: "rule",
        verdict: "guidance",
        message: stepResult.message,
        hints: question.hints.slice(0, state.hintsRevealed),
        steps: stepResult.steps,
        misconceptions: [],
        retrievedContext: [],
        usage: usageFor(sessionId, answer),
      },
      state: stepResult.state,
    }
  }

  if (answer.length === 0) {
    const nextState = nextStateForAttempt(state, {
      state: "working",
    })

    return {
      response: {
        source: "rule",
        verdict: "guidance",
        message: "Try entering an answer first, then I can check it.",
        hints: question.hints.slice(0, state.hintsRevealed),
        steps: [],
        misconceptions: [],
        retrievedContext: [],
        usage: usageFor(sessionId, answer),
      },
      state: nextState,
    }
  }

  const attemptCheck = checkStudentAttempt(question, answer)

  if (attemptCheck.answerCheck.isCorrect) {
    const nextState = nextStateForAttempt(state, {
      hintsRevealed: question.hints.length,
      solved: true,
      state: "solved",
      stepsRevealed: question.solutionSteps.length,
    })

    return {
      response: {
        source: "rule",
        verdict: "correct",
        message: question.answer.explanation,
        hints: [],
        steps: question.solutionSteps,
        misconceptions: [],
        retrievedContext: [],
        usage: usageFor(sessionId, answer),
      },
      state: nextState,
    }
  }

  if (shouldEscalateToRetrieval({ answer, mode, question, state })) {
    const retrieved = await buildRetrievalResponse(
      `${question.prompt} ${answer}`,
      question.topicId,
      sessionId,
      {
        ...state,
        wrongAttemptCount: state.wrongAttemptCount + 1,
      },
    )

    if (retrieved) {
      return retrieved
    }
  }

  const fingerprint = normalizeAnswerText(answer)
  const misconceptionMatches = attemptCheck.misconception
    ? [attemptCheck.misconception]
    : []
  const repeatedMisconception =
    fingerprint === state.lastAnswerFingerprint &&
    sameStringSet(
      misconceptionMatches.map((misconception) => misconception.id),
      state.lastMisconceptionIds,
  )
  const misconceptions = repeatedMisconception
    ? []
    : misconceptionMatches.map((misconception) => misconception.feedback)
  const hintResult = getNextHint(question, state, {
    state: misconceptions.length > 0 ? "misconception_detected" : "working",
  })
  const nextState = nextStateForAttempt(state, {
    hintsRevealed: hintResult.state.hintsRevealed,
    lastAnswerFingerprint: fingerprint,
    lastMisconceptionIds: misconceptionMatches.map(
      (misconception) => misconception.id,
    ),
    state: misconceptions.length > 0 ? "misconception_detected" : "working",
    wrongAttemptCount: state.wrongAttemptCount + 1,
  })

  return {
    response: {
      source: "rule",
      verdict: "incorrect",
      message:
        misconceptions.length > 0
          ? "Not quite. I found a likely misconception to check first."
          : "Not quite. Use the next hint before jumping to the full solution.",
      hints:
        misconceptions.length > 0 && attemptCheck.misconception?.correctiveHint
          ? [attemptCheck.misconception.correctiveHint]
          : hintResult.hints,
      steps: [],
      misconceptions,
      retrievedContext: [],
      usage: usageFor(sessionId, answer),
    },
    state: nextState,
  }
}

export function checkStudentAttempt(
  question: PracticeQuestion,
  answer: string,
): StudentAttemptCheck {
  const answerCheck = checkAnswer({
    ...question.answer,
    studentAnswer: answer,
  })

  return {
    answerCheck,
    misconception: answerCheck.isCorrect
      ? undefined
      : detectMisconception(question, answer),
  }
}

export function getNextHint(
  question: PracticeQuestion,
  state: TutorSessionState,
  options?: {
    state?: TutorSessionState["state"]
  },
) {
  const hintsRevealed = Math.min(
    question.hints.length,
    state.hintsRevealed + 1,
  )
  const nextState = nextStateForAttempt(state, {
    hintsRevealed,
    state: options?.state ?? "hinting",
  })

  return {
    hints: question.hints.slice(0, hintsRevealed),
    message:
      hintsRevealed > state.hintsRevealed
        ? "Here is the next approved hint."
        : "All approved hints for this question are visible.",
    state: nextState,
  }
}

export function getNextStep(
  question: PracticeQuestion,
  state: TutorSessionState,
  options?: {
    allowFullSolution?: boolean
    fullSolutionRequested?: boolean
  },
) {
  const allowFullSolution = Boolean(options?.allowFullSolution || state.solved)
  const stepsRevealed = allowFullSolution
    ? question.solutionSteps.length
    : Math.min(question.solutionSteps.length, state.stepsRevealed + 1)
  const alreadyRevealedAll =
    state.stepsRevealed >= question.solutionSteps.length
  const nextState = nextStateForAttempt(state, {
    state: state.solved ? "solved" : "step_reveal",
    stepsRevealed,
  })
  const message =
    allowFullSolution || alreadyRevealedAll
      ? question.answer.explanation
      : options?.fullSolutionRequested
        ? "Full solution is not available yet. Here is the next approved solution step."
        : "Here is the next approved solution step."

  return {
    message,
    state: nextState,
    steps: question.solutionSteps.slice(0, stepsRevealed),
  }
}

export function detectMisconception(
  question: PracticeQuestion,
  answer: string,
): MisconceptionMatch | undefined {
  return detectMisconceptions({
    questionMisconceptions: question.misconceptions,
    studentAnswer: answer,
    topicId: question.topicId,
  }).map<MisconceptionMatch>((misconception) => ({
    correctiveHint: misconception.correctiveHint,
    feedback: misconception.feedback,
    id: misconception.id,
  }))[0]
}

export function shouldEscalateToRetrieval(input: EscalationInput) {
  if (!input.question) {
    return true
  }

  if (input.mode !== "check" || input.answer.trim().length === 0) {
    return false
  }

  return (
    input.state.hintsRevealed >= input.question.hints.length &&
    input.state.stepsRevealed >= input.question.solutionSteps.length
  )
}

export function shouldEscalateToLLM(input: EscalationInput) {
  return Boolean(
    input.allowLlmFallback &&
      input.answer.trim().length > 0 &&
      (input.retrievalMatches ?? 0) === 0,
  )
}

async function buildRetrievalResponse(
  query: string,
  topicId: string | undefined,
  sessionId: string,
  state: TutorSessionState,
): Promise<RuleResult | undefined> {
  const retrievedContext = await retrieveCourseContext(query, topicId)

  if (retrievedContext.length === 0) {
    return undefined
  }

  const nextState = nextStateForAttempt(state, {
    retrievalUsed: true,
    state: "retrieval_guidance",
  })

  return {
    response: {
      source: "retrieval",
      verdict: "guidance",
      message:
        "I found an approved course pattern that is close to your question.",
      hints: [retrievedContext[0].body],
      steps: [],
      misconceptions: [],
      retrievedContext,
      usage: usageFor(sessionId, query),
    },
    state: nextState,
  }
}

function usageFor(sessionId: string, input: string) {
  return {
    estimatedTokens: estimateTokens(input),
    llmFallbacksRemaining: getLlmFallbacksRemaining(sessionId),
  }
}

function blockedResponse(
  message: string,
  sessionId: string,
  state: TutorSessionState,
): TutorResponse {
  return withProgress(
    {
      source: "blocked",
      verdict: "blocked",
      message,
      hints: [],
      steps: [],
      misconceptions: [],
      retrievedContext: [],
      usage: {
        estimatedTokens: 0,
        llmFallbacksRemaining: getLlmFallbacksRemaining(sessionId),
      },
    },
    state,
  )
}

function finalizeResponse(
  response: TutorResponse,
  request: TutorRequest,
  answer: string,
  sessionId: string,
  state: TutorSessionState,
) {
  recordTutorInteraction(
    sessionId,
    response.usage.estimatedTokens,
    response.source,
  )
  recordTutorAttemptSnapshot({
    answerPreview: answerPreviewFor(answer),
    estimatedTokens: response.usage.estimatedTokens,
    mode: request.mode,
    questionId: request.questionId,
    sessionId,
    source: response.source,
    state: state.state,
    topicId: request.topicId,
    verdict: response.verdict,
  })

  return response
}

function nextStateForAttempt(
  state: TutorSessionState,
  updates: Partial<TutorSessionState>,
): TutorSessionState {
  return {
    ...state,
    ...updates,
    attemptCount: state.attemptCount + 1,
  }
}

function withProgress(
  response: TutorResponse,
  state: TutorSessionState,
): TutorResponse {
  return {
    ...response,
    progress: tutorProgressFromState(state),
  }
}

function questionKeyForRequest(request: TutorRequest) {
  return request.questionId ?? `topic:${request.topicId ?? "freeform"}`
}

function answerPreviewFor(answer: string) {
  return answer.length > 0 ? answer.slice(0, 80) : undefined
}

function sameStringSet(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((item) => right.includes(item)) &&
    right.every((item) => left.includes(item))
  )
}
