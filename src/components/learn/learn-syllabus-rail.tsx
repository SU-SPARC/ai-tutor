"use client";

import {
  SyllabusRail,
  type SyllabusRailTopic,
} from "@/components/shell/app-rail";
import {
  topicMasteryLevel,
  type LearnTopicRow,
} from "@/components/learn/learn-model";

/**
 * The learn model's syllabus rows as rail rows: week number, title, and a
 * mastery pip. A topic with nothing published keeps its closed glyph (a
 * slashed circle, distinct from "not started"), says "none yet", and is not a
 * link. "Up next" becomes the rail's left rule; the topic whose page is open,
 * if any, gets the active wash.
 *
 * No counts in the rail: it is 264px and the titles are long, so "2 of 6
 * solved" lives in the syllabus list and the topic header instead.
 */
export function toSyllabusRailTopics(
  topics: LearnTopicRow[],
): SyllabusRailTopic[] {
  return topics.map((topic) => ({
    current: topic.isCurrent,
    glyph: topic.glyph,
    href: topic.href,
    id: topic.id,
    masteryLevel: topicMasteryLevel(topic),
    meta: topic.total === 0 ? "none yet" : undefined,
    title: topic.title,
    weekNumber: topic.weekNumber,
  }));
}

export function LearnSyllabusRail({
  activeTopicId,
  topics,
}: {
  activeTopicId?: string;
  topics: LearnTopicRow[];
}) {
  return (
    <SyllabusRail
      activeTopicId={activeTopicId}
      topics={toSyllabusRailTopics(topics)}
    />
  );
}
