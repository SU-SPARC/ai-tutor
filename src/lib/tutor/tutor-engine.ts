import "server-only"

import {
  estimateLlmTutorTokens,
  generateLlmTutorResponse,
  type LlmTutorDisclosure,
  type LlmTutorInput,
  type LlmTutorTask,
} from "@/lib/ai/llm-tutor"
import { getApprovedQuestionById } from "@/lib/data/data-store"
import { getServerEnv } from "@/lib/env/server"
import type { AnswerCheckResult } from "@/lib/tutor/answer-checker"
import { checkAnswer, normalizeAnswerText } from "@/lib/tutor/answer-checker"
import { detectMisconceptions } from "@/lib/tutor/misconceptions"
import {
  buildLlmGroundingContext,
  retrieveTutorContext,
} from "@/lib/tutor/retrieval"
import {
  getTutorSessionState,
  recordTutorAttemptSnapshot,
  saveTutorSessionState,
  tutorProgressFromState,
  type TutorSessionState,
} from "@/lib/tutor/tutor-state"
import {
  DEFAULT_USAGE_POLICY,
  canUseLlmFallback,
  estimateTokens,
  getLlmFallbacksRemaining,
  recordTutorInteraction,
} from "@/lib/tutor/usage"
import type {
  LlmGroundingContext,
  PracticeQuestion,
  RetrievalChunk,
  RetrievalMatch,
  TutorMode,
  TutorRequest,
  TutorResponse,
  TutorResponseLabel,
  TutorRetrievalResult,
} from "@/lib/types"

export type RuleTutorMode = TutorMode | "full_solution"

export type TutorDecisionInput = {
  allowFullSolution?: boolean
  allowLlmFallback?: boolean
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

type LlmTutorResultInput = {
  answer: string
  answerCheck?: AnswerCheckResult
  allowFullSolution?: boolean
  mode: RuleTutorMode
  question?: PracticeQuestion
  retrievalResult?: TutorRetrievalResult
  sessionId: string
  state: TutorSessionState
  stateUpdates?: Partial<TutorSessionState>
  task: LlmTutorTask
  topicId?: string
}

export type MisconceptionMatch = {
  correctiveHint?: string
  feedback: string
  id: string
}

const LOW_CONFIDENCE_THRESHOLD = 0.2
const MAX_LLM_GROUNDING_ITEMS = 3
const MAX_LLM_GROUNDING_CHARS_TOTAL = 1400
const GENERAL_AI_HELP_NOTE =
  "I'm using general AI help beyond approved course/demo content."

const probabilityStatisticsTerms = [
  "bayes",
  "bernoulli",
  "binomial",
  "chance",
  "combination",
  "conditional",
  "confidence interval",
  "distribution",
  "event",
  "expected",
  "expectation",
  "hypothesis",
  "independent",
  "likelihood",
  "mean",
  "median",
  "normal",
  "odds",
  "p-value",
  "percentile",
  "permutation",
  "poisson",
  "probability",
  "random variable",
  "regression",
  "sample space",
  "standard deviation",
  "statistics",
  "variance",
  "z-score",
]

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
      allowLlmFallback: request.allowLlmFallback,
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
  const retrievalResult = shouldRetrieve
    ? await retrieveTutorContext(`${request.topicId ?? ""} ${answer}`, {
        maxResults: MAX_LLM_GROUNDING_ITEMS,
        topicId: request.topicId,
      })
    : undefined

  if (hasRetrievedContext(retrievalResult)) {
    const result = buildRetrievalResponseFromResult(
      retrievalResult,
      answer,
      sessionId,
      state,
    )
    const nextState = saveTutorSessionState(result.state)
    return finalizeResponse(
      withProgress(result.response, nextState),
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
    const result = await buildLlmResponse({
      answer,
      mode: request.mode,
      retrievalResult,
      sessionId,
      state,
      task: request.mode === "hint" ? "hint" : "conceptual_explanation",
      topicId: request.topicId,
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
  allowLlmFallback,
  answer,
  mode,
  question,
  sessionId,
  state,
}: TutorDecisionInput): Promise<RuleResult> {
  if (mode === "hint") {
    if (question.hints.length === 0) {
      const retrieved = await buildRetrievalOrLlmResponse({
        allowLlmFallback,
        answer,
        mode,
        query: question.prompt,
        question,
        sessionId,
        state,
        task: "retrieval_explanation",
        topicId: question.topicId,
      })

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
        responseLabel: labelForQuestion(question),
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
      const retrieved = await buildRetrievalOrLlmResponse({
        allowFullSolution,
        allowLlmFallback,
        answer,
        mode,
        query: question.prompt,
        question,
        sessionId,
        state,
        task: "retrieval_explanation",
        topicId: question.topicId,
      })

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
        responseLabel: labelForQuestion(question),
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
        responseLabel: labelForQuestion(question),
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
        responseLabel: labelForQuestion(question),
        hints: [],
        steps: question.solutionSteps,
        misconceptions: [],
        retrievedContext: [],
        usage: usageFor(sessionId, answer),
      },
      state: nextState,
    }
  }

  if (
    allowLlmFallback &&
    !attemptCheck.misconception &&
    attemptCheck.answerCheck.confidence <= LOW_CONFIDENCE_THRESHOLD
  ) {
    const fingerprint = normalizeAnswerText(answer)
    const result = await buildRetrievalOrLlmResponse({
      allowLlmFallback,
      answer,
      answerCheck: attemptCheck.answerCheck,
      mode,
      query: `${question.prompt} ${answer}`,
      question,
      sessionId,
      state,
      stateUpdates: {
        lastAnswerFingerprint: fingerprint,
        lastMisconceptionIds: [],
        wrongAttemptCount: state.wrongAttemptCount + 1,
      },
      task: "low_confidence_answer_help",
      topicId: question.topicId,
    })

    if (result) {
      return result
    }
  }

  if (shouldEscalateToRetrieval({ answer, mode, question, state })) {
    const retrieved = await buildRetrievalOrLlmResponse({
      allowLlmFallback,
      answer,
      mode,
      query: `${question.prompt} ${answer}`,
      question,
      sessionId,
      state: {
        ...state,
        wrongAttemptCount: state.wrongAttemptCount + 1,
      },
      task: "retrieval_explanation",
      topicId: question.topicId,
    })

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
        responseLabel: labelForQuestion(question),
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
    input.allowLlmFallback && input.answer.trim().length > 0,
  )
}

function buildRetrievalResponseFromResult(
  retrievalResult: TutorRetrievalResult,
  query: string,
  sessionId: string,
  state: TutorSessionState,
): RuleResult {
  const retrievedContext = retrievalResult.retrievedContext
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
      responseLabel: labelForRetrievedContext(retrievedContext),
      hints: [retrievedContext[0].body],
      steps: [],
      misconceptions: [],
      retrievedContext,
      usage: usageFor(sessionId, query, {
        contextUsed: true,
      }),
    },
    state: nextState,
  }
}

