import "server-only";

import { randomUUID } from "node:crypto";

import { DataServiceUnavailableError } from "@/lib/data/service-error";
import { DatabaseOperationError } from "@/lib/data/postgres";

export type PilotOperationalEvent =
  | "authentication_unavailable"
  | "data_service_unavailable"
  | "llm_provider_unavailable"
  | "malformed_request"
  | "rate_limit_reached"
  | "retrieval_unavailable"
  | "session_stale"
  | "session_unavailable";

export type PilotOperationalSubsystem =
  | "ai-provider"
  | "authentication"
  | "content"
  | "question-feedback"
  | "retrieval"
  | "tutor-session"
  | "unknown";

type PilotOperationalLogInput = {
  cause?: unknown;
  event: PilotOperationalEvent;
  requestId: string;
  route: string;
  status: number;
  subsystem?: PilotOperationalSubsystem;
};

export type PilotOperationalDiagnostic = {
  databaseCategory?: string;
  errorClass: "data_service" | "database" | "unexpected";
  event: PilotOperationalEvent;
  level: "error" | "warn";
  requestId: string;
  retryable?: boolean;
  route: string;
  status: number;
  subsystem: PilotOperationalSubsystem;
  timestamp: string;
};

type PilotObservabilityGlobal = typeof globalThis & {
  __pilotOperationalDiagnostics?: PilotOperationalDiagnostic[];
};

const MAX_RECENT_DIAGNOSTICS = 100;
const observabilityGlobal = globalThis as PilotObservabilityGlobal;
const recentDiagnostics =
  observabilityGlobal.__pilotOperationalDiagnostics ?? [];
observabilityGlobal.__pilotOperationalDiagnostics = recentDiagnostics;

export function pilotRequestId(request?: Request) {
  // Always generate correlation values server-side. Untrusted request headers
  // can therefore never inject answers, identifiers, or credentials into logs.
  void request;
  return `pilot-${randomUUID()}`;
}

/**
 * Emits a bounded, privacy-safe operational record. Causes are classified,
 * never serialized: no stack, SQL, request body, student identity, retrieval
 * context, provider response, URL, or secret can enter this log record.
 */
export function logPilotOperationalEvent(input: PilotOperationalLogInput) {
  const failure = classifyOperationalCause(input.cause);
  const record: PilotOperationalDiagnostic = {
    databaseCategory: failure.databaseCategory,
    errorClass: failure.errorClass,
    event: input.event,
    level: input.status >= 500 ? "error" : "warn",
    requestId: input.requestId,
    retryable: failure.retryable,
    route: input.route,
    status: input.status,
    subsystem: input.subsystem ?? failure.subsystem ?? "unknown",
    timestamp: new Date().toISOString(),
  };
  recentDiagnostics.push(record);
  if (recentDiagnostics.length > MAX_RECENT_DIAGNOSTICS) {
    recentDiagnostics.splice(
      0,
      recentDiagnostics.length - MAX_RECENT_DIAGNOSTICS,
    );
  }

  if (process.env.LOG_LEVEL === "silent") {
    return;
  }

  const serialized = JSON.stringify(record);

  if (input.status >= 500) {
    console.error(serialized);
  } else {
    console.warn(serialized);
  }
}

export function listPilotOperationalDiagnostics() {
  return recentDiagnostics
    .slice(-MAX_RECENT_DIAGNOSTICS)
    .reverse()
    .map((record) => ({ ...record }));
}

export function resetPilotOperationalDiagnosticsForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Operational diagnostics can only be reset in tests.");
  }

  recentDiagnostics.length = 0;
}

function classifyOperationalCause(cause: unknown): {
  databaseCategory?: string;
  errorClass: "data_service" | "database" | "unexpected";
  retryable?: boolean;
  subsystem?: PilotOperationalSubsystem;
} {
  if (cause instanceof DataServiceUnavailableError) {
    return {
      databaseCategory: cause.databaseCategory,
      errorClass: "data_service",
      retryable: cause.retryable,
      subsystem: cause.subsystem,
    };
  }

  if (cause instanceof DatabaseOperationError) {
    return {
      databaseCategory: cause.category,
      errorClass: "database",
      retryable: cause.retryable,
    };
  }

  return { errorClass: "unexpected" };
}
