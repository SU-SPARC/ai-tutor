import { describe, expect, it } from "vitest";

import { lifecycleApiErrorResponse } from "@/lib/api/question-lifecycle";
import { QuestionPublicationBlockedError } from "@/lib/tutor/question-lifecycle";

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
});