async function buildRetrievalOrLlmResponse(input: {
  allowFullSolution?: boolean
  allowLlmFallback?: boolean
  answer: string
  answerCheck?: AnswerCheckResult
  mode: RuleTutorMode
  query: string
  question?: PracticeQuestion
  sessionId: string
  state: TutorSessionState
  stateUpdates?: Partial<TutorSessionState>
  task: LlmTutorTask
  topicId?: string
}) {
  const retrievalResult = await retrieveTutorContext(input.query, {
    maxResults: MAX_LLM_GROUNDING_ITEMS,
    topicId: input.topicId,
  })

  if (
    hasRetrievedContext(retrievalResult) &&
    isRetrievalTemplateEnough(input.task)
  ) {
    return buildRetrievalResponseFromResult(
      retrievalResult,
      input.query,
      input.sessionId,
      input.state,
    )
  }

  if (!input.allowLlmFallback) {
    return hasRetrievedContext(retrievalResult)
      ? buildRetrievalResponseFromResult(
          retrievalResult,
          input.query,
          input.sessionId,
          input.state,
        )
      : undefined
  }

  return buildLlmResponse({
    allowFullSolution: input.allowFullSolution,
    answer: input.answer,
    answerCheck: input.answerCheck,
    mode: input.mode,
    question: input.question,
    retrievalResult,
    sessionId: input.sessionId,
    state: input.state,
    stateUpdates: input.stateUpdates,
    task:
      hasRetrievedContext(retrievalResult) &&
      input.task !== "low_confidence_answer_help"
        ? "retrieval_explanation"
        : input.task,
    topicId: input.topicId,
  })
}

