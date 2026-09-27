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

export function sortQuestionsForSyllabus(questions: TutorQuestion[]) {
  return [...questions].sort(
    (left, right) =>
      compareCanonicalTopicIds(left.topicId, right.topicId) ||
      left.title.localeCompare(right.title) ||
      left.id.localeCompare(right.id),
  );
}
