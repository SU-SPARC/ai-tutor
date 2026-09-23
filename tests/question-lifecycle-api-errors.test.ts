import { describe, expect, it } from "vitest";

import { lifecycleApiErrorResponse } from "@/lib/api/question-lifecycle";
import {
  QuestionLifecycleConflictError,
  QuestionLifecycleStorageError,
  QuestionPublicationBlockedError,
  lifecycleErrorFromDatabaseFailure,
} from "@/lib/tutor/question-lifecycle";

describe("question lifecycle API errors", () => {
  it("returns clear structured publication blocker reasons", async () => {
    const response = lifecycleApiErrorResponse(
      new QuestionPublicationBlockedError([
        {
          code: "missing_required_hint",
          message: "At least one useful hint is required before publication.",
        },
        {
          code: "professor_approval_missing",
          message: "Professor approval is required before publication.",
        },
      ]),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(/publication blocked/i),
      reasons: [
        {
          code: "missing_required_hint",
          message: "At least one useful hint is required before publication.",
        },
        {
          code: "professor_approval_missing",
          message: "Professor approval is required before publication.",
        },
      ],
    });
  });

  it("returns an actionable storage failure instead of the bare database text", async () => {
    const response = lifecycleApiErrorResponse(
      lifecycleErrorFromDatabaseFailure({
        message: "The database operation could not be completed.",
        sqlState: "42501",
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: expect.stringMatching(
        /database permission problem, not by this question[\s\S]*Nothing was changed[\s\S]*site operator/,
      ),
      sqlState: "42501",
    });
  });

  it("keeps database-raised lifecycle wording and classifies the rest as storage failures", () => {
    const blocked = lifecycleErrorFromDatabaseFailure({
      message: "The database operation could not be completed.",
      reason:
        "Publication blocked: An immutable professor approval for this exact version is required.",
      sqlState: "P0001",
    });
    expect(blocked.name).toBe("QuestionLifecycleValidationError");
    expect(blocked.message).toMatch(/professor approval/);

    const stale = lifecycleErrorFromDatabaseFailure({
      message: "The database operation could not be completed.",
      reason:
        "Stale question lifecycle state: expected approved, found published",
      sqlState: "P0001",
    });
    expect(stale.name).toBe("QuestionLifecycleConflictError");
    expect(stale.message).toMatch(/Stale question lifecycle state/);

    const unknown = lifecycleErrorFromDatabaseFailure({
      message: "The database operation timed out.",
      sqlState: "57014",
    });
    expect(unknown).toBeInstanceOf(QuestionLifecycleStorageError);
    expect(unknown.message).toBe(
      "The database operation timed out. Nothing was changed (database error 57014). Try again in a moment; if it keeps failing, contact the site operator.",
    );
    expect(unknown.message).not.toMatch(/permission denied|pg_|aclcheck/);
  });

  it("returns lifecycle conflicts without converting them to service errors", async () => {
    const response = lifecycleApiErrorResponse(
      new QuestionLifecycleConflictError(
        "Remove Save for later before changing the working version.",
      ),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Remove Save for later before changing the working version.",
    });
  });
});