async function buildLlmResponse({
  allowFullSolution,
  answer,
  answerCheck,
  mode,
  question,
  retrievalResult,
  sessionId,
  state,
  stateUpdates,
  task,
  topicId,
}: LlmTutorResultInput): Promise<RuleResult> {
  const allowedDisclosure = allowedDisclosureFor(mode, state, allowFullSolution)
  const groundingContext = selectLlmGroundingContext(
    retrievalResult,
    allowedDisclosure,
  )
  const retrievedContext = retrievalResult?.retrievedContext ?? []

  if (
    !isProbabilityStatisticsRequest({
      answer,
      groundingContext,
      question,
      topicId,
    })
  ) {
    return blockedRuleResult(
      "LLM fallback is only available for probability and statistics tutoring.",
      sessionId,
      state,
      stateUpdates,
    )
  }

  if (!getServerEnv().OPENAI_API_KEY) {
    return blockedRuleResult(
      "LLM fallback is not configured. Approved rules and retrieval can still be used without it.",
      sessionId,
      state,
      stateUpdates,
    )
  }

  const promptInput: LlmTutorInput = {
    allowedDisclosure,
    answerCheck: answerCheck
      ? {
          confidence: answerCheck.confidence,
          feedback: answerCheck.feedback,
        }
      : undefined,
    mode: mode === "full_solution" ? "solution" : mode,
    sessionState: {
      hintsRevealed: state.hintsRevealed,
      solved: state.solved,
      stepsRevealed: state.stepsRevealed,
    },
    provenanceNote:
      groundingContext.length > 0
        ? "Use only the retrieved approved/demo context below. Do not claim professor approval."
        : GENERAL_AI_HELP_NOTE,
    currentQuestion: question
      ? {
          prompt: question.prompt,
          title: question.title,
        }
      : undefined,
    retrievedContext: groundingContext,
    studentMessage: answer,
    task,
    topicId: topicId ?? question?.topicId,
  }
  const estimatedTokens = estimateLlmTutorTokens(promptInput)
  const policy = canUseLlmFallback(
    sessionId,
    estimatedTokens.estimatedTotalTokens,
  )

  if (!policy.allowed) {
    return blockedRuleResult(policy.reason, sessionId, state, stateUpdates)
  }

  const generated = await generateLlmTutorResponse(promptInput)

  if (!generated.fallbackUsed) {
    if (hasRetrievedContext(retrievalResult)) {
      return buildRetrievalResponseFromResult(
        retrievalResult,
        answer,
        sessionId,
        state,
      )
    }

    return blockedRuleResult(
      "I could not use AI help for this request. Try an approved hint, or rephrase with the probability/statistics concept you are working on.",
      sessionId,
      state,
      stateUpdates,
    )
  }

  const nextState = nextStateForAttempt(state, {
    ...stateUpdates,
    llmUsed: true,
    retrievalUsed: state.retrievalUsed || retrievedContext.length > 0,
    state: "llm_guidance",
  })

  const message =
    groundingContext.length === 0 &&
    !generated.tutorMessage
      .toLowerCase()
      .includes("general ai help beyond approved course/demo content")
      ? `${GENERAL_AI_HELP_NOTE} ${generated.tutorMessage}`
      : generated.tutorMessage

  return {
    response: {
      source: "llm",
      verdict: "guidance",
      message,
      responseLabel:
        groundingContext.length > 0
          ? labelForGroundingContext(groundingContext)
          : "general_ai_help",
      hints: [],
      steps: [],
      misconceptions: [],
      retrievedContext,
      usage: {
        contextUsed: generated.contextUsed,
        estimatedTokens:
          generated.estimatedTokens?.estimatedTotalTokens ??
          estimatedTokens.estimatedTotalTokens,
        fallbackUsed: true,
        llmFallbacksRemaining: Math.max(
          0,
          getLlmFallbacksRemaining(sessionId) - 1,
        ),
      },
    },
    state: nextState,
  }
}

function blockedRuleResult(
  message: string,
  sessionId: string,
  state: TutorSessionState,
  stateUpdates?: Partial<TutorSessionState>,
): RuleResult {
  const nextState = nextStateForAttempt(state, {
    ...stateUpdates,
    state: "blocked",
  })

  return {
    response: blockedResponse(message, sessionId, nextState),
    state: nextState,
  }
}

