import { describe, expect, it } from "vitest";

import {
  allowedQuestionLifecycleActions,
  assertQuestionLifecycleTransition,
  QuestionLifecycleConflictError,
  QuestionLifecycleValidationError,
  stateAfterQuestionLifecycleAction,
} from "@/lib/tutor/question-lifecycle";
import type {
  QuestionLifecycleAction,
  QuestionVersionState,
} from "@/lib/types";

describe("question lifecycle policy", () => {
  it.each<
    [QuestionVersionState, QuestionLifecycleAction, QuestionVersionState]
  >([
    ["draft", "submit", "needs_review"],
    ["needs_review", "request_revision", "revision_requested"],
    ["needs_review", "approve", "approved"],
    ["needs_review", "reject", "rejected"],
    ["approved", "publish", "published"],
    ["approved", "request_revision", "revision_requested"],
    ["published", "unpublish", "unpublished"],
    ["unpublished", "publish", "published"],
    ["unpublished", "rollback", "published"],
    ["unpublished", "reject", "rejected"],
  ])("permits %s --%s--> %s", (from, action, to) => {
    expect(() =>
      assertQuestionLifecycleTransition({
        action,
        hasPublishedVersion: from === "published",
        reasonCode: [
          "request_revision",
          "reject",
          "unpublish",
          "rollback",
        ].includes(action)
          ? "test_reason"
          : undefined,
        recordState: "active",
        revisionMethod: action === "request_revision" ? "manual" : undefined,
        versionState: from,
      }),
    ).not.toThrow();
    expect(stateAfterQuestionLifecycleAction(from, action)).toBe(to);
  });

  it("rejects unsupported transitions and missing reasons", () => {
    expect(() =>
      assertQuestionLifecycleTransition({
        action: "publish",
        hasPublishedVersion: false,
        recordState: "active",
        versionState: "draft",
      }),
    ).toThrow(QuestionLifecycleConflictError);

    expect(() =>
      assertQuestionLifecycleTransition({
        action: "unpublish",
        hasPublishedVersion: true,
        recordState: "active",
        versionState: "published",
      }),
    ).toThrow(QuestionLifecycleValidationError);

    expect(() =>
      assertQuestionLifecycleTransition({
        action: "request_revision",
        hasPublishedVersion: false,
        reasonCode: "content_correction",
        recordState: "active",
        versionState: "needs_review",
      }),
    ).toThrow(/revision method/i);
  });

  it("makes archive conditional on having no publication and restore exclusive to archives", () => {
    expect(
      allowedQuestionLifecycleActions({
        hasPublishedVersion: false,
        recordState: "active",
        versionState: "approved",
      }),
    ).toContain("archive");
    expect(
      allowedQuestionLifecycleActions({
        hasPublishedVersion: true,
        recordState: "active",
        versionState: "published",
      }),
    ).not.toContain("archive");
    expect(
      allowedQuestionLifecycleActions({
        hasPublishedVersion: false,
        recordState: "archived",
        versionState: "unpublished",
      }),
    ).toEqual(["restore"]);
  });
});
