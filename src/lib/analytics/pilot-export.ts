export const PILOT_ANALYTICS_EXPORT_SCHEMA_VERSION = 2 as const;

export type PilotAnalyticsCount = {
  count: number;
  key: string;
};

export type PilotAnalyticsPerformance = {
  answerAttempts: number;
  correctAnswerAttempts: number;
  correctnessRate: number | null;
  incorrectAnswerAttempts: number;
  unscoredAnswerAttempts: number;
};

export type PilotAnalyticsTutorPath = {
  blockedInteractions: number;
  deterministicInteractions: number;
  llmAssistanceInteractions: number;
  llmCacheInteractions: number;
  llmProviderInteractions: number;
  retrievalInteractions: number;
  totalInteractions: number;
};

export type PilotAnalyticsActivity = PilotAnalyticsPerformance &
  PilotAnalyticsTutorPath & {
    hintsUsed: number;
    questionsAttempted: number;
    sessions: number;
    solutionStepsRevealed: number;
  };

export type PilotAnalyticsExport = {
  schemaVersion: typeof PILOT_ANALYTICS_EXPORT_SCHEMA_VERSION;
  exportType: "pilot_analytics";
  generatedAt: string;
  mode: "database" | "demo";
  privacy: {
    directIdentifiersIncluded: false;
    participantIdentifier: "pseudonymous_sha256";
    privateRetrievalContentIncluded: false;
    rawStudentTextIncluded: false;
  };
  metricDefinitions: {
    feedback: string;
    performance: string;
    researchOutcomes: {
      included: false;
      statement: string;
    };
    usage: string;
  };
  dataCoverage: {
    earliestDate: string | null;
    latestDate: string | null;
  };
  cohort: PilotAnalyticsActivity & {
    participatingStudents: number;
  };
  tutorUsage: PilotAnalyticsTutorPath;
  aiUsage: {
    cacheHits: number;
    estimatedRequestTokens: number;
    estimatedTokenPortion: number;
    generationRequests: number;
    inputTokens: number;
    limitBlocks: number;
    outputTokens: number;
    providerCalls: number;
    successfulFallbacks: number;
    totalTokens: number;
  };
  participants: Array<
    PilotAnalyticsActivity & {
      participantId: string;
    }
  >;
  topics: Array<
    PilotAnalyticsActivity & {
      participatingStudents: number;
      topicId: string;
      topicTitle: string;
    }
  >;
  questions: Array<
    PilotAnalyticsActivity & {
      participatingStudents: number;
      questionId: string;
      questionVersionsAttempted: number;
      topicId: string;
    }
  >;
  misconceptions: Array<{
    misconceptionCode: string;
    sessionOccurrences: number;
  }>;
  feedback: {
    byCategory: PilotAnalyticsCount[];
    byStatus: PilotAnalyticsCount[];
    totalReports: number;
  };
  limitations: string[];
};

const RESEARCH_OUTCOME_STATEMENT =
  "This export contains usage, observed answer performance, and feedback counts. It does not measure or establish learning improvement, causal impact, mastery, or other research outcomes.";

export function emptyPilotAnalyticsExport(
  generatedAt = new Date().toISOString(),
): PilotAnalyticsExport {
  const tutorUsage = emptyTutorPath();
  return {
    schemaVersion: PILOT_ANALYTICS_EXPORT_SCHEMA_VERSION,
    exportType: "pilot_analytics",
    generatedAt,
    mode: "demo",
    privacy: {
      directIdentifiersIncluded: false,
      participantIdentifier: "pseudonymous_sha256",
      privateRetrievalContentIncluded: false,
      rawStudentTextIncluded: false,
    },
    metricDefinitions: pilotAnalyticsMetricDefinitions(),
    dataCoverage: { earliestDate: null, latestDate: null },
    cohort: {
      ...emptyActivity(),
      participatingStudents: 0,
    },
    tutorUsage,
    aiUsage: {
      cacheHits: 0,
      estimatedRequestTokens: 0,
      estimatedTokenPortion: 0,
      generationRequests: 0,
      inputTokens: 0,
      limitBlocks: 0,
      outputTokens: 0,
      providerCalls: 0,
      successfulFallbacks: 0,
      totalTokens: 0,
    },
    participants: [],
    topics: [],
    questions: [],
    misconceptions: [],
    feedback: { byCategory: [], byStatus: [], totalReports: 0 },
    limitations: pilotAnalyticsLimitations(),
  };
}

export function pilotAnalyticsMetricDefinitions(): PilotAnalyticsExport["metricDefinitions"] {
  return {
    feedback:
      "Counts of submitted question reports by workflow category and status; report text and resolution notes are excluded.",
    performance:
      "Observed answer-check results from published-practice sessions owned by anonymous participants or authenticated accounts without a current effective professor role. These descriptive counts are not measures of mastery or learning gain.",
    researchOutcomes: {
      included: false,
      statement: RESEARCH_OUTCOME_STATEMENT,
    },
    usage:
      "A practice session has at least one persisted tutoring interaction or durable answer, hint, solution-step, or completion evidence. Opening or resuming a question alone does not count. Participation, session, tutoring-path, hint, and solution-reveal counts exclude sessions owned by authenticated accounts with a current effective professor role. AI accounting is reported separately.",
  };
}

export function pilotAnalyticsLimitations() {
  return [
    "Participant identifiers are stable pseudonyms, not anonymous identifiers; access to exports must remain restricted.",
    "Correctness uses scored answer checks (correct + incorrect) as the denominator. Unreadable guidance and blocked checks remain unscored activity.",
    "Authenticated session activity is excluded when the owner's current database role projection has an effective professor grant; historical role-at-session-time is not stored.",
    "Recorded blocked requests count as interaction, not successful help or learning. Legacy counters and completion can establish practice without retained interaction rows.",
    "Anonymous sessions remain included because anonymous owners have no authoritative role membership.",
    "Global AI accounting and feedback workflow counts are not session-owner populations and are not role-filtered.",
    "Misconception frequency counts the latest retained misconception codes per session, not every historical occurrence.",
    "AI token values can include estimates when the provider did not return usage; estimatedTokenPortion identifies that amount.",
  ];
}

export function correctnessRate(correct: number, attempts: number) {
  return attempts > 0 ? correct / attempts : null;
}

function emptyPerformance(): PilotAnalyticsPerformance {
  return {
    answerAttempts: 0,
    correctAnswerAttempts: 0,
    correctnessRate: null,
    incorrectAnswerAttempts: 0,
    unscoredAnswerAttempts: 0,
  };
}

function emptyTutorPath(): PilotAnalyticsTutorPath {
  return {
    blockedInteractions: 0,
    deterministicInteractions: 0,
    llmAssistanceInteractions: 0,
    llmCacheInteractions: 0,
    llmProviderInteractions: 0,
    retrievalInteractions: 0,
    totalInteractions: 0,
  };
}

function emptyActivity(): PilotAnalyticsActivity {
  return {
    ...emptyPerformance(),
    ...emptyTutorPath(),
    hintsUsed: 0,
    questionsAttempted: 0,
    sessions: 0,
    solutionStepsRevealed: 0,
  };
}
