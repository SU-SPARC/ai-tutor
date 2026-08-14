import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GET as exportProfessorContent,
  POST as importProfessorContent,
} from "@/app/api/professor/content-transfer/route";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
  TEST_STUDENT,
} from "./auth-test-helpers";
import { validDocument, validQuestion } from "./content-transfer-test-helpers";

describe("professor content-transfer API", () => {
  beforeEach(() => {
    mockPrincipal(TEST_PROFESSOR);
    vi.stubEnv("APP_DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(() => {
    resetAuthMocks();
    vi.unstubAllEnvs();
  });

  it("requires a professor for imports and exports", async () => {
    mockPrincipal(undefined);
    const anonymousImport = await importProfessorContent(
      request({ document: validDocument(), mode: "dry_run" }),
    );
    const anonymousExport = await exportProfessorContent(
      new Request("http://test/api/professor/content-transfer"),
    );

    mockPrincipal(TEST_STUDENT);
    const studentImport = await importProfessorContent(
      request({ document: validDocument(), mode: "dry_run" }),
    );
    const studentExport = await exportProfessorContent(
      new Request("http://test/api/professor/content-transfer"),
    );

    expect(anonymousImport.status).toBe(401);
    expect(anonymousExport.status).toBe(401);
    expect(studentImport.status).toBe(403);
    expect(studentExport.status).toBe(403);
  });

  it("returns a read-only row preview for a valid file in demo mode", async () => {
    const response = await importProfessorContent(
      request({ document: validDocument(), mode: "dry_run" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.preview).toMatchObject({
      canApply: false,
      rootErrors: [],
      storageChecked: false,
      summary: { invalid: 0, ready: 1, total: 1 },
    });
  });

  it("rejects malformed requests and never echoes malicious source text", async () => {
    const malformedJson = await importProfessorContent(
      new Request("http://test/api/professor/content-transfer", {
        body: "{not-json",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const maliciousDocument = validDocument({
      questions: [
        validQuestion({
          prompt: "Copied from textbook page 812: SECRET-SOURCE-PHRASE.",
        }),
      ],
    });
    const maliciousPreview = await importProfessorContent(
      request({ document: maliciousDocument, mode: "dry_run" }),
    );
    const maliciousText = await maliciousPreview.text();

    expect(malformedJson.status).toBe(400);
    expect(maliciousPreview.status).toBe(200);
    expect(maliciousText).toMatch(/private-source or copied-textbook/i);
    expect(maliciousText).not.toContain("SECRET-SOURCE-PHRASE");
  });

  it("requires explicit confirmation and production storage before applying", async () => {
    const missingConfirmation = await importProfessorContent(
      request({ document: validDocument(), mode: "apply" }),
    );
    const readOnly = await importProfessorContent(
      request({
        confirmation: "IMPORT",
        document: validDocument(),
        mode: "apply",
      }),
    );

    expect(missingConfirmation.status).toBe(422);
    expect(readOnly.status).toBe(503);
  });

  it("exports sanitized question content without lifecycle or identity data", async () => {
    const response = await exportProfessorContent(
      new Request("http://test/api/professor/content-transfer?scope=approved"),
    );
    const text = await response.text();
    const payload = JSON.parse(text);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(
      "question-content-approved.json",
    );
    expect(payload.questions.length).toBeGreaterThan(0);
    expect(text).not.toMatch(
      /"events"|"createdBy"|"generationMetadata"|"studentId"|"userId"|"source"/,
    );
  });
});

function request(body: unknown) {
  return new Request("http://test/api/professor/content-transfer", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "content-transfer-test",
    },
    method: "POST",
  });
}
