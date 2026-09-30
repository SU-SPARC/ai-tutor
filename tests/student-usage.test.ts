import { describe, expect, it } from "vitest";

import {
  formatActiveTime,
  studentUsageDisclosure,
} from "@/lib/professor/student-usage";

describe("formatActiveTime", () => {
  it("says a measured zero in words", () => {
    expect(formatActiveTime(0)).toBe("None yet");
    expect(formatActiveTime(-15)).toBe("None yet");
  });

  it("says less than a minute in words, never with a symbol", () => {
    expect(formatActiveTime(15)).toBe("Under a minute");
    expect(formatActiveTime(59.9)).toBe("Under a minute");
  });

  it("spells out minutes with the right plural", () => {
    expect(formatActiveTime(60)).toBe("1 minute");
    expect(formatActiveTime(119)).toBe("1 minute");
    expect(formatActiveTime(12 * 60)).toBe("12 minutes");
    expect(formatActiveTime(59 * 60 + 59)).toBe("59 minutes");
  });

  it("spells out hours, with minutes only when there are some", () => {
    expect(formatActiveTime(3600)).toBe("1 hour");
    expect(formatActiveTime(2 * 3600)).toBe("2 hours");
    expect(formatActiveTime(3600 + 60)).toBe("1 hour 1 minute");
    expect(formatActiveTime(2 * 3600 + 5 * 60)).toBe("2 hours 5 minutes");
  });

  it("never abbreviates", () => {
    for (const seconds of [0, 30, 60, 750, 3600, 7500, 100_000]) {
      expect(formatActiveTime(seconds)).not.toMatch(/\d[hm]\b|<|\bmin\b|\bhr\b/);
    }
  });
});

describe("studentUsageDisclosure", () => {
  it("names the AI tutor count, not the messages, while sketchpad time is off", () => {
    expect(studentUsageDisclosure(false)).toBe(
      "Your professor also sees how many times you asked the AI tutor, not what you wrote.",
    );
  });

  it("adds sketchpad time in the same sentence once it is measured", () => {
    expect(studentUsageDisclosure(true)).toBe(
      "Your professor also sees how many times you asked the AI tutor and about how long you spent on the sketchpad, not what you wrote or drew.",
    );
  });
});