function hasRetrievedContext(
  retrievalResult: TutorRetrievalResult | undefined,
): retrievalResult is TutorRetrievalResult {
  return Boolean(retrievalResult?.retrievedContext.length)
}

function isRetrievalTemplateEnough(task: LlmTutorTask) {
  return task !== "low_confidence_answer_help"
}

function allowedDisclosureFor(
  mode: RuleTutorMode,
  state: TutorSessionState,
  allowFullSolution?: boolean,
): LlmTutorDisclosure {
  if (state.solved || allowFullSolution) {
    return "full_solution_allowed"
  }

  if (mode === "solution" || mode === "full_solution") {
    return "next_step_only"
  }

  return "hint_only"
}

function selectLlmGroundingContext(
  retrievalResult: TutorRetrievalResult | undefined,
  allowedDisclosure: LlmTutorDisclosure,
) {
  const matches = retrievalResult?.matches ?? []
  const safeMatches =
    allowedDisclosure === "full_solution_allowed"
      ? matches
      : matches.filter(isNotSolutionChunk)

  return buildLlmGroundingContext(safeMatches, {
    maxItems: MAX_LLM_GROUNDING_ITEMS,
    maxTotalChars: MAX_LLM_GROUNDING_CHARS_TOTAL,
  })
}

function isNotSolutionChunk(match: RetrievalMatch) {
  return !["solution_step", "solution_summary"].includes(match.chunk.chunkType)
}

function isProbabilityStatisticsRequest(input: {
  answer: string
  groundingContext: LlmGroundingContext[]
  question?: PracticeQuestion
  topicId?: string
}) {
  if (input.question || input.topicId || input.groundingContext.length > 0) {
    return true
  }

  const normalized = input.answer.toLowerCase()
  return probabilityStatisticsTerms.some((term) => normalized.includes(term))
}

function labelForQuestion(question: PracticeQuestion): TutorResponseLabel {
  return isGeneratedApprovedSource(question.source)
    ? "generated_approved_content"
    : "approved_course_content"
}

function labelForRetrievedContext(
  retrievedContext: RetrievalChunk[],
): TutorResponseLabel {
  if (retrievedContext.some(isPrivateReferenceChunk)) {
    return "private_reference_grounded_explanation"
  }

  if (retrievedContext.some(isGeneratedApprovedChunk)) {
    return "generated_approved_content"
  }

  return "approved_course_content"
}

function labelForGroundingContext(
  groundingContext: LlmGroundingContext[],
): TutorResponseLabel {
  if (groundingContext.some((context) => context.priorityTier === "private_reference")) {
    return "private_reference_grounded_explanation"
  }

  if (
    groundingContext.some(
      (context) =>
        context.priorityTier === "approved_generated" ||
        context.sourceType === "generated_original" ||
        context.sourceType === "pattern_derived_original",
    )
  ) {
    return "generated_approved_content"
  }

  return "approved_course_content"
}

function isPrivateReferenceChunk(chunk: RetrievalChunk) {
  return (
    chunk.priorityTier === "private_reference" ||
    chunk.source.visibility === "private" ||
    chunk.source.trustLevel === "private_reference" ||
    chunk.source.sourceType === "private_reference_pattern"
  )
}

function isGeneratedApprovedChunk(chunk: RetrievalChunk) {
  return (
    chunk.priorityTier === "approved_generated" ||
    isGeneratedApprovedSource(chunk.source)
  )
}

function isGeneratedApprovedSource(source: RetrievalChunk["source"]) {
  return (
    source.trustLevel === "professor_approved" &&
    (source.sourceType === "generated_original" ||
      source.sourceType === "pattern_derived_original")
  )
}

function usageFor(
  sessionId: string,
  input: string,
  metadata: {
    contextUsed?: boolean
    fallbackUsed?: boolean
  } = {},
) {
  return {
    contextUsed: Boolean(metadata.contextUsed),
    estimatedTokens: estimateTokens(input),
    fallbackUsed: Boolean(metadata.fallbackUsed),
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
        contextUsed: false,
        estimatedTokens: 0,
        fallbackUsed: false,
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
    contextUsed: response.usage.contextUsed,
    estimatedTokens: response.usage.estimatedTokens,
    fallbackUsed: response.usage.fallbackUsed,
    mode: request.mode,
    questionId: request.questionId,
    responseLabel: response.responseLabel,
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
