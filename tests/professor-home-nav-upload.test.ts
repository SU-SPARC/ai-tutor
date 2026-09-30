import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  formatUploadSize,
  ProfessorUploadPanel,
  uploadFileProblem,
} from "@/components/professor/professor-upload-panel";
import {
  PROFESSOR_NAV,
  PROFESSOR_SECTION_GROUPS,
  STUDENT_NAV,
} from "@/components/shell/nav-config";

const MAX = 512_000;

describe("professor navigation", () => {
  it("groups the professor pages in plain words", () => {
    expect(
      PROFESSOR_SECTION_GROUPS.map((group) => [
        group.heading,
        group.sections.map((section) => `${section.label} ${section.href}`),
      ]),
    ).toEqual([
      [
        "Teach",
        [
          "Home /professor",
          "Review questions /professor/review",
          "Question bank /professor/questions",
          "What students see /professor/availability",
        ],
      ],
      [
        "Students",
        [
          "Students /professor/students",
          "Class progress /professor/analytics",
          "Reports from students /professor/feedback",
        ],
      ],
      ["Courses", ["Courses /professor/courses"]],
      [
        "Less often",
        [
          "Upload notes /professor/upload",
          "Copy questions in or out /professor/content-transfer",
        ],
      ],
    ]);
  });

  it("counts only questions waiting for review", () => {
    const counted = PROFESSOR_SECTION_GROUPS.flatMap((group) =>
      group.sections.filter((section) => section.countKey),
    );
    expect(counted.map((section) => section.label)).toEqual([
      "Review questions",
    ]);
  });

  it("names the professor header links Home and Student view, leaving students alone", () => {
    expect(PROFESSOR_NAV.map((item) => item.label)).toEqual([
      "Home",
      "Student view",
    ]);
    expect(STUDENT_NAV.map((item) => item.label)).toEqual([
      "Learn",
      "Practice",
    ]);
  });
});

describe("upload notes", () => {
  it("states the limit as 500 KB, matching the server", () => {
    expect(formatUploadSize(MAX)).toBe("500 KB");
  });

  it("checks the file in the browser before sending it", () => {
    expect(uploadFileProblem({ name: "week3-notes.pdf", size: 2_200_000 }, MAX))
      .toBe(
        "This file is 2.1 MB. Files must be 500 KB or smaller; try saving a shorter PDF.",
      );
    expect(uploadFileProblem({ name: "notes.docx", size: 10 }, MAX)).toBe(
      "This file isn't a PDF or .tex file we can read. Try exporting it again as PDF.",
    );
    expect(uploadFileProblem({ name: "Week3.TEX", size: 10 }, MAX)).toBe(
      undefined,
    );
  });

  it("labels the field and button in plain words and keeps the privacy line", () => {
    const markup = renderToStaticMarkup(
      createElement(ProfessorUploadPanel, { maxBytes: MAX }),
    );
    expect(markup).toContain("Your lecture notes");
    expect(markup).toContain(
      "A PDF or LaTeX (.tex) file, up to 500 KB. Example: week3-notes.pdf",
    );
    expect(markup).toContain("Upload and preview");
    expect(markup).toContain("Your file stays private. Students never see it.");
    expect(markup).not.toContain("Preview extraction");
  });
});
