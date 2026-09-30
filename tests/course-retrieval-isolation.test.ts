import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { searchLocalRetrieval } from "@/lib/ai/retrieval";
import { setContentRepositoryForTests } from "@/lib/data/data-store";
import { demoContentRepository } from "@/lib/data/demo-repository";
import { retrieveTutorContext } from "@/lib/tutor/retrieval";

const PS_COURSE = "probability-statistics";
const CALCULUS_COURSE = "calculus-1";
const PS_TOPIC = "conditional-probability";
const QUERY = "conditional probability given sample space";

beforeEach(() => {
  vi.stubEnv("APP_DEMO_MODE", "true");
  setContentRepositoryForTests(demoContentRepository);
});

afterEach(() => {
  setContentRepositoryForTests(undefined);
  vi.unstubAllEnvs();
});

describe("retrieval never crosses course boundaries", () => {
  it("keeps grounding for Probability & Statistics unchanged", async () => {
    const result = await retrieveTutorContext(QUERY, {
      maxResults: 3,
      topicId: PS_TOPIC,
    });

    expect(result.matches.length).toBeGreaterThan(0);
  });

  it("returns nothing from another course, even for a topic that exists elsewhere", async () => {
    const result = await retrieveTutorContext(QUERY, {
      courseId: CALCULUS_COURSE,
      maxResults: 3,
      topicId: PS_TOPIC,
    });

    expect(result.matches).toEqual([]);
    expect(result.retrievedContext).toEqual([]);
  });

  it("takes the course from the topic when none is given", async () => {
    const fromTopic = await retrieveTutorContext(QUERY, { topicId: PS_TOPIC });
    const explicit = await retrieveTutorContext(QUERY, {
      courseId: PS_COURSE,
      topicId: PS_TOPIC,
    });

    expect(fromTopic.matches.map((match) => match.chunk.id)).toEqual(
      explicit.matches.map((match) => match.chunk.id),
    );
  });

  it("matches nothing for a topic it cannot place, rather than everything", async () => {
    const result = await retrieveTutorContext(QUERY, {
      topicId: "topic-that-does-not-exist",
    });

    expect(result.matches).toEqual([]);
  });

  it("gives a student request with no course or topic the original course only", async () => {
    const result = await retrieveTutorContext(QUERY);
    const calculus = await retrieveTutorContext(QUERY, {
      courseId: CALCULUS_COURSE,
    });

    expect(result.matches.length).toBeGreaterThan(0);
    expect(calculus.matches).toEqual([]);
  });

  it("filters local keyword retrieval by the course's syllabus", async () => {
    const probability = await searchLocalRetrieval(QUERY, {
      courseId: PS_COURSE,
      maxResults: 5,
    });
    const calculus = await searchLocalRetrieval(QUERY, {
      courseId: CALCULUS_COURSE,
      maxResults: 5,
    });

    expect(probability.length).toBeGreaterThan(0);
    expect(calculus).toEqual([]);
  });
});
