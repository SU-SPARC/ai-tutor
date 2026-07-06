import "server-only"

import type {
  TutorMode,
  TutorProgress,
  TutorSource,
  TutorState,
  TutorVerdict,
} from "@/lib/types"

export type TutorSessionState = TutorProgress & {
  lastAnswerFingerprint?: string
  lastMisconceptionIds: string[]
  questionKey: string
  sessionId: string
}

export type TutorAttemptSnapshot = {
  answerPreview?: string
  createdAt: string
  estimatedTokens: number
  mode: TutorMode
  questionId?: string
  sessionId: string
  source: TutorSource
  state: TutorState
  topicId?: string
  verdict: TutorVerdict
}

const sessionStates = new Map<string, TutorSessionState>()
const attemptSnapshots: TutorAttemptSnapshot[] = []

export function getTutorSessionState(sessionId: string, questionKey: string) {
  const key = stateKey(sessionId, questionKey)
  const existing = sessionStates.get(key)

  if (existing) {
    return cloneState(existing)
  }

  const created = createInitialState(sessionId, questionKey)
  sessionStates.set(key, created)
  return cloneState(created)
}

export function saveTutorSessionState(state: TutorSessionState) {
  sessionStates.set(
    stateKey(state.sessionId, state.questionKey),
    cloneState(state),
  )
  return cloneState(state)
}

export function recordTutorAttemptSnapshot(
  attempt: Omit<TutorAttemptSnapshot, "createdAt">,
) {
  attemptSnapshots.push({
    ...attempt,
    answerPreview: attempt.answerPreview?.slice(0, 80),
    createdAt: new Date().toISOString(),
  })
}

export function tutorProgressFromState(state: TutorSessionState): TutorProgress {
  return {
    attemptCount: state.attemptCount,
    hintsRevealed: state.hintsRevealed,
    llmUsed: state.llmUsed,
    retrievalUsed: state.retrievalUsed,
    solved: state.solved,
    state: state.state,
    stepsRevealed: state.stepsRevealed,
    wrongAttemptCount: state.wrongAttemptCount,
  }
}

export function getTutorAttemptSnapshotsForTests() {
  return attemptSnapshots.map((attempt) => ({ ...attempt }))
}

export function resetTutorStateForTests() {
  sessionStates.clear()
  attemptSnapshots.length = 0
}

function createInitialState(
  sessionId: string,
  questionKey: string,
): TutorSessionState {
  return {
    attemptCount: 0,
    hintsRevealed: 0,
    lastMisconceptionIds: [],
    llmUsed: false,
    questionKey,
    retrievalUsed: false,
    sessionId,
    solved: false,
    state: "working",
    stepsRevealed: 0,
    wrongAttemptCount: 0,
  }
}

function stateKey(sessionId: string, questionKey: string) {
  return `${sessionId}:${questionKey}`
}

function cloneState(state: TutorSessionState): TutorSessionState {
  return {
    ...state,
    lastMisconceptionIds: [...state.lastMisconceptionIds],
  }
}
