import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StartGuideButton } from "@/components/tour/start-guide-button";
import {
  clampPopover,
  PROFESSOR_TOUR,
  STUDENT_TOUR,
  shouldAutoStart,
  stepLabel,
  stepsForRole,
  TOUR_MENU_HELPER,
  TOUR_MENU_LABEL,
  TOUR_WELCOME,
  tourStorageKey,
  type TourRole,
} from "@/components/tour/tour-steps";

const ROLES: TourRole[] = ["professor", "student"];
const BANNED = /\bpublish|lifecycle|session|\bWk\b|\bQ-/i;

function words(text: string) {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

describe("onboarding guide steps", () => {
  it("has six steps per role, ending on the account menu", () => {
    for (const role of ROLES) {
      const steps = stepsForRole(role);
      expect(steps).toHaveLength(6);
      expect(steps.at(-1)?.anchor).toBe("account-menu");
      expect(steps.at(-1)?.headline).toBe("Come back any time");
    }
    expect(stepsForRole("professor")).toBe(PROFESSOR_TOUR);
    expect(stepsForRole("student")).toBe(STUDENT_TOUR);
  });

  it("keeps headlines to five words and one sentence of at most twenty", () => {
    for (const step of [...PROFESSOR_TOUR, ...STUDENT_TOUR]) {
      expect(words(step.headline).length).toBeLessThanOrEqual(5);
      expect(words(step.sentence).length).toBeLessThanOrEqual(20);
    }
  });

  it("uses no banned words in any step or the welcome", () => {
    const text = [
      TOUR_WELCOME.headline,
      TOUR_WELCOME.sentence,
      ...[...PROFESSOR_TOUR, ...STUDENT_TOUR].flatMap((step) => [
        step.headline,
        step.sentence,
      ]),
    ];
    for (const line of text) {
      expect(line).not.toMatch(BANNED);
    }
  });

  it("anchors every step to a data-tour attribute that exists in src/", () => {
    const source = sourceFiles(path.join(process.cwd(), "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    const ids = new Set(
      [...PROFESSOR_TOUR, ...STUDENT_TOUR].flatMap((step) =>
        step.fallback ? [step.anchor, step.fallback] : [step.anchor],
      ),
    );
    for (const id of ids) {
      const literal = source.includes(`data-tour="${id}"`);
      const quoted = source.includes(`"${id}"`);
      expect(literal || quoted, id).toBe(true);
    }
  });

  it("numbers steps as Step n of 6 and keys the seen flag per role", () => {
    expect(stepLabel(0, 6)).toBe("Step 1 of 6");
    expect(stepLabel(5, 6)).toBe("Step 6 of 6");
    expect(tourStorageKey("professor")).toBe("ai-tutor:guide:professor");
    expect(tourStorageKey("student")).toBe("ai-tutor:guide:student");
  });

  it("offers Not now before Take the tour on the welcome card", () => {
    expect(TOUR_WELCOME.buttons[0]).toBe("Not now");
    expect(TOUR_WELCOME.buttons[1]).toBe("Take the tour");
    expect(TOUR_WELCOME.headline).toBe("Welcome to AI Tutor");
  });
});

describe("onboarding guide auto-start", () => {
  const unseen = { seen: false, signedIn: true };

  it("starts for a professor on /professor only", () => {
    expect(
      shouldAutoStart({ role: "professor", pathname: "/professor", ...unseen }),
    ).toBe(true);
    expect(
      shouldAutoStart({
        role: "professor",
        pathname: "/professor/review",
        ...unseen,
      }),
    ).toBe(false);
    expect(
      shouldAutoStart({ role: "professor", pathname: "/learn", ...unseen }),
    ).toBe(false);
  });

  it("starts for a student on /learn only", () => {
    expect(
      shouldAutoStart({ role: "student", pathname: "/learn", ...unseen }),
    ).toBe(true);
    expect(
      shouldAutoStart({ role: "student", pathname: "/onboarding", ...unseen }),
    ).toBe(false);
    expect(
      shouldAutoStart({ role: "student", pathname: "/practice", ...unseen }),
    ).toBe(false);
  });

  it("never starts once seen, for signed-out visitors, or on the landing page", () => {
    expect(
      shouldAutoStart({
        role: "professor",
        pathname: "/professor",
        seen: true,
        signedIn: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoStart({
        role: "student",
        pathname: "/learn",
        seen: true,
        signedIn: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoStart({
        role: null,
        pathname: "/learn",
        seen: false,
        signedIn: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoStart({
        role: "student",
        pathname: "/learn",
        seen: false,
        signedIn: false,
      }),
    ).toBe(false);
    for (const role of ROLES) {
      expect(shouldAutoStart({ role, pathname: "/", ...unseen })).toBe(false);
    }
  });
});

describe("onboarding guide menu item", () => {
  it("reads Onboarding guide with its helper line and no role words", () => {
    const markup = renderToStaticMarkup(createElement(StartGuideButton));

    expect(markup).toContain(TOUR_MENU_LABEL);
    expect(markup).toContain("Onboarding guide");
    expect(markup).toContain(TOUR_MENU_HELPER);
    expect(markup).toContain('type="button"');
    expect(markup).toContain("min-h-11");
    expect(markup).not.toMatch(/student|professor|ghost|provider|oidc/i);
    expect(markup).not.toContain("bg-mint");
  });
});

describe("onboarding guide card clamp", () => {
  const card = { width: 352, height: 201 };

  it("pulls a card placed past the right edge back on screen (800px window)", () => {
    // The live defect: the card at x 837 in an 800px-wide window.
    expect(
      clampPopover(
        { left: 837, top: 375, ...card },
        { width: 800, height: 628 },
      ),
    ).toEqual({ left: 800 - 8 - 352, top: 375 });
  });

  it("keeps the bottom edge 8px inside the window", () => {
    expect(
      clampPopover(
        { left: 100, top: 560, ...card },
        { width: 1100, height: 628 },
      ),
    ).toEqual({ left: 100, top: 628 - 8 - 201 });
  });

  it("pins to the top-left margin when placed off the top or left", () => {
    expect(
      clampPopover(
        { left: -40, top: -12, ...card },
        { width: 1100, height: 628 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });

  it("leaves a card that already fits where it is", () => {
    expect(
      clampPopover(
        { left: 408, top: 214, ...card },
        { width: 800, height: 628 },
      ),
    ).toEqual({ left: 408, top: 214 });
    expect(
      clampPopover(
        { left: 700, top: 214, ...card },
        { width: 1100, height: 628 },
      ),
    ).toEqual({ left: 700, top: 214 });
  });

  it("pins a card wider than the window to the left margin", () => {
    expect(
      clampPopover(
        { left: 30, top: 20, width: 400, height: 201 },
        { width: 380, height: 700 },
      ),
    ).toEqual({ left: 8, top: 20 });
  });
});
