import type {
  QuestionLifecycleAction,
  QuestionPublicationBlocker,
  QuestionRecordState,
  QuestionRevisionMethod,
  QuestionVersionState,
} from "@/lib/types";
import { professorReviewReasonRequiresNote } from "@/lib/tutor/professor-review-reasons";

export class QuestionLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionLifecycleConflictError";
  }
}

export class QuestionLifecycleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionLifecycleValidationError";
  }
}

export class QuestionPublicationBlockedError extends QuestionLifecycleValidationError {
  readonly reasons: QuestionPublicationBlocker[];

  constructor(reasons: QuestionPublicationBlocker[]) {
    super(
      `Publication blocked: ${reasons
        .map((reason) => reason.message)
        .join(" ")}`,
    );
    this.name = "QuestionPublicationBlockedError";
    this.reasons = reasons;
  }
}

export class QuestionLifecycleNotFoundError extends Error {
  constructor(message = "Question lifecycle record was not found.") {
    super(message);
    this.name = "QuestionLifecycleNotFoundError";
  }
}

/**
 * The database refused or could not complete a lifecycle write for a reason
 * that is not the professor's to fix: a missing runtime permission, a
 * timeout, or an unavailable server. The message says that nothing changed
 * and what to do next; the SQLSTATE is kept for the operator without any
 * driver text.
 */
export class QuestionLifecycleStorageError extends Error {
  readonly sqlState?: string;

  constructor(message: string, sqlState?: string) {
    super(message);
    this.name = "QuestionLifecycleStorageError";
    this.sqlState = sqlState;
  }
}

const DATABASE_RAISED_VALIDATION =
  /publication blocked|requires a reason|valid question/i;

/**
 * Turns a classified database failure from a lifecycle transition into the
 * error the professor should see. A `raise exception` authored by our own
 * database functions keeps its wording; everything else becomes an actionable
 * storage error instead of the bare "could not be completed" text.
 */
export function lifecycleErrorFromDatabaseFailure(failure: {
  message: string;
  reason?: string;
  sqlState?: string;
}): Error {
  if (failure.reason) {
    return DATABASE_RAISED_VALIDATION.test(failure.reason)
      ? new QuestionLifecycleValidationError(failure.reason)
      : new QuestionLifecycleConflictError(failure.reason);
  }
  const code = failure.sqlState ? ` (database error ${failure.sqlState})` : "";
  if (failure.sqlState === "42501") {
    return new QuestionLifecycleStorageError(
      `Publishing is blocked by a database permission problem, not by this question${code}. Nothing was changed. Ask the site operator to restore the application's database permissions, then try again.`,
      failure.sqlState,
    );
  }
  return new QuestionLifecycleStorageError(
    `${failure.message} Nothing was changed${code}. Try again in a moment; if it keeps failing, contact the site operator.`,
    failure.sqlState,
  );
}

const VERSION_TRANSITIONS: Readonly<
  Partial<Record<QuestionLifecycleAction, readonly QuestionVersionState[]>>
> = {
  approve: ["needs_review"],
  publish: ["approved", "unpublished"],
  reject: ["needs_review", "approved", "unpublished"],
  request_revision: ["needs_review", "approved", "unpublished"],
  rollback: ["unpublished"],
  submit: ["draft"],
  unpublish: ["published"],
};

const REQUIRED_REASON_ACTIONS = new Set<QuestionLifecycleAction>([
  "archive",
  "reject",
  "request_revision",
  "rollback",
  "unpublish",
]);

export function allowedQuestionLifecycleActions(input: {
  hasPublishedVersion: boolean;
  recordState: QuestionRecordState;
  versionState: QuestionVersionState;
}): QuestionLifecycleAction[] {
  if (input.recordState === "archived") {
    return ["restore"];
  }

  const actions = Object.entries(VERSION_TRANSITIONS).flatMap(
    ([action, states]) =>
      states?.includes(input.versionState)
        ? [action as QuestionLifecycleAction]
        : [],
  );

  if (!input.hasPublishedVersion) {
    actions.push("archive");
  }

  return actions;
}

export function assertQuestionLifecycleTransition(input: {
  action: QuestionLifecycleAction;
  hasPublishedVersion: boolean;
  note?: string;
  reasonCode?: string;
  recordState: QuestionRecordState;
  revisionMethod?: QuestionRevisionMethod;
  versionState: QuestionVersionState;
}) {
  const allowed = allowedQuestionLifecycleActions(input);
  if (!allowed.includes(input.action)) {
    throw new QuestionLifecycleConflictError(
      `Cannot ${input.action} a ${input.recordState} question version in ${input.versionState} state.`,
    );
  }

  if (REQUIRED_REASON_ACTIONS.has(input.action) && !input.reasonCode?.trim()) {
    throw new QuestionLifecycleValidationError(
      `${input.action} requires a reason code.`,
    );
  }

  if (
    REQUIRED_REASON_ACTIONS.has(input.action) &&
    professorReviewReasonRequiresNote(input.reasonCode) &&
    !input.note?.trim()
  ) {
    throw new QuestionLifecycleValidationError("Other requires an audit note.");
  }

  if (input.action === "request_revision" && !input.revisionMethod) {
    throw new QuestionLifecycleValidationError(
      "request_revision requires a manual or regeneration revision method.",
    );
  }
}

export function stateAfterQuestionLifecycleAction(
  state: QuestionVersionState,
  action: QuestionLifecycleAction,
): QuestionVersionState {
  switch (action) {
    case "submit":
      return "needs_review";
    case "request_revision":
      return "revision_requested";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "publish":
    case "rollback":
      return "published";
    case "unpublish":
      return "unpublished";
    case "archive":
    case "restore":
      return state;
  }
}

export function lifecycleActionRequiresReason(action: QuestionLifecycleAction) {
  return REQUIRED_REASON_ACTIONS.has(action);
}

const LIFECYCLE_DOMAIN_ERROR_NAMES = new Set([
  "QuestionLifecycleConflictError",
  "QuestionLifecycleNotFoundError",
  "QuestionLifecycleStorageError",
  "QuestionLifecycleValidationError",
  "QuestionPublicationBlockedError",
]);

/**
 * Domain and validation failures (including publication quality-gate blockers)
 * must stay distinguishable from infrastructure failures so callers never
 * report a rejected transition as unavailable storage.
 */
export function isQuestionLifecycleDomainError(error: unknown): boolean {
  return (
    error instanceof QuestionLifecycleConflictError ||
    error instanceof QuestionLifecycleNotFoundError ||
    error instanceof QuestionLifecycleStorageError ||
    error instanceof QuestionLifecycleValidationError ||
    (error instanceof Error && LIFECYCLE_DOMAIN_ERROR_NAMES.has(error.name))
  );
}
