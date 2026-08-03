import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as uploadAdminContent } from "@/app/api/admin/upload/route";
import {
  ADMIN_CONTENT_UPLOAD_MAX_BYTES,
  type AdminContentUploadPreview,
} from "@/lib/tutor/admin-content-upload";
import { mockPrincipal, resetAuthMocks, TEST_ADMIN } from "./auth-test-helpers";

const TOKEN = "admin-secret";
const privatePreviewDir = path.join(
  process.cwd(),
  "data/private/extracted/admin-upload-previews",
);

describe("admin content upload API", () => {
  beforeEach(() => {
    mockPrincipal(TEST_ADMIN);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetAuthMocks();
    await rm(privatePreviewDir, { force: true, recursive: true });
  });

  it("requires the admin role", async () => {
    mockPrincipal(undefined);
    const response = await uploadAdminContent(
      uploadRequest(texFile(), { token: "" }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects unsupported file types and oversized files", async () => {
    const unsupported = await uploadAdminContent(
      uploadRequest(
        new File(["{}"], "notes.json", { type: "application/json" }),
      ),
    );
    const oversized = await uploadAdminContent(
      uploadRequest(
        new File(
          [new Uint8Array(ADMIN_CONTENT_UPLOAD_MAX_BYTES + 1)],
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
    const response = await uploadAdminContent(uploadRequest(texFile()));
    const payload = (await response.json()) as {
      preview: AdminContentUploadPreview;
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
    expect(serialized).toContain("Conditional probability");
    expect(payload.preview.formulas[0]?.symbolicFormula).toContain(
      "P(A\\mid B)",
    );
    expect(serialized).not.toContain("copied question");
    expect(serialized).not.toMatch(/acceptedAnswers|solutionSteps|rawText/i);
  });

  it("extracts PDF text only to ignored private storage and returns abstract preview", async () => {
    const response = await uploadAdminContent(uploadRequest(pdfFile()));
    const payload = (await response.json()) as {
      preview: AdminContentUploadPreview;
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
        privateStorage: "data/private/extracted/admin-upload-previews/",
        reviewStatus: "needs_review",
        uploadKind: "pdf",
      },
    });
    expect(serialized).toContain("PDFs are private reference material only");
    expect(serialized).toContain("Conditional probability");
    expect(serialized).not.toContain("What is the answer");
    expect(serialized).not.toMatch(/rawText|extractedText|sourcePage/i);
  });
});

function uploadRequest(file: File, { token = TOKEN } = {}) {
  const formData = new FormData();
  formData.set("file", file);

  return new Request("http://test/api/admin/upload", {
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
