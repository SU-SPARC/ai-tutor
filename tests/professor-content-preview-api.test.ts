import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as uploadProfessorContent } from "@/app/api/professor/content-preview/route";
import {
  PROFESSOR_CONTENT_UPLOAD_MAX_BYTES,
  type ProfessorContentUploadPreview,
} from "@/lib/tutor/professor-content-upload";
import {
  mockPrincipal,
  resetAuthMocks,
  TEST_PROFESSOR,
} from "./auth-test-helpers";

const TOKEN = "admin-secret";
const privatePreviewDir = path.join(
  process.cwd(),
  "data/private/extracted/professor-upload-previews",
);

describe("professor content preview API", () => {
  beforeEach(() => {
    mockPrincipal(TEST_PROFESSOR);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetAuthMocks();
    await rm(privatePreviewDir, { force: true, recursive: true });
  });

  it("requires the professor role", async () => {
    mockPrincipal(undefined);
    const response = await uploadProfessorContent(
      uploadRequest(texFile(), { token: "" }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects unsupported file types and oversized files", async () => {
    const unsupported = await uploadProfessorContent(
      uploadRequest(
        new File(["{}"], "notes.json", { type: "application/json" }),
      ),
    );
    const oversized = await uploadProfessorContent(
      uploadRequest(
        new File(
          [new Uint8Array(PROFESSOR_CONTENT_UPLOAD_MAX_BYTES + 1)],
          "large.tex",
          {
            type: "text/x-tex",
          },
        ),
      ),
    );

    expect(unsupported.status).toBe(400);
    expect(oversized.status).toBe(413);
  });

  it("parses LaTeX uploads into a needs-review metadata preview", async () => {
    const response = await uploadProfessorContent(uploadRequest(texFile()));
    const payload = (await response.json()) as {
      preview: ProfessorContentUploadPreview;
    } & Record<string, unknown>;
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      imported: false,
      reviewStatus: "needs_review",
      preview: {
        approved: false,
        reviewStatus: "needs_review",
        uploadKind: "tex",
      },
    });
    expect(serialized).toContain("Conditional Probability");
    expect(serialized).toContain('"topicId":"conditional-probability"');
    expect(payload.preview.formulas[0]?.symbolicFormula).toContain(
      "P(A\\mid B)",
    );
    expect(serialized).not.toContain("copied question");
    expect(serialized).not.toMatch(/acceptedAnswers|solutionSteps|rawText/i);
  });

  it("extracts PDF text only to ignored private storage and returns abstract preview", async () => {
    const response = await uploadProfessorContent(uploadRequest(pdfFile()));
    const payload = (await response.json()) as {
      preview: ProfessorContentUploadPreview;
    } & Record<string, unknown>;
    const serialized = JSON.stringify(payload);
    const privateFiles = await readdir(privatePreviewDir);

    expect(response.status).toBe(200);
    expect(privateFiles.some((file) => file.endsWith(".txt"))).toBe(true);
    expect(payload).toMatchObject({
      imported: false,
      reviewStatus: "needs_review",
      preview: {
        approved: false,
        privateTextSaved: true,
        privateStorage: "data/private/extracted/professor-upload-previews/",
        reviewStatus: "needs_review",
        uploadKind: "pdf",
      },
    });
    expect(serialized).toContain("PDFs are private reference material only");
    expect(serialized).toContain("Conditional Probability");
    expect(serialized).not.toContain("What is the answer");
    expect(serialized).not.toMatch(/rawText|extractedText|sourcePage/i);
  });
});

function uploadRequest(file: File, { token = TOKEN } = {}) {
  const formData = new FormData();
  formData.set("file", file);

  return new Request("http://test/api/professor/content-preview", {
    body: formData,
    headers: token ? { "x-professor-token": token } : undefined,
    method: "POST",
  });
}

function texFile() {
  return new File(
    [
      String.raw`
\section{Conditional Probability}
Learning objective: identify the conditioned sample space before computing probability.
\[
P(A\mid B)=\frac{P(A\cap B)}{P(B)}
\]
What is a copied question that should stay private?
`,
    ],
    "conditional-probability.tex",
    { type: "text/x-tex" },
  );
}

function pdfFile() {
  const content = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog >> endobj",
    "2 0 obj << /Length 180 >> stream",
    "BT",
    "(Conditional probability and Bayes rule P(A|B)=P(B|A)P(A)/P(B)) Tj",
    "(What is the answer to this copied question?) Tj",
    "ET",
    "endstream endobj",
    "%%EOF",
  ].join("\n");

  return new File([content], "private-reference.pdf", {
    type: "application/pdf",
  });
}
