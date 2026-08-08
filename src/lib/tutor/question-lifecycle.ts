import type {
  QuestionLifecycleAction,
  QuestionRecordState,
  QuestionRevisionMethod,
  QuestionVersionState,
} from "@/lib/types";

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

export class QuestionLifecycleNotFoundError extends Error {
  constructor(message = "Question lifecycle record was not found.") {
    super(message);
    this.name = "QuestionLifecycleNotFoundError";
  }
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
