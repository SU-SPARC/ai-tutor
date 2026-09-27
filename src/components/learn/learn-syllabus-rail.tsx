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
 * mastery pip (a topic with nothing published keeps its closed glyph and is
 * not a link). "You are here" becomes the rail's left rule; the topic whose
 * page is open, if any, gets the active wash.
 *
 * No right-hand meta: the rail is 264px and the titles are long, so the
 * counts live in the syllabus list and the topic header instead.
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
