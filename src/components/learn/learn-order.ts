import { compareCanonicalTopicIds } from "@/lib/data/canonical-syllabus-topics";
import type { CourseTopic, TutorQuestion } from "@/lib/types";

/**
 * Canonical syllabus order, matching `getStudentProgress` exactly so the
 * numbers on `/learn` line up with the progress they describe. Kept out of
 * `learn-model.ts` so the canonical topic table never reaches the browser.
 */
export function sortTopicsForSyllabus(topics: CourseTopic[]) {
  return [...topics].sort(
    (left, right) =>
      compareCanonicalTopicIds(left.id, right.id) ||
      left.order - right.order ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}

/**
 * Inside a topic questions run Intro → Core → Stretch, so "Question 1 of 5",
 * the Continue card and "Up next" follow the course's own sequence rather
 * than the alphabet. `getStudentProgress` uses the same ranks.
 */
const DIFFICULTY_RANK: Record<TutorQuestion["difficulty"], number> = {
  foundational: 0,
  intermediate: 1,
  challenge: 2,
};

export function sortQuestionsForSyllabus(questions: TutorQuestion[]) {
  return [...questions].sort(
    (left, right) =>
      compareCanonicalTopicIds(left.topicId, right.topicId) ||
      (DIFFICULTY_RANK[left.difficulty] ?? 3) -
        (DIFFICULTY_RANK[right.difficulty] ?? 3) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}
